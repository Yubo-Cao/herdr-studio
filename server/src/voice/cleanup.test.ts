import { describe, expect, test } from "bun:test";
import {
  chatCleanupBody,
  cleanDictation,
  cleanupProblem,
  responseText,
  VOICE_CLEANUP_PROMPTS,
  voiceCleanupFromEnv,
} from "./cleanup";

describe("voice cleanup configuration", () => {
  test("is off without a key and when disabled", () => {
    expect(voiceCleanupFromEnv({})).toBeNull();
    expect(
      voiceCleanupFromEnv({ OPENAI_API_KEY: "k", ROAMGATE_VOICE_LLM: "off" }),
    ).toBeNull();
  });

  test("defaults to the fast OpenAI model", () => {
    expect(voiceCleanupFromEnv({ OPENAI_API_KEY: "k" })).toEqual({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6-luna",
      apiKey: "k",
    });
    expect(
      voiceCleanupFromEnv({
        OPENAI_API_KEY: "ignored",
        ROAMGATE_VOICE_LLM_API_KEY: "k",
        ROAMGATE_VOICE_LLM_BASE_URL: "https://llm.example/v1/",
        ROAMGATE_VOICE_LLM_MODEL: "m",
        ROAMGATE_VOICE_LLM_REASONING_EFFORT: "low",
      }),
    ).toEqual({
      baseUrl: "https://llm.example/v1",
      model: "m",
      apiKey: "k",
      reasoningEffort: "low",
      api: "chat",
    });
  });

  test("uses Chat Completions for OpenAI-compatible providers", () => {
    const deepseek = {
      ROAMGATE_VOICE_LLM_API_KEY: "k",
      ROAMGATE_VOICE_LLM_BASE_URL: "https://api.deepseek.com",
    };
    expect(voiceCleanupFromEnv(deepseek)).toMatchObject({ api: "chat" });
    expect(
      voiceCleanupFromEnv({ ...deepseek, ROAMGATE_VOICE_LLM_API: "responses" }),
    ).not.toHaveProperty("api");
    expect(() =>
      voiceCleanupFromEnv({ ...deepseek, ROAMGATE_VOICE_LLM_API: "soap" }),
    ).toThrow("unknown");
    expect(
      chatCleanupBody(
        {
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-flash",
          apiKey: "k",
        },
        "sys",
        "hi",
      ),
    ).toEqual({
      model: "deepseek-flash",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      stream: false,
      thinking: { type: "disabled" },
      temperature: 0.1,
    });
  });
});

describe("voice cleanup request", () => {
  test("reads output_text or message parts", () => {
    expect(responseText({ output_text: " a " })).toBe("a");
    expect(
      responseText({
        output: [
          { type: "reasoning", content: [] },
          {
            type: "message",
            content: [
              { type: "output_text", text: "x" },
              { type: "output_text", text: "y" },
            ],
          },
        ],
      }),
    ).toBe("xy");
    expect(responseText(null)).toBe("");
  });

  test("sends the preset as instructions without storing", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return Response.json({ output_text: "Hello." });
    }) as unknown as typeof fetch;
    const text = await cleanDictation(
      {
        baseUrl: "https://api",
        model: "m",
        apiKey: "k",
        reasoningEffort: "low",
      },
      "verbatim",
      "um hello",
      fetchImpl,
      [],
    );
    expect(text).toBe("Hello.");
    expect(sent!.url).toBe("https://api/responses");
    expect(new Headers(sent!.init.headers).get("authorization")).toBe(
      "Bearer k",
    );
    expect(JSON.parse(String(sent!.init.body))).toEqual({
      model: "m",
      instructions: VOICE_CLEANUP_PROMPTS.verbatim,
      input: "um hello",
      store: false,
      reasoning: { effort: "low" },
    });
  });

  test("surfaces provider errors", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(
      cleanDictation(
        { baseUrl: "https://api", model: "m", apiKey: "k" },
        "typeset",
        "x",
        fetchImpl,
        [],
      ),
    ).rejects.toThrow("cleanup failed (401) nope");
  });
});

describe("chat cleanup request", () => {
  const config = {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    apiKey: "k",
    api: "chat" as const,
  };
  const reply = (body: unknown, seen: { url?: string } = {}) =>
    (async (url: string) => {
      seen.url = url;
      return Response.json(body);
    }) as unknown as typeof fetch;

  test("reads the first choice", async () => {
    const seen: { url?: string } = {};
    expect(
      await cleanDictation(
        config,
        "tidy",
        "嗯 run the tests",
        reply(
          {
            choices: [
              {
                finish_reason: "stop",
                message: { content: " Run the tests. " },
              },
            ],
          },
          seen,
        ),
        [],
      ),
    ).toBe("Run the tests.");
    expect(seen.url).toBe("https://api.deepseek.com/chat/completions");
  });

  test("rejects a truncated rewrite", async () => {
    await expect(
      cleanDictation(
        config,
        "tidy",
        "x",
        reply({
          choices: [{ finish_reason: "length", message: { content: "x" } }],
        }),
        [],
      ),
    ).rejects.toThrow("stopped early (length)");
  });
});

describe("voice cleanup guard", () => {
  const config = { baseUrl: "https://api", model: "m", apiKey: "k" };
  const reply = (text: string, seen?: { instructions?: string }) =>
    (async (_url: string, init: RequestInit) => {
      if (seen) seen.instructions = JSON.parse(String(init.body)).instructions;
      return Response.json({ output_text: text });
    }) as unknown as typeof fetch;

  test("flags lost text, lost English, and changed numbers", () => {
    const long = "我们今天要讨论的是这个项目的整体架构以及后续的部署计划安排";
    expect(cleanupProblem(long, "讨论架构")).toMatch(/shrank/);
    expect(
      cleanupProblem("run build test deploy now", "运行构建测试部署"),
    ).toMatch(/English/);
    expect(cleanupProblem("端口 8787", "端口 8080")).toBe("numbers changed");
    expect(
      cleanupProblem("first 3 then 4", "1. first 3\n2. then 4"),
    ).toBeNull();
    expect(cleanupProblem("嗯那个 run tests", "Run tests.")).toBeNull();
  });

  test("keeps the transcript when the rewrite is destructive", async () => {
    const dictionary = [{ term: "Codex", aliases: ["code x"] }];
    expect(
      await cleanDictation(
        config,
        "tidy",
        "ask code x to fix it",
        reply("Ask it to fix it."),
        dictionary,
      ),
    ).toBe("ask Codex to fix it");
    const seen: { instructions?: string } = {};
    expect(
      await cleanDictation(
        config,
        "tidy",
        "嗯 ask code x to fix it",
        reply("Ask code x to fix it.", seen),
        dictionary,
      ),
    ).toBe("Ask Codex to fix it.");
    expect(seen.instructions).toStartWith(VOICE_CLEANUP_PROMPTS.tidy);
    expect(seen.instructions).toContain('"term":"Codex"');
  });
});
