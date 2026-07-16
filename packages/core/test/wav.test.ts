import { describe, expect, it } from "vitest";
import {
  decodeWav,
  encodeWav,
  stepSeconds,
  CANONICAL_SAMPLE_RATE,
  DEFAULT_BPM,
} from "../src/index.js";

/** Handcraft a RIFF/WAVE file for decoder tests. */
function buildWav(opts: {
  format: number; // 1 = PCM, 3 = float
  channels: number;
  sampleRate: number;
  bits: number;
  data: Uint8Array;
}): Uint8Array {
  const { format, channels, sampleRate, bits, data } = opts;
  const bytes = new Uint8Array(44 + data.length);
  const view = new DataView(bytes.buffer);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bits) / 8, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  ascii(36, "data");
  view.setUint32(40, data.length, true);
  bytes.set(data, 44);
  return bytes;
}

describe("encodeWav", () => {
  it("writes a canonical 16-bit mono header", () => {
    const bytes = encodeWav(new Float32Array(100));
    const ascii = (off: number, len: number) =>
      String.fromCharCode(...bytes.subarray(off, off + len));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(CANONICAL_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(bytes.length).toBe(44 + 200);
  });

  it("round-trips samples within 16-bit precision", () => {
    const src = Float32Array.from([0, 0.5, -0.5, 0.25, 1, -1]);
    const { samples, sampleRate } = decodeWav(encodeWav(src));
    expect(sampleRate).toBe(CANONICAL_SAMPLE_RATE);
    for (let i = 0; i < src.length; i++) {
      expect(samples[i]).toBeCloseTo(src[i]!, 3);
    }
  });

  it("clamps out-of-range samples instead of wrapping", () => {
    const { samples } = decodeWav(encodeWav(Float32Array.from([2, -2])));
    expect(samples[0]).toBeCloseTo(1, 3);
    expect(samples[1]).toBeCloseTo(-1, 3);
  });

  it("honors a custom sample rate", () => {
    const { sampleRate } = decodeWav(encodeWav(new Float32Array(10), 22050));
    expect(sampleRate).toBe(22050);
  });
});

describe("decodeWav format support", () => {
  it("downmixes 16-bit stereo to mono by averaging", () => {
    const data = new Uint8Array(8);
    const v = new DataView(data.buffer);
    v.setInt16(0, 16384, true); // L = 0.5
    v.setInt16(2, -16384, true); // R = -0.5 → avg 0
    v.setInt16(4, 16384, true); // L = 0.5
    v.setInt16(6, 16384, true); // R = 0.5 → avg 0.5
    const { samples } = decodeWav(
      buildWav({ format: 1, channels: 2, sampleRate: 44100, bits: 16, data }),
    );
    expect(samples).toHaveLength(2);
    expect(samples[0]).toBeCloseTo(0, 4);
    expect(samples[1]).toBeCloseTo(0.5, 4);
  });

  it("decodes 24-bit PCM with sign extension", () => {
    const data = new Uint8Array(6);
    // +0.5 = 0x400000 (little-endian)
    data.set([0x00, 0x00, 0x40], 0);
    // -0.5 = 0xC00000 sign-extended
    data.set([0x00, 0x00, 0xc0], 3);
    const { samples } = decodeWav(
      buildWav({ format: 1, channels: 1, sampleRate: 44100, bits: 24, data }),
    );
    expect(samples[0]).toBeCloseTo(0.5, 5);
    expect(samples[1]).toBeCloseTo(-0.5, 5);
  });

  it("decodes float32 WAVs", () => {
    const data = new Uint8Array(8);
    const v = new DataView(data.buffer);
    v.setFloat32(0, 0.75, true);
    v.setFloat32(4, -0.25, true);
    const { samples } = decodeWav(
      buildWav({ format: 3, channels: 1, sampleRate: 48000, bits: 32, data }),
    );
    expect(samples[0]).toBeCloseTo(0.75, 6);
    expect(samples[1]).toBeCloseTo(-0.25, 6);
  });

  it("decodes 8-bit unsigned PCM", () => {
    const { samples } = decodeWav(
      buildWav({
        format: 1,
        channels: 1,
        sampleRate: 44100,
        bits: 8,
        data: Uint8Array.from([192, 64, 128]),
      }),
    );
    expect(samples[0]).toBeCloseTo(0.5, 4);
    expect(samples[1]).toBeCloseTo(-0.5, 4);
    expect(samples[2]).toBeCloseTo(0, 4);
  });

  it("rejects non-WAV bytes", () => {
    expect(() => decodeWav(Uint8Array.from([1, 2, 3, 4]))).toThrowError(/not a WAV/);
    const notWave = encodeWav(new Float32Array(4));
    notWave[8] = "X".charCodeAt(0);
    expect(() => decodeWav(notWave)).toThrowError(/not a WAV/);
  });

  it("rejects a WAV with no data chunk", () => {
    const bytes = new Uint8Array(12);
    const ascii = (off: number, s: string): void => {
      for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i);
    };
    ascii(0, "RIFF");
    ascii(8, "WAVE");
    expect(() => decodeWav(bytes)).toThrowError(/no data chunk/);
  });
});

describe("tempo helpers", () => {
  it("stepSeconds is one sixteenth note", () => {
    expect(stepSeconds(120)).toBeCloseTo(0.125, 10);
    expect(stepSeconds(60)).toBeCloseTo(0.25, 10);
    expect(stepSeconds(240)).toBeCloseTo(0.0625, 10);
  });

  it("default tempo is ♩ = 120 (SPEC §2)", () => {
    expect(DEFAULT_BPM).toBe(120);
  });
});
