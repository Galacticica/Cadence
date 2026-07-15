import { describe, expect, it } from "vitest";
import {
  assemble,
  assembleMeasure,
  check,
  formatError,
  grooveMeasure,
  parse,
  OPCODES,
  type Instruction,
  type MeasureGrid,
  type Register,
  type Step,
} from "../src/index.js";
import { ALL_OPCODES, COUNTDOWN } from "./fixtures.js";

/** Parse a grid and return just the instructions (asserting no errors). */
function roundTrip(instrs: Instruction[]): Instruction[] {
  const program = parse(assemble(instrs));
  expect(program.errors).toEqual([]);
  return program.lines.map((l) => {
    expect(l.kind).toBe("code");
    return (l as Extract<typeof l, { kind: "code" }>).instr;
  });
}

const emptyMeasure = (): MeasureGrid => ({
  steps: Array.from({ length: 16 }, () => [] as Step),
});

describe("assemble → parse round-trip", () => {
  it("round-trips all 21 opcodes", () => {
    expect(roundTrip(ALL_OPCODES)).toEqual(ALL_OPCODES);
  });

  it("round-trips every register as dest, including FT-led fills R5–R8", () => {
    for (let r = 1; r <= 8; r++) {
      const instrs: Instruction[] = [{ opcode: "OUTN", rd: r as Register }];
      expect(roundTrip(instrs)).toEqual(instrs);
    }
  });

  it("round-trips every register pair for two-register ops", () => {
    for (let rd = 1; rd <= 8; rd++) {
      for (let rs = 1; rs <= 8; rs++) {
        const instrs: Instruction[] = [
          { opcode: "ADD", rd: rd as Register, rs: rs as Register },
        ];
        expect(roundTrip(instrs)).toEqual(instrs);
      }
    }
  });

  it("round-trips operand values MSB-first", () => {
    for (const imm of [0, 1, 72, 128, 250, 255]) {
      const instrs: Instruction[] = [{ opcode: "LOADI", rd: 1, imm }];
      expect(roundTrip(instrs)).toEqual(instrs);
    }
  });

  it("keeps the sequence table unambiguous (no duplicate sequences)", () => {
    const keys = OPCODES.map((o) => o.seq.join(">"));
    expect(new Set(keys).size).toBe(OPCODES.length);
  });
});

describe("SPEC §6.1 worked example", () => {
  it("parses the LOADI R1, 72 anatomy measure", () => {
    // kick on 1; T1 on 5; operand 01001000: snare on 10 and 13, hats elsewhere
    const m = emptyMeasure();
    m.steps[0] = ["K"];
    m.steps[4] = ["T1"];
    const bits = [0, 1, 0, 0, 1, 0, 0, 0];
    bits.forEach((b, i) => {
      m.steps[8 + i] = [b ? "S" : "H"];
    });
    const program = parse([m]);
    expect(program.errors).toEqual([]);
    expect(program.lines[0]).toMatchObject({
      kind: "code",
      instr: { opcode: "LOADI", rd: 1, imm: 72 },
    });
  });

  it("parses SUB R1, R2 with free follow-up placement", () => {
    // S on 1, S on 2 · T1 on 5, T2 on 7 — and again with the snare on step 4
    for (const snareStep of [1, 2, 3] as const) {
      const m = emptyMeasure();
      m.steps[0] = ["S"];
      m.steps[snareStep] = ["S"];
      m.steps[4] = ["T1"];
      m.steps[6] = ["T2"];
      const program = parse([m]);
      expect(program.errors).toEqual([]);
      expect(program.lines[0]).toMatchObject({
        kind: "code",
        instr: { opcode: "SUB", rd: 1, rs: 2 },
      });
    }
  });
});

