import { describe, expect, it } from "vitest";
import {
  formatError,
  opcodeForSequence,
  registerForFill,
  OPCODES,
  OPCODE_INFO,
  REG_TO_FILL,
  type OpSym,
  type Register,
  type TomSym,
} from "../src/index.js";

describe("opcodeForSequence", () => {
  it("resolves every one of the 21 opcodes from its sequence", () => {
    expect(OPCODES).toHaveLength(21);
    for (const info of OPCODES) {
      expect(opcodeForSequence(info.seq)?.opcode).toBe(info.opcode);
    }
  });

  it("resolves specific sequences per SPEC §5", () => {
    expect(opcodeForSequence(["K"])?.opcode).toBe("LOADI");
    expect(opcodeForSequence(["S", "S"])?.opcode).toBe("SUB");
    expect(opcodeForSequence(["R", "S"])?.opcode).toBe("TONE");
    expect(opcodeForSequence(["C", "S", "K"])?.opcode).toBe("SKIPLT");
    expect(opcodeForSequence(["C", "R"])?.opcode).toBe("HALT");
  });

  it("returns undefined for reserved/unknown sequences", () => {
    expect(opcodeForSequence(["K", "C"])).toBeUndefined();
    expect(opcodeForSequence(["R", "C"])).toBeUndefined();
    expect(opcodeForSequence(["K", "K", "K", "K"])).toBeUndefined();
    expect(opcodeForSequence([])).toBeUndefined();
  });

  it("is order-sensitive: K→S is MOV but S→K is MUL", () => {
    expect(opcodeForSequence(["K", "S"])?.opcode).toBe("MOV");
    expect(opcodeForSequence(["S", "K"])?.opcode).toBe("MUL");
  });
});

describe("OPCODE_INFO arity table", () => {
  it("declares the SPEC §5 shapes", () => {
    expect(OPCODE_INFO.LOADI).toMatchObject({ regs: 1, imm: true });
    expect(OPCODE_INFO.REPEAT_START).toMatchObject({ regs: 0, imm: true });
    expect(OPCODE_INFO.MOV).toMatchObject({ regs: 2, imm: false });
    expect(OPCODE_INFO.HALT).toMatchObject({ regs: 0, imm: false });
    expect(OPCODE_INFO.OUTN).toMatchObject({ regs: 1, imm: false });
  });

  it("only LOADI and REPEAT_START take immediates", () => {
    const immOps = OPCODES.filter((o) => o.imm).map((o) => o.opcode);
    expect(immOps.sort()).toEqual(["LOADI", "REPEAT_START"]);
  });
});

describe("register tom-fills (SPEC §3)", () => {
  it("maps every fill to its register and back", () => {
    const expected: [TomSym[], Register][] = [
      [["T1"], 1],
      [["T2"], 2],
      [["T3"], 3],
      [["FT"], 4],
      [["FT", "T1"], 5],
      [["FT", "T2"], 6],
      [["FT", "T3"], 7],
      [["FT", "FT"], 8],
    ];
    for (const [fill, reg] of expected) {
      expect(registerForFill(fill), fill.join("→")).toBe(reg);
      expect(REG_TO_FILL[reg]).toEqual(fill);
    }
  });

  it("rejects fills that are not single-tom or FT-led", () => {
    expect(registerForFill(["T1", "T2"])).toBeUndefined();
    expect(registerForFill(["T2", "FT"])).toBeUndefined();
    expect(registerForFill(["T1", "T1"])).toBeUndefined();
    expect(registerForFill([])).toBeUndefined();
  });
});

describe("formatError", () => {
  it("formats as `bar N: message`", () => {
    expect(formatError({ bar: 7, message: "unknown opcode K→C" })).toBe(
      "bar 7: unknown opcode K→C",
    );
  });
});

// keep the OpSym import earning its keep — the table is typed
const _seqTypeCheck: readonly OpSym[] = OPCODES[0]!.seq;
void _seqTypeCheck;
