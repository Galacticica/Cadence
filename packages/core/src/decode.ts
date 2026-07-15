/**
 * Decoder v1 (SPEC §8): program WAV → Grid, for files rendered from the
 * built-in kit.
 *
 *   count-in detect → tempo + phase lock → grid-synchronous matched pursuit
 *   → grid snap → measures
 *
 * Design notes:
 * - The count-in is found by MATCHED FILTER with the known CLICK template
 *   (the decoder owns the kit, so this beats generic onset detection).
 * - Classification is matched pursuit: at each step, the best-correlating
 *   template is accepted and subtracted over its FULL length from a residual
 *   buffer. Because the encoder mixed these exact samples, subtraction is
 *   ~exact, so ringing decays never pollute later steps and polyphonic steps
 *   resolve one voice at a time.
 * - A slow phase tracker absorbs the sub-sample tempo-estimate error that
 *   would otherwise accumulate over long programs.
 */
import type { DrumSymbol, Grid, MeasureGrid, Step } from "./types.js";
import type { SampleKit } from "./encode.js";
import { CANONICAL_SAMPLE_RATE, decodeWav } from "./wav.js";

export interface DecodeResult {
  grid: Grid;
  bpm: number;
}

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

/** Attack window used for correlation (the first ~23 ms of each template). */
const MATCH_LEN = 1024;
/** Jitter search around the expected grid position, in samples. */
const LAG = 32;
/** Normalized-correlation acceptance threshold. */
const MIN_CORR = 0.85;
/** Window-energy floor below which a step is silence. */
const MIN_ENERGY = 1e-3;
/** Max voices resolved per step. */
const MAX_VOICES = 4;

const SYMBOL_ORDER: readonly DrumSymbol[] = [
  "K",
  "S",
  "H",
  "T1",
  "T2",
  "T3",
  "FT",
  "C",
  "R",
];

interface Template {
  sym: DrumSymbol;
  full: Float32Array;
  head: Float32Array; // first MATCH_LEN samples
  headNorm: number; // |head|
  headEnergy: number; // <head, head>
}

function makeTemplates(kit: SampleKit): Template[] {
  return SYMBOL_ORDER.map((sym) => {
    const full = kit.samples[sym];
    const head = full.subarray(0, Math.min(MATCH_LEN, full.length));
    let e = 0;
    for (const v of head) e += v * v;
    return { sym, full, head, headNorm: Math.sqrt(e), headEnergy: e };
  });
}

/** <x[at..], head> */
function dot(x: Float32Array, at: number, head: Float32Array): number {
  let s = 0;
  const n = Math.min(head.length, x.length - at);
  for (let i = 0; i < n; i++) s += x[at + i]! * head[i]!;
  return s;
}

function windowNorm(x: Float32Array, at: number, len: number): number {
  let e = 0;
  const n = Math.min(len, x.length - at);
  for (let i = 0; i < n; i++) e += x[at + i]! * x[at + i]!;
  return Math.sqrt(e);
}

/**
 * Find the four count-in clicks: matched-filter the click attack over the
 * head of the file, collect well-separated correlation peaks.
 */
function findCountIn(
  x: Float32Array,
  click: Float32Array,
): { positions: number[]; interval: number } {
  const head = click.subarray(0, Math.min(MATCH_LEN, click.length));
  let he = 0;
  for (const v of head) he += v * v;
  const hn = Math.sqrt(he);

  const searchEnd = Math.min(x.length - head.length, CANONICAL_SAMPLE_RATE * 12);
  const peaks: { at: number; corr: number }[] = [];
  for (let at = 0; at < searchEnd; at += 8) {
    const wn = windowNorm(x, at, head.length);
    if (wn < 1e-3) continue;
    const corr = dot(x, at, head) / (wn * hn);
    if (corr < 0.7) continue;
    // refine to stride 1 around the coarse hit
    let bestAt = at;
    let bestCorr = corr;
    for (let a = Math.max(0, at - 8); a < at + 8; a++) {
      const c = dot(x, a, head) / (windowNorm(x, a, head.length) * hn);
      if (c > bestCorr) {
        bestCorr = c;
        bestAt = a;
      }
    }
    const last = peaks[peaks.length - 1];
    if (last && bestAt - last.at < 2048) {
      if (bestCorr > last.corr) {
        last.at = bestAt;
        last.corr = bestCorr;
      }
    } else {
      peaks.push({ at: bestAt, corr: bestCorr });
    }
    if (peaks.length >= 4 && peaks[3]!.at + 4096 < at) break;
  }

  if (peaks.length < 4) {
    throw new DecodeError("no count-in detected (need four stick clicks)");
  }
  const p = peaks.slice(0, 4).map((q) => q.at);
  const intervals = [p[1]! - p[0]!, p[2]! - p[1]!, p[3]! - p[2]!];
  const median = intervals.slice().sort((a, b) => a - b)[1]!;
  for (const iv of intervals) {
    if (Math.abs(iv - median) > median * 0.25) {
      throw new DecodeError("count-in clicks are not evenly spaced");
    }
  }
  return { positions: p, interval: (p[3]! - p[0]!) / 3 };
}