describe("groove and decoration", () => {
  it("treats a hat-only bar as groove", () => {
    const program = parse([grooveMeasure()]);
    expect(program.errors).toEqual([]);
    expect(program.lines[0]).toMatchObject({ kind: "groove" });
  });

  it("treats an empty step 1 as groove", () => {
    const m = emptyMeasure();
    m.steps[3] = ["K"]; // an opcode instrument, but not on the downbeat
    expect(parse([m]).lines[0]).toMatchObject({ kind: "groove" });
  });

  it("treats a tom downbeat as groove", () => {
    const m = emptyMeasure();
    m.steps[0] = ["T1"];
    expect(parse([m]).lines[0]).toMatchObject({ kind: "groove" });
  });

  it("treats a two-opcode-instrument chord on step 1 as groove", () => {
    const m = emptyMeasure();
    m.steps[0] = ["K", "S"];
    expect(parse([m]).lines[0]).toMatchObject({ kind: "groove" });
  });

  it("ignores hats riding under the opcode and register fields", () => {
    const m = assembleMeasure({ opcode: "SUB", rd: 1, rs: 2 });
    for (let i = 0; i < 8; i++) m.steps[i]!.push("H");
    const program = parse([m]);
    expect(program.errors).toEqual([]);
    expect(program.lines[0]).toMatchObject({
      kind: "code",
      instr: { opcode: "SUB", rd: 1, rs: 2 },
    });
  });

  it("ignores the operand field entirely for register–register ops", () => {
    const m = assembleMeasure({ opcode: "ADD", rd: 1, rs: 2 });
    m.steps[8] = ["C"]; // would be an error in a live operand field
    m.steps[9] = ["T1", "H"];
    const program = parse([m]);
    expect(program.errors).toEqual([]);
    expect(program.lines[0]).toMatchObject({
      kind: "code",
      instr: { opcode: "ADD", rd: 1, rs: 2 },
    });
  });
});

describe("syntax errors carry bar numbers", () => {
  it("reports a tom in the opcode field", () => {
    const m = assembleMeasure({ opcode: "OUTN", rd: 1 });
    m.steps[1] = ["T2"];
    const errors = check([grooveMeasure(), m]);
    expect(errors).toHaveLength(1);
    expect(formatError(errors[0]!)).toBe("bar 2: tom in opcode field");
  });

  it("reports an unknown opcode sequence K→C", () => {
    const m = emptyMeasure();
    m.steps[0] = ["K"];
    m.steps[2] = ["C"];
    const errors = check([m]);
    expect(errors.some((e) => formatError(e) === "bar 1: unknown opcode K→C")).toBe(
      true,
    );
  });

  it("reports a non-tom instrument in the register field", () => {
    const m = assembleMeasure({ opcode: "OUTN", rd: 1 });
    m.steps[5] = ["K"];
    const errors = check([m]);
    expect(errors.some((e) => e.message === "kick in register field")).toBe(true);
    expect(errors[0]!.bar).toBe(1);
  });

  it("reports a crash in a live operand field", () => {
    const m = assembleMeasure({ opcode: "LOADI", rd: 1, imm: 5 });
    m.steps[10] = ["C"];
    const errors = check([m]);
    expect(errors.some((e) => e.message === "crash in operand field")).toBe(true);
  });

  it("reports a source register on a single-register op", () => {
    const m = assembleMeasure({ opcode: "OUTN", rd: 1 });
    m.steps[6] = ["T2"];
    const errors = check([m]);
    expect(errors.some((e) => e.message.includes("unexpected source register"))).toBe(
      true,
    );
  });

  it("reports a missing register", () => {
    const m = emptyMeasure();
    m.steps[0] = ["R"]; // OUTN with no tom
    const errors = check([m]);
    expect(errors.some((e) => e.message.includes("missing register"))).toBe(true);
  });

  it("reports an invalid two-tom fill", () => {
    const m = assembleMeasure({ opcode: "OUTN", rd: 1 });
    m.steps[4] = ["T1"];
    m.steps[5] = ["T2"]; // T1→T2 is not a valid fill (must be FT-led)
    const errors = check([m]);
    expect(errors.some((e) => e.message.includes("unknown register fill T1→T2"))).toBe(
      true,
    );
  });

  it("reports unmatched repeat structure", () => {
    const open = check(assemble([{ opcode: "REPEAT_START", imm: 2 }]));
    expect(open.some((e) => e.message === "unclosed repeat block")).toBe(true);
    const stray = check(assemble([{ opcode: "REPEAT_END" }]));
    expect(stray.some((e) => e.message === "unmatched REPEAT_END")).toBe(true);
  });

  it("parses the countdown clean", () => {
    expect(check(assemble(COUNTDOWN))).toEqual([]);
  });
});
