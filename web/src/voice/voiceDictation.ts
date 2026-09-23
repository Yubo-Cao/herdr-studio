import { encodeVoiceWav } from "./voiceSegmenter";
import workletUrl from "./voiceCapture.worklet.ts?worker&url";

export type DictationPhase = "starting" | "listening" | "speaking";

export type DictationCallbacks = {
  onPhase: (phase: DictationPhase) => void;
  onPending: (count: number) => void;
  onLevel: (level: number) => void;
  onText: (text: string) => void;
  onError: (message: string, fatal: boolean) => void;
};

export type DictationSession = {
  /** Flush the current utterance, wait for its transcript, release the mic. */
  stop: () => Promise<void>;
  /** Release the mic immediately, discarding untranscribed audio. */
  cancel: () => void;
};

type VoiceStatus = { available: boolean; provider?: string; error?: string };

export async function voiceStatus(): Promise<VoiceStatus> {
  const response = await fetch("/api/voice/status", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) return { available: false };
  return (await response.json()) as VoiceStatus;
}

async function transcribe(wav: Uint8Array, attempt = 0): Promise<string> {
  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "audio/wav" },
    body: new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
  });
  if (response.status === 429 && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    return transcribe(wav, attempt + 1);
  }
  const body = (await response.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? `transcription failed (${response.status})`);
  return body.text?.trim() ?? "";
}

/**
 * Start dictation. The browser's WebRTC audio processing performs noise
 * suppression, echo cancellation, and gain control before the worklet VAD
 * segments speech; segments are transcribed in order by the bridge.
 */
export async function startDictation(
  callbacks: DictationCallbacks,
): Promise<DictationSession> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Voice input needs a secure origin (HTTPS or localhost) with microphone access.",
    );
  const status = await voiceStatus();
  if (!status.available)
    throw new Error(
      status.error ?? "Voice input is not configured on this Roamgate server.",
    );

  callbacks.onPhase("starting");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  let context: AudioContext;
  try {
    // Capture at the device rate: browsers resample a 48 kHz microphone into a
    // 16 kHz context without adequate filtering. The worklet low-pass filters
    // and downsamples instead.
    context = new AudioContext({ latencyHint: "interactive" });
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "roamgate-voice-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node);
  // The worklet produces silence; routing it keeps the graph pulling audio.
  node.connect(mute).connect(context.destination);

  let pending = 0;
  let queue = Promise.resolve();
  let released = false;
  let flushed: (() => void) | null = null;

  const release = () => {
    if (released) return;
    released = true;
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  const enqueue = (samples: Float32Array) => {
    const wav = encodeVoiceWav(samples);
    callbacks.onPending(++pending);
    queue = queue
      .then(() => transcribe(wav))
      .then(
        (text) => {
          if (text) callbacks.onText(text);
        },
        (error: Error) => {
          const fatal = /not configured/i.test(error.message);
          callbacks.onError(error.message, fatal);
        },
      )
      .finally(() => callbacks.onPending(--pending));
  };

  node.port.onmessage = (
    event: MessageEvent<
      | { type: "speech"; active: boolean }
      | { type: "level"; rms: number }
      | { type: "segment"; samples: Float32Array }
      | { type: "flushed" }
    >,
  ) => {
    const message = event.data;
    if (message.type === "segment") enqueue(message.samples);
    else if (message.type === "speech")
      callbacks.onPhase(message.active ? "speaking" : "listening");
    else if (message.type === "level")
      callbacks.onLevel(Math.min(1, Math.sqrt(message.rms) * 4));
    else if (message.type === "flushed") flushed?.();
  };
  for (const track of stream.getAudioTracks())
    track.addEventListener("ended", () =>
      callbacks.onError("The microphone was disconnected.", true),
    );
  callbacks.onPhase("listening");

  return {
    async stop() {
      if (released) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1500);
        flushed = () => {
          clearTimeout(timer);
          resolve();
        };
        node.port.postMessage({ type: "flush" });
      });
      release();
      await queue;
    },
    cancel: release,
  };
}
