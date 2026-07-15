/**
 * WAV byte-level codec (SPEC §8: canonical container is WAV 44.1 kHz 16-bit PCM).
 *
 * Pure TypeScript, no Node or Web Audio dependencies — the same code decodes
 * the kit samples in the browser, in Node, and in tests, byte-identically.
 * That shared identity is what makes the decoder's template matching
 * deterministic across hosts.
 */

export interface DecodedWav {
  /** Mono samples in [-1, 1]; multi-channel input is averaged down. */
  samples: Float32Array;
  sampleRate: number;
}

export const CANONICAL_SAMPLE_RATE = 44100;

/** Decode a RIFF/WAVE file: PCM 16/24/32-bit and float32, any channel count. */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (off: number, len: number): string =>
    String.fromCharCode(...bytes.subarray(off, off + len));

  if (bytes.length < 12 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("not a WAV file");
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOff = -1;
  let dataLen = 0;

  // Walk chunks; tolerate extra chunks (LIST, cue, etc.) before/after data.
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = ascii(off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === "fmt ") {
      format = view.getUint16(off + 8, true);
      channels = view.getUint16(off + 10, true);
      sampleRate = view.getUint32(off + 12, true);
      bits = view.getUint16(off + 22, true);
      if (format === 0xfffe && size >= 40) {
        // WAVE_FORMAT_EXTENSIBLE: real format is in the GUID's first 2 bytes
        format = view.getUint16(off + 32, true);
      }
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = Math.min(size, bytes.length - dataOff);
    }
    off += 8 + size + (size % 2); // chunks are word-aligned
  }

  if (dataOff < 0) throw new Error("WAV has no data chunk");
  if (channels < 1) throw new Error("WAV has no channels");
  if (format !== 1 && format !== 3) {
    throw new Error(`unsupported WAV format ${format} (want PCM or float)`);
  }

  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataLen / (bytesPerSample * channels));
  const samples = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataOff + (f * channels + c) * bytesPerSample;
      let v: number;
      if (format === 3 && bits === 32) v = view.getFloat32(p, true);
      else if (bits === 16) v = view.getInt16(p, true) / 32768;
      else if (bits === 24) {
        let u = bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16);
        if (u & 0x800000) u -= 0x1000000; // sign-extend
        v = u / 8388608;
      }
      else if (bits === 32 && format === 1) v = view.getInt32(p, true) / 2147483648;
      else if (bits === 8) v = (view.getUint8(p) - 128) / 128;
      else throw new Error(`unsupported WAV bit depth ${bits}`);
      sum += v;
    }
    samples[f] = sum / channels;
  }

  return { samples, sampleRate };
}

/** Encode mono float samples as a 16-bit PCM WAV, clamping out-of-range values. */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number = CANONICAL_SAMPLE_RATE,
): Uint8Array {
  const dataLen = samples.length * 2;
  const bytes = new Uint8Array(44 + dataLen);
  const view = new DataView(bytes.buffer);
  const writeAscii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i);
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  writeAscii(36, "data");
  view.setUint32(40, dataLen, true);

  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}
