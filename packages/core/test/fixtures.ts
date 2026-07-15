/**
 * Shared program fixtures — the SPEC §6 examples as Instruction[].
 * Reused across parser, VM, and (later) encode/decode round-trip suites.
 */
import type { Instruction } from "../src/index.js";

const I = (
  opcode: Instruction["opcode"],
  fields: Omit<Instruction, "opcode"> = {},
): Instruction => ({ opcode, ...fields });

/** Countdown — prints 5 4 3 2 1 (SPEC §6.7). */
export const COUNTDOWN: Instruction[] = [
  I("LOADI", { rd: 1, imm: 5 }),
  I("LOADI", { rd: 2, imm: 1 }),
  I("REPEAT_WHILE", { rd: 1 }),
  I("OUTN", { rd: 1 }),
  I("SUB", { rd: 1, rs: 2 }),
  I("REPEAT_END"),
  I("HALT"),
];

/** Truth machine — 0 prints once and halts, 1 prints forever (SPEC §6.7). */
export const TRUTH_MACHINE: Instruction[] = [
  I("IN", { rd: 1 }),
  I("REPEAT_WHILE", { rd: 1 }),
  I("OUTN", { rd: 1 }),
  I("REPEAT_END"),
  I("OUTN", { rd: 1 }),
  I("HALT"),
];

/** Hello, World! — LOADI+OUTC per character (SPEC §6.7). */
export const HELLO_WORLD: Instruction[] = [
  ...[..."Hello, World!"].flatMap((ch) => [
    I("LOADI", { rd: 1, imm: ch.codePointAt(0)! }),
    I("OUTC", { rd: 1 }),
  ]),
  I("HALT"),
];

/** (3 + 4) × 5 = 35 through a scratch register (SPEC §6.3). */
export const ARITH_35: Instruction[] = [
  I("LOADI", { rd: 1, imm: 3 }),
  I("LOADI", { rd: 2, imm: 4 }),
  I("ADD", { rd: 1, rs: 2 }),
  I("LOADI", { rd: 2, imm: 5 }),
  I("MUL", { rd: 1, rs: 2 }),
  I("OUTN", { rd: 1 }),
];

/** DIV/MOD split 42 into tens and ones (SPEC §6.3). */
export const SPLIT_42: Instruction[] = [
  I("LOADI", { rd: 1, imm: 42 }),
  I("MOV", { rd: 3, rs: 1 }),
  I("LOADI", { rd: 2, imm: 10 }),
  I("DIV", { rd: 1, rs: 2 }),
  I("MOD", { rd: 3, rs: 2 }),
  I("OUTN", { rd: 1 }),
  I("OUTN", { rd: 3 }),
];

/** 70,000 in six bars (SPEC §4). */
export const BIG_70000: Instruction[] = [
  I("LOADI", { rd: 1, imm: 250 }),
  I("LOADI", { rd: 2, imm: 4 }),
  I("MUL", { rd: 1, rs: 2 }),
  I("LOADI", { rd: 2, imm: 70 }),
  I("MUL", { rd: 1, rs: 2 }),
  I("OUTN", { rd: 1 }),
];

/** 10^32 by repeated squaring — exercises BigInt beyond 2^53. */
export const BIG_10_POW_32: Instruction[] = [
  I("LOADI", { rd: 1, imm: 10 }),
  I("MUL", { rd: 1, rs: 1 }), // 10^2
  I("MUL", { rd: 1, rs: 1 }), // 10^4
  I("MUL", { rd: 1, rs: 1 }), // 10^8
  I("MUL", { rd: 1, rs: 1 }), // 10^16
  I("MUL", { rd: 1, rs: 1 }), // 10^32
  I("OUTN", { rd: 1 }),
];

