import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertVoiceWav,
  cleanTranscript,
  createVoiceHandlers,
  transcribeVoice,
  voiceProviderFromEnv,
  voiceProvidersFromEnv,
} from "./transcription";

function wav(samples = 1600) {
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) =>
    [...value].forEach((char, index) =>
      view.setUint8(offset + index, char.charCodeAt(0)),
    );
  tag(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples * 2, true);
  return bytes;
}

describe("voice provider configuration", () => {
  test("is off without configuration", () => {
    expect(voiceProviderFromEnv({})).toBeNull();
    expect(
      voiceProviderFromEnv({
        ROAMGATE_VOICE_PROVIDER: "off",
        ELEVENLABS_API_KEY: "k",
      }),
    ).toBeNull();
  });

  test("builds the Fun-ASR command from a model directory", () => {
    const provider = voiceProviderFromEnv({
      ROAMGATE_VOICE_FUNASR_MODEL_DIR: "/models/nano",
    });
    expect(provider).toMatchObject({ kind: "command", label: "Fun-ASR" });
    expect(provider?.kind === "command" && provider.argv).toContain("{input}");
    expect(provider?.kind === "command" && provider.argv[0]).toBe(
      "llama-funasr-cli",
    );
    expect(provider?.kind === "command" && provider.argv).not.toContain(
      "--vad",
    );
  });

  test("prefers an explicit command and validates it", () => {
    expect(
      voiceProviderFromEnv({
        ROAMGATE_VOICE_COMMAND: '["asr","{input}"]',
        ROAMGATE_VOICE_API_KEY: "k",
      }),
    ).toMatchObject({ kind: "command", argv: ["asr", "{input}"] });
    expect(() =>
      voiceProviderFromEnv({ ROAMGATE_VOICE_COMMAND: "asr file" }),
    ).toThrow("JSON array");
    expect(() =>
      voiceProviderFromEnv({ ROAMGATE_VOICE_COMMAND: '["asr"]' }),
    ).toThrow("{input}");
  });

  test("prefers a cloud key over the local Fun-ASR fallback", () => {
    expect(
      voiceProviderFromEnv({
        ELEVENLABS_API_KEY: "k",
        ROAMGATE_VOICE_FUNASR_MODEL_DIR: "/models/nano",
      }),
    ).toMatchObject({ kind: "elevenlabs" });
    expect(
      voiceProviderFromEnv({
        ELEVENLABS_API_KEY: "k",
        ROAMGATE_VOICE_FUNASR_MODEL_DIR: "/models/nano",
        ROAMGATE_VOICE_PROVIDER: "funasr",
      }),
    ).toMatchObject({ kind: "command", label: "Fun-ASR" });
  });

  test("orders the fallback chain behind the primary provider", () => {
    const env = {
      ELEVENLABS_API_KEY: "k",
      ROAMGATE_VOICE_API_KEY: "o",
      ROAMGATE_VOICE_FUNASR_MODEL_DIR: "/models/nano",
    };
    expect(voiceProvidersFromEnv(env).map((p) => p.label)).toEqual([
      "ElevenLabs",
      "openai-compatible",
      "Fun-ASR",
    ]);
    expect(
      voiceProvidersFromEnv({ ...env, ROAMGATE_VOICE_PROVIDER: "funasr" }).map(
        (p) => p.label,
      ),
    ).toEqual(["Fun-ASR", "ElevenLabs", "openai-compatible"]);
    expect(
      voiceProvidersFromEnv({ ...env, ROAMGATE_VOICE_FALLBACK: "off" }),
    ).toHaveLength(1);
    expect(
      voiceProvidersFromEnv({
        ELEVENLABS_API_KEY: "k",
        ROAMGATE_VOICE_PROVIDER: "funasr",
      }),
    ).toEqual([]);
    expect(() =>
      voiceProvidersFromEnv({ ROAMGATE_VOICE_PROVIDER: "whisper" }),
    ).toThrow("unknown");
  });

  test("configures an OpenAI-compatible endpoint", () => {
    expect(
      voiceProviderFromEnv({
        ROAMGATE_VOICE_API_KEY: "secret",
        ROAMGATE_VOICE_BASE_URL: "https://openrouter.ai/api/v1/",
        ROAMGATE_VOICE_MODEL: "whisper-large-v3-turbo",
        ROAMGATE_VOICE_LANGUAGE: "zh",
      }),
    ).toEqual({
      kind: "openai",
      label: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "whisper-large-v3-turbo",
      apiKey: "secret",
      language: "zh",
    });
  });
});

