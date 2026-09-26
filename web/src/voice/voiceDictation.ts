import vadWasmUrl from "@echogarden/fvad-wasm/fvad.wasm?url";
import type { VoiceCaptureOptions } from "./voiceCapture.worklet";
import { encodeVoiceWav, VOICE_SAMPLE_RATE } from "./voiceSegmenter";
import type { VoiceCleanupMode } from "./voicePreferences";
import workletUrl from "./voiceCapture.worklet.ts?worker&url";

/** The bridge's per-request audio limit, which bounds the final pass. */
const FINAL_MAX_SECONDS = 300;
/** Silence placed between speech segments in the final-pass audio. */
const FINAL_GAP_SECONDS = 0.25;

export type DictationPhase = "starting" | "listening" | "speaking";

export type DictationCallbacks = {
  onPhase: (phase: DictationPhase) => void;
  onPending: (count: number) => void;
  onLevel: (level: number) => void;
  onText: (text: string) => void;
  onError: (message: string, fatal: boolean) => void;
};

export type DictationSession = {
  /**
   * Flush the current utterance, wait for its transcript, and release the
   * mic. Resolves to the whole dictation re-recognized as one request, or
   * null when that pass was unnecessary (one segment) or failed.
   */
  stop: () => Promise<string | null>;
  /** Release the mic immediately, discarding untranscribed audio. */
  cancel: () => void;
  /** Whether the bridge can rewrite the finished dictation with an LLM. */
  cleanup: boolean;
};

type VoiceStatus = {
  available: boolean;
  provider?: string;
  error?: string;
  cleanup?: { available: boolean; model?: string };
};

let vadWasm: Promise<ArrayBuffer | null> | null = null;

/** WebRTC VAD bytes for the worklet; null falls back to the energy VAD. */
function loadVadWasm() {
  vadWasm ??= fetch(vadWasmUrl)
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .catch(() => null)
    .then((bytes) => {
      if (!bytes) vadWasm = null;
      return bytes;
    });
  return vadWasm;
}

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

/** Rewrite a finished dictation with the bridge's cleanup model. */
export async function tidyDictation(
  text: string,
  mode: Exclude<VoiceCleanupMode, "off">,
): Promise<string> {
  const response = await fetch("/api/voice/cleanup", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, mode }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? `cleanup failed (${response.status})`);
  return body.text ?? "";
}

/**
 * Start dictation. The browser's WebRTC audio processing performs noise
 * suppression, echo cancellation, and gain control before the worklet VAD
 * segments speech; segments are transcribed in order by the bridge.
 *
 * `unlocked` is a context created during the user's tap (iOS Safari only
 * starts audio inside a gesture). Capture runs at the device rate: browsers
 * resample a 48 kHz microphone into a 16 kHz context without adequate
 * filtering, so the worklet low-pass filters and downsamples instead.
 */
export async function startDictation(
  callbacks: DictationCallbacks,
  unlocked: AudioContext | null = null,
): Promise<DictationSession> {
  let stream: MediaStream | null = null;
  let context: AudioContext | null = unlocked;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Voice input needs a secure origin (HTTPS or localhost) with microphone access.",
      );
    const [status, wasm] = await Promise.all([voiceStatus(), loadVadWasm()]);
    if (!status.available)
      throw new Error(
        status.error ??
          "Voice input is not configured on this Roamgate server.",
      );

    callbacks.onPhase("starting");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    context ??= new AudioContext({ latencyHint: "interactive" });
    await context.audioWorklet.addModule(workletUrl);
    if (context.state !== "running") await context.resume();
    return capture(callbacks, stream, context, status, wasm);
  } catch (error) {
    for (const track of stream?.getTracks() ?? []) track.stop();
    void context?.close().catch(() => undefined);
    throw error;
  }
}

function capture(
  callbacks: DictationCallbacks,
  stream: MediaStream,
  context: AudioContext,
  status: VoiceStatus,
  vadWasm: ArrayBuffer | null,
): DictationSession {
  const source = context.createMediaStreamSource(stream);
  const processorOptions: VoiceCaptureOptions = vadWasm
    ? { vadWasm: vadWasm.slice(0) }
    : {};
  const node = new AudioWorkletNode(context, "roamgate-voice-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    processorOptions,
  });
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node);
  // The worklet produces silence; routing it keeps the graph pulling audio.
  node.connect(mute).connect(context.destination);

  let pending = 0;
  let queue = Promise.resolve();
  // Speech-only audio of the whole session, re-recognized as one request on
  // stop: segments split at pauses lose the context recognizers rely on.
  const spoken: Float32Array[] = [];
  let released = false;
  let flushed: (() => void) | null = null;

  // iOS suspends ("interrupted") the context for calls, Siri, or app
  // switches; resume when it becomes possible again.
  const resume = () => {
    if (!released && context.state !== "running" && !document.hidden)
      void context.resume().catch(() => undefined);
  };
  context.addEventListener("statechange", resume);
  document.addEventListener("visibilitychange", resume);

  const release = () => {
    if (released) return;
    released = true;
    context.removeEventListener("statechange", resume);
    document.removeEventListener("visibilitychange", resume);
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  const enqueue = (samples: Float32Array) => {
    spoken.push(samples);
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
      | { type: "vad"; engine: "webrtc" | "energy"; error: string }
    >,
  ) => {
    const message = event.data;
    if (message.type === "vad" && message.engine === "energy")
      console.warn(
        `voice: WebRTC VAD unavailable, using energy detection. ${message.error}`,
      );
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

  const finalPass = async (): Promise<string | null> => {
    if (spoken.length < 2) return null;
    const gap = Math.round(FINAL_GAP_SECONDS * VOICE_SAMPLE_RATE);
    const length = spoken.reduce(
      (total, samples) => total + samples.length + gap,
      -gap,
    );
    if (length > FINAL_MAX_SECONDS * VOICE_SAMPLE_RATE) return null;
    const joined = new Float32Array(length);
    let offset = 0;
    for (const samples of spoken) {
      joined.set(samples, offset);
      offset += samples.length + gap;
    }
    callbacks.onPending(++pending);
    try {
      return (await transcribe(encodeVoiceWav(joined))) || null;
    } catch (error) {
      console.warn(
        "voice: whole-dictation pass failed; keeping segments",
        error,
      );
      return null;
    } finally {
      callbacks.onPending(--pending);
    }
  };

  return {
    async stop() {
      if (released) return null;
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
      return finalPass();
    },
    cancel: release,
    cleanup: status.cleanup?.available === true,
  };
}
