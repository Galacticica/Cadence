/**
 * The VM (SPEC §3, §5): 8 arbitrary-precision registers (BigInt), one stack,
 * structured control flow — repeat blocks and skips, no jumps.
 *
 * Exposed as a generator: it yields VMEvents as execution produces them, and
 * `IN` yields an `input` event whose resume value (gen.next(value)) becomes
 * the register's new contents. Synchronous and deterministic for tests;
 * hosts wrap it for async prompting.
 */
import type { Line, Program, Register } from "./types.js";

export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly bar: number,
  ) {
    super(`bar ${bar}: ${message}`);
    this.name = "RuntimeError";
  }
}

export type VMEvent =
  | { type: "outN"; value: bigint; bar: number }
  | { type: "outC"; codepoint: number; bar: number }
  | { type: "tone"; midi: number; bar: number }
  | { type: "input"; reg: Register; bar: number }
  | { type: "halt"; bar: number }
  /** Emitted for every executed code bar — hosts use it to animate/sound the bar. */
  | { type: "bar"; bar: number };

export interface RunOptions {
  /**
   * Stop (generator returns without a `halt` event) after this many executed
   * code measures. Off by default — infinite loops are legal Cadence.
   */
  maxBars?: number;
  /** Emit `bar` events for every executed code measure. Default false. */
  barEvents?: boolean;
}

type CodeLine = Extract<Line, { kind: "code" }>;

/** Match repeat openers to their ends over the code-line sequence. */
function matchBlocks(code: readonly CodeLine[]): { end: number[]; start: number[] } {
  const end: number[] = [];
  const start: number[] = [];
  const st: number[] = [];
  code.forEach((line, i) => {
    const op = line.instr.opcode;
    if (op === "REPEAT_START" || op === "REPEAT_WHILE") st.push(i);
    else if (op === "REPEAT_END") {
      const opener = st.pop()!;
      end[opener] = i;
      start[i] = opener;
    }
  });
  return { end, start };
}

const isOpener = (line: CodeLine | undefined): boolean =>
  line !== undefined &&
  (line.instr.opcode === "REPEAT_START" || line.instr.opcode === "REPEAT_WHILE");

export function* run(
  program: Program,
  opts: RunOptions = {},
): Generator<VMEvent, void, bigint | undefined> {
  if (program.errors.length > 0) {
    throw new Error(
      `program has ${program.errors.length} syntax error(s); refusing to run`,
    );
  }
  // Groove bars are transparent to control flow (SPEC §5 rule 3): the VM
  // sees only the code lines, so "next measure" is the next *code* measure.
  const code = program.lines.filter((l): l is CodeLine => l.kind === "code");
  const { end, start } = matchBlocks(code);

  const R: bigint[] = Array.from({ length: 9 }, () => 0n);
  const stack: bigint[] = [];
  const frames: { start: number; left?: number }[] = [];
  let pc = 0;
  let executed = 0;

  const reg = (r: Register | undefined): bigint => R[r ?? 1]!;

  while (pc < code.length) {
    if (opts.maxBars !== undefined && executed >= opts.maxBars) return;
    executed++;

    const line = code[pc]!;
    const { opcode, rd, rs, imm } = line.instr;
    const bar = line.bar;
    if (opts.barEvents) yield { type: "bar", bar };
    let next = pc + 1;

    // A skip blinds the machine for the next code measure; if that measure
    // opens a block, the whole block is skipped (SPEC §5 rules 3–4).
    const skipIf = (cond: boolean): void => {
      if (!cond) return;
      const tgt = pc + 1;
      next = isOpener(code[tgt]) ? end[tgt]! + 1 : tgt + 1;
    };

    switch (opcode) {
      case "LOADI":
        R[rd!] = BigInt(imm!);
        break;
      case "MOV":
        R[rd!] = reg(rs);
        break;
      case "PUSH":
        stack.push(reg(rd));
        break;
      case "POP":
        if (stack.length === 0) throw new RuntimeError("pop from empty stack", bar);
        R[rd!] = stack.pop()!;
        break;
      case "ADD":
        R[rd!] = reg(rd) + reg(rs);
        break;
      case "SUB":
        R[rd!] = reg(rd) - reg(rs);
        break;
      case "MUL":
        R[rd!] = reg(rd) * reg(rs);
        break;
      case "DIV":
        if (reg(rs) === 0n) throw new RuntimeError("division by zero", bar);
        R[rd!] = reg(rd) / reg(rs); // BigInt division truncates toward zero
        break;
      case "MOD":
        if (reg(rs) === 0n) throw new RuntimeError("division by zero", bar);
        R[rd!] = reg(rd) % reg(rs);
        break;
      case "OUTN":
        yield { type: "outN", value: reg(rd), bar };
        break;
      case "OUTC":
        yield { type: "outC", codepoint: Number(reg(rd)), bar };
        break;
      case "TONE":
        yield { type: "tone", midi: Number(reg(rd)), bar };
        break;
      case "IN": {
        const value = yield { type: "input", reg: rd!, bar };
        R[rd!] = value ?? 0n;
        break;
      }
      case "SKIPZ":
        skipIf(reg(rd) === 0n);
        break;
      case "SKIPNZ":
        skipIf(reg(rd) !== 0n);
        break;
      case "SKIPLT":
        skipIf(reg(rd) < reg(rs));
        break;
      case "SKIPGE":
        skipIf(reg(rd) >= reg(rs));
        break;
      case "REPEAT_START": {
        let f = frames[frames.length - 1];
        if (!f || f.start !== pc) {
          f = { start: pc, left: imm! };
          frames.push(f);
        }
        if (f.left! > 0) f.left!--;
        else {
          frames.pop();
          next = end[pc]! + 1;
        }
        break;
      }
      case "REPEAT_WHILE": {
        let f = frames[frames.length - 1];
        if (!f || f.start !== pc) {
          f = { start: pc };
          frames.push(f);
        }
        if (reg(rd) === 0n) {
          frames.pop();
          next = end[pc]! + 1;
        }
        break;
      }
      case "REPEAT_END":
        next = start[pc]!;
        break;
      case "HALT":
        yield { type: "halt", bar };
        return;
    }
    pc = next;
  }
  // Falling off the last measure also ends the program (SPEC §5).
  const lastBar = code.length > 0 ? code[code.length - 1]!.bar : 0;
  yield { type: "halt", bar: lastBar };
}

/**
 * Convenience for tests and the CLI: run to completion with a queue of
 * inputs, collecting all events. Throws on RuntimeError.
 */
export function runToCompletion(
  program: Program,
  inputs: readonly bigint[] = [],
  opts: RunOptions = {},
): VMEvent[] {
  const events: VMEvent[] = [];
  const queue = [...inputs];
  const gen = run(program, opts);
  let result = gen.next();
  while (!result.done) {
    events.push(result.value);
    result =
      result.value.type === "input" ? gen.next(queue.shift() ?? 0n) : gen.next();
  }
  return events;
}

/** Render a program's text output the way the console shows it. */
export function renderOutput(events: readonly VMEvent[]): string {
  let text = "";
  for (const e of events) {
    if (e.type === "outN") text += `${e.value} `;
    else if (e.type === "outC") text += String.fromCodePoint(e.codepoint);
  }
  return text;
}
