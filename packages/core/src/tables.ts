/**
 * Bidirectional lookup tables for the instruction set (SPEC §5) and
 * register tom-fills (SPEC §3). Pure data — shared by parser and assembler.
 */
import type { DrumSymbol, Opcode, OpSym, Register, TomSym } from "./types.js";

export interface OpcodeInfo {
  opcode: Opcode;
  /** The ordered instrument sequence in the opcode field, e.g. C→S→K. */
  seq: readonly OpSym[];
  /** How many register operands the instruction takes. */
  regs: 0 | 1 | 2;
  /** Whether steps 9–16 carry an 8-bit immediate. */
  imm: boolean;
}

const op = (
  opcode: Opcode,
  seq: readonly OpSym[],
  regs: 0 | 1 | 2,
  imm = false,
): OpcodeInfo => ({ opcode, seq, regs, imm });

/** All 21 instructions (SPEC §5). */
export const OPCODES: readonly OpcodeInfo[] = [
  // Kick — data movement
  op("LOADI", ["K"], 1, true),
  op("PUSH", ["K", "K"], 1),
  op("MOV", ["K", "S"], 2),
  op("POP", ["K", "R"], 1),
  // Snare — arithmetic
  op("ADD", ["S"], 2),
  op("SUB", ["S", "S"], 2),
  op("MUL", ["S", "K"], 2),
  op("DIV", ["S", "R"], 2),
  op("MOD", ["S", "C"], 2),
  // Ride — I/O
  op("OUTN", ["R"], 1),
  op("OUTC", ["R", "R"], 1),
  op("IN", ["R", "K"], 1),
  op("TONE", ["R", "S"], 1),
  // Crash — structure & tests
  op("REPEAT_START", ["C"], 0, true),
  op("REPEAT_END", ["C", "C"], 0),
  op("REPEAT_WHILE", ["C", "K"], 1),
  op("HALT", ["C", "R"], 0),
  op("SKIPZ", ["C", "S"], 1),
  op("SKIPNZ", ["C", "S", "S"], 1),
  op("SKIPLT", ["C", "S", "K"], 2),
  op("SKIPGE", ["C", "S", "R"], 2),
];

const seqKey = (seq: readonly OpSym[]): string => seq.join(">");

export const SEQ_TO_OPCODE: ReadonlyMap<string, OpcodeInfo> = new Map(
  OPCODES.map((o) => [seqKey(o.seq), o]),
);

export const OPCODE_INFO: Readonly<Record<Opcode, OpcodeInfo>> = Object.fromEntries(
  OPCODES.map((o) => [o.opcode, o]),
) as Record<Opcode, OpcodeInfo>;

/** Look up an opcode by its instrument sequence, or undefined if unknown. */
export function opcodeForSequence(seq: readonly OpSym[]): OpcodeInfo | undefined {
  return SEQ_TO_OPCODE.get(seqKey(seq));
}

/** Register tom-fills (SPEC §3): index 1–8 → the fill that reaches it. */
export const REG_TO_FILL: readonly (readonly TomSym[])[] = [
  /* 0 unused */ [],
  ["T1"],
  ["T2"],
  ["T3"],
  ["FT"],
  ["FT", "T1"],
  ["FT", "T2"],
  ["FT", "T3"],
  ["FT", "FT"],
];

const FILL_TO_REG: ReadonlyMap<string, Register> = new Map(
  ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((r) => [REG_TO_FILL[r]!.join(">"), r]),
);

/** Look up a register by its tom fill, or undefined if the fill is invalid. */
export function registerForFill(fill: readonly TomSym[]): Register | undefined {
  return FILL_TO_REG.get(fill.join(">"));
}

export const OP_SYMS: ReadonlySet<DrumSymbol> = new Set(["K", "S", "R", "C"]);
export const TOM_SYMS: ReadonlySet<DrumSymbol> = new Set(["T1", "T2", "T3", "FT"]);

/** Human name of an instrument, for error messages. */
export const SYMBOL_NAME: Readonly<Record<DrumSymbol, string>> = {
  K: "kick",
  S: "snare",
  H: "hat",
  T1: "tom",
  T2: "tom",
  T3: "tom",
  FT: "tom",
  C: "crash",
  R: "ride",
};
