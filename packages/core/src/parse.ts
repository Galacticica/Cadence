/**
 * Parser: Grid → Program (SPEC §2, §3, §5).
 *
 * Per bar: decide code vs. groove, decode the three fields, validate arity,
 * then structurally match repeat blocks. Errors carry 1-based bar numbers.
 */
import {
  OP_SYMS,
  SYMBOL_NAME,
  TOM_SYMS,
  opcodeForSequence,
} from "./tables.js";
import type {
  DrumSymbol,
  Grid,
  Line,
  MeasureGrid,
  OpSym,
  ParseError,
  Program,
  Register,
  TomSym,
} from "./types.js";
import { registerForFill } from "./tables.js";

const isOpSym = (s: DrumSymbol): s is OpSym => OP_SYMS.has(s);
const isTom = (s: DrumSymbol): s is TomSym => TOM_SYMS.has(s);

interface BarErrors {
  errors: ParseError[];
  bar: number;
}

function err(b: BarErrors, message: string): void {
  b.errors.push({ bar: b.bar, message });
}

/**
 * A measure is code iff step 1 contains exactly one opcode instrument
 * (SPEC §2). Otherwise the whole bar is decoration — a groove NOP.
 */
function isCodeMeasure(m: MeasureGrid): boolean {
  return (m.steps[0] ?? []).filter(isOpSym).length === 1;
}

/** Decode the opcode field (steps 1–4). Hats are decoration; toms are errors. */
function readOpcodeField(m: MeasureGrid, b: BarErrors): OpSym[] {
  const seq: OpSym[] = [];
  for (let i = 0; i < 4; i++) {
    const hits = (m.steps[i] ?? []).filter((s) => s !== "H");
    if (hits.some(isTom)) {
      err(b, "tom in opcode field");
      continue;
    }
    if (hits.length > 1) {
      err(b, "chord in opcode field");
      continue;
    }
    const hit = hits[0];
    if (hit && isOpSym(hit)) seq.push(hit);
  }
  return seq;
}

/**
 * Decode one 2-step register subfield. Hats are decoration; non-tom
 * instruments are errors. Returns the register, or undefined if the
 * subfield is empty or invalid.
 */
function readFill(
  m: MeasureGrid,
  firstStep: number, // 0-based index of the subfield's first step
  which: "register" | "source register",
  b: BarErrors,
): Register | undefined {
  const fill: TomSym[] = [];
  let bad = false;
  for (let i = firstStep; i < firstStep + 2; i++) {
    const hits = (m.steps[i] ?? []).filter((s) => s !== "H");
    const toms = hits.filter(isTom);
    for (const other of hits.filter((s) => !isTom(s))) {
      err(b, `${SYMBOL_NAME[other]} in register field`);
      bad = true;
    }
    if (toms.length > 1) {
      err(b, "chord in register field");
      bad = true;
      continue;
    }
    if (toms[0]) fill.push(toms[0]);
  }
  if (bad || fill.length === 0) return undefined;
  const reg = registerForFill(fill);
  if (reg === undefined) {
    err(b, `unknown ${which} fill ${fill.join("→")}`);
    return undefined;
  }
  return reg;
}

/** Whether a register subfield contains any tom hits at all. */
function fillPresent(m: MeasureGrid, firstStep: number): boolean {
  for (let i = firstStep; i < firstStep + 2; i++) {
    if ((m.steps[i] ?? []).some(isTom)) return true;
  }
  return false;
}

/** Decode the 8-bit operand (steps 9–16), MSB first. S=1, H=0, rest=0. */
function readOperand(m: MeasureGrid, b: BarErrors): number {
  let value = 0;
  for (let bit = 0; bit < 8; bit++) {
    const hits = m.steps[8 + bit] ?? [];
    let bitVal = 0;
    let seen = 0;
    for (const hit of hits) {
      if (hit === "S") {
        bitVal = 1;
        seen++;
      } else if (hit === "H") {
        seen++;
      } else {
        err(b, `${SYMBOL_NAME[hit]} in operand field`);
      }
    }
    if (seen > 1) err(b, "chord in operand field");
    value = (value << 1) | bitVal;
  }
  return value;
}

function parseMeasure(m: MeasureGrid, bar: number): { line: Line; errors: ParseError[] } {
  if (!isCodeMeasure(m)) {
    return { line: { kind: "groove", bar }, errors: [] };
  }
  const b: BarErrors = { errors: [], bar };

  const seq = readOpcodeField(m, b);
  const info = seq.length > 0 ? opcodeForSequence(seq) : undefined;
  if (seq.length > 0 && !info) {
    err(b, `unknown opcode ${seq.join("→")}`);
  }
  if (!info) {
    return { line: { kind: "invalid", bar }, errors: b.errors };
  }

  // Register subfields: dest = steps 5–6 (idx 4), source = steps 7–8 (idx 6).
  let rd: Register | undefined;
  let rs: Register | undefined;
  if (info.regs >= 1) {
    rd = readFill(m, 4, "register", b);
    if (rd === undefined && !fillPresent(m, 4)) err(b, `${info.opcode}: missing register`);
  } else if (fillPresent(m, 4) || fillPresent(m, 6)) {
    err(b, `${info.opcode}: unexpected register`);
  }
  if (info.regs === 2) {
    rs = readFill(m, 6, "source register", b);
    if (rs === undefined && !fillPresent(m, 6)) err(b, `${info.opcode}: missing source register`);
  } else if (info.regs === 1 && fillPresent(m, 6)) {
    err(b, `${info.opcode}: unexpected source register`);
  }

  // Operand: live for immediate ops; otherwise steps 9–16 are entirely
  // ignored and may carry free decoration (SPEC §2).
  let imm: number | undefined;
  if (info.imm) imm = readOperand(m, b);

  if (b.errors.length > 0) {
    return { line: { kind: "invalid", bar }, errors: b.errors };
  }
  return {
    line: {
      kind: "code",
      bar,
      instr: {
        opcode: info.opcode,
        ...(rd !== undefined ? { rd } : {}),
        ...(rs !== undefined ? { rs } : {}),
        ...(imm !== undefined ? { imm } : {}),
      },
    },
    errors: [],
  };
}

/** Structural pass: repeat openers and ends must match (SPEC §5 rules). */
function checkBlocks(lines: readonly Line[], errors: ParseError[]): void {
  const stack: number[] = [];
  for (const line of lines) {
    if (line.kind !== "code") continue;
    const op = line.instr.opcode;
    if (op === "REPEAT_START" || op === "REPEAT_WHILE") stack.push(line.bar);
    else if (op === "REPEAT_END") {
      if (stack.length === 0) errors.push({ bar: line.bar, message: "unmatched REPEAT_END" });
      else stack.pop();
    }
  }
  for (const bar of stack) errors.push({ bar, message: "unclosed repeat block" });
}

export function parse(grid: Grid): Program {
  const lines: Line[] = [];
  const errors: ParseError[] = [];
  grid.forEach((measure, i) => {
    const { line, errors: barErrors } = parseMeasure(measure, i + 1);
    lines.push(line);
    errors.push(...barErrors);
  });
  checkBlocks(lines, errors);
  return { lines, errors };
}

/** Parse and report only the errors — `cadence check`. */
export function check(grid: Grid): ParseError[] {
  return parse(grid).errors;
}
