/**
 * The user-facing guarantee behind ghost notes: a program saved WITH ghost
 * decoration, then reloaded from the .wav, still RUNS as exactly the same
 * program — same parse, same output — and the decoration itself survives.
 */
import { describe, expect, it } from "vitest";
import {
  assemble,
  decode,
  DecodeError,
  encode,
  encodeWav,
  parse,
  renderOutput,
  runToCompletion,
  type Grid,
  type Step,
} from "@cadence/core";
import { loadKit, manifest, KIT_SYMBOLS } from "@cadence/kit";
import { COUNTDOWN, EVEN_ODD } from "../../core/test/fixtures.js";

const kit = loadKit();
const emptySteps = (): Step[] => Array.from({ length: 16 }, () => []);

/** Sprinkle ghost decoration over a grid without touching the language layer. */
function decorate(grid: Grid): Grid {
  return grid.map((measure, b) => {
    const ghosts = emptySteps();
    // a soft kick pickup before every downbeat…
    ghosts[15]!.push("K");
    // …ghost snare drags through the register and operand fields…
    ghosts[5]!.push("S");
    ghosts[10]!.push("S");
    // …and alternating extras per bar, including opcode-field intruders
    // that would be syntax errors as real hits
    if (b % 2 === 0) ghosts[1]!.push("FT");
    else ghosts[2]!.push("C");
    return { steps: measure.steps.map((s) => [...s]), ghosts };
  });
}

describe("saving a program with ghost notes, then reloading it", () => {
  it("countdown still prints 5 4 3 2 1 after a decorated save→open round-trip", () => {
    const clean = assemble(COUNTDOWN);
    const decorated = decorate(clean);

    const wav = encode(decorated, kit, { bpm: 120 });
    const { grid: reloaded, bpm } = decode(wav, kit);

    // the decoration survived byte-for-byte…
    expect(reloaded).toEqual(decorated);
    expect(Math.round(bpm)).toBe(120);

    // …the language layer is untouched…
    const program = parse(reloaded);
    expect(program.errors).toEqual([]);
    expect(
      program.lines.map((l) => (l.kind === "code" ? l.instr : l.kind)),
    ).toEqual(COUNTDOWN);

    // …and the reloaded program RUNS identically to the clean one.
    const cleanOut = renderOutput(runToCompletion(parse(clean)));
    const reloadedOut = renderOutput(runToCompletion(program));
    expect(reloadedOut).toBe(cleanOut);
    expect(reloadedOut).toBe("5 4 3 2 1 ");
  });

  it("a decorated interactive program (even/odd) still branches correctly", () => {
    const decorated = decorate(assemble(EVEN_ODD));
    const { grid: reloaded } = decode(encode(decorated, kit, { bpm: 120 }), kit);
    const program = parse(reloaded);
    expect(program.errors).toEqual([]);
    expect(renderOutput(runToCompletion(program, [4n]))).toBe("E");
    expect(renderOutput(runToCompletion(program, [7n]))).toBe("O");
  });

  it("re-encoding the reloaded decorated grid is a byte fixpoint", () => {
    const decorated = decorate(assemble(COUNTDOWN));
    const wav1 = encode(decorated, kit, { bpm: 120 });
    const { grid: reloaded } = decode(wav1, kit);
    const wav2 = encode(reloaded, kit, { bpm: 120 });
    expect(Buffer.from(wav2).equals(Buffer.from(wav1))).toBe(true);
  });
});

describe("encode input validation", () => {
  const grid = assemble([{ opcode: "HALT" }]);

  it("rejects a non-positive bpm", () => {
    expect(() => encode(grid, kit, { bpm: 0 })).toThrowError(/invalid bpm/);
    expect(() => encode(grid, kit, { bpm: -120 })).toThrowError(/invalid bpm/);
  });

  it("rejects a kit at the wrong sample rate", () => {
    expect(() =>
      encode(grid, { sampleRate: 48000, samples: kit.samples }),
    ).toThrowError(/44100/);
  });
});

describe("decode input validation", () => {
  it("rejects programs at the wrong sample rate", () => {
    const bytes = encodeWav(new Float32Array(44100), 22050);
    expect(() => decode(bytes, kit)).toThrowError(DecodeError);
    expect(() => decode(bytes, kit)).toThrowError(/44100/);
  });

  it("rejects bytes that are not a WAV at all", () => {
    expect(() => decode(Uint8Array.from([9, 9, 9, 9]), kit)).toThrowError(/not a WAV/);
  });
});

describe("kit manifest contract", () => {
  it("covers the 9 language symbols plus CLICK, each with a file", () => {
    expect(KIT_SYMBOLS).toHaveLength(10);
    expect(KIT_SYMBOLS).toContain("CLICK");
    for (const sym of KIT_SYMBOLS) {
      expect(manifest.kit[sym]?.file, sym).toMatch(/^samples\/.+\.wav$/);
    }
  });

  it("declares the canonical format and the tone base note", () => {
    expect(manifest.format).toMatchObject({
      codec: "pcm_s16le",
      sampleRate: 44100,
      bitDepth: 16,
      channels: 1,
    });
    expect(manifest.tone.baseMidi).toBe(60);
    expect(manifest.tone.file).toMatch(/^tone\/.+\.wav$/);
  });
});
