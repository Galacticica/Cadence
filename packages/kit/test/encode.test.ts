import { describe, expect, it } from "vitest";
import {
  assemble,
  decodeWav,
  encode,
  stepSeconds,
  CANONICAL_SAMPLE_RATE,
} from "@cadence/core";
import { loadKit, KIT_SYMBOLS } from "@cadence/kit";
import { COUNTDOWN } from "../../core/test/fixtures.js";

describe("the kit", () => {
  it("loads all 10 canonical samples at 44.1 kHz, onset at sample 0", () => {
    const kit = loadKit();
    expect(kit.sampleRate).toBe(CANONICAL_SAMPLE_RATE);
    for (const sym of KIT_SYMBOLS) {
      const s = kit.samples[sym];
      expect(s.length).toBeGreaterThan(1000);
      // trimmed: the attack transient arrives within the first 64 samples
      const head = s.subarray(0, 64);
      expect(Math.max(...head.map(Math.abs))).toBeGreaterThan(0.001);
      // normalized to −6 dBFS
      let peak = 0;
      for (const v of s) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(0.4);
      expect(peak).toBeLessThanOrEqual(0.51);
    }
    expect(kit.tone.baseMidi).toBe(60);
    expect(kit.tone.samples.length).toBeGreaterThan(1000);
  });
});

describe("encoder", () => {
  const grid = assemble(COUNTDOWN);

  it("renders canonical WAV: 44.1 kHz 16-bit mono, count-in + program length", () => {
    const kit = loadKit();
    const bytes = encode(grid, kit, { bpm: 120 });
    const { samples, sampleRate } = decodeWav(bytes);
    expect(sampleRate).toBe(CANONICAL_SAMPLE_RATE);
    const minLength =
      Math.round((grid.length + 1) * 16 * stepSeconds(120) * CANONICAL_SAMPLE_RATE);
    expect(samples.length).toBeGreaterThanOrEqual(minLength);
    // the count-in click actually sounds at t=0
    expect(Math.max(...samples.subarray(0, 128).map(Math.abs))).toBeGreaterThan(0.01);
  });

  it("is byte-deterministic: two renders are identical", () => {
    const kit = loadKit();
    const a = encode(grid, kit, { bpm: 120 });
    const b = encode(grid, kit, { bpm: 120 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("scales with tempo", () => {
    const kit = loadKit();
    const slow = decodeWav(encode(grid, kit, { bpm: 60 })).samples.length;
    const fast = decodeWav(encode(grid, kit, { bpm: 240 })).samples.length;
    expect(slow).toBeGreaterThan(fast);
  });
});
