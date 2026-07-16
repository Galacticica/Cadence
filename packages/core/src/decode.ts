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
import { GHOST_GAIN, MIX_GAIN, type SampleKit } from "./encode.js";
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
/**
 * Normalized-correlation acceptance threshold. Deliberately permissive: when
 * several hits stack on one step, each depresses the others' correlation; the
 * joint amplitude refit below rejects spurious picks by amplitude instead.
 */
const MIN_CORR = 0.6;
/** Fitted amplitudes below this are noise, not hits (ghosts sit at ~0.35). */
const MIN_AMP = 0.15;
/** Window-energy floor below which a step is silence. */
const MIN_ENERGY = 1e-3;
/** Max voices resolved per step (real hits + ghost notes). */
const MAX_VOICES = 6;
/** Fitted amplitude below this is a ghost note, above a real hit. */
const GHOST_SPLIT = (MIX_GAIN + GHOST_GAIN) / 2;

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

/** <a[k], b[k+offset]> over the valid overlap of two template heads. */
function headDot(a: Float32Array, b: Float32Array, offset: number): number {
  let s = 0;
  const from = Math.max(0, -offset);
  const to = Math.min(a.length, b.length - offset);
  for (let k = from; k < to; k++) s += a[k]! * b[k + offset]!;
  return s;
}

/** Solve G·a = b in place (Gaussian elimination, partial pivoting; n ≤ 6). */
function solve(G: number[][], b: number[]): number[] {
  const n = b.length;
  const a = [...b];
  const m = G.map((row) => [...row]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const d = m[col]![col]!;
    if (Math.abs(d) < 1e-12) return a.map(() => 0); // degenerate — reject all
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / d;
      for (let c = col; c < n; c++) m[r]![c]! -= f * m[col]![c]!;
      a[r]! -= f * a[col]!;
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    for (let c = r + 1; c < n; c++) a[r]! -= m[r]![c]! * a[c]!;
    a[r]! /= m[r]![r]!;
  }
  return a;
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

  const bySymbolOrder = (x: DrumSymbol, y: DrumSymbol): number =>
    SYMBOL_ORDER.indexOf(x) - SYMBOL_ORDER.indexOf(y);

  for (let b = 0; b < barCount; b++) {
    const steps: Step[] = [];
    const ghostSteps: Step[] = [];
    let ghostCount = 0;
    for (let s = 0; s < 16; s++) {
      const hits: DrumSymbol[] = [];
      const ghostHits: DrumSymbol[] = [];
      const expected = Math.round(programStart + (b * 16 + s) * stepSamples + drift);

      const subtractFull = (t: Template, at: number, a: number): void => {
        const n = Math.min(t.full.length, residual.length - at);
        for (let i = 0; i < n; i++) residual[at + i]! -= a * t.full[i]!;
      };

      // Greedy matched pursuit with tentative subtractions, so stacked hits
      // (e.g. a real hat plus a ghost snare) surface one after another.
      const found: { t: Template; at: number; a: number }[] = [];
      for (let voice = 0; voice < MAX_VOICES; voice++) {
        if (windowNorm(residual, expected, MATCH_LEN) < MIN_ENERGY) break;

        let best: { t: Template; at: number; corr: number } | null = null;
        for (const t of templates) {
          if (found.some((f) => f.t.sym === t.sym)) continue;
          for (let at = expected - LAG; at <= expected + LAG; at++) {
            if (at < 0) continue;
            const wn = windowNorm(residual, at, t.head.length);
            if (wn < 1e-4) continue;
            const corr = dot(residual, at, t.head) / (wn * t.headNorm);
            if (!best || corr > best.corr) best = { t, at, corr };
          }
        }
        if (!best || best.corr < MIN_CORR) break;

        const a0 = dot(residual, best.at, best.t.head) / best.t.headEnergy;
        subtractFull(best.t, best.at, a0);
        found.push({ t: best.t, at: best.at, a: a0 });
      }

      // Joint amplitude refit (orthogonal matched pursuit): overlapping
      // templates contaminate each other's individually-fitted amplitude, so
      // restore the tentative subtractions and solve for all amplitudes at
      // once, then subtract the FULL templates so decays can't pollute later
      // steps. The refit amplitude also rejects phantom picks (a ≈ 0).
      if (found.length > 1) {
        for (const f of found) subtractFull(f.t, f.at, -f.a);
        const G = found.map((fi) =>
          found.map((fj) => headDot(fi.t.head, fj.t.head, fi.at - fj.at)),
        );
        const rhs = found.map((f) => dot(residual, f.at, f.t.head));
        const amps = solve(G, rhs);
        found.forEach((f, i) => {
          f.a = amps[i]!;
          if (f.a >= MIN_AMP) subtractFull(f.t, f.at, f.a);
        });
      }

      for (const f of found) {
        if (f.a < MIN_AMP) continue; // phantom from overlap — rejected
        // The fitted amplitude separates the layers: real hits mix at
        // MIX_GAIN, ghost notes at GHOST_GAIN (SPEC §8 addendum).
        const layer = f.a < GHOST_SPLIT ? ghostHits : hits;
        if (!hits.includes(f.t.sym) && !ghostHits.includes(f.t.sym)) {
          layer.push(f.t.sym);
        }
        // update the phase tracker with the observed timing error
        drift += 0.1 * (f.at - expected);
      }

      hits.sort(bySymbolOrder);
      ghostHits.sort(bySymbolOrder);
      steps.push(hits);
      ghostSteps.push(ghostHits);
      ghostCount += ghostHits.length;
    }
    measures.push(ghostCount > 0 ? { steps, ghosts: ghostSteps } : { steps });
  }

  // The encoder pads the file for the final decay; drop trailing all-empty
  // bars (indistinguishable from tail padding). Ghost-only bars are NOT empty.
  while (measures.length > 0) {
    const last = measures[measures.length - 1]!;
    const empty =
      last.steps.every((s) => s.length === 0) &&
      (!last.ghosts || last.ghosts.every((s) => s.length === 0));
    if (!empty) break;
    measures.pop();
  }

  return { grid: measures, bpm };
}
