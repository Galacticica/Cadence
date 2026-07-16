/** Built-in example programs (SPEC §6) for the Examples menu. */
import type { Instruction } from "@cadence/core";

const I = (
  opcode: Instruction["opcode"],
  fields: Omit<Instruction, "opcode"> = {},
): Instruction => ({ opcode, ...fields });

export interface Example {
  instrs: Instruction[];
  /** Shown in the console when the example loads, and as the option tooltip. */
  note: string;
}

/** TONE per note of a full C-major octave; intervals 2-2-1-2-2-2-1 via R2. */
const SCALE: Instruction[] = [
  I("LOADI", { rd: 1, imm: 60 }), // C4
  I("LOADI", { rd: 2, imm: 2 }), // whole step
  I("TONE", { rd: 1 }), // C
  I("ADD", { rd: 1, rs: 2 }),
  I("TONE", { rd: 1 }), // D
  I("ADD", { rd: 1, rs: 2 }),
  I("TONE", { rd: 1 }), // E
  I("LOADI", { rd: 2, imm: 1 }), // half step
  I("ADD", { rd: 1, rs: 2 }),
  I("TONE", { rd: 1 }), // F
  I("LOADI", { rd: 2, imm: 2 }),
  I("ADD", { rd: 1, rs: 2 }),
  I("TONE", { rd: 1 }), // G
  I("ADD", { rd: 1, rs: 2 }),
  I("TONE", { rd: 1 }), // A
  I("ADD", { rd: 1, rs: 2 }),
  I("TONE", { rd: 1 }), // B
  I("LOADI", { rd: 2, imm: 1 }),
  I("ADD", { rd: 1, rs: 2 }),
  I("TONE", { rd: 1 }), // C5
  I("HALT"),
];

export const EXAMPLES: Record<string, Example> = {
  "Countdown (5 4 3 2 1)": {
    note: "a REPEAT_WHILE loop counts R1 down and prints it each pass",
    instrs: [
      I("LOADI", { rd: 1, imm: 5 }),
      I("LOADI", { rd: 2, imm: 1 }),
      I("REPEAT_WHILE", { rd: 1 }),
      I("OUTN", { rd: 1 }),
      I("SUB", { rd: 1, rs: 2 }),
      I("REPEAT_END"),
      I("HALT"),
    ],
  },
  "Hello, World!": {
    note: "13 characters × (LOADI + OUTC) — a 54-second drum solo that says hi",
    instrs: [
      ...[..."Hello, World!"].flatMap((ch) => [
        I("LOADI", { rd: 1, imm: ch.codePointAt(0)! }),
        I("OUTC", { rd: 1 }),
      ]),
      I("HALT"),
    ],
  },
  "Truth machine": {
    note: "input 0 → prints 0 once and halts · input 1 → prints 1 FOREVER (that's the point — ■ stop to interrupt)",
    instrs: [
      I("IN", { rd: 1 }),
      I("REPEAT_WHILE", { rd: 1 }),
      I("OUTN", { rd: 1 }),
      I("REPEAT_END"),
      I("OUTN", { rd: 1 }),
      I("HALT"),
    ],
  },
  "Even or odd?": {
    note: "MOD 2 then two skips pick the branch — prints E or O",
    instrs: [
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
  },
  "C major scale (TONE)": {
    note: "arithmetic plays music: R1 walks a full octave C4→C5, TONE sounds each note (♪ in the console)",
    instrs: SCALE,
  },
};