/** Even/odd detector — prints E or O (SPEC §6.6). */
export const EVEN_ODD: Instruction[] = [
  I("IN", { rd: 1 }),
  I("LOADI", { rd: 2, imm: 2 }),
  I("MOD", { rd: 1, rs: 2 }),
  I("SKIPNZ", { rd: 1 }),
  I("LOADI", { rd: 3, imm: 69 }), // 'E'
  I("SKIPZ", { rd: 1 }),
  I("LOADI", { rd: 3, imm: 79 }), // 'O'
  I("OUTC", { rd: 3 }),
];

/** max(R1, R2) via SKIPGE (SPEC §6.6), parameterized by the two loads. */
export const maxProgram = (a: number, b: number): Instruction[] => [
  I("LOADI", { rd: 1, imm: a }),
  I("LOADI", { rd: 2, imm: b }),
  I("SKIPGE", { rd: 1, rs: 2 }),
  I("MOV", { rd: 1, rs: 2 }),
  I("OUTN", { rd: 1 }),
];

/** Stack swap (SPEC §6.2). */
export const STACK_SWAP: Instruction[] = [
  I("LOADI", { rd: 1, imm: 1 }),
  I("LOADI", { rd: 2, imm: 2 }),
  I("PUSH", { rd: 1 }),
  I("PUSH", { rd: 2 }),
  I("POP", { rd: 1 }),
  I("POP", { rd: 2 }),
  I("OUTN", { rd: 1 }),
  I("OUTN", { rd: 2 }),
];

/** Nested 3×3 square of stars (SPEC §6.5). */
export const STARS_3x3: Instruction[] = [
  I("LOADI", { rd: 1, imm: 42 }), // '*'
  I("LOADI", { rd: 2, imm: 10 }), // newline
  I("REPEAT_START", { imm: 3 }),
  I("REPEAT_START", { imm: 3 }),
  I("OUTC", { rd: 1 }),
  I("REPEAT_END"),
  I("OUTC", { rd: 2 }),
  I("REPEAT_END"),
];

/** REPEAT_START 0 skips its block entirely (SPEC §6.5). */
export const REPEAT_ZERO: Instruction[] = [
  I("LOADI", { rd: 1, imm: 1 }),
  I("REPEAT_START", { imm: 0 }),
  I("OUTN", { rd: 1 }),
  I("REPEAT_END"),
  I("LOADI", { rd: 2, imm: 7 }),
  I("OUTN", { rd: 2 }),
];

/** Multi-measure branch: skip jumps a whole REPEAT_START 1 block (SPEC §6.6). */
export const multiBarBranch = (r1: number): Instruction[] => [
  I("LOADI", { rd: 1, imm: r1 }),
  I("SKIPZ", { rd: 1 }),
  I("REPEAT_START", { imm: 1 }),
  I("OUTN", { rd: 1 }),
  I("REPEAT_END"),
  I("LOADI", { rd: 3, imm: 9 }),
  I("OUTN", { rd: 3 }),
];

/** All 21 opcodes with representative operands, for round-trip sweeps. */
export const ALL_OPCODES: Instruction[] = [
  I("LOADI", { rd: 1, imm: 72 }),
  I("PUSH", { rd: 5 }),
  I("MOV", { rd: 2, rs: 8 }),
  I("POP", { rd: 4 }),
  I("ADD", { rd: 1, rs: 2 }),
  I("SUB", { rd: 3, rs: 4 }),
  I("MUL", { rd: 5, rs: 6 }),
  I("DIV", { rd: 7, rs: 8 }),
  I("MOD", { rd: 8, rs: 1 }),
  I("OUTN", { rd: 1 }),
  I("OUTC", { rd: 2 }),
  I("IN", { rd: 3 }),
  I("TONE", { rd: 4 }),
  I("REPEAT_START", { imm: 1 }),
  I("REPEAT_WHILE", { rd: 6 }),
  I("SKIPZ", { rd: 7 }),
  I("SKIPNZ", { rd: 8 }),
  I("SKIPLT", { rd: 1, rs: 5 }),
  I("SKIPGE", { rd: 2, rs: 6 }),
  I("REPEAT_END"),
  I("REPEAT_END"),
  I("HALT"),
];
