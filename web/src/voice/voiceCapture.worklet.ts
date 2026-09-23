import {
  VoiceResampler,
  VoiceSegmenter,
  type VoiceSegmenterEvent,
} from "./voiceSegmenter";

const RENDER_QUANTUM = 128;

// AudioWorkletGlobalScope is not part of TypeScript's DOM libraries.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void;

/**
 * Mixes the (already noise-suppressed) microphone to mono, resamples it to
 * 16 kHz, and runs the VAD segmenter off the main thread. Each committed
 * segment is posted as a transferable Float32Array.
 */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  private readonly resampler = new VoiceResampler(sampleRate);
  private readonly segmenter = new VoiceSegmenter();
  private stopped = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ type: string }>) => {
      if (event.data?.type !== "flush") return;
      this.stopped = true;
      this.post(this.segmenter.flush());
      this.port.postMessage({ type: "flushed" });
    };
  }

  private post(events: VoiceSegmenterEvent[]) {
    for (const event of events) {
      if (event.type === "segment")
        this.port.postMessage(event, [event.samples.buffer]);
      else this.port.postMessage(event);
    }
  }

  process(inputs: Float32Array[][]) {
    if (this.stopped) return false;
    const channels = inputs[0] ?? [];
    // An ended or muted source delivers no channels; treat it as silence so
    // the VAD still sees the trailing pause and commits the utterance.
    const frames = channels[0]?.length ?? RENDER_QUANTUM;
    const mono = new Float32Array(frames);
    for (const channel of channels)
      for (let index = 0; index < frames; index++)
        mono[index]! += channel[index]! / channels.length;
    this.post(this.segmenter.push(this.resampler.process(mono)));
    return true;
  }
}

registerProcessor("roamgate-voice-capture", VoiceCaptureProcessor);
