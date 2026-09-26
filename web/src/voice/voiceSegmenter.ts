/**
 * Voice activity segmentation for dictation, run inside the capture worklet
 * after the browser's WebRTC noise suppression, echo cancellation, and gain
 * control. A frame is voiced when it clears the adaptive energy threshold and,
 * when a classifier is supplied, the WebRTC VAD also calls it speech; energy
 * alone mistakes typing and broadband noise for speech, and the WebRTC VAD
 * alone accepts quiet steady noise. Thresholds follow Koushu: a segment
 * commits after 500 ms of trailing silence, needs 320 ms of voiced audio, is
 * forced out at 12 s, and is dropped unless it lasts 650 ms and reaches RMS
 * 0.006 or peak 0.025.
 */
export const VOICE_SAMPLE_RATE = 16_000;

export type VoiceSegmenterOptions = {
  frameMs: number;
  preRollMs: number;
  startMs: number;
  tailSilenceMs: number;
  keepTailMs: number;
  minVoicedMs: number;
  minSegmentMs: number;
  forceCommitMs: number;
  minSegmentRms: number;
  minSegmentPeak: number;
  minFrameRms: number;
  noiseRatio: number;
};

export const DEFAULT_VOICE_SEGMENTER_OPTIONS: VoiceSegmenterOptions = {
  frameMs: 20,
  preRollMs: 300,
  startMs: 60,
  tailSilenceMs: 500,
  keepTailMs: 160,
  minVoicedMs: 320,
  minSegmentMs: 650,
  forceCommitMs: 12_000,
  minSegmentRms: 0.006,
  minSegmentPeak: 0.025,
  minFrameRms: 0.004,
  noiseRatio: 3,
};

export type VoiceSegmenterEvent =
  | { type: "speech"; active: boolean }
  | { type: "level"; rms: number; speaking: boolean }
  | { type: "segment"; samples: Float32Array; forced: boolean };

export class VoiceSegmenter {
  private readonly options: VoiceSegmenterOptions;
  private readonly frameSize: number;
  private pending = new Float32Array(0);
  private preRoll: Float32Array[] = [];
  private segment: Float32Array[] = [];
  private speaking = false;
  private candidateFrames = 0;
  private silenceFrames = 0;
  private voicedFrames = 0;
  private sumSquares = 0;
  private peak = 0;
  private noiseFloor = 0.002;
  private framesSinceLevel = 0;

  constructor(
    options: Partial<VoiceSegmenterOptions> = {},
    private readonly isSpeech?: (frame: Float32Array) => boolean,
  ) {
    this.options = { ...DEFAULT_VOICE_SEGMENTER_OPTIONS, ...options };
    this.frameSize = Math.round(
      (VOICE_SAMPLE_RATE * this.options.frameMs) / 1000,
    );
  }

  private frames(ms: number) {
    return Math.max(1, Math.round(ms / this.options.frameMs));
  }

  push(input: Float32Array): VoiceSegmenterEvent[] {
    const joined = new Float32Array(this.pending.length + input.length);
    joined.set(this.pending);
    joined.set(input, this.pending.length);
    const events: VoiceSegmenterEvent[] = [];
    let offset = 0;
    for (; offset + this.frameSize <= joined.length; offset += this.frameSize)
      this.frame(joined.slice(offset, offset + this.frameSize), events);
    this.pending = joined.slice(offset);
    return events;
  }

  /** Emit the in-progress segment, if it qualifies, when capture stops. */
  flush(): VoiceSegmenterEvent[] {
    const events: VoiceSegmenterEvent[] = [];
    if (this.speaking) this.commit(events, false, true);
    this.reset();
    return events;
  }

