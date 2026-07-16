/**
 * Kit loading + sample playback. No synthesis anywhere — every sound is a
 * recorded sample from @cadence/kit, and TONE is the marimba pitch-shifted
 * via playbackRate (rate = 2^((midi - baseMidi)/12)).
 *
 * Each sample is fetched ONCE and used two ways:
 *  - decoded by core's own decodeWav → the canonical SampleKit that encode()
 *    and decode() consume (byte-identical to what Node sees), and
 *  - decoded by the Web Audio API → AudioBuffers for live playback.
 */
import { decodeWav, type SampleKit } from "@cadence/core";
import { SAMPLE_URLS, TONE_URL, manifest, type KitSymbol } from "@cadence/kit/assets";

export interface LoadedAudio {
  audio: KitAudio;
  /** The canonical kit for encode()/decode(). */
  kit: SampleKit;
}

export class KitAudio {
  private constructor(
    private readonly ctx: AudioContext,
    private readonly master: AudioNode,
    private readonly buffers: Map<KitSymbol, AudioBuffer>,
    private readonly toneBuffer: AudioBuffer,
    private readonly baseMidi: number,
  ) {}

  static async load(): Promise<LoadedAudio> {
    const ctx = new AudioContext({ sampleRate: 44100 });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    comp.connect(out);
    out.connect(ctx.destination);

    const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`failed to load sample ${url}`);
      return res.arrayBuffer();
    };

    const buffers = new Map<KitSymbol, AudioBuffer>();
    const samples = {} as SampleKit["samples"];
    await Promise.all(
      (Object.entries(SAMPLE_URLS) as [KitSymbol, string][]).map(async ([sym, url]) => {
        const ab = await fetchBytes(url);
        samples[sym] = decodeWav(new Uint8Array(ab)).samples;
        buffers.set(sym, await ctx.decodeAudioData(ab.slice(0)));
      }),
    );
    const toneAb = await fetchBytes(TONE_URL);
    const toneBuffer = await ctx.decodeAudioData(toneAb.slice(0));

    return {
      audio: new KitAudio(ctx, comp, buffers, toneBuffer, manifest.tone.baseMidi),
      kit: { sampleRate: 44100, samples },
    };
  }

  /** Current audio-clock time, seconds. */
  now(): number {
    return this.ctx.currentTime;
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /**
   * Schedule one drum hit at absolute audio-clock time `when`.
   * `gain` scales the hit — ghost notes pass GHOST_GAIN/MIX_GAIN (≈0.44).
   */
  play(sym: KitSymbol, when = 0, gain = 1): void {
    const buffer = this.buffers.get(sym);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    if (gain !== 1) {
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      g.connect(this.master);
    } else {
      src.connect(this.master);
    }
    src.start(Math.max(when, this.ctx.currentTime));
  }

  /** Schedule the pitched TONE (marimba) for a MIDI note. */
  playTone(midi: number, when = 0): void {
    const clamped = Math.max(24, Math.min(108, midi));
    const src = this.ctx.createBufferSource();
    src.buffer = this.toneBuffer;
    src.playbackRate.value = 2 ** ((clamped - this.baseMidi) / 12);
    const g = this.ctx.createGain();
    g.gain.value = 0.8;
    src.connect(g);
    g.connect(this.master);
    src.start(Math.max(when, this.ctx.currentTime));
  }
}
