/**
 * Assembler: Instruction → MeasureGrid with canonical placement.
 * Inverse of the parser; contract: parse(assemble(instrs)) round-trips.
 *
 * Canonical placement (the form the encoder renders and SPEC §6.1 shows):
 *  - opcode sequence hits contiguously from step 1
 *  - dest fill starts at step 5, source fill at step 7
 *  - immediate bits on steps 9–16, snare = 1, closed hat = 0 (audible zeros)
 *  - no decoration
 */
import { OPCODE_INFO, REG_TO_FILL } from "./tables.js";
import type { Grid, Instruction, MeasureGrid, Step } from "./types.js";

export function assembleMeasure(instr: Instruction): MeasureGrid {
  const info = OPCODE_INFO[instr.opcode];
  const steps: Step[] = Array.from({ length: 16 }, () => []);

  info.seq.forEach((sym, i) => steps[i]!.push(sym));

  if (info.regs >= 1) {
    if (instr.rd === undefined)
      throw new Error(`${instr.opcode}: missing register rd`);
    REG_TO_FILL[instr.rd]!.forEach((tom, i) => steps[4 + i]!.push(tom));
  }
  if (info.regs === 2) {
    if (instr.rs === undefined)
      throw new Error(`${instr.opcode}: missing register rs`);
    REG_TO_FILL[instr.rs]!.forEach((tom, i) => steps[6 + i]!.push(tom));
  }

  if (info.imm) {
    const imm = instr.imm ?? 0;
    if (!Number.isInteger(imm) || imm < 0 || imm > 255)
      throw new Error(`${instr.opcode}: immediate ${imm} out of 8-bit range`);
    for (let bit = 0; bit < 8; bit++) {
      steps[8 + bit]!.push((imm >> (7 - bit)) & 1 ? "S" : "H");
    }
  }

  return { steps };
}

export function assemble(instrs: readonly Instruction[]): Grid {
  return instrs.map(assembleMeasure);
}

/** A pure-decoration groove bar (steady closed hats), for tests and demos. */
export function grooveMeasure(): MeasureGrid {
  return { steps: Array.from({ length: 16 }, () => ["H"] as Step) };
}
