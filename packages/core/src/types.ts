/**
 * Core data model. The `Grid` is the universal intermediate representation:
 * the editor edits a Grid, the assembler builds one from instructions, the
 * encoder renders it to WAV, the decoder recovers it from WAV, the parser
 * turns it into instructions, and the VM runs them.
 */

/** The 9 drum symbols of the alphabet (SPEC §1). Rest = absence of a hit. */
export type DrumSymbol = "K" | "S" | "H" | "T1" | "T2" | "T3" | "FT" | "C" | "R";

/** The four opcode-family instruments (SPEC §2). */
export type OpSym = "K" | "S" | "R" | "C";

/** The four register-selector toms (SPEC §3). */
export type TomSym = "T1" | "T2" | "T3" | "FT";

/**
 * One sixteenth-note step. Polyphonic: several lanes can sound at once
 * (e.g. a decorative hat riding under an opcode hit). Empty = rest.
 */
export type Step = DrumSymbol[];

/** One measure of 4/4: exactly 16 steps (SPEC §2). */
export interface MeasureGrid {
  /** The language layer — what the parser reads. */
  steps: Step[];
  /**
   * Ghost notes (SPEC §2 addendum): a decoration layer — any drum on any
   * step, rendered ~9 dB quieter, NEVER semantic. The parser doesn't see
   * this layer; the decoder separates it from real hits by amplitude.
   * Present only when it contains at least one hit.
   */
  ghosts?: Step[];
}

/** A whole program as a grid, one measure per bar. */
export type Grid = MeasureGrid[];

export type Register = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** The 21 opcodes (SPEC §5). */
export type Opcode =
  // Kick — data movement
  | "LOADI"
  | "PUSH"
  | "MOV"
  | "POP"
  // Snare — arithmetic
  | "ADD"
  | "SUB"
  | "MUL"
  | "DIV"
  | "MOD"
  // Ride — I/O
  | "OUTN"
  | "OUTC"
  | "IN"
  | "TONE"
  // Crash — structure & tests
  | "REPEAT_START"
  | "REPEAT_END"
  | "REPEAT_WHILE"
  | "HALT"
  | "SKIPZ"
  | "SKIPNZ"
  | "SKIPLT"
  | "SKIPGE";

/**
 * One decoded instruction.
 *
 * `rd` is the register in the dest subfield (steps 5–6). Single-register
 * instructions (PUSH, OUTN, SKIPZ, …) keep their register here too — it is
 * the *primary* register, whatever its read/write role.
 * `rs` is the source subfield (steps 7–8), two-register ops only.
 * `imm` is the 8-bit operand (steps 9–16), immediate ops only.
 */
export interface Instruction {
  opcode: Opcode;
  rd?: Register;
  rs?: Register;
  imm?: number;
}

/** One bar of a parsed program, index-aligned with the source Grid. */
export type Line =
  | { kind: "code"; bar: number; instr: Instruction }
  | { kind: "groove"; bar: number }
  | { kind: "invalid"; bar: number };

/** A syntax error, reported with its 1-based bar number. */
export interface ParseError {
  bar: number;
  message: string;
}

export interface Program {
  lines: Line[];
  errors: ParseError[];
}

/** `bar 12: tom in opcode field` */
export function formatError(e: ParseError): string {
  return `bar ${e.bar}: ${e.message}`;
}
