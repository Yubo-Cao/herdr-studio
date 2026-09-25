import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roamgateEnv } from "../config/environment";
import {
  cleanDictation,
  isVoiceCleanupMode,
  VOICE_CLEANUP_MAX_CHARS,
  type VoiceCleanupConfig,
} from "./cleanup";
import {
  applyAliases,
  type DictionaryEntry,
  dictionaryHints,
  dictionaryKeyterms,
  voiceDictionary,
} from "./dictionary";

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
      /** Multi-language hint for GPT-Transcribe when no language is pinned. */
      languages?: string[];
    }
  | {
      kind: "elevenlabs";
      label: string;
      apiKey: string;
      model: string;
      language?: string;
      /** Send dictionary terms as hard keyword bias (`keyterms`). */
      keyterms?: boolean;
      /** `enable_logging=false`; zero retention needs an enterprise plan. */
      zeroRetention?: boolean;
    };

type Environment = Record<string, string | undefined>;

/**
 * Fun-ASR-Nano without its FSMN VAD: browser segments are already single
 * utterances, and re-segmenting them drops speech at the split points.
 */
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
 * Resolve the speech-to-text chain from the service environment: the primary
 * provider first, then every other configured provider as a fallback. Keys
 * stay on the bridge host; the browser only ever sees provider labels.
 * `ROAMGATE_VOICE_PROVIDER` picks the primary; `ROAMGATE_VOICE_FALLBACK=off`
 * disables fallback.
 */
export function voiceProvidersFromEnv(
  environment: Environment = process.env,
): VoiceProvider[] {
  const requested = roamgateEnv("VOICE_PROVIDER", environment)
    ?.trim()
    .toLowerCase();
  if (requested === "off") return [];
  const language =
    roamgateEnv("VOICE_LANGUAGE", environment)?.trim() || undefined;
  const command = roamgateEnv("VOICE_COMMAND", environment)?.trim();
  const funAsr = funAsrCommand(environment);
  const apiKey = roamgateEnv("VOICE_API_KEY", environment)?.trim();
  const elevenLabsKey = environment.ELEVENLABS_API_KEY?.trim();
  const enabled = (name: string) =>
    /^(1|true|on|yes)$/i.test(roamgateEnv(name, environment)?.trim() ?? "");
  const openAiModel =
    roamgateEnv("VOICE_MODEL", environment)?.trim() || "gpt-transcribe";
  const languages = (roamgateEnv("VOICE_LANGUAGES", environment) ?? "zh,en")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  // An explicit command wins; cloud keys outrank the local fallback.
  const configured: Array<[string, VoiceProvider | null]> = [
    [
      "command",
      command
        ? { kind: "command", label: "command", argv: parseCommand(command) }
        : null,
    ],
    [
      "elevenlabs",
      elevenLabsKey
        ? {
            kind: "elevenlabs",
            label: "ElevenLabs",
            apiKey: elevenLabsKey,
            model:
              roamgateEnv("VOICE_ELEVENLABS_MODEL", environment)?.trim() ||
              "scribe_v2",
            language,
            ...(enabled("VOICE_DICTIONARY_KEYTERMS") ? { keyterms: true } : {}),
            ...(enabled("VOICE_ELEVENLABS_ZERO_RETENTION")
              ? { zeroRetention: true }
              : {}),
          }
        : null,
    ],
    [
      "openai",
      apiKey
        ? {
            kind: "openai",
            label: "openai-compatible",
            baseUrl: (
              roamgateEnv("VOICE_BASE_URL", environment)?.trim() ||
              "https://api.openai.com/v1"
            ).replace(/\/+$/, ""),
            model: openAiModel,
            apiKey,
            language,
            ...(openAiModel === "gpt-transcribe" &&
            !language &&
            languages.length
              ? { languages }
              : {}),
          }
        : null,
    ],
    [
      "funasr",
      funAsr ? { kind: "command", label: "Fun-ASR", argv: funAsr } : null,
    ],
  ];
  if (requested && !configured.some(([name]) => name === requested))
    throw new Error(`unknown ROAMGATE_VOICE_PROVIDER: ${requested}`);
  const ordered = requested
    ? [
        ...configured.filter(([name]) => name === requested),
        ...configured.filter(([name]) => name !== requested),
      ]
    : configured;
  const providers = ordered
    .map(([, provider]) => provider)
    .filter((provider): provider is VoiceProvider => provider !== null);
  if (requested && ordered[0]?.[1] === null) return [];
  const fallback = roamgateEnv("VOICE_FALLBACK", environment)
    ?.trim()
    .toLowerCase();
  return fallback === "off" ? providers.slice(0, 1) : providers;
}

