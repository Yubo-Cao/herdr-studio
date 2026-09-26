import type { Terminal } from "@xterm/xterm";

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
  const size = term.options.fontSize ?? 13;
  if (
    typeof document !== "undefined" &&
    document.fonts &&
    !document.fonts.check(`${size}px "${TERMINAL_WEB_FONT_FAMILY}"`)
  ) {
    void document.fonts
      .load(`${size}px "${TERMINAL_WEB_FONT_FAMILY}"`)
      .then((faces) => {
        if (faces.length > 0) remeasure();
      })
      .catch(() => {});
  }

  load();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisible);
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
