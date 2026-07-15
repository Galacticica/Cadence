/**
 * One-time processing: raw/ -> samples/ + tone/ (see PROCESSING.md).
 *
 * Deterministic, dependency-free. Converts each raw sample (44.1 kHz 24-bit
 * stereo) to canonical form: mono, 16-bit, leading silence trimmed so
 * sample[0] is the onset, peak-normalized to -6 dBFS, decay capped with a
 * raised-cosine fade. The outputs are committed and then treated as frozen
 * bytes — this script is NOT part of any build.
 *
 * Run from packages/kit:  node tools/process.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kitDir = dirname(dirname(fileURLToPath(import.meta.url)));

/** file -> { max seconds, output folder } */
const RECIPE = {
  "kick.wav": { cap: 1.0, out: "samples" },
  "snare.wav": { cap: 0.8, out: "samples" },
  "hat-closed.wav": { cap: 0.85, out: "samples" },
  "tom-hi.wav": { cap: 1.2, out: "samples" },
  "tom-mid.wav": { cap: 1.2, out: "samples" },
  "tom-low.wav": { cap: 1.5, out: "samples" },
  "tom-floor.wav": { cap: 1.5, out: "samples" },
  "crash.wav": { cap: 2.0, out: "samples" },
  "ride.wav": { cap: 1.8, out: "samples" },
  "stick.wav": { cap: 0.5, out: "samples" },
  "marimba-c4.wav": { cap: 2.4, out: "tone" },
};

const RATE = 44100;
const TRIM_THRESHOLD = 0.001; // -60 dBFS
const ATTACK_BACKOFF = 32; // samples kept before the first above-threshold sample
const PEAK_TARGET = 0.5; // -6 dBFS
const FADE_SECONDS = 0.03;

function decodeWavMono(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (off, len) => String.fromCharCode(...bytes.subarray(off, off + len));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") throw new Error("not a WAV");
  let channels = 0, sampleRate = 0, bits = 0, dataOff = -1, dataLen = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = ascii(off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(off + 10, true);
      sampleRate = view.getUint32(off + 12, true);
      bits = view.getUint16(off + 22, true);
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = Math.min(size, bytes.length - dataOff);
    }
    off += 8 + size + (size % 2);
  }
  if (sampleRate !== RATE) throw new Error(`expected ${RATE} Hz, got ${sampleRate}`);
  if (bits !== 24) throw new Error(`expected 24-bit, got ${bits}`);
  const bps = 3;
  const frames = Math.floor(dataLen / (bps * channels));
  const mono = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataOff + (f * channels + c) * bps;
      let u = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
      if (u & 0x800000) u -= 0x1000000;
      sum += u / 8388608;
    }
    mono[f] = sum / channels;
  }
  return mono;
}

function encodeWav16Mono(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); };
  w(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  w(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}

function process(name, { cap }) {
  const raw = decodeWavMono(readFileSync(join(kitDir, "raw", name)));

  // Trim leading silence, keeping a tiny pre-attack so the transient is intact.
  let first = raw.findIndex((v) => Math.abs(v) > TRIM_THRESHOLD);
  if (first < 0) throw new Error(`${name}: all silence?`);
  first = Math.max(0, first - ATTACK_BACKOFF);

  // Trim trailing silence, then cap the decay.
  let last = raw.length - 1;
  while (last > first && Math.abs(raw[last]) < TRIM_THRESHOLD) last--;
  let len = last + 1 - first;
  len = Math.min(len, Math.round(cap * RATE));

  const out = new Float64Array(raw.subarray(first, first + len));

  // Peak-normalize to -6 dBFS.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = PEAK_TARGET / peak;
  for (let i = 0; i < out.length; i++) out[i] *= gain;

  // Raised-cosine fade-out so the cap never clicks.
  const fade = Math.min(Math.round(FADE_SECONDS * RATE), out.length);
  for (let i = 0; i < fade; i++) {
    const t = (i + 1) / fade;
    out[out.length - fade + i] *= 0.5 * (1 + Math.cos(Math.PI * t));
  }

  return out;
}

for (const [name, recipe] of Object.entries(RECIPE)) {
  const out = process(name, recipe);
  const dir = join(kitDir, recipe.out);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, encodeWav16Mono(Float32Array.from(out)));
  console.log(
    `${name.padEnd(16)} ${(out.length / RATE).toFixed(2)}s  ${(
      (44 + out.length * 2) / 1024
    ).toFixed(0)} KB`,
  );
}
console.log("done — outputs are canonical frozen bytes; commit them.");
