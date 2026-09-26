import { Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ALargeSmall,
  Bell,
  ChevronRight,
  Download,
  GitBranch,
  Keyboard,
  Languages,
  LayoutDashboard,
  Mic,
  Minus,
  Moon,
  Palette,
  Plus,
  SquareTerminal,
  Sun,
  SunMoon,
  Type as TypeIcon,
} from "lucide-react";
import type { Theme } from "../App";
import {
  ACCENT_OPTIONS,
  type AccentColor,
  clampUiScale,
  normalizeTerminalFontFamily,
  TERMINAL_FONT_OPTIONS,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
} from "../appearance";
import {
  LOCALE_OPTIONS,
  loadLocalePreference,
  type LocalePreference,
  msg,
  saveLocalePreference,
  t,
} from "../i18n";
import { lazyWithReload } from "../lazyWithReload";
import {
  mobileTerminalShortcutCount,
  type MobileTerminalShortcutRows,
  type MobileTerminalSideShortcuts,
} from "../mobileTerminalShortcuts";
import { shallowEqual, store, useStoreSelector } from "../store";
import {
  type CustomTerminalTheme,
  resolveTerminalThemeDefinition,
  type TerminalThemeSelection,
} from "../terminalThemes";
import {
  connectionClientScopeKey,
  useConnectionClient,
} from "../useConnectionClient";
import { AgentIntegrationsSettings } from "./AgentIntegrationsSettings";
import { AutoSyncRepositoriesDialog } from "./AutoSyncRepositoriesDialog";
import { CloseButton } from "./CloseButton";
import { MobileTerminalShortcutsDialog } from "./MobileTerminalShortcutsDialog";
import { TerminalTransportSettings } from "./TerminalTransportSettings";
import { ConfigurationLoadingDialog } from "./ConfigurationLoadingDialog";
import { MobileSheetHandle } from "./MobileSheetHandle";
import { ThemedSelect } from "./ThemedSelect";
import "./ConfigMenu.css";
import "./ConfigurationDialog.css";
import {
  setVoiceCleanupMode,
  useVoiceCleanupMode,
  VOICE_CLEANUP_OPTIONS,
  type VoiceCleanupMode,
} from "../voice/voicePreferences";

const ShortcutLookupDialog = lazyWithReload("keyboard-shortcuts", () =>
  import("./ShortcutLookupDialog").then((module) => ({
    default: module.ShortcutLookupDialog,
  })),
);
const TerminalThemeDialog = lazyWithReload("terminal-theme", () =>
  import("./TerminalThemeDialog").then((module) => ({
    default: module.TerminalThemeDialog,
  })),
);
const MobileLayoutDialog = lazyWithReload("mobile-layout", () =>
  import("./MobileLayoutDialog").then((module) => ({
    default: module.MobileLayoutDialog,
  })),
);

export type ConfigurationProps = {
  theme: Theme;
  accentColor: AccentColor;
  uiScale: number;
  terminalFontFamily: string;
  mobileTerminalShortcuts: MobileTerminalShortcutRows;
  mobileTerminalSideShortcuts: MobileTerminalSideShortcuts;
  terminalThemeSelection: TerminalThemeSelection;
  customTerminalThemes: CustomTerminalTheme[];
  onThemeChange: (theme: Theme) => void;
  onAccentColorChange: (accentColor: AccentColor) => void;
  onUiScaleChange: (scale: number) => void;
  onTerminalFontFamilyChange: (fontFamily: string) => void;
  onMobileTerminalShortcutsChange: (rows: MobileTerminalShortcutRows) => void;
  onMobileTerminalSideShortcutsChange: (
    shortcuts: MobileTerminalSideShortcuts,
  ) => void;
  onTerminalThemeSelectionChange: (selection: TerminalThemeSelection) => void;
  onCustomTerminalThemesChange: (themes: CustomTerminalTheme[]) => void;
};
const tabs = ["Appearance", "Behavior", "Connection", "Integrations"] as const;
export type ConfigurationTab = (typeof tabs)[number];
const TAB_LABELS: Record<ConfigurationTab, string> = {
  Appearance: msg("Appearance"),
  Behavior: msg("Behavior"),
  Connection: msg("Connection"),
  Integrations: msg("Integrations"),
};
type Detail = "terminal" | "layout" | "keyboard" | "mobile" | "sync";

