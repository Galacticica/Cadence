import { describe, expect, it } from "vitest";
import {
  assemble,
  decode,
  DecodeError,
  encode,
  encodeWav,
  grooveMeasure,
  parse,
  type DrumSymbol,
  type Grid,
} from "@cadence/core";
import { loadKit } from "@cadence/kit";
import {
  ALL_OPCODES,
  COUNTDOWN,
  EVEN_ODD,
  HELLO_WORLD,
  STARS_3x3,
  TRUTH_MACHINE,
} from "../../core/test/fixtures.js";

const kit = loadKit();

const roundTrip = (grid: Grid, bpm: number): void => {
  const result = decode(encode(grid, kit, { bpm }), kit);
  expect(result.grid).toEqual(grid);
  expect(Math.round(result.bpm)).toBe(bpm);
};

describe("encode → decode round-trip (SPEC milestone v1, headless half)", () => {
  const programs = {
    COUNTDOWN,
    TRUTH_MACHINE,
    EVEN_ODD,
    STARS_3x3,
    ALL_OPCODES,
  };

  for (const [name, instrs] of Object.entries(programs)) {
    it(`round-trips ${name} at 120 bpm`, () => {
      roundTrip(assemble(instrs), 120);
    });
  }

  it("round-trips HELLO_WORLD (27 bars) at 120 bpm", () => {
    roundTrip(assemble(HELLO_WORLD), 120);
  });

  it("round-trips the countdown at 60 and 200 bpm", () => {
    roundTrip(assemble(COUNTDOWN), 60);
    roundTrip(assemble(COUNTDOWN), 200);
  });

  it("round-trips groove bars and polyphonic decoration", () => {
    const grid = assemble(COUNTDOWN.slice(0, 2));
    grid.push(grooveMeasure());
    // a SUB bar with hats riding under the opcode and register fields
    const sub = assemble([{ opcode: "SUB", rd: 1, rs: 2 }])[0]!;
    for (let i = 0; i < 8; i++) if (!sub.steps[i]!.includes("H")) sub.steps[i]!.push("H");
    grid.push(sub);
    grid.push(...assemble([{ opcode: "HALT" }]));
    // canonical symbol order within a step: K/S before H etc.
    const normalized = grid.map((m) => ({
      steps: m.steps.map((s) =>
        [...s].sort(
          (a, b) =>
            ["K", "S", "H", "T1", "T2", "T3", "FT", "C", "R"].indexOf(a) -
            ["K", "S", "H", "T1", "T2", "T3", "FT", "C", "R"].indexOf(b),
        ),
      ),
    }));
    const result = decode(encode(grid, kit, { bpm: 120 }), kit);
    expect(result.grid).toEqual(normalized);
  });

  it("decoded grid parses and still means the same program", () => {
    const grid = assemble(COUNTDOWN);
    const { grid: decoded } = decode(encode(grid, kit, { bpm: 120 }), kit);
    const program = parse(decoded);
    expect(program.errors).toEqual([]);
    expect(
      program.lines.map((l) => (l.kind === "code" ? l.instr : l.kind)),
    ).toEqual(COUNTDOWN);
  });

  it("is a fixpoint: re-encoding the decoded grid reproduces the WAV", () => {
    const grid = assemble(COUNTDOWN);
    const wav1 = encode(grid, kit, { bpm: 120 });
    const { grid: decoded, bpm } = decode(wav1, kit);
    const wav2 = encode(decoded, kit, { bpm: Math.round(bpm) });
    expect(Buffer.from(wav2).equals(Buffer.from(wav1))).toBe(true);
  });
});

describe("count-in handshake", () => {
  it("rejects audio with no count-in", () => {
    // two seconds of a 440 Hz sine — clearly not a Cadence program
    const sine = new Float32Array(88200);
    for (let i = 0; i < sine.length; i++)
      sine[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / 44100);
    expect(() => decode(encodeWav(sine), kit)).toThrowError(DecodeError);
  });

  it("rejects silence", () => {
    expect(() => decode(encodeWav(new Float32Array(88200)), kit)).toThrowError(
      /count-in/,
    );
  });
});

describe("template separability (the confusion matrix)", () => {
  const symbols: DrumSymbol[] = ["K", "S", "H", "T1", "T2", "T3", "FT", "C", "R"];

  for (const sym of symbols) {
    it(`classifies a lone ${sym} as itself`, () => {
      const grid: Grid = [
        { steps: Array.from({ length: 16 }, (_, i) => (i === 0 ? [sym] : [])) },
      ];
      const { grid: decoded } = decode(encode(grid, kit, { bpm: 120 }), kit);
      expect(decoded).toEqual(grid);
    });
  }

  it("every template's self-match dominates every cross-match", () => {
    const heads = symbols.map((sym) => {
      const s = kit.samples[sym].subarray(0, 1024);
      const norm = Math.sqrt(s.reduce((e, v) => e + v * v, 0));
      return { sym, s, norm };
    });
    for (const a of heads) {
      for (const b of heads) {
        if (a.sym === b.sym) continue;
        let d = 0;
        for (let i = 0; i < 1024; i++) d += a.s[i]! * b.s[i]!;
        const corr = d / (a.norm * b.norm);
        // cross-correlation must stay clearly below the acceptance threshold
        expect(
          Math.abs(corr),
          `${a.sym} vs ${b.sym} corr ${corr.toFixed(3)}`,
        ).toBeLessThan(0.7);
      }
    }
  });
});
