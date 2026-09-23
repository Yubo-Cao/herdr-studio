// Monaco editor bundle for file editing. Only this lazy module (reached from
// FileEditor) imports Monaco: the core API, a curated set of editing
// features, Monarch grammars for common languages, and the base editor worker.
// Language-service workers (TypeScript, JSON, CSS, HTML) are intentionally
// excluded, and nothing is fetched from a CDN.
import * as monaco from "monaco-esm/editor/editor.api.js";
import "monaco-esm/features/codicon/register.js";
import "monaco-esm/features/bracketMatching/register.js";
import "monaco-esm/features/caretOperations/register.js";
import "monaco-esm/features/clipboard/register.js";
import "monaco-esm/features/comment/register.js";
import "monaco-esm/features/contextmenu/register.js";
import "monaco-esm/features/cursorUndo/register.js";
import "monaco-esm/features/find/register.js";
import "monaco-esm/features/folding/register.js";
import "monaco-esm/features/gotoLine/register.js";
import "monaco-esm/features/indentation/register.js";
import "monaco-esm/features/lineSelection/register.js";
import "monaco-esm/features/linesOperations/register.js";
import "monaco-esm/features/multicursor/register.js";
import "monaco-esm/features/smartSelect/register.js";
import "monaco-esm/features/wordHighlighter/register.js";
import "monaco-esm/features/wordOperations/register.js";
import * as bat from "monaco-esm/languages/definitions/bat/bat.js";
import * as cpp from "monaco-esm/languages/definitions/cpp/cpp.js";
import * as csharp from "monaco-esm/languages/definitions/csharp/csharp.js";
import * as css from "monaco-esm/languages/definitions/css/css.js";
import * as dockerfile from "monaco-esm/languages/definitions/dockerfile/dockerfile.js";
import * as go from "monaco-esm/languages/definitions/go/go.js";
import * as graphql from "monaco-esm/languages/definitions/graphql/graphql.js";
import * as hcl from "monaco-esm/languages/definitions/hcl/hcl.js";
import * as html from "monaco-esm/languages/definitions/html/html.js";
import * as ini from "monaco-esm/languages/definitions/ini/ini.js";
import * as java from "monaco-esm/languages/definitions/java/java.js";
import * as javascript from "monaco-esm/languages/definitions/javascript/javascript.js";
import * as kotlin from "monaco-esm/languages/definitions/kotlin/kotlin.js";
import * as less from "monaco-esm/languages/definitions/less/less.js";
import * as lua from "monaco-esm/languages/definitions/lua/lua.js";
import * as markdown from "monaco-esm/languages/definitions/markdown/markdown.js";
import * as perl from "monaco-esm/languages/definitions/perl/perl.js";
import * as php from "monaco-esm/languages/definitions/php/php.js";
import * as powershell from "monaco-esm/languages/definitions/powershell/powershell.js";
import * as protobuf from "monaco-esm/languages/definitions/protobuf/protobuf.js";
import * as python from "monaco-esm/languages/definitions/python/python.js";
import * as r from "monaco-esm/languages/definitions/r/r.js";
import * as ruby from "monaco-esm/languages/definitions/ruby/ruby.js";
import * as rust from "monaco-esm/languages/definitions/rust/rust.js";
import * as scss from "monaco-esm/languages/definitions/scss/scss.js";
import * as shell from "monaco-esm/languages/definitions/shell/shell.js";
import * as sql from "monaco-esm/languages/definitions/sql/sql.js";
import * as swift from "monaco-esm/languages/definitions/swift/swift.js";
import * as typescript from "monaco-esm/languages/definitions/typescript/typescript.js";
import * as xml from "monaco-esm/languages/definitions/xml/xml.js";
import * as yaml from "monaco-esm/languages/definitions/yaml/yaml.js";
import EditorWorker from "monaco-esm/editor/editor.worker.js?worker";

type MonarchModule = {
  conf: monaco.languages.LanguageConfiguration;
  language: monaco.languages.IMonarchLanguage;
};

// JSON has no Monarch grammar in Monaco; its JavaScript grammar tokenizes
// strings, numbers, and literals well enough for editing.
const GRAMMARS: Record<string, MonarchModule> = {
  bat,
  cpp,
  csharp,
  css,
  dockerfile,
  go,
  graphql,
  hcl,
  html,
  ini,
  java,
  javascript,
  json: javascript,
  kotlin,
  less,
  lua,
  markdown,
  perl,
  php,
  powershell,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

(
  self as unknown as { MonacoEnvironment: monaco.Environment }
).MonacoEnvironment = { getWorker: () => new EditorWorker() };

for (const [id, grammar] of Object.entries(GRAMMARS)) {
  monaco.languages.register({ id });
  monaco.languages.setMonarchTokensProvider(id, grammar.language);
  monaco.languages.setLanguageConfiguration(id, grammar.conf);
}

function cssColor(expression: string, fallback: string) {
  // Resolve var()/color-mix() through the cascade into a hex color.
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = expression;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const channels = rgb.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) return fallback;
  const hex = channels
    .slice(0, 3)
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

/** Define (or refresh) the app theme from the live CSS tokens. */
export function applyMonacoTheme(theme: "dark" | "light") {
  const dark = theme === "dark";
  const name = dark ? "roamgate-dark" : "roamgate-light";
  const background = cssColor(
    "var(--viewer-content-bg, var(--terminal-bg))",
    dark ? "#0e1014" : "#ffffff",
  );
  monaco.editor.defineTheme(name, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": background,
      "editorGutter.background": background,
      "minimap.background": background,
      "editor.foreground": cssColor(
        "var(--text)",
        dark ? "#d4d8df" : "#24292f",
      ),
      "editorLineNumber.foreground": cssColor("var(--muted)", "#858c97"),
      "editorLineNumber.activeForeground": cssColor(
        "var(--text-strong)",
        dark ? "#f4f6f8" : "#101418",
      ),
      "editorCursor.foreground": cssColor("var(--accent)", "#6ea0ff"),
      "editorWidget.background": cssColor("var(--panel)", background),
      "editorWidget.border": cssColor("var(--border)", "#23272e"),
    },
  });
  monaco.editor.setTheme(name);
}

export { monaco };
