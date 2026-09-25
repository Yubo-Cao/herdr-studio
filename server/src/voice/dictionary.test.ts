import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAliases,
  createDictionaryLoader,
  dictionaryHints,
  dictionaryKeyterms,
  dictionaryPathFromEnv,
  parseDictionary,
} from "./dictionary";

describe("voice dictionary", () => {
  test("parses Aoide's term and alias format", () => {
    expect(
      parseDictionary(
        "terms:\n  - Claude Code\n  - {term: FunASR, aliases: [fun asr, ' ', 3]}\n",
      ),
    ).toEqual([
      { term: "Claude Code", aliases: [] },
      { term: "FunASR", aliases: ["fun asr"] },
    ]);
    expect(parseDictionary("")).toEqual([]);
    expect(() => parseDictionary("terms:\n  - {aliases: [x]}\n")).toThrow();
  });

  test("replaces aliases in one pass at word boundaries", () => {
    const entries = [
      { term: "Codex", aliases: ["code x"] },
      { term: "B", aliases: ["A"] },
      { term: "C", aliases: ["B"] },
      { term: "语皇", aliases: ["雨黄"] },
    ];
    expect(applyAliases("use code x and A", entries)).toBe("use Codex and B");
    expect(applyAliases("Alpha 雨黄说", entries)).toBe("Alpha 语皇说");
    expect(applyAliases("unchanged", [])).toBe("unchanged");
  });

  test("builds prompt hints and provider keyterms", () => {
    expect(dictionaryHints([])).toBe("");
    expect(dictionaryHints([{ term: "Kylian", aliases: [] }])).toContain(
      '[{"term":"Kylian","aliases":[]}]',
    );
    expect(
      dictionaryKeyterms([
        { term: "Claude Code", aliases: [] },
        { term: "a b c d e f", aliases: [] },
        { term: "x[1]", aliases: [] },
        { term: "Claude Code", aliases: [] },
      ]),
    ).toEqual(["Claude Code"]);
  });

  test("expands a home-relative path", () => {
    expect(dictionaryPathFromEnv({})).toBeNull();
    expect(
      dictionaryPathFromEnv({ ROAMGATE_VOICE_DICTIONARY: "~/d.yaml" }),
    ).toMatch(/\/d\.yaml$/);
    expect(
      dictionaryPathFromEnv({ ROAMGATE_VOICE_DICTIONARY: "~/d.yaml" }),
    ).not.toContain("~");
  });

  test("reloads on change and keeps the last valid version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roamgate-dictionary-"));
    const file = join(dir, "dictionary.yaml");
    try {
      const load = createDictionaryLoader(() => file);
      expect(load()).toEqual([]);
      await writeFile(file, "terms: [Kylian]\n");
      expect(load()).toEqual([{ term: "Kylian", aliases: [] }]);
      await writeFile(file, "terms: [[broken\n");
      await utimes(file, new Date(), new Date(Date.now() + 5_000));
      expect(load()).toEqual([{ term: "Kylian", aliases: [] }]);
      await writeFile(file, "terms: [Aoide]\n");
      await utimes(file, new Date(), new Date(Date.now() + 10_000));
      expect(load()).toEqual([{ term: "Aoide", aliases: [] }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
