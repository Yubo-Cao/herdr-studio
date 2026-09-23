import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

// The web UI is square and borderless: surfaces separate by tone and single
// dividers, never by rounded corners or boxed outlines.
const webSource = new URL("../web/src/", import.meta.url).pathname;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(css|tsx?)$/.test(entry.name) && !entry.name.includes(".test.")
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}

function violations(path: string, text: string) {
  const found: string[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const at = `${relative(webSource, path)}:${index + 1}`;
    if (path.endsWith(".css")) {
      if (/border-radius\s*:(?!\s*0\s*;)/.test(line))
        found.push(`${at} rounds corners: ${line.trim()}`);
      // Thicker rings on status dots and spinners are glyphs, not outlines.
      if (/^\s*border\s*:\s*1px\s+solid/.test(line))
        found.push(`${at} draws an outline: ${line.trim()}`);
    } else if (/borderRadius\s*:(?![\s"']*0\b)/.test(line)) {
      found.push(`${at} rounds corners inline: ${line.trim()}`);
    }
  });
  return found;
}

test("web styles stay square and borderless", async () => {
  const found: string[] = [];
  for (const path of await sourceFiles(webSource))
    found.push(...violations(path, await readFile(path, "utf8")));
  expect(found).toEqual([]);
});
