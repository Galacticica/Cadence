/**
 * Encoder (SPEC §8): render a Grid to the canonical program WAV —
 * 44.1 kHz / 16-bit / mono, one sample-kit hit per grid step, preceded by a
 * one-bar count-in of four stick clicks on the quarter notes.
 *
 * Deterministic: fixed frozen samples + integer sample offsets means the same
 * (grid, bpm) always yields byte-identical output.
 */
import type { DrumSymbol, Grid } from "./types.js";
import { CANONICAL_SAMPLE_RATE, encodeWav } from "./wav.js";

/** The kit contract. Loading is host-specific (fs / fetch) — see @cadence/kit. */
export interface SampleKit {
  sampleRate: number;
  samples: Record<DrumSymbol | "CLICK", Float32Array>;
}

export interface EncodeOptions {
  /** Tempo — the VM's clock speed, default ♩ = 120 (SPEC §2). */
  bpm?: number;
}

export const DEFAULT_BPM = 120;

/** Seconds per sixteenth-note step. */
export const stepSeconds = (bpm: number): number => 60 / bpm / 4;

/** Headroom so simultaneous hits don't clip (samples peak at −6 dBFS). */
const MIX_GAIN = 0.8;

/**
 * Render `grid` to WAV bytes. Bar 0 of the output is the count-in (clicks on
 * steps 1, 5, 9, 13); program bar b occupies steps (b+1)*16 …
 */
export function encode(grid: Grid, kit: SampleKit, opts: EncodeOptions = {}): Uint8Array {
  const bpm = opts.bpm ?? DEFAULT_BPM;
  if (!(bpm > 0)) throw new Error(`invalid bpm ${bpm}`);
  if (kit.sampleRate !== CANONICAL_SAMPLE_RATE) {
    throw new Error(`kit must be ${CANONICAL_SAMPLE_RATE} Hz`);
  }
  const rate = CANONICAL_SAMPLE_RATE;
  const step = stepSeconds(bpm);

  // Every hit: [global step index, sample]. Count-in first.
  const events: [number, Float32Array][] = [];
  for (const q of [0, 4, 8, 12]) events.push([q, kit.samples.CLICK]);
  grid.forEach((measure, b) => {
    measure.steps.forEach((hits, s) => {
      for (const sym of hits) {
        const sample = kit.samples[sym];
        if (sample) events.push([(b + 1) * 16 + s, sample]);
      }
    });
  });

  const totalSteps = (grid.length + 1) * 16;
  let length = Math.round(totalSteps * step * rate);
  for (const [stepIndex, sample] of events) {
    // Integer offsets computed from the global step index — no accumulation
    // of rounded step sizes, so grids at any bpm stay sample-exact.
    length = Math.max(length, Math.round(stepIndex * step * rate) + sample.length);
  }

  const mix = new Float32Array(length);
  for (const [stepIndex, sample] of events) {
    const at = Math.round(stepIndex * step * rate);
    for (let i = 0; i < sample.length; i++) mix[at + i]! += sample[i]! * MIX_GAIN;
  }

  return encodeWav(mix, rate);
}
