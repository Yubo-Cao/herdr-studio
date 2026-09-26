import { describe, expect, test } from "bun:test";
import {
  dictationInsertion,
  encodeVoiceWav,
  VoiceResampler,
  VOICE_SAMPLE_RATE,
  VoiceSegmenter,
  type VoiceSegmenterEvent,
} from "./voiceSegmenter";

const ms = (value: number) => Math.round((VOICE_SAMPLE_RATE * value) / 1000);

function tone(durationMs: number, amplitude: number) {
  const samples = new Float32Array(ms(durationMs));
  for (let index = 0; index < samples.length; index++)
    samples[index] = amplitude * Math.sin((2 * Math.PI * 220 * index) / 16_000);
  return samples;
}

const silence = (durationMs: number) => new Float32Array(ms(durationMs));

function run(segmenter: VoiceSegmenter, ...chunks: Float32Array[]) {
  const events: VoiceSegmenterEvent[] = [];
  for (const chunk of chunks) events.push(...segmenter.push(chunk));
  return events;
}

const segments = (events: VoiceSegmenterEvent[]) =>
  events.filter(
    (event): event is Extract<VoiceSegmenterEvent, { type: "segment" }> =>
      event.type === "segment",
  );

describe("voice segmenter", () => {
  test("requires the speech classifier as well as energy", () => {
    const loudNoise = () =>
      run(
        new VoiceSegmenter({}, () => false),
        silence(500),
        tone(1200, 0.2),
        silence(700),
      );
    expect(segments(loudNoise())).toHaveLength(0);
    expect(
      segments(
        run(
          new VoiceSegmenter({}, () => true),
          silence(500),
          tone(1200, 0.2),
          silence(700),
        ),
      ),
    ).toHaveLength(1);
  });

  test("commits an utterance after trailing silence with pre-roll", () => {
    const events = run(
      new VoiceSegmenter(),
      silence(500),
      tone(1200, 0.2),
      silence(700),
    );
    const [segment] = segments(events);
    expect(segment?.forced).toBe(false);
    const seconds = segment!.samples.length / VOICE_SAMPLE_RATE;
    // Speech plus up to 300 ms pre-roll and a 160 ms retained tail.
    expect(seconds).toBeGreaterThan(1.2);
    expect(seconds).toBeLessThan(1.8);
    expect(events.filter((event) => event.type === "speech")).toEqual([
      { type: "speech", active: true },
      { type: "speech", active: false },
    ]);
  });

  test("drops short blips and quiet noise", () => {
    expect(
      segments(run(new VoiceSegmenter(), tone(200, 0.3), silence(800))),
    ).toHaveLength(0);
    expect(
      segments(run(new VoiceSegmenter(), tone(2000, 0.002), silence(800))),
    ).toHaveLength(0);
  });

  test("forces long speech out every 12 seconds", () => {
    const events = run(new VoiceSegmenter(), tone(25_000, 0.2));
    const forced = segments(events);
    expect(forced.length).toBe(2);
    expect(forced.every((segment) => segment.forced)).toBe(true);
  });

  test("flushes the in-progress utterance on stop", () => {
    const segmenter = new VoiceSegmenter();
    expect(segments(run(segmenter, tone(1000, 0.2)))).toHaveLength(0);
    expect(segments(segmenter.flush())).toHaveLength(1);
  });

  test("ignores steady background noise once the floor adapts", () => {
    const noise = new Float32Array(ms(4000));
    for (let index = 0; index < noise.length; index++)
      noise[index] = (index % 2 ? 1 : -1) * 0.003;
    expect(segments(run(new VoiceSegmenter(), noise, silence(600)))).toEqual(
      [],
    );
  });
});

describe("voice audio helpers", () => {
  test("encodes canonical 16 kHz mono PCM16 WAV", () => {
    const wav = encodeVoiceWav(Float32Array.from([0, 1, -1, 2]));
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(view.getInt16(50, true)).toBe(0x7fff);
  });

  test("resamples 48 kHz input to 16 kHz across chunks", () => {
    const resampler = new VoiceResampler(48_000);
    let total = 0;
    for (let chunk = 0; chunk < 10; chunk++)
      total += resampler.process(new Float32Array(128)).length;
    expect(Math.abs(total - Math.round((1280 * 16) / 48))).toBeLessThanOrEqual(
      1,
    );
  });

  test("passes speech frequencies and rejects aliasing tones", () => {
    const amplitude = (frequency: number) => {
      const resampler = new VoiceResampler(48_000);
      const input = new Float32Array(48_000);
      for (let index = 0; index < input.length; index++)
        input[index] = Math.sin((2 * Math.PI * frequency * index) / 48_000);
      let peak = 0;
      for (let offset = 0; offset < input.length; offset += 128) {
        const output = resampler.process(input.subarray(offset, offset + 128));
        if (offset < 4800) continue;
        for (const sample of output) peak = Math.max(peak, Math.abs(sample));
      }
      return peak;
    };
    expect(amplitude(1000)).toBeGreaterThan(0.95);
    // 12 kHz would alias to 4 kHz at 16 kHz without the low-pass filter.
    expect(amplitude(12_000)).toBeLessThan(0.01);
  });

  test("spaces Latin transcripts but not CJK", () => {
    expect(dictationInsertion("", " hello ")).toBe("hello");
    expect(dictationInsertion("run", "tests")).toBe(" tests");
    expect(dictationInsertion("run ", "tests")).toBe("tests");
    expect(dictationInsertion("\u4f60\u597d", "\u4e16\u754c")).toBe(
      "\u4e16\u754c",
    );
    expect(dictationInsertion("fix", "\u8fd9\u4e2a")).toBe("\u8fd9\u4e2a");
    expect(dictationInsertion("fix", "  ")).toBe("");
  });
});
