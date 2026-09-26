import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WebRtcVad } from "./webrtcVad";

const wasm = readFileSync(
  new URL(import.meta.resolve("@echogarden/fvad-wasm/fvad.wasm")),
);

/** A sustained vowel: 140 Hz harmonics shaped by /a/-like formants. */
function vowel(samples: number) {
  const formant = (hz: number, center: number, width: number) =>
    Math.exp(-((hz - center) ** 2) / (2 * width ** 2));
  return Float32Array.from({ length: samples }, (_, n) => {
    let value = 0;
    for (let harmonic = 1; harmonic <= 20; harmonic++) {
      const hz = 140 * harmonic;
      const gain =
        formant(hz, 700, 200) +
        0.6 * formant(hz, 1200, 250) +
        0.3 * formant(hz, 2600, 300);
      value += gain * Math.sin((2 * Math.PI * hz * n) / 16_000);
    }
    return 0.2 * value;
  });
}

const voicedFrames = (vad: WebRtcVad, audio: Float32Array) => {
  let voiced = 0;
  for (let offset = 0; offset + 320 <= audio.length; offset += 320)
    if (vad.isSpeech(audio.subarray(offset, offset + 320))) voiced++;
  return voiced;
};

describe("WebRTC VAD", () => {
  test("loads the pinned build and separates silence from voice", () => {
    const vad = new WebRtcVad(wasm);
    expect(voicedFrames(vad, new Float32Array(16_000))).toBe(0);
    expect(voicedFrames(vad, vowel(16_000))).toBeGreaterThan(40);
  });

  test("rejects frames longer than 30 ms", () => {
    expect(() => new WebRtcVad(wasm).isSpeech(new Float32Array(640))).toThrow(
      "at most 30 ms",
    );
  });
});
