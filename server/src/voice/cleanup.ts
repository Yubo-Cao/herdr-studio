import { roamgateEnv } from "../config/environment";

/**
 * LLM cleanup of a finished dictation, adapted from Koushu's presets. Every
 * step up trades fidelity for readability; dictation is the user's own voice,
 * so the rules forbid adding content the speaker did not say.
 */
export const VOICE_CLEANUP_MODES = ["verbatim", "typeset", "polish"] as const;
export type VoiceCleanupMode = (typeof VOICE_CLEANUP_MODES)[number];
export const VOICE_CLEANUP_MAX_CHARS = 20_000;
const CLEANUP_TIMEOUT_MS = 45_000;

export function isVoiceCleanupMode(value: string): value is VoiceCleanupMode {
  return (VOICE_CLEANUP_MODES as readonly string[]).includes(value);
}

const COMMON =
  "You are formatting a speech-to-text transcript. Reply with the formatted " +
  "text only: no preamble, no explanation, no code fence around the whole " +
  "answer. Always reply in the same language the transcript is in; when the " +
  "speaker mixes Chinese and English, keep each word in the language it was " +
  "spoken. If the transcript is empty or contains no speech, reply with " +
  "nothing.\n\nThe transcript was dictated into a terminal input box, usually " +
  "as an instruction for a coding agent or as a shell command, and may join " +
  "several recognition segments. Keep file paths, commands, flags, code " +
  "identifiers, and product names exactly as meant, fixing only obvious " +
  "recognition errors in them.";

export const VOICE_CLEANUP_PROMPTS: Record<VoiceCleanupMode, string> = {
  verbatim:
    COMMON +
    "\n\nRemove filler sounds (um, uh, 嗯, 那个) and false " +
    "starts. Fix punctuation and obvious speech-recognition homophone errors. " +
    "Break into paragraphs where the speaker changes topic.\n\nDo not reword " +
    "anything. Do not reorder sentences. Do not merge or split sentences. Do " +
    "not add headings, lists, or any content the speaker did not say. Every " +
    "word that survives must be a word they actually used.",
  typeset:
    COMMON +
    "\n\nRemove filler sounds and false starts. Fix punctuation and obvious " +
    "speech-recognition errors. Apply light Markdown structure that reflects " +
    "what was said: bullet or numbered lists where the speaker enumerated " +
    "things, `code` for literal identifiers, commands and file paths (never " +
    "for ordinary words or descriptive phrases), fenced blocks for dictated " +
    "code. Use headings only for a long, multi-topic dictation. A short " +
    "single-sentence dictation stays one plain sentence.\n\nKeep the speaker's own wording. You may split a run-on " +
    "sentence or drop a duplicated phrase, but do not paraphrase, do not " +
    "upgrade their vocabulary, and do not add content they did not say.",
  polish:
    COMMON +
    "\n\nRewrite spoken phrasing into clear written prose while preserving " +
    "the meaning exactly. Merge repeated attempts at the same sentence, " +
    "reorder clauses for readability, and apply Markdown lists and code " +
    "formatting where they fit.\n\nPreserve every claim, qualifier and piece " +
    "of uncertainty. Do not add information, do not resolve ambiguity the " +
    "speaker left open, and do not make tentative statements sound confident.",
};

export type VoiceCleanupConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffort?: string;
};

type Environment = Record<string, string | undefined>;

/** Cleanup uses the OpenAI Responses API; off unless a key is configured. */
export function voiceCleanupFromEnv(
  environment: Environment = process.env,
): VoiceCleanupConfig | null {
  if (roamgateEnv("VOICE_LLM", environment)?.trim().toLowerCase() === "off")
    return null;
  const apiKey = (
    roamgateEnv("VOICE_LLM_API_KEY", environment) ?? environment.OPENAI_API_KEY
  )?.trim();
  if (!apiKey) return null;
  const reasoningEffort =
    roamgateEnv("VOICE_LLM_REASONING_EFFORT", environment)?.trim() || undefined;
  return {
    baseUrl: (
      roamgateEnv("VOICE_LLM_BASE_URL", environment)?.trim() ||
      "https://api.openai.com/v1"
    ).replace(/\/+$/, ""),
    model:
      roamgateEnv("VOICE_LLM_MODEL", environment)?.trim() || "gpt-5.6-luna",
    apiKey,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

/** Text of a Responses API result, from `output_text` or message parts. */
export function responseText(body: unknown): string {
  const value = body as {
    output_text?: unknown;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: unknown }>;
    }>;
  };
  if (typeof value?.output_text === "string") return value.output_text.trim();
  return (value?.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter(
      (part) => part.type === "output_text" && typeof part.text === "string",
    )
    .map((part) => part.text as string)
    .join("")
    .trim();
}

export async function cleanDictation(
  config: VoiceCleanupConfig,
  mode: VoiceCleanupMode,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      instructions: VOICE_CLEANUP_PROMPTS[mode],
      input: text,
      store: false,
      ...(config.reasoningEffort
        ? { reasoning: { effort: config.reasoningEffort } }
        : {}),
    }),
    signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`cleanup failed (${response.status}) ${detail}`);
  }
  return responseText(await response.json());
}