/** The primary provider alone, for callers that do not fall back. */
export function voiceProviderFromEnv(
  environment: Environment = process.env,
): VoiceProvider | null {
  return voiceProvidersFromEnv(environment)[0] ?? null;
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

/**
 * Recognize one segment. Dictionary terms go to OpenAI as a free-text prompt
 * and optionally to ElevenLabs as keyterms; confirmed aliases are then
 * replaced in every provider's transcript.
 */
export async function transcribeVoice(
  provider: VoiceProvider,
  wav: Uint8Array,
  fetchImpl: typeof fetch = fetch,
  dictionary: DictionaryEntry[] = voiceDictionary(),
): Promise<string> {
  return applyAliases(
    await recognize(provider, wav, fetchImpl, dictionary),
    dictionary,
  );
}

async function recognize(
  provider: VoiceProvider,
  wav: Uint8Array,
  fetchImpl: typeof fetch,
  dictionary: DictionaryEntry[],
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
    form.append("response_format", "json");
    if (provider.language) form.append("language", provider.language);
    for (const code of provider.languages ?? [])
      form.append("languages[]", code);
    const prompt = dictionaryHints(dictionary);
    if (prompt) form.append("prompt", prompt);
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
  form.append("model_id", provider.model);
  form.append("tag_audio_events", "false");
  if (provider.language) form.append("language_code", provider.language);
  if (provider.keyterms)
    for (const term of dictionaryKeyterms(dictionary))
      form.append("keyterms", term);
  if (provider.zeroRetention) form.append("enable_logging", "false");
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
 * HTTP surface: GET status, POST one WAV segment, and POST dictated text for
 * cleanup. Recognition tries each provider in order and is capped at a small
 * concurrency so one busy browser cannot starve the host.
 */
export function createVoiceHandlers(options: {
  providers: () => VoiceProvider[];
  cleanup?: () => VoiceCleanupConfig | null;
  transcribe?: typeof transcribeVoice;
  cleanText?: typeof cleanDictation;
  maxConcurrent?: number;
  maxQueued?: number;
}) {
  const transcribe = options.transcribe ?? transcribeVoice;
  const cleanText = options.cleanText ?? cleanDictation;
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

  const resolve = <T>(read: () => T, empty: T) => {
    try {
      return { value: read(), error: null };
    } catch (error) {
      return { value: empty, error: (error as Error).message };
    }
  };

  return {
    status(): Response {
      const { value: providers, error } = resolve(options.providers, []);
      const { value: cleanup } = resolve(
        () => options.cleanup?.() ?? null,
        null,
      );
      return Response.json(
        providers.length
          ? {
              available: true,
              provider: providers[0]!.label,
              fallbacks: providers.slice(1).map((provider) => provider.label),
              cleanup: cleanup
                ? { available: true, model: cleanup.model }
                : { available: false },
            }
          : { available: false, ...(error ? { error } : {}) },
        { headers: noStore },
      );
    },
    async transcribe(req: Request): Promise<Response> {
      const { value: providers, error } = resolve(options.providers, []);
      if (!providers.length) {
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
      const failures: string[] = [];
      try {
        for (const provider of providers) {
          try {
            const text = await transcribe(provider, wav);
            return Response.json(
              {
                text,
                provider: provider.label,
                ...(failures.length ? { fallback: true } : {}),
              },
              { headers: noStore },
            );
          } catch (cause) {
            failures.push(`${provider.label}: ${(cause as Error).message}`);
          }
        }
        return Response.json(
          { error: failures.join("; ").slice(0, 1000) },
          { status: 502, headers: noStore },
        );
      } finally {
        release();
      }
    },
    async cleanup(req: Request): Promise<Response> {
      const { value: config, error } = resolve(
        () => options.cleanup?.() ?? null,
        null,
      );
      if (!config) {
        return Response.json(
          { error: error ?? "voice cleanup is not configured on this server" },
          { status: 503, headers: noStore },
        );
      }
      const body = (await req.json().catch(() => null)) as {
        text?: unknown;
        mode?: unknown;
      } | null;
      const text = typeof body?.text === "string" ? body.text : "";
      const mode = typeof body?.mode === "string" ? body.mode : "";
      if (!isVoiceCleanupMode(mode) || !text.trim()) {
        return Response.json(
          { error: "cleanup needs text and a mode" },
          { status: 400, headers: noStore },
        );
      }
      if (text.length > VOICE_CLEANUP_MAX_CHARS) {
        return Response.json(
          { error: "dictation is too long to clean up" },
          { status: 413, headers: noStore },
        );
      }
      try {
        const cleaned = await cleanText(config, mode, text);
        return Response.json(
          { text: cleaned, model: config.model },
          { headers: noStore },
        );
      } catch (cause) {
        return Response.json(
          { error: (cause as Error).message },
          { status: 502, headers: noStore },
        );
      }
    },
  };
}
