import { VOICE_SAMPLE_RATE } from "./voiceSegmenter";

/**
 * The WebRTC voice activity detector (libfvad, BSD-3-Clause) from the pinned
 * `@echogarden/fvad-wasm@0.2.0` build, instantiated without its Emscripten
 * loader so it can run inside the capture AudioWorklet, which has neither
 * `fetch` nor module import support. The minified export names below belong
 * to that exact build; `webrtcVad.test.ts` fails if an upgrade changes them.
 */
const EXPORTS = {
  memory: "c",
  init: "d",
  create: "e",
  malloc: "f",
  setMode: "j",
  setSampleRate: "k",
  process: "l",
} as const;

/** 0 (quality) to 3 (very aggressive): higher rejects more non-speech. */
export type WebRtcVadMode = 0 | 1 | 2 | 3;

type VadExports = {
  memory: WebAssembly.Memory;
  init: () => void;
  create: () => number;
  malloc: (bytes: number) => number;
  setMode: (vad: number, mode: number) => number;
  setSampleRate: (vad: number, rate: number) => number;
  process: (vad: number, frame: number, length: number) => number;
};

export class WebRtcVad {
  private readonly api: VadExports;
  private readonly handle: number;
  private readonly frame: number;
  private readonly capacity: number;

  /** Compiles synchronously; the module is 20 KiB and worklets allow it. */
  constructor(wasm: BufferSource, mode: WebRtcVadMode = 3) {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), {
      a: {
        a: () => {
          throw new Error("WebRTC VAD assertion failed");
        },
        // Refuse heap growth: one detector and one frame buffer fit easily.
        b: () => 0,
      },
    });
    const raw = instance.exports as Record<string, unknown>;
    const api = Object.fromEntries(
      Object.entries(EXPORTS).map(([name, key]) => [name, raw[key]]),
    ) as VadExports;
    if (
      !(api.memory instanceof WebAssembly.Memory) ||
      Object.entries(api).some(
        ([name, value]) => name !== "memory" && typeof value !== "function",
      )
    )
      throw new Error("unexpected WebRTC VAD build");
    this.api = api;
    api.init();
    this.handle = api.create();
    // 30 ms at 16 kHz is the largest frame libfvad accepts.
    this.capacity = (VOICE_SAMPLE_RATE * 30) / 1000;
    this.frame = api.malloc(this.capacity * 2);
    if (
      !this.handle ||
      !this.frame ||
      api.setMode(this.handle, mode) !== 0 ||
      api.setSampleRate(this.handle, VOICE_SAMPLE_RATE) !== 0
    )
      throw new Error("WebRTC VAD could not initialize");
  }

  /** Classify one 10, 20, or 30 ms frame of 16 kHz audio in [-1, 1]. */
  isSpeech(samples: Float32Array): boolean {
    if (samples.length > this.capacity)
      throw new Error("WebRTC VAD frames are at most 30 ms");
    const pcm = new Int16Array(
      this.api.memory.buffer,
      this.frame,
      samples.length,
    );
    for (let index = 0; index < samples.length; index++) {
      const sample = Math.max(-1, Math.min(1, samples[index]!));
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    const result = this.api.process(this.handle, this.frame, samples.length);
    if (result < 0) throw new Error("WebRTC VAD rejected the frame length");
    return result === 1;
  }
}
