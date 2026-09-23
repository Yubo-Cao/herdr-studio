import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roamgateEnv } from "../config/environment";

/** Browser segments are 16 kHz mono PCM16 WAV; the VAD commits within 12 s. */
export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_MAX_SECONDS = 60;
export const VOICE_MAX_BYTES = 44 + VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE * 2;
const TRANSCRIBE_TIMEOUT_MS = 60_000;

export type VoiceProvider =
  | { kind: "command"; label: string; argv: string[] }
  | {
      kind: "openai";
      label: string;
      baseUrl: string;
      model: string;
      apiKey: string;
      language?: string;
    }
  | { kind: "elevenlabs"; label: string; apiKey: string; language?: string };

type Environment = Record<string, string | undefined>;

function funAsrCommand(environment: Environment): string[] | null {
  const modelDir = roamgateEnv("VOICE_FUNASR_MODEL_DIR", environment)?.trim();
  if (!modelDir) return null;
  const cli =
    roamgateEnv("VOICE_FUNASR_CLI", environment)?.trim() || "llama-funasr-cli";
  return [
    cli,
    "--enc",
    join(modelDir, "funasr-encoder-f16.gguf"),
    "-m",
    join(modelDir, "qwen3-0.6b-q4km.gguf"),
    "-a",
    "{input}",
    "--vad",
    join(modelDir, "fsmn-vad.gguf"),
  ];
}

function parseCommand(value: string): string[] {
  let argv: unknown;
  try {
    argv = JSON.parse(value);
  } catch {
    throw new Error("ROAMGATE_VOICE_COMMAND must be a JSON array of strings");
  }
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    !argv.every((part) => typeof part === "string" && part.length > 0) ||
    !argv.some((part) => part.includes("{input}"))
  ) {
    throw new Error(
      'ROAMGATE_VOICE_COMMAND must be a JSON array of strings containing "{input}"',
    );
  }
  return argv as string[];
}

/**
 * Resolve the speech-to-text backend from the service environment. Keys stay
 * on the bridge host; the browser only ever sees the provider label.
 */
export function voiceProviderFromEnv(
  environment: Environment = process.env,
): VoiceProvider | null {
  const requested = roamgateEnv("VOICE_PROVIDER", environment)
    ?.trim()
    .toLowerCase();
  if (requested === "off") return null;
  const language =
    roamgateEnv("VOICE_LANGUAGE", environment)?.trim() || undefined;
  const command = roamgateEnv("VOICE_COMMAND", environment)?.trim();
  const funAsr = funAsrCommand(environment);
  const apiKey = roamgateEnv("VOICE_API_KEY", environment)?.trim();
  const elevenLabsKey = environment.ELEVENLABS_API_KEY?.trim();

  const commandProvider = (): VoiceProvider | null =>
    command
      ? { kind: "command", label: "command", argv: parseCommand(command) }
      : null;
  const funAsrProvider = (): VoiceProvider | null =>
    funAsr ? { kind: "command", label: "Fun-ASR", argv: funAsr } : null;
  const openAiProvider = (): VoiceProvider | null =>
    apiKey
      ? {
          kind: "openai",
          label: "openai-compatible",
          baseUrl: (
            roamgateEnv("VOICE_BASE_URL", environment)?.trim() ||
            "https://api.openai.com/v1"
          ).replace(/\/+$/, ""),
          model:
            roamgateEnv("VOICE_MODEL", environment)?.trim() ||
            "gpt-4o-transcribe",
          apiKey,
          language,
        }
      : null;
  const elevenLabsProvider = (): VoiceProvider | null =>
    elevenLabsKey
      ? {
          kind: "elevenlabs",
          label: "ElevenLabs",
          apiKey: elevenLabsKey,
          language,
        }
      : null;

  switch (requested) {
    case "command":
      return commandProvider();
    case "funasr":
      return funAsrProvider();
    case "openai":
      return openAiProvider();
    case "elevenlabs":
      return elevenLabsProvider();
    case undefined:
    case "":
      return (
        commandProvider() ??
        funAsrProvider() ??
        openAiProvider() ??
        elevenLabsProvider()
      );
    default:
      throw new Error(`unknown ROAMGATE_VOICE_PROVIDER: ${requested}`);
  }
}

