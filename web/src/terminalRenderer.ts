import type { Terminal } from "@xterm/xterm";
import { TERMINAL_FONT_STYLESHEET } from "./terminalFontStylesheet";

// Programming ligatures drawn as one glyph when the GPU renderer is active.
// Taken from Iosevka's default "calt" set, which @xterm/addon-ligatures also
// uses when it cannot read the font file. Joining these runs lets the font's
// contextual alternates shape them; everything else stays one cell per glyph.
export const TERMINAL_LIGATURES = [
  "<--",
  "<---",
  "<<-",
  "<-",
  "->",
  "->>",
  "-->",
  "--->",
  "<==",
  "<===",
  "<<=",
  "<=",
  "=>",
  "=>>",
  "==>",
  "===>",
  ">=",
  ">>=",
  "<->",
  "<-->",
  "<--->",
  "<---->",
  "<=>",
  "<==>",
  "<===>",
  "<====>",
  "::",
  ":::",
  "<~~",
  "</",
  "</>",
  "/>",
  "~~>",
  "==",
  "!=",
  "/=",
  "~=",
  "<>",
  "===",
  "!==",
  "!===",
  "<:",
  ":=",
  "*=",
  "*+",
  "<*",
  "<*>",
  "*>",
  "<|",
  "<|>",
  "|>",
  "+*",
  "=*",
  "=:",
  ":>",
  "/*",
  "*/",
  "+++",
  "<!--",
  "<!---",
  "&&",
  "||",
  "..",
  "...",
  "..=",
  "..<",
  "??",
  "?.",
  "=~",
  "!~",
  "#{",
  "#[",
  "]#",
  "::=",
  "|||",
  ">>",
  "<<",
  ">>>",
  "<<<",
  "__",
  "//",
  "///",
];

const LIGATURE_PATTERN = new RegExp(
  [...new Set(TERMINAL_LIGATURES)]
    .sort((left, right) => right.length - left.length)
    .map((ligature) => ligature.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
    .join("|"),
  "g",
);

/** Ranges of `text` to draw as single ligature glyphs. */
export function terminalLigatureRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  LIGATURE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(LIGATURE_PATTERN)) {
    const start = match.index ?? 0;
    ranges.push([start, start + match[0].length]);
  }
  return ranges;
}

export const TERMINAL_WEB_FONT_FAMILY = "Roamgate Mono";

/**
 * Add the bundled font's unicode-range stylesheet once, without blocking: the
 * terminal paints with fallback fonts until the chunks it needs arrive.
 */