describe("voice audio", () => {
  test("accepts only canonical 16 kHz mono PCM16 WAV", () => {
    expect(() => assertVoiceWav(wav())).not.toThrow();
    const stereo = wav();
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(() => assertVoiceWav(stereo)).toThrow("16 kHz mono");
    expect(() => assertVoiceWav(new Uint8Array(10))).toThrow("empty");
    expect(() => assertVoiceWav(wav(16_000 * 61))).toThrow("60 seconds");
  });

  test("joins transcript lines like the local runtimes", () => {
    expect(cleanTranscript("  hello \n\n world \n")).toBe("hello world");
  });

  test("runs a local command with the segment path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roamgate-voice-test-"));
    try {
      const script = join(dir, "asr.sh");
      await writeFile(
        script,
        '#!/bin/sh\nhead -c 4 "$1" >/dev/null && printf "  \u4f60\u597d world\\n\\n"\n',
      );
      await chmod(script, 0o755);
      const text = await transcribeVoice(
        { kind: "command", label: "test", argv: [script, "{input}"] },
        wav(),
      );
      expect(text).toBe("\u4f60\u597d world");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("posts multipart audio to an OpenAI-compatible endpoint", async () => {
    let seen: { url: string; auth: string | null; model: unknown } | undefined;
    const text = await transcribeVoice(
      {
        kind: "openai",
        label: "openai-compatible",
        baseUrl: "https://example.test/v1",
        model: "m",
        apiKey: "k",
      },
      wav(),
      (async (url: string, init: RequestInit) => {
        const form = init.body as FormData;
        seen = {
          url,
          auth: new Headers(init.headers).get("authorization"),
          model: form.get("model"),
        };
        return Response.json({ text: " ok " });
      }) as typeof fetch,
    );
    expect(text).toBe("ok");
    expect(seen).toEqual({
      url: "https://example.test/v1/audio/transcriptions",
      auth: "Bearer k",
      model: "m",
    });
  });
});

describe("voice HTTP handlers", () => {
  const request = (body: Uint8Array) =>
    new Request("http://local/api/voice/transcribe", {
      method: "POST",
      body: new Uint8Array(body),
    });

  test("report status without exposing configuration", async () => {
    const off = createVoiceHandlers({ providers: () => [] });
    expect(await off.status().json()).toEqual({ available: false });
    const on = createVoiceHandlers({
      providers: () => [
        { kind: "elevenlabs", label: "ElevenLabs", apiKey: "k" },
        { kind: "command", label: "Fun-ASR", argv: ["x", "{input}"] },
      ],
      cleanup: () => ({ baseUrl: "u", model: "m", apiKey: "secret" }),
    });
    const status = await on.status().json();
    expect(status).toEqual({
      available: true,
      provider: "ElevenLabs",
      fallbacks: ["Fun-ASR"],
      cleanup: { available: true, model: "m" },
    });
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  test("reject unconfigured servers and invalid audio", async () => {
    const off = createVoiceHandlers({ providers: () => [] });
    expect((await off.transcribe(request(wav()))).status).toBe(503);
    const on = createVoiceHandlers({
      providers: () => [
        { kind: "command", label: "c", argv: ["x", "{input}"] },
      ],
      transcribe: async () => "never",
    });
    expect((await on.transcribe(request(new Uint8Array(60)))).status).toBe(400);
  });

  test("bound concurrent recognition and queue overflow", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const handlers = createVoiceHandlers({
      providers: () => [
        { kind: "command", label: "c", argv: ["x", "{input}"] },
      ],
      transcribe: async () => {
        await gate;
        return "done";
      },
      maxConcurrent: 1,
      maxQueued: 1,
    });
    const first = handlers.transcribe(request(wav()));
    const second = handlers.transcribe(request(wav()));
    await Bun.sleep(5);
    const third = await handlers.transcribe(request(wav()));
    expect(third.status).toBe(429);
    release();
    expect(await (await first).json()).toEqual({
      text: "done",
      provider: "c",
    });
    expect(await (await second).json()).toEqual({
      text: "done",
      provider: "c",
    });
  });

  test("fall back to the next provider when one fails", async () => {
    const seen: string[] = [];
    const handlers = createVoiceHandlers({
      providers: () => [
        { kind: "elevenlabs", label: "ElevenLabs", apiKey: "k" },
        { kind: "command", label: "Fun-ASR", argv: ["x", "{input}"] },
      ],
      transcribe: async (provider) => {
        seen.push(provider.label);
        if (provider.kind === "elevenlabs") throw new Error("quota");
        return "local";
      },
    });
    const response = await handlers.transcribe(request(wav()));
    expect(await response.json()).toEqual({
      text: "local",
      provider: "Fun-ASR",
      fallback: true,
    });
    expect(seen).toEqual(["ElevenLabs", "Fun-ASR"]);
  });

  test("report every failure when the whole chain fails", async () => {
    const handlers = createVoiceHandlers({
      providers: () => [
        { kind: "elevenlabs", label: "ElevenLabs", apiKey: "k" },
        { kind: "command", label: "Fun-ASR", argv: ["x", "{input}"] },
      ],
      transcribe: async (provider) => {
        throw new Error(`${provider.kind} down`);
      },
    });
    const response = await handlers.transcribe(request(wav()));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe(
      "ElevenLabs: elevenlabs down; Fun-ASR: command down",
    );
  });

  test("clean up dictation through the configured model", async () => {
    const cleanupRequest = (body: unknown) =>
      new Request("http://local/api/voice/cleanup", {
        method: "POST",
        body: JSON.stringify(body),
      });
    const off = createVoiceHandlers({ providers: () => [] });
    expect((await off.cleanup(cleanupRequest({}))).status).toBe(503);
    const handlers = createVoiceHandlers({
      providers: () => [],
      cleanup: () => ({ baseUrl: "u", model: "m", apiKey: "k" }),
      cleanText: async (_config, mode, text) => `${mode}:${text}`,
    });
    expect(
      (await handlers.cleanup(cleanupRequest({ text: "x", mode: "loud" })))
        .status,
    ).toBe(400);
    expect(
      (await handlers.cleanup(cleanupRequest({ text: " ", mode: "typeset" })))
        .status,
    ).toBe(400);
    const response = await handlers.cleanup(
      cleanupRequest({ text: "um hello", mode: "typeset" }),
    );
    expect(await response.json()).toEqual({
      text: "typeset:um hello",
      model: "m",
    });
  });
});
