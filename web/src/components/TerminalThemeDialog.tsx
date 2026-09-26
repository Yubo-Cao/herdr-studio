import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ITheme } from "@xterm/xterm";
import { Check, Copy, Moon, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import type { ResolvedTheme } from "../appearance";
import { msg, t } from "../i18n";
import {
  type CustomTerminalTheme,
  customTerminalThemeToITheme,
  defaultTerminalThemeId,
  MAX_CUSTOM_TERMINAL_THEMES,
  MAX_TERMINAL_THEME_NAME_LENGTH,
  resolveTerminalThemeDefinition,
  TERMINAL_ANSI_COLOR_KEYS,
  TERMINAL_BASE_COLOR_KEYS,
  type TerminalThemeColorKey,
  type TerminalThemeDefinition,
  TERMINAL_THEME_PRESETS,
  type TerminalThemeSelection,
  terminalColorToHex,
} from "../terminalThemes";
import { CloseButton } from "./CloseButton";
import { focusDialogElement } from "./dialogFocus";
import { ConfirmDialog } from "./ModalDialogs";
import "./TerminalThemeDialog.css";

// Editor fallback palette for colors a source theme leaves unset (xterm
// defaults, e.g. Herdr Dark's ANSI colors).
const EDITOR_FALLBACK_COLORS: Record<TerminalThemeColorKey, string> = {
  background: "#0b0d12",
  foreground: "#c9cdd6",
  cursor: "#c9cdd6",
  cursorAccent: "#0b0d12",
  selectionBackground: "#6ea8ff",
  black: "#2e3436",
  red: "#cc0000",
  green: "#4e9a06",
  yellow: "#c4a000",
  blue: "#3465a4",
  magenta: "#75507b",
  cyan: "#06989a",
  white: "#d3d7cf",
  brightBlack: "#555753",
  brightRed: "#ef2929",
  brightGreen: "#8ae234",
  brightYellow: "#fce94f",
  brightBlue: "#729fcf",
  brightMagenta: "#ad7fa8",
  brightCyan: "#34e2e2",
  brightWhite: "#eeeeec",
};

const COLOR_KEY_LABELS: Record<TerminalThemeColorKey, string> = {
  background: msg("Background"),
  foreground: msg("Foreground"),
  cursor: msg("Cursor"),
  cursorAccent: msg("Cursor text"),
  selectionBackground: msg("Selection"),
  black: msg("Black"),
  red: msg("Red"),
  green: msg("Green"),
  yellow: msg("Yellow"),
  blue: msg("Blue"),
  magenta: msg("Magenta"),
  cyan: msg("Cyan"),
  white: msg("White"),
  brightBlack: msg("Bright black"),
  brightRed: msg("Bright red"),
  brightGreen: msg("Bright green"),
  brightYellow: msg("Bright yellow"),
  brightBlue: msg("Bright blue"),
  brightMagenta: msg("Bright magenta"),
  brightCyan: msg("Bright cyan"),
  brightWhite: msg("Bright white"),
};

const ALL_COLOR_KEYS: readonly TerminalThemeColorKey[] = [
  ...TERMINAL_BASE_COLOR_KEYS,
  ...TERMINAL_ANSI_COLOR_KEYS,
];

const THEME_VARIANTS: readonly {
  value: ResolvedTheme;
  label: string;
  usedWhen: string;
  create: string;
  group: string;
}[] = [
  {
    value: "dark",
    label: msg("Dark mode"),
    usedWhen: msg("Used when the app is in dark mode"),
    create: msg("Create a custom theme for dark mode"),
    group: msg("Dark mode terminal theme"),
  },
  {
    value: "light",
    label: msg("Light mode"),
    usedWhen: msg("Used when the app is in light mode"),
    create: msg("Create a custom theme for light mode"),
    group: msg("Light mode terminal theme"),
  },
];

let nextCustomThemeId = 1;

function newCustomThemeId(): string {
  return `custom-${Date.now()}-${nextCustomThemeId++}`;
}

type TerminalThemeDraft = {
  id: string | null;
  name: string;
  variant: ResolvedTheme;
  colors: Record<TerminalThemeColorKey, string>;
};

function draftColorsFromITheme(
  theme: ITheme,
): Record<TerminalThemeColorKey, string> {
  const colors = {} as Record<TerminalThemeColorKey, string>;
  for (const key of ALL_COLOR_KEYS) {
    colors[key] = terminalColorToHex(theme[key]) || EDITOR_FALLBACK_COLORS[key];
  }
  return colors;
}

function draftFromDefinition(
  definition: TerminalThemeDefinition,
  name: string,
): TerminalThemeDraft {
  return {
    id: null,
    name,
    variant: definition.variant,
    colors: draftColorsFromITheme(definition.theme),
  };
}

function draftFromCustom(custom: CustomTerminalTheme): TerminalThemeDraft {
  const colors = {} as Record<TerminalThemeColorKey, string>;
  for (const key of ALL_COLOR_KEYS) {
    colors[key] = custom.colors[key]
      ? terminalColorToHex(custom.colors[key])
      : EDITOR_FALLBACK_COLORS[key];
  }
  return { id: custom.id, name: custom.name, variant: custom.variant, colors };
}

function TerminalThemePreview({
  colors,
}: {
  colors: Record<TerminalThemeColorKey, string>;
}) {
  return (
    <div
      className="terminal-theme-preview"
      style={{ background: colors.background }}
      aria-hidden="true"
    >
      <div className="terminal-theme-preview-lines">
        <span style={{ color: colors.foreground }}>$ herdr test</span>
        <span>
          <i style={{ color: colors.green }}>pass</i>
          <i style={{ color: colors.red }}>fail</i>
          <i style={{ color: colors.blue }}>src/main.ts</i>
        </span>
      </div>
      <div className="terminal-theme-dots">
        {TERMINAL_ANSI_COLOR_KEYS.map((key) => (
          <span
            key={key}
            className="terminal-theme-dot"
            style={{ background: colors[key] }}
          />
        ))}
      </div>
    </div>
  );
}

type ThemeCardData = {
  definition: TerminalThemeDefinition;
  custom: CustomTerminalTheme | null;
};

export function TerminalThemeDialog({
  open,
  selection,
  customThemes,
  onSelectionChange,
  onCustomThemesChange,
  onClose,
}: {
  open: boolean;
  selection: TerminalThemeSelection;
  customThemes: CustomTerminalTheme[];
  onSelectionChange: (selection: TerminalThemeSelection) => void;
  onCustomThemesChange: (themes: CustomTerminalTheme[]) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<TerminalThemeDraft | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<CustomTerminalTheme | null>(null);

  const editing = draft !== null;
  const confirmingDelete = pendingDelete !== null;
  const canCreate = customThemes.length < MAX_CUSTOM_TERMINAL_THEMES;
  const missingDraft =
    draft?.id != null && !customThemes.some((theme) => theme.id === draft.id);

  useEffect(() => {
    if (open && !confirmingDelete) {
      return focusDialogElement(dialogRef.current);
    }
  }, [open, editing, confirmingDelete]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The delete confirmation handles its own Escape while open.
      if (pendingDelete) return;
      event.preventDefault();
      event.stopPropagation();
      if (draft) setDraft(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [open, draft, pendingDelete, onClose]);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setPendingDelete(null);
    }
  }, [open]);

  if (!open) return null;

  const cardsFor = (variant: ResolvedTheme): ThemeCardData[] => [
    ...TERMINAL_THEME_PRESETS.filter(
      (preset) => preset.variant === variant,
    ).map((definition) => ({ definition, custom: null })),
    ...customThemes
      .filter((theme) => theme.variant === variant)
      .map((custom) => ({
        custom,
        definition: {
          id: custom.id,
          name: custom.name,
          variant: custom.variant,
          builtin: false,
          theme: customTerminalThemeToITheme(custom),
        },
      })),
  ];

  const selectTheme = (variant: ResolvedTheme, id: string) => {
    onSelectionChange({ ...selection, [variant]: id });
  };

  const startNewTheme = (variant: ResolvedTheme) => {
    const current = resolveTerminalThemeDefinition(
      variant,
      selection,
      customThemes,
    );
    setDraft(draftFromDefinition(current, t("Custom theme")));
  };

  const duplicateTheme = (card: ThemeCardData) => {
    setDraft(
      draftFromDefinition(
        card.definition,
        t("{name} copy", { name: card.definition.name }),
      ),
    );
  };

  const saveDraft = () => {
    if (!draft || missingDraft || (!draft.id && !canCreate)) return;
    const theme: CustomTerminalTheme = {
      id: draft.id ?? newCustomThemeId(),
      name: draft.name.trim() || t("Custom theme"),
      variant: draft.variant,
      colors: { ...draft.colors },
    };
    onCustomThemesChange(
      draft.id
        ? customThemes.map((custom) =>
            custom.id === draft.id ? theme : custom,
          )
        : [...customThemes, theme],
    );
    onSelectionChange({ ...selection, [theme.variant]: theme.id });
    setDraft(null);
  };

  const deleteCustomTheme = (theme: CustomTerminalTheme) => {
    onCustomThemesChange(
      customThemes.filter((custom) => custom.id !== theme.id),
    );
    if (selection.dark === theme.id || selection.light === theme.id) {
      onSelectionChange({
        dark:
          selection.dark === theme.id
            ? defaultTerminalThemeId("dark")
            : selection.dark,
        light:
          selection.light === theme.id
            ? defaultTerminalThemeId("light")
            : selection.light,
      });
    }
  };

  const onCardKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    cards: ThemeCardData[],
    index: number,
    variant: ResolvedTheme,
  ) => {
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    const nextIndex = (index + direction + cards.length) % cards.length;
    selectTheme(variant, cards[nextIndex].definition.id);
    const buttons = event.currentTarget
      .closest('[role="radiogroup"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[nextIndex]?.focus();
  };

  const renderSection = (section: (typeof THEME_VARIANTS)[number]) => {
    const variant = section.value;
    const cards = cardsFor(variant);
    // A stale selection id (e.g. edited storage) marks no card active; keep
    // the first card tabbable so the group stays keyboard-reachable.
    const hasActive = cards.some(
      (card) => selection[variant] === card.definition.id,
    );
    return (
      <section className="terminal-theme-section" key={variant}>
        <div className="terminal-theme-section-head">
          <div>
            <strong>
              {variant === "dark" ? (
                <Moon size={14} aria-hidden="true" />
              ) : (
                <Sun size={14} aria-hidden="true" />
              )}
              {t(section.label)}
            </strong>
            <span>{t(section.usedWhen)}</span>
          </div>
          <button
            type="button"
            className="terminal-theme-new-button"
            disabled={!canCreate}
            title={
              canCreate
                ? t(section.create)
                : t("Custom theme limit reached ({limit})", {
                    limit: MAX_CUSTOM_TERMINAL_THEMES,
                  })
            }
            onClick={() => startNewTheme(variant)}
          >
            <Plus size={14} aria-hidden="true" />
            {t("New theme")}
          </button>
        </div>
        <div
          className="terminal-theme-grid"
          role="radiogroup"
          aria-label={t(section.group)}
        >
          {cards.map((card, index) => {
            const active = selection[variant] === card.definition.id;
            const custom = card.custom;
            return (
              <div
                key={card.definition.id}
                className={`terminal-theme-card ${active ? "is-active" : ""}`}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active || (!hasActive && index === 0) ? 0 : -1}
                  className="terminal-theme-card-select"
                  onClick={() => selectTheme(variant, card.definition.id)}
                  onKeyDown={(event) =>
                    onCardKeyDown(event, cards, index, variant)
                  }
                >
                  <TerminalThemePreview
                    colors={draftColorsFromITheme(card.definition.theme)}
                  />
                  <span className="terminal-theme-card-name">
                    {active ? <Check size={13} aria-hidden="true" /> : null}
                    {card.definition.name}
                    {custom ? (
                      <span className="badge">{t("Custom")}</span>
                    ) : null}
                  </span>
                </button>
                <span className="terminal-theme-card-actions">
                  <button
                    type="button"
                    aria-label={t("Duplicate {name}", {
                      name: card.definition.name,
                    })}
                    title={
                      canCreate
                        ? t("Duplicate as custom theme")
                        : t("Custom theme limit reached ({limit})", {
                            limit: MAX_CUSTOM_TERMINAL_THEMES,
                          })
                    }
                    disabled={!canCreate}
                    onClick={() => duplicateTheme(card)}
                  >
                    <Copy size={13} aria-hidden="true" />
                  </button>
                  {custom ? (
                    <>
                      <button
                        type="button"
                        aria-label={t("Edit {name}", {
                          name: card.definition.name,
                        })}
                        title={t("Edit theme")}
                        onClick={() => setDraft(draftFromCustom(custom))}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("Delete {name}", {
                          name: card.definition.name,
                        })}
                        title={t("Delete theme")}
                        onClick={() => setPendingDelete(custom)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const renderEditor = (current: TerminalThemeDraft) => {
    const setColor = (key: TerminalThemeColorKey, value: string) => {
      setDraft({ ...current, colors: { ...current.colors, [key]: value } });
    };
    const colorField = (key: TerminalThemeColorKey) => (
      <label className="terminal-theme-color-field" key={key}>
        <input
          type="color"
          value={current.colors[key]}
          onChange={(event) => setColor(key, event.target.value)}
        />
        <span>{t(COLOR_KEY_LABELS[key])}</span>
        <code>{current.colors[key]}</code>
      </label>
    );
    return (
      <>
        <div className="modal-head">
          <div>
            <h2>{current.id ? t("Edit theme") : t("New theme")}</h2>
            <p>{t("Pick colors; the preview updates as you go.")}</p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="terminal-theme-editor">
          <div className="terminal-theme-editor-top">
            <label className="form-field terminal-theme-name-field">
              <span>{t("Theme name")}</span>
              <input
                value={current.name}
                maxLength={MAX_TERMINAL_THEME_NAME_LENGTH}
                onChange={(event) =>
                  setDraft({ ...current, name: event.target.value })
                }
              />
            </label>
            <div className="terminal-theme-variant-field">
              <span>{t("Suggested for")}</span>
              <div
                className="config-theme-control"
                aria-label={t("Suggested appearance")}
              >
                {THEME_VARIANTS.map((variant) => (
                  <button
                    key={variant.value}
                    type="button"
                    aria-label={t(variant.label)}
                    aria-pressed={current.variant === variant.value}
                    className={
                      current.variant === variant.value ? "is-active" : ""
                    }
                    onClick={() =>
                      setDraft({ ...current, variant: variant.value })
                    }
                  >
                    {variant.value === "dark" ? (
                      <Moon size={14} />
                    ) : (
                      <Sun size={14} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <TerminalThemePreview colors={current.colors} />

          <div className="terminal-theme-color-group">
            <strong>{t("Base colors")}</strong>
            <div className="terminal-theme-color-grid">
              {TERMINAL_BASE_COLOR_KEYS.map(colorField)}
            </div>
          </div>
          <div className="terminal-theme-color-group">
            <strong>{t("ANSI colors")}</strong>
            <div className="terminal-theme-color-grid">
              {TERMINAL_ANSI_COLOR_KEYS.map(colorField)}
            </div>
          </div>
        </div>

        {missingDraft ? (
          <p role="alert">
            {t(
              "This theme no longer exists. Your unsaved edits are kept here until you close the editor.",
            )}
          </p>
        ) : null}
        {!current.id && !canCreate ? (
          <p role="alert">
            {t(
              "Custom theme limit reached ({limit}). Delete a theme before creating another.",
              { limit: MAX_CUSTOM_TERMINAL_THEMES },
            )}
          </p>
        ) : null}
        <div className="modal-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => setDraft(null)}
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            disabled={
              !current.name.trim() ||
              missingDraft ||
              (!current.id && !canCreate)
            }
            onClick={saveDraft}
          >
            {current.id ? t("Save theme") : t("Create theme")}
          </button>
        </div>
      </>
    );
  };

  return (
    <>
      <div
        className="modal-backdrop"
        onMouseDown={() => (draft ? setDraft(null) : onClose())}
      >
        <div
          ref={dialogRef}
          className="modal terminal-themes-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t("Terminal themes")}
          tabIndex={-1}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {draft ? (
            renderEditor(draft)
          ) : (
            <>
              <div className="modal-head">
                <div>
                  <h2>{t("Terminal Themes")}</h2>
                  <p>
                    {t(
                      "Choose a theme per appearance mode, or create your own from any preset.",
                    )}
                  </p>
                </div>
                <CloseButton onClick={onClose} />
              </div>
              {THEME_VARIANTS.map((variant) => renderSection(variant))}
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("Delete theme")}
        message={t("Delete {name}? This cannot be undone.", {
          name: `"${pendingDelete?.name ?? ""}"`,
        })}
        confirmLabel={t("Delete")}
        danger
        onConfirm={() => {
          if (pendingDelete) deleteCustomTheme(pendingDelete);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
