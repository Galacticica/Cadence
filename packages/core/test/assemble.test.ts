import { describe, expect, it } from "vitest";
import {
  assemble,
  assembleMeasure,
  grooveMeasure,
  parse,
} from "../src/index.js";

describe("assembleMeasure canonical placement (SPEC §6.1)", () => {
  it("lays out LOADI R1, 72 exactly like the spec's anatomy diagram", () => {
    const m = assembleMeasure({ opcode: "LOADI", rd: 1, imm: 72 });
    expect(m.steps[0]).toEqual(["K"]);
    expect(m.steps[1]).toEqual([]);
    expect(m.steps[4]).toEqual(["T1"]);
    // 72 = 01001000, audible zeros as hats
    const operand = m.steps.slice(8).map((s) => s[0]);
    expect(operand).toEqual(["H", "S", "H", "H", "S", "H", "H", "H"]);
  });

  it("places multi-hit sequences contiguously from step 1", () => {
    const m = assembleMeasure({ opcode: "SKIPNZ", rd: 8 }); // C S S
    expect(m.steps[0]).toEqual(["C"]);
    expect(m.steps[1]).toEqual(["S"]);
    expect(m.steps[2]).toEqual(["S"]);
    expect(m.steps[3]).toEqual([]);
    // R8 = FT FT fill on steps 5–6
    expect(m.steps[4]).toEqual(["FT"]);
    expect(m.steps[5]).toEqual(["FT"]);
  });

  it("places the source fill at step 7", () => {
    const m = assembleMeasure({ opcode: "MOV", rd: 1, rs: 5 }); // rs = FT T1
    expect(m.steps[6]).toEqual(["FT"]);
    expect(m.steps[7]).toEqual(["T1"]);
  });

  it("defaults a missing immediate to 0", () => {
    const m = assembleMeasure({ opcode: "REPEAT_START" });
    const program = parse([m]);
    expect(program.lines[0]).toMatchObject({
      kind: "code",
      instr: { opcode: "REPEAT_START", imm: 0 },
    });
  });

  it("throws on a missing required register", () => {
    expect(() => assembleMeasure({ opcode: "LOADI", imm: 5 })).toThrowError(
      /missing register rd/,
    );
    expect(() => assembleMeasure({ opcode: "MOV", rd: 1 })).toThrowError(
      /missing register rs/,
    );
  });

  it("throws on an out-of-range immediate", () => {
    expect(() => assembleMeasure({ opcode: "LOADI", rd: 1, imm: 256 })).toThrowError(
      /out of 8-bit range/,
    );
    expect(() => assembleMeasure({ opcode: "LOADI", rd: 1, imm: -1 })).toThrowError(
      /out of 8-bit range/,
    );
    expect(() =>
      assembleMeasure({ opcode: "LOADI", rd: 1, imm: 3.5 }),
    ).toThrowError(/out of 8-bit range/);
  });
});

describe("assemble / grooveMeasure", () => {
  it("assemble maps instructions 1:1 to measures", () => {
    const grid = assemble([
      { opcode: "LOADI", rd: 1, imm: 1 },
      { opcode: "HALT" },
    ]);
    expect(grid).toHaveLength(2);
    expect(grid.every((m) => m.steps.length === 16)).toBe(true);
  });

  it("grooveMeasure is 16 steady hats and parses as a groove NOP", () => {
    const m = grooveMeasure();
    expect(m.steps).toHaveLength(16);
    expect(m.steps.every((s) => s.length === 1 && s[0] === "H")).toBe(true);
    expect(parse([m]).lines[0]).toMatchObject({ kind: "groove" });
  });
});