export function decode(bytes: Uint8Array, kit: SampleKit): DecodeResult {
  if (kit.sampleRate !== CANONICAL_SAMPLE_RATE) {
    throw new DecodeError(`kit must be ${CANONICAL_SAMPLE_RATE} Hz`);
  }
  const { samples, sampleRate } = decodeWav(bytes);
  if (sampleRate !== CANONICAL_SAMPLE_RATE) {
    throw new DecodeError(
      `program must be ${CANONICAL_SAMPLE_RATE} Hz WAV, got ${sampleRate}`,
    );
  }

  const { positions, interval } = findCountIn(samples, kit.samples.CLICK);
  const bpm = (60 * CANONICAL_SAMPLE_RATE) / interval;
  if (bpm < 20 || bpm > 400) {
    throw new DecodeError(`implausible tempo ${bpm.toFixed(1)} bpm`);
  }
  const stepSamples = interval / 4;
  const programStart = positions[0]! + 4 * interval;

  const templates = makeTemplates(kit);
  const residual = Float32Array.from(samples);
  const measures: MeasureGrid[] = [];
  let drift = 0; // slow phase tracker (samples)

  const totalSteps = Math.floor((residual.length - programStart) / stepSamples);
  const barCount = Math.floor(totalSteps / 16);

  for (let b = 0; b < barCount; b++) {
    const steps: Step[] = [];
    for (let s = 0; s < 16; s++) {
      const hits: DrumSymbol[] = [];
      const expected = Math.round(programStart + (b * 16 + s) * stepSamples + drift);

      for (let voice = 0; voice < MAX_VOICES; voice++) {
        if (windowNorm(residual, expected, MATCH_LEN) < MIN_ENERGY) break;

        let best: { t: Template; at: number; corr: number } | null = null;
        for (const t of templates) {
          for (let at = expected - LAG; at <= expected + LAG; at++) {
            if (at < 0) continue;
            const wn = windowNorm(residual, at, t.head.length);
            if (wn < 1e-4) continue;
            const corr = dot(residual, at, t.head) / (wn * t.headNorm);
            if (!best || corr > best.corr) best = { t, at, corr };
          }
        }
        if (!best || best.corr < MIN_CORR) break;

        // Subtract the FULL template so its decay can't pollute later steps.
        const a = dot(residual, best.at, best.t.head) / best.t.headEnergy;
        const full = best.t.full;
        const n = Math.min(full.length, residual.length - best.at);
        for (let i = 0; i < n; i++) residual[best.at + i]! -= a * full[i]!;

        if (!hits.includes(best.t.sym)) hits.push(best.t.sym);
        // update the phase tracker with the observed timing error
        drift += 0.1 * (best.at - expected);
      }

      hits.sort((x, y) => SYMBOL_ORDER.indexOf(x) - SYMBOL_ORDER.indexOf(y));
      steps.push(hits);
    }
    measures.push({ steps });
  }

  // The encoder pads the file for the final decay; drop trailing all-empty
  // bars (indistinguishable from tail padding).
  while (
    measures.length > 0 &&
    measures[measures.length - 1]!.steps.every((s) => s.length === 0)
  ) {
    measures.pop();
  }

  return { grid: measures, bpm };
}