export function ConfigurationDialog({
  onClose,
  initialTab = "Appearance",
  ...props
}: ConfigurationProps & {
  onClose: () => void;
  initialTab?: ConfigurationTab;
}) {
  const { theme, accentColor, uiScale } = props;
  const s = useStoreSelector(
    (state) => ({
      taskNotificationPermission: state.taskNotificationPermission,
      taskNotificationsEnabled: state.taskNotificationsEnabled,
      taskNotificationPreferences: state.taskNotificationPreferences,
      taskNotificationTransport: state.taskNotificationTransport,
      taskNotificationBusy: state.taskNotificationBusy,
      automaticUpdateChecksEnabled: state.automaticUpdateChecksEnabled,
      connectionLabel:
        state.connections.find((c) => c.id === state.activeConnectionId)
          ?.label ?? t("Current connection"),
      sshDestination: state.connections.find(
        (c) => c.id === state.activeConnectionId,
      )?.ssh_destination,
    }),
    shallowEqual,
  );
  const connectionClient = useConnectionClient();
  const [tab, setTab] = useState<ConfigurationTab>(initialTab);
  const voiceCleanup = useVoiceCleanupMode();
  const [detail, setDetail] = useState<Detail | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const openDetail = (event: MouseEvent<HTMLButtonElement>, next: Detail) => {
    detailTrigger.current = event.currentTarget;
    setDetail(next);
  };
  useEffect(() => {
    if (detail) return;
    (detailTrigger.current?.isConnected
      ? detailTrigger.current
      : dialogRef.current
    )?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(".popover-content"))
        return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [detail, onClose]);
  const notificationStatus = s.taskNotificationBusy
    ? t("Saving...")
    : s.taskNotificationPermission === "unsupported"
      ? t("Unsupported")
      : s.taskNotificationPermission === "denied"
        ? t("Blocked by browser permissions")
        : s.taskNotificationsEnabled
          ? s.taskNotificationTransport === "push"
            ? t("On · Background push")
            : t("On · Active page only")
          : t("Off");
  const localePreference = loadLocalePreference();

  return (
    <>
      <div
        className="modal-backdrop configuration-backdrop"
        hidden={detail !== null}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          className="modal configuration-modal mobile-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t("Configuration")}
          tabIndex={-1}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key !== "Tab") return;
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled):not([tabindex='-1']), input:not(:disabled), select:not(:disabled), a[href]",
              ),
            ).filter((element) => element.getClientRects().length > 0);
            const first = controls[0],
              last = controls[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
        >
          <MobileSheetHandle
            label={t("Dismiss Configuration")}
            onClose={onClose}
          />
          <div className="modal-head">
            <div>
              <h2>{t("Configuration")}</h2>
              <p>
                {t("Appearance, behavior, connections, and agent integrations")}
              </p>
            </div>
            <CloseButton label={t("Close Configuration")} onClick={onClose} />
          </div>
          <div
            className="configuration-tabs"
            role="tablist"
            aria-label={t("Configuration categories")}
          >
            {tabs.map((name, index) => (
              <button
                key={name}
                type="button"
                role="tab"
                id={`configuration-tab-${name}`}
                aria-controls={`configuration-panel-${name}`}
                aria-selected={tab === name}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setTab(name)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  setTab(tabs[next]);
                  document
                    .getElementById(`configuration-tab-${tabs[next]}`)
                    ?.focus();
                }}
              >
                {t(TAB_LABELS[name])}
              </button>
            ))}
          </div>
          <div className="configuration-content">
            <section
              role="tabpanel"
              id="configuration-panel-Appearance"
              aria-labelledby="configuration-tab-Appearance"
              hidden={tab !== "Appearance"}
            >
              <p className="configuration-scope">
                {t("Saved in this browser.")}
              </p>
              <div className="config-preference-row">
                <span className="config-item-icon">
                  <SunMoon size={15} />
                </span>
                <div className="config-item-copy">
                  <strong>{t("Theme")}</strong>
                  <span>{t("Application appearance")}</span>
                </div>
                <div
                  className="config-theme-control"
                  role="group"
                  aria-label={t("Theme")}
                >
                  {(
                    [
                      ["light", Sun, t("Use light theme")],
                      ["dark", Moon, t("Use dark theme")],
                      ["system", SunMoon, t("Use system theme")],
                    ] as const
                  ).map(([value, Icon, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-label={label}
                      aria-pressed={theme === value}
                      className={theme === value ? "is-active" : ""}
                      onClick={() => props.onThemeChange(value)}
                    >
                      <Icon size={14} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="config-preference-row">
                <span className="config-item-icon">
                  <Palette size={15} />
                </span>
                <div className="config-item-copy">
                  <strong>{t("Accent color")}</strong>
                  <span>
                    {t(
                      ACCENT_OPTIONS.find(
                        (option) => option.value === accentColor,
                      )?.label ?? "",
                    )}
                  </span>
                </div>
                <div
                  className="config-accent-control"
                  role="radiogroup"
                  aria-label={t("Accent color")}
                >
                  {ACCENT_OPTIONS.map((option, index) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      data-accent={option.value}
                      title={t(option.label)}
                      aria-label={t(option.label)}
                      aria-checked={accentColor === option.value}
                      tabIndex={accentColor === option.value ? 0 : -1}
                      className={
                        accentColor === option.value ? "is-active" : ""
                      }
                      onClick={() => props.onAccentColorChange(option.value)}
                      onKeyDown={(event) => {
                        const direction = ["ArrowRight", "ArrowDown"].includes(
                          event.key,
                        )
                          ? 1
                          : ["ArrowLeft", "ArrowUp"].includes(event.key)
                            ? -1
                            : 0;
                        if (!direction) return;
                        event.preventDefault();
                        const next =
                          (index + direction + ACCENT_OPTIONS.length) %
                          ACCENT_OPTIONS.length;
                        props.onAccentColorChange(ACCENT_OPTIONS[next].value);
                        const buttons =
                          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                            "button",
                          );
                        buttons?.[next]?.focus();
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="config-preference-row">
                <span className="config-item-icon">
                  <ALargeSmall size={15} />
                </span>
                <div className="config-item-copy">
                  <strong>{t("Text size")}</strong>
                  <span>{t("Scale the interface")}</span>
                </div>
                <div
                  className="config-scale-control"
                  role="group"
                  aria-label={t("Text size")}
                >
                  <button
                    type="button"
                    aria-label={t("Decrease text size")}
                    disabled={uiScale <= UI_SCALE_MIN}
                    onClick={() =>
                      props.onUiScaleChange(
                        clampUiScale(uiScale - UI_SCALE_STEP),
                      )
                    }
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    type="button"
                    className="config-scale-value"
                    aria-label={t("Reset text size, currently {scale}%", {
                      scale: uiScale,
                    })}
                    disabled={uiScale === UI_SCALE_DEFAULT}
                    onClick={() => props.onUiScaleChange(UI_SCALE_DEFAULT)}
                  >
                    {uiScale}%
                  </button>
                  <button
                    type="button"
                    aria-label={t("Increase text size")}
                    disabled={uiScale >= UI_SCALE_MAX}
                    onClick={() =>
                      props.onUiScaleChange(
                        clampUiScale(uiScale + UI_SCALE_STEP),
                      )
                    }
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="config-preference-row config-font-row">
                <span className="config-item-icon">
                  <TypeIcon size={15} />
                </span>
                <div className="config-item-copy">
                  <strong>{t("Terminal font")}</strong>
                  <span>{t("Uses locally installed fonts")}</span>
                </div>
                <div className="config-font-control">
                  <ThemedSelect
                    aria-label={t("Terminal font")}
                    align="end"
                    value={normalizeTerminalFontFamily(
                      props.terminalFontFamily,
                    )}
                    options={TERMINAL_FONT_OPTIONS.map((option) => ({
                      value: option.value,
                      label: t(option.label),
                    }))}
                    onChange={props.onTerminalFontFamilyChange}
                  />
                </div>
              </div>
              <div className="config-preference-row config-font-row">
                <span className="config-item-icon">
                  <Languages size={15} />
                </span>
                <div className="config-item-copy">
                  <strong>{t("Language")}</strong>
                  <span>{t("Reloads the page to apply.")}</span>
                </div>
                <div className="config-font-control">
                  <ThemedSelect
                    aria-label={t("Language")}
                    align="end"
                    value={localePreference}
                    options={LOCALE_OPTIONS.map((option) => ({
                      value: option.value,
                      label: t(option.label),
                    }))}
                    onChange={(value) => {
                      if (value !== localePreference)
                        saveLocalePreference(value as LocalePreference);
                    }}
                  />
                </div>
              </div>
              <button
                type="button"
                className="config-menu-item"
                onClick={(event) => openDetail(event, "terminal")}
              >
                <span className="config-item-icon">
                  <SquareTerminal size={15} />
                </span>
                <span className="config-item-copy">
                  <strong>{t("Terminal theme")}</strong>
                  <span>
                    {t("Dark: {dark} · Light: {light}", {
                      dark: resolveTerminalThemeDefinition(
                        "dark",
                        props.terminalThemeSelection,
                        props.customTerminalThemes,
                      ).name,
                      light: resolveTerminalThemeDefinition(
                        "light",
                        props.terminalThemeSelection,
                        props.customTerminalThemes,
                      ).name,
                    })}
                  </span>
                </span>
                <ChevronRight size={15} />
              </button>
              <button
                type="button"
                className="config-menu-item"
                onClick={(event) => openDetail(event, "layout")}
              >
                <span className="config-item-icon">
                  <LayoutDashboard size={15} />
                </span>
                <span className="config-item-copy">
                  <strong>{t("Layout")}</strong>
                  <span>
                    {t("Display mode, mobile breakpoint, and sidebar order")}
                  </span>
                </span>
                <ChevronRight size={15} />
              </button>
            </section>
            <section
              role="tabpanel"
              id="configuration-panel-Behavior"
              aria-labelledby="configuration-tab-Behavior"
              hidden={tab !== "Behavior"}
            >
              <p className="configuration-scope">
                {t(
                  "Preferences apply to this browser. Push delivery preferences apply to this device.",
                )}
              </p>
              <div className="config-preference-row">
                <span className="config-item-icon">
                  <Download size={15} />
                </span>
                <div className="config-item-copy">
                  <strong>{t("Automatic update checks")}</strong>
                  <span>
                    {s.automaticUpdateChecksEnabled
                      ? t("Enabled")
                      : t("Disabled")}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label={t("Automatic update checks")}
                  aria-checked={s.automaticUpdateChecksEnabled}
                  className={
                    "settings-switch" +
                    (s.automaticUpdateChecksEnabled ? " is-on" : "")
                  }
                  onClick={() =>
                    store.setAutomaticUpdateChecksEnabled(
                      !s.automaticUpdateChecksEnabled,
                    )
                  }
                >
                  <span />
                </button>
              </div>
              <div className="config-preference-row config-font-row">
                <span className="config-item-icon">
                  <Mic size={15} />
                </span>
                <div className="config-item-copy">
                  <strong>{t("Voice cleanup")}</strong>
                  <span>
                    {t("Rewrites a finished dictation with the server model")}
                  </span>
                </div>
                <div className="config-font-control">
                  <ThemedSelect
                    aria-label={t("Voice cleanup")}
                    align="end"
                    value={voiceCleanup}
                    options={VOICE_CLEANUP_OPTIONS.map((option) => ({
                      value: option.value,
                      label: t(option.label),
                    }))}
                    onChange={(value) =>
                      setVoiceCleanupMode(value as VoiceCleanupMode)
                    }
                  />
                </div>
              </div>
              <div className="config-preference-row">
                <span className="config-item-icon">
                  <Bell size={15} />
                </span>
                <div className="config-item-copy">
                  <strong>{t("Task notifications")}</strong>
                  <span className="config-notification-status">
                    {notificationStatus}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label={t("Task notifications")}
                  aria-disabled={s.taskNotificationBusy}
                  aria-checked={s.taskNotificationsEnabled}
                  className={
                    "settings-switch" +
                    (s.taskNotificationsEnabled ? " is-on" : "")
                  }
                  onClick={() => {
                    if (!s.taskNotificationBusy)
                      void store.setTaskNotificationsEnabled(
                        !s.taskNotificationsEnabled,
                      );
                  }}
                >
                  <span />
                </button>
              </div>
              {s.taskNotificationsEnabled &&
                (
                  [
                    ["blocked", t("Agent needs input")],
                    ["completed", t("Task completed")],
                  ] as const
                ).map(([kind, label]) => (
                  <div className="config-preference-row" key={kind}>
                    <div className="config-item-copy">
                      <strong>{label}</strong>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label={label}
                      aria-checked={s.taskNotificationPreferences[kind]}
                      aria-disabled={s.taskNotificationBusy}
                      className={
                        "settings-switch" +
                        (s.taskNotificationPreferences[kind] ? " is-on" : "")
                      }
                      onClick={() => {
                        if (!s.taskNotificationBusy)
                          void store.setTaskNotificationPreference(
                            kind,
                            !s.taskNotificationPreferences[kind],
                          );
                      }}
                    >
                      <span />
                    </button>
                  </div>
                ))}
              <button
                type="button"
                className="config-menu-item"
                onClick={(event) => openDetail(event, "keyboard")}
              >
                <span className="config-item-icon">
                  <Keyboard size={15} />
                </span>
                <span className="config-item-copy">
                  <strong>{t("Keyboard shortcuts")}</strong>
                  <span>{t("Presets, bindings, and help")}</span>
                </span>
                <ChevronRight size={15} />
              </button>
              <button
                type="button"
                className="config-menu-item"
                onClick={(event) => openDetail(event, "mobile")}
              >
                <span className="config-item-icon">
                  <Keyboard size={15} />
                </span>
                <span className="config-item-copy">
                  <strong>{t("Mobile terminal shortcuts")}</strong>
                  <span>
                    {t("{panel} panel · {side} side", {
                      panel: mobileTerminalShortcutCount(
                        props.mobileTerminalShortcuts,
                      ),
                      side: props.mobileTerminalSideShortcuts.filter(Boolean)
                        .length,
                    })}
                  </span>
                </span>
                <ChevronRight size={15} />
              </button>
            </section>
            <section
              role="tabpanel"
              id="configuration-panel-Connection"
              aria-labelledby="configuration-tab-Connection"
              hidden={tab !== "Connection"}
            >
              <p className="configuration-scope">
                {t("Connection:")} <strong>{s.connectionLabel}</strong>
              </p>
              {tab === "Connection" ? (
                <TerminalTransportSettings
                  key={connectionClientScopeKey(
                    connectionClient,
                    connectionClient.serverRuntimeGeneration,
                  )}
                />
              ) : null}
              <button
                type="button"
                className="config-menu-item"
                onClick={(event) => openDetail(event, "sync")}
              >
                <span className="config-item-icon">
                  <GitBranch size={15} />
                </span>
                <span className="config-item-copy">
                  <strong>{t("Automatic branch updates")}</strong>
                  <span>
                    {t(
                      "Manage saved repository sync settings on this connection",
                    )}
                  </span>
                </span>
                <ChevronRight size={15} />
              </button>
            </section>
            <section
              role="tabpanel"
              id="configuration-panel-Integrations"
              aria-labelledby="configuration-tab-Integrations"
              hidden={tab !== "Integrations"}
            >
              {tab === "Integrations" ? (
                <AgentIntegrationsSettings
                  key={connectionClientScopeKey(
                    connectionClient,
                    connectionClient.serverRuntimeGeneration,
                  )}
                  connectionLabel={s.connectionLabel}
                  sshDestination={s.sshDestination}
                />
              ) : null}
            </section>
          </div>
          <div className="modal-actions">
            <span className="muted">
              {tab === "Integrations"
                ? t("Changes require confirmation.")
                : t("Changes are saved automatically.")}
            </span>
            <button type="button" onClick={onClose}>
              {t("Done")}
            </button>
          </div>
        </div>
      </div>
      <Suspense
        fallback={
          <ConfigurationLoadingDialog
            onClose={() => setDetail(null)}
            buttonLabel={t("Back to Configuration")}
          />
        }
      >
        {detail === "keyboard" ? (
          <ShortcutLookupDialog open onClose={() => setDetail(null)} />
        ) : null}
        {detail === "terminal" ? (
          <TerminalThemeDialog
            open
            selection={props.terminalThemeSelection}
            customThemes={props.customTerminalThemes}
            onSelectionChange={props.onTerminalThemeSelectionChange}
            onCustomThemesChange={props.onCustomTerminalThemesChange}
            onClose={() => setDetail(null)}
          />
        ) : null}
        {detail === "layout" ? (
          <MobileLayoutDialog open onClose={() => setDetail(null)} />
        ) : null}
      </Suspense>
      <MobileTerminalShortcutsDialog
        open={detail === "mobile"}
        rows={props.mobileTerminalShortcuts}
        sideShortcuts={props.mobileTerminalSideShortcuts}
        onChange={props.onMobileTerminalShortcutsChange}
        onSideChange={props.onMobileTerminalSideShortcutsChange}
        onClose={() => setDetail(null)}
      />
      <AutoSyncRepositoriesDialog
        open={detail === "sync"}
        onClose={() => setDetail(null)}
      />
    </>
  );
}
