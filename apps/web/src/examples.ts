/** Built-in example programs (SPEC §6) for the Examples menu. */
import type { Instruction } from "@cadence/core";

const I = (
  opcode: Instruction["opcode"],
  fields: Omit<Instruction, "opcode"> = {},
): Instruction => ({ opcode, ...fields });

export const EXAMPLES: Record<string, Instruction[]> = {
  "Countdown (5 4 3 2 1)": [
    I("LOADI", { rd: 1, imm: 5 }),
    I("LOADI", { rd: 2, imm: 1 }),
    I("REPEAT_WHILE", { rd: 1 }),
    I("OUTN", { rd: 1 }),
    I("SUB", { rd: 1, rs: 2 }),
    I("REPEAT_END"),
    I("HALT"),
  ],
  "Hello, World!": [
    ...[..."Hello, World!"].flatMap((ch) => [
      I("LOADI", { rd: 1, imm: ch.codePointAt(0)! }),
      I("OUTC", { rd: 1 }),
    ]),
    I("HALT"),
  ],
  "Truth machine": [
    I("IN", { rd: 1 }),
    I("REPEAT_WHILE", { rd: 1 }),
    I("OUTN", { rd: 1 }),
    I("REPEAT_END"),
    I("OUTN", { rd: 1 }),
    I("HALT"),
  ],
  "Even or odd?": [
    I("IN", { rd: 1 }),
    I("LOADI", { rd: 2, imm: 2 }),
    I("MOD", { rd: 1, rs: 2 }),
    I("SKIPNZ", { rd: 1 }),
    I("LOADI", { rd: 3, imm: 69 }),
    I("SKIPZ", { rd: 1 }),
    I("LOADI", { rd: 3, imm: 79 }),
    I("OUTC", { rd: 3 }),
    I("HALT"),
  ],
  "Scale (TONE)": [
    I("LOADI", { rd: 1, imm: 60 }),
    I("LOADI", { rd: 2, imm: 2 }),
    I("TONE", { rd: 1 }),
    I("ADD", { rd: 1, rs: 2 }),
    I("TONE", { rd: 1 }),
    I("ADD", { rd: 1, rs: 2 }),
    I("TONE", { rd: 1 }),
    I("LOADI", { rd: 2, imm: 1 }),
    I("ADD", { rd: 1, rs: 2 }),
    I("TONE", { rd: 1 }),
    I("HALT"),
  ],
};