export function ensureTerminalFontStylesheet(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector("link[data-terminal-font]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = TERMINAL_FONT_STYLESHEET;
  link.dataset.terminalFont = "";
  document.head.append(link);
}

// Characters whose font chunk this page has already requested.
const requestedGlyphs = new Set<string>();

/** New non-ASCII characters in the visible rows, requested at most once. */
export function unrequestedGlyphs(lines: Iterable<string>): string {
  let found = "";
  for (const line of lines) {
    for (const char of line) {
      if (char.charCodeAt(0) < 0x80 || requestedGlyphs.has(char)) continue;
      requestedGlyphs.add(char);
      found += char;
    }
  }
  return found;
}

// iOS drops WebGL contexts of backgrounded pages; recover a few times per
// terminal, then keep the DOM renderer rather than flap.
const MAX_WEBGL_RECOVERIES = 3;

/**
 * Renders the terminal on the GPU when WebGL2 is available, with pixel-exact
 * box drawing and Powerline glyphs and programming ligatures. Falls back to
 * xterm's DOM renderer when WebGL is unavailable or its context is lost.
 */
export function attachTerminalRenderer(term: Terminal): () => void {
  let disposed = false;
  let addon: { dispose(): void; clearTextureAtlas(): void } | null = null;
  let joiner: number | null = null;
  let recoveries = 0;
  let loading: Promise<void> | null = null;

  const setGpu = (active: boolean) => {
    term.element?.classList.toggle("xterm-gpu", active);
    if (active && joiner === null) {
      joiner = term.registerCharacterJoiner(terminalLigatureRanges);
    } else if (!active && joiner !== null) {
      term.deregisterCharacterJoiner(joiner);
      joiner = null;
    }
  };

  const load = () => {
    if (disposed || addon || loading) return;
    loading = import("@xterm/addon-webgl")
      .then(({ WebglAddon }) => {
        if (disposed || addon) return;
        const webgl = new WebglAddon({ customGlyphs: true });
        try {
          // Ligature font features must be in place before the atlas renders.
          setGpu(true);
          term.loadAddon(webgl);
        } catch {
          setGpu(false);
          return;
        }
        addon = webgl;
        webgl.onContextLoss(() => {
          webgl.dispose();
          if (addon === webgl) addon = null;
          setGpu(false);
          if (++recoveries <= MAX_WEBGL_RECOVERIES) {
            if (document.visibilityState === "visible") queueMicrotask(load);
          }
        });
      })
      .catch(() => {
        // The DOM renderer stays in place.
      })
      .finally(() => {
        loading = null;
      });
  };

  const onVisible = () => {
    if (
      document.visibilityState === "visible" &&
      recoveries <= MAX_WEBGL_RECOVERIES
    )
      load();
  };

  // The bundled font may finish loading after xterm measured its fallback.
  // Reapplying the family makes xterm remeasure cells and rebuild glyphs.
  const remeasure = () => {
    if (disposed) return;
    const family = term.options.fontFamily ?? "";
    term.options.fontFamily = `${family} `;
    term.options.fontFamily = family;
    addon?.clearTextureAtlas();
  };
  const fontSpec = () =>
    `${term.options.fontSize ?? 13}px "${TERMINAL_WEB_FONT_FAMILY}"`;
  ensureTerminalFontStylesheet();
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (fonts && !fonts.check(fontSpec())) {
    // Both weights' Latin chunks (~14 KB each) carry the ligature features;
    // bold output would otherwise draw with a fallback face.
    void Promise.all([fonts.load(fontSpec()), fonts.load(`bold ${fontSpec()}`)])
      // Wait for both: WebKit may cache bold glyphs from a fallback face and
      // does not always fire loadingdone for loads started here.
      .then(([regular, bold]) => {
        if (regular.length > 0 || bold.length > 0) remeasure();
      })
      .catch(() => {});
  }
  // The GPU renderer caches glyphs drawn with fallback fonts; once a CJK or
  // icon chunk arrives, rebuild the atlas so those cells use the real face.
  let atlasTimer: ReturnType<typeof setTimeout> | null = null;
  const onFontsLoaded = () => {
    if (disposed || atlasTimer) return;
    atlasTimer = setTimeout(() => {
      atlasTimer = null;
      if (disposed) return;
      addon?.clearTextureAtlas();
      term.refresh(0, term.rows - 1);
    }, 120);
  };
  fonts?.addEventListener("loadingdone", onFontsLoaded);
  // Canvas text does not reliably trigger unicode-range downloads, so ask for
  // the chunks of characters that appear on screen.
  let scanQueued = false;
  const scanGlyphs = () => {
    scanQueued = false;
    if (disposed || !fonts) return;
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < term.rows; y++)
      lines.push(
        buffer.getLine(buffer.viewportY + y)?.translateToString() ?? "",
      );
    const glyphs = unrequestedGlyphs(lines);
    if (glyphs)
      void fonts
        .load(fontSpec(), glyphs)
        .then((faces) => {
          if (faces.length > 0) onFontsLoaded();
        })
        .catch(() => {});
  };
  const written = term.onWriteParsed(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scanGlyphs);
  });

  load();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisible);
    fonts?.removeEventListener("loadingdone", onFontsLoaded);
    written.dispose();
    if (atlasTimer) clearTimeout(atlasTimer);
    if (joiner !== null) {
      try {
        term.deregisterCharacterJoiner(joiner);
      } catch {
        // The terminal may already be disposed.
      }
    }
    addon?.dispose();
    addon = null;
  };
}