  private frame(frame: Float32Array, events: VoiceSegmenterEvent[]) {
    let squares = 0;
    let peak = 0;
    for (const sample of frame) {
      squares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(squares / frame.length);
    const threshold = Math.max(
      this.options.minFrameRms,
      this.noiseFloor * this.options.noiseRatio,
    );
    const loud = rms >= threshold;
    // Track the background only between utterances so speech never raises it.
    if (!this.speaking && !loud)
      this.noiseFloor = Math.max(0.0005, this.noiseFloor * 0.95 + rms * 0.05);
    const voiced = loud && (this.isSpeech?.(frame) ?? true);

    if (++this.framesSinceLevel >= 5) {
      this.framesSinceLevel = 0;
      events.push({ type: "level", rms, speaking: this.speaking });
    }

    if (!this.speaking) {
      this.preRoll.push(frame);
      if (this.preRoll.length > this.frames(this.options.preRollMs))
        this.preRoll.shift();
      this.candidateFrames = voiced ? this.candidateFrames + 1 : 0;
      if (this.candidateFrames < this.frames(this.options.startMs)) return;
      this.speaking = true;
      this.segment = this.preRoll;
      this.preRoll = [];
      this.voicedFrames = this.candidateFrames;
      this.silenceFrames = 0;
      this.sumSquares = 0;
      this.peak = 0;
      for (const chunk of this.segment) this.measure(chunk);
      events.push({ type: "speech", active: true });
      return;
    }

    this.segment.push(frame);
    this.measure(frame);
    if (voiced) {
      this.voicedFrames++;
      this.silenceFrames = 0;
    } else {
      this.silenceFrames++;
    }
    if (this.silenceFrames >= this.frames(this.options.tailSilenceMs)) {
      this.commit(events, false, true);
      this.speaking = false;
      this.candidateFrames = 0;
      events.push({ type: "speech", active: false });
    } else if (this.segment.length >= this.frames(this.options.forceCommitMs)) {
      this.commit(events, true, false);
    }
  }

  private measure(frame: Float32Array) {
    for (const sample of frame) {
      this.sumSquares += sample * sample;
      this.peak = Math.max(this.peak, Math.abs(sample));
    }
  }

  private commit(
    events: VoiceSegmenterEvent[],
    forced: boolean,
    trimTail: boolean,
  ) {
    const trailing = trimTail
      ? Math.max(0, this.silenceFrames - this.frames(this.options.keepTailMs))
      : 0;
    const frames = this.segment.slice(0, this.segment.length - trailing);
    const length = frames.reduce((total, frame) => total + frame.length, 0);
    const durationMs = (length / VOICE_SAMPLE_RATE) * 1000;
    const rms = Math.sqrt(this.sumSquares / Math.max(1, length));
    const speechLike =
      durationMs >= this.options.minSegmentMs &&
      this.voicedFrames >= this.frames(this.options.minVoicedMs) &&
      (rms >= this.options.minSegmentRms ||
        this.peak >= this.options.minSegmentPeak);
    if (speechLike) {
      const samples = new Float32Array(length);
      let offset = 0;
      for (const frame of frames) {
        samples.set(frame, offset);
        offset += frame.length;
      }
      events.push({ type: "segment", samples, forced });
    }
    this.segment = [];
    this.voicedFrames = 0;
    this.silenceFrames = 0;
    this.sumSquares = 0;
    this.peak = 0;
  }

  private reset() {
    this.pending = new Float32Array(0);
    this.preRoll = [];
    this.segment = [];
    this.speaking = false;
    this.candidateFrames = 0;
    this.silenceFrames = 0;
    this.voicedFrames = 0;
    this.sumSquares = 0;
    this.peak = 0;
  }
}

/** Canonical 44-byte header, 16 kHz mono PCM16, as the bridge expects. */
export function encodeVoiceWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(
      44 + index * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  }
  return bytes;
}

/**
 * Streaming downsampler from the capture context rate to 16 kHz. A
 * Blackman-windowed sinc low-pass (cutoff 7.2 kHz) removes content above the
 * new Nyquist rate before interpolation; without it, 48 kHz microphone audio
 * aliases into the speech band and recognition accuracy drops sharply.
 * Browsers' own MediaStream-to-16 kHz-context conversion has the same flaw,
 * so capture runs at the device rate and resamples here.
 */
export class VoiceResampler {
  private readonly taps: Float32Array;
  private history: Float32Array;
  private position = 0;
  private lastFiltered = 0;
  private readonly step: number;

  constructor(
    private readonly inputRate: number,
    tapCount = 63,
  ) {
    this.step = inputRate / VOICE_SAMPLE_RATE;
    const cutoff = (0.45 * VOICE_SAMPLE_RATE) / inputRate;
    this.taps = new Float32Array(tapCount);
    const middle = (tapCount - 1) / 2;
    let sum = 0;
    for (let index = 0; index < tapCount; index++) {
      const x = index - middle;
      const sinc =
        x === 0
          ? 2 * cutoff
          : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      const window =
        0.42 -
        0.5 * Math.cos((2 * Math.PI * index) / (tapCount - 1)) +
        0.08 * Math.cos((4 * Math.PI * index) / (tapCount - 1));
      this.taps[index] = sinc * window;
      sum += this.taps[index]!;
    }
    for (let index = 0; index < tapCount; index++) this.taps[index]! /= sum;
    this.history = new Float32Array(tapCount - 1);
  }

  process(input: Float32Array): Float32Array {
    if (this.inputRate === VOICE_SAMPLE_RATE) return input.slice();
    const tapCount = this.taps.length;
    const buffer = new Float32Array(this.history.length + input.length);
    buffer.set(this.history);
    buffer.set(input, this.history.length);
    // filtered[k] is the low-passed value of input sample k.
    const filtered = new Float32Array(input.length);
    for (let k = 0; k < input.length; k++) {
      let acc = 0;
      for (let tap = 0; tap < tapCount; tap++)
        acc += this.taps[tap]! * buffer[k + tap]!;
      filtered[k] = acc;
    }
    this.history = buffer.slice(buffer.length - (tapCount - 1));
    // Positions in [-1, 0) interpolate from the previous chunk's last sample.
    const at = (index: number) =>
      index < 0 ? this.lastFiltered : filtered[index]!;
    const output: number[] = [];
    while (this.position <= input.length - 1) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const left = at(index);
      output.push(
        fraction === 0 ? left : left + (at(index + 1) - left) * fraction,
      );
      this.position += this.step;
    }
    this.position -= input.length;
    this.lastFiltered = filtered[input.length - 1] ?? this.lastFiltered;
    return Float32Array.from(output);
  }
}

/**
 * Join a transcript onto existing draft text: Latin words need a separating
 * space, CJK text and text after whitespace or an empty draft do not.
 */
export function dictationInsertion(before: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const last = before[before.length - 1];
  if (!last || /\s/.test(last)) return trimmed;
  const cjk = /[\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/;
  if (cjk.test(last) || cjk.test(trimmed[0]!)) return trimmed;
  return ` ${trimmed}`;
}