/** Accept only the canonical 44-byte PCM16 mono 16 kHz WAV the browser emits. */
export function assertVoiceWav(bytes: Uint8Array) {
  if (bytes.length < 46) throw new Error("audio segment is empty");
  if (bytes.length > VOICE_MAX_BYTES)
    throw new Error(`audio segment exceeds ${VOICE_MAX_SECONDS} seconds`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const valid =
    tag(0) === "RIFF" &&
    tag(8) === "WAVE" &&
    tag(12) === "fmt " &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === VOICE_SAMPLE_RATE &&
    view.getUint16(34, true) === 16 &&
    tag(36) === "data" &&
    view.getUint32(40, true) === bytes.length - 44;
  if (!valid) throw new Error("audio must be 16 kHz mono PCM16 WAV");
}

/** Same cleanup as Koushu: runtimes print only transcript lines on stdout. */
export function cleanTranscript(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function runCommand(argv: string[], wavPath: string, timeoutMs: number) {
  const [program, ...args] = argv.map((part) =>
    part.replaceAll("{input}", wavPath),
  );
  return new Promise<string>((resolve, reject) => {
    const child = spawn(program!, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("speech recognition timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes > 16_384) return;
      stderrBytes += chunk.length;
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`speech recognizer could not start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(cleanTranscript(Buffer.concat(stdout).toString("utf8")));
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim().split("\n");
      reject(
        new Error(
          `speech recognizer exited ${code}: ${detail.at(-1)?.slice(0, 300) ?? ""}`,
        ),
      );
    });
  });
}

async function readProviderText(response: Response, label: string) {
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `${label} transcription failed (${response.status}) ${detail}`,
    );
  }
  const body = (await response.json()) as { text?: unknown };
  return typeof body.text === "string" ? body.text.trim() : "";
}

export async function transcribeVoice(
  provider: VoiceProvider,
  wav: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  assertVoiceWav(wav);
  const signal = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS);
  const file = new Blob([new Uint8Array(wav)], { type: "audio/wav" });
  if (provider.kind === "command") {
    const path = join(
      tmpdir(),
      `roamgate-voice-${randomBytes(8).toString("hex")}.wav`,
    );
    await writeFile(path, wav, { mode: 0o600, flag: "wx" });
    try {
      return await runCommand(provider.argv, path, TRANSCRIBE_TIMEOUT_MS);
    } finally {
      await rm(path, { force: true });
    }
  }
  const form = new FormData();
  form.append("file", file, "segment.wav");
  if (provider.kind === "openai") {
    form.append("model", provider.model);
    if (provider.language) form.append("language", provider.language);
    const response = await fetchImpl(
      `${provider.baseUrl}/audio/transcriptions`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${provider.apiKey}` },
        body: form,
        signal,
      },
    );
    return readProviderText(response, provider.label);
  }
  form.append("model_id", "scribe_v1");
  if (provider.language) form.append("language_code", provider.language);
  const response = await fetchImpl(
    "https://api.elevenlabs.io/v1/speech-to-text",
    {
      method: "POST",
      headers: { "xi-api-key": provider.apiKey },
      body: form,
      signal,
    },
  );
  return readProviderText(response, provider.label);
}

/**
 * HTTP surface: GET status and POST one WAV segment. Recognition is serialized
 * beyond a small concurrency cap so one busy browser cannot starve the host.
 */
export function createVoiceHandlers(options: {
  provider: () => VoiceProvider | null;
  transcribe?: typeof transcribeVoice;
  maxConcurrent?: number;
  maxQueued?: number;
}) {
  const transcribe = options.transcribe ?? transcribeVoice;
  const maxConcurrent = options.maxConcurrent ?? 2;
  const maxQueued = options.maxQueued ?? 8;
  let active = 0;
  const waiting: Array<() => void> = [];
  const noStore = { "cache-control": "private, no-store" };

  const acquire = async () => {
    if (active < maxConcurrent) {
      active++;
      return;
    }
    if (waiting.length >= maxQueued) throw new Error("busy");
    await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
  };
  const release = () => {
    active--;
    waiting.shift()?.();
  };

  const resolveProvider = () => {
    try {
      return { provider: options.provider(), error: null };
    } catch (error) {
      return { provider: null, error: (error as Error).message };
    }
  };

  return {
    status(): Response {
      const { provider, error } = resolveProvider();
      return Response.json(
        provider
          ? { available: true, provider: provider.label }
          : { available: false, ...(error ? { error } : {}) },
        { headers: noStore },
      );
    },
    async transcribe(req: Request): Promise<Response> {
      const { provider, error } = resolveProvider();
      if (!provider) {
        return Response.json(
          { error: error ?? "voice input is not configured on this server" },
          { status: 503, headers: noStore },
        );
      }
      const declared = Number(req.headers.get("content-length") ?? "0");
      if (declared > VOICE_MAX_BYTES) {
        return Response.json(
          { error: "audio segment is too large" },
          { status: 413, headers: noStore },
        );
      }
      const wav = new Uint8Array(await req.arrayBuffer());
      try {
        assertVoiceWav(wav);
      } catch (cause) {
        return Response.json(
          { error: (cause as Error).message },
          { status: 400, headers: noStore },
        );
      }
      try {
        await acquire();
      } catch {
        return Response.json(
          { error: "speech recognition is busy; try again" },
          { status: 429, headers: noStore },
        );
      }
      try {
        const text = await transcribe(provider, wav);
        return Response.json({ text }, { headers: noStore });
      } catch (cause) {
        return Response.json(
          { error: (cause as Error).message },
          { status: 502, headers: noStore },
        );
      } finally {
        release();
      }
    },
  };
}
