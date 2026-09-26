import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { installCatalog, msg, resolveLocale, t } from "./i18n";
import zhCN from "./locales/zh-CN";

const SOURCE_ROOT = import.meta.dir;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory())
      return name === "locales" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// t("…") and msg("…") literals, allowing a line break after the parenthesis.
const MESSAGE_CALL = /\b(?:t|msg)\(\s*"((?:[^"\\\n]|\\.)*)"/g;
const TEMPLATE_CALL = /\b(?:t|msg)\(\s*`/;

function extractMessages() {
  const messages = new Map<string, string>();
  const templates: string[] = [];
  for (const file of sourceFiles(SOURCE_ROOT)) {
    // Skip comment lines: documentation may show example calls.
    const source = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join("\n");
    if (TEMPLATE_CALL.test(source)) templates.push(relative(SOURCE_ROOT, file));
    for (const match of source.matchAll(MESSAGE_CALL)) {
      const text = JSON.parse(`"${match[1]}"`) as string;
      if (!messages.has(text)) messages.set(text, relative(SOURCE_ROOT, file));
    }
  }
  return { messages, templates };
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("interface translation", () => {
  test("translates, interpolates, and falls back to English", () => {
    installCatalog("zh-CN", {
      "Copied {count} characters": "已复制 {count} 个字符",
    });
    try {
      expect(t("Copied {count} characters", { count: 3 })).toBe(
        "已复制 3 个字符",
      );
      expect(t("Untranslated")).toBe("Untranslated");
      expect(msg("Marked")).toBe("Marked");
    } finally {
      installCatalog("en", {});
    }
  });

  test("auto follows Chinese browser languages", () => {
    expect(resolveLocale("auto", ["zh-TW", "en"])).toBe("zh-CN");
    expect(resolveLocale("auto", ["en-US"])).toBe("en");
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
  });

  test("every message in the source has a Simplified Chinese translation", () => {
    const { messages, templates } = extractMessages();
    expect(templates).toEqual([]);
    const missing = [...messages]
      .filter(([text]) => !(text in zhCN))
      .map(([text, file]) => `${file}: ${text}`);
    expect(missing).toEqual([]);
  });

  test("translations keep every placeholder", () => {
    const broken = Object.entries(zhCN)
      .filter(([source, text]) => {
        const expected = placeholders(source);
        return expected.join() !== placeholders(text).join();
      })
      .map(([source]) => source);
    expect(broken).toEqual([]);
  });
});
