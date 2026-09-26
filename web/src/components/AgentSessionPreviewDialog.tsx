import { useEffect, useMemo, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import {
  Brain,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Info,
  Wrench,
} from "lucide-react";
import { useStoreSelector } from "../store";
import type { Pane } from "../types";
import { t } from "../i18n";
import { uiIntlLocale } from "../uiLocale";
import { copyTextWithFeedback } from "../copyText";
import { useConnectionClient } from "../useConnectionClient";
import { shortId } from "../utils";
import { AgentIcon } from "./AgentIcon";
import { CodePreview } from "./CodePreview";
import {
  type AgentSessionTrajectoryStep,
  type AgentSessionTurn,
  type AgentSessionSummary,
  downloadSession,
  downloadSessionAtif,
  firstLinePreview,
  formatBytes,
  formatCount,
  formatOptionalCompact,
  formatTokenTotal,
  groupTrajectoryTurns,
  toolArgumentsPreview,
} from "./agentSession";
import { CloseButton } from "./CloseButton";
import { focusDialogElement } from "./dialogFocus";
import "./AgentSessionPreviewDialog.css";

function formatStepTime(timestamp?: string) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString(uiIntlLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSessionTime(timestamp?: string) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString(uiIntlLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function stepMetricText(steps: AgentSessionTrajectoryStep[]) {
  const latest: NonNullable<AgentSessionTrajectoryStep["metrics"]> = {};
  for (const step of steps) {
    if (!step.metrics) continue;
    if (step.metrics.prompt_tokens !== undefined) {
      latest.prompt_tokens = step.metrics.prompt_tokens;
    }
    if (step.metrics.cached_tokens !== undefined) {
      latest.cached_tokens = step.metrics.cached_tokens;
    }
    if (step.metrics.completion_tokens !== undefined) {
      latest.completion_tokens = step.metrics.completion_tokens;
    }
  }
  return [
    latest.prompt_tokens !== undefined
      ? t("Input {count}", {
          count: formatOptionalCompact(latest.prompt_tokens),
        })
      : "",
    latest.cached_tokens !== undefined
      ? t("Cached {count}", {
          count: formatOptionalCompact(latest.cached_tokens),
        })
      : "",
    latest.completion_tokens !== undefined
      ? t("Output {count}", {
          count: formatOptionalCompact(latest.completion_tokens),
        })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function meaningfulMessage(step: AgentSessionTrajectoryStep) {
  if (!step.message || (step.metrics && step.message === "Token usage"))
    return "";
  return step.message;
}

export function AgentSessionPreviewDialog({
  pane,
  summary,
  loading,
  error,
  onClose,
}: {
  pane: Pane | null;
  summary: AgentSessionSummary | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const workspaces = useStoreSelector((state) => state.workspaces);
  const connectionClient = useConnectionClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"timeline" | "atif" | "raw">("timeline");
  const turns = useMemo(
    () => groupTrajectoryTurns(summary?.trajectory?.steps ?? []),
    [summary?.trajectory?.steps],
  );
  const paneId = pane?.pane_id;

  useEffect(() => {
    if (!paneId) return;
    setMode("timeline");
    const cancelFocus = focusDialogElement(dialogRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      cancelFocus();
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [onClose, paneId]);

  if (!pane) return null;

  const workspaceLabel =
    workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)
      ?.label ?? pane.workspace_id;
  const usage = summary?.stats.token_usage;
  const text = summary?.text ?? "";
  const atifText = summary?.trajectory
    ? JSON.stringify(summary.trajectory, null, 2)
    : "";
  const unavailableDetail =
    error ||
    summary?.detail ||
    t("No readable session transcript was reported for this agent.");

  // Render at the document root for the same reason as AgentMessageDialog:
  // on mobile the transformed .app box and the inspector slot's stacking
  // context would otherwise let the topbar paint over the dialog.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal agent-session-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("Session Inspector")}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head agent-session-modal-head">
          <div className="agent-session-identity">
            <AgentIcon agent={pane.agent} />
            <div>
              <h3>{t("Session Inspector")}</h3>
              <span>
                {workspaceLabel} · {pane.agent ?? t("Agent")} ·{" "}
                {shortId(pane.pane_id)}
              </span>
            </div>
          </div>
          <CloseButton label={t("Close Session Inspector")} onClick={onClose} />
        </div>

        {summary?.status === "ok" ? (
          <>
            <section
              className="agent-session-overview"
              aria-label={t("Session overview")}
            >
              <div>
                <strong>{formatCount(summary.stats.turns)}</strong>
                <span>{t("Turns")}</span>
              </div>
              <div>
                <strong>{formatTokenTotal(summary)}</strong>
                <span>{t("Total tokens")}</span>
              </div>
              <div>
                <strong title={formatSessionTime(summary.updated_at)}>
                  {formatSessionTime(summary.updated_at)}
                </strong>
                <span>{t("Updated")}</span>
              </div>
              <p>
                {t("Input {count}", {
                  count: formatOptionalCompact(usage?.input_tokens),
                })}
                <span>·</span>
                {t("Cached {count}", {
                  count: formatOptionalCompact(usage?.cached_input_tokens),
                })}
                <span>·</span>
                {t("Output {count}", {
                  count: formatOptionalCompact(usage?.output_tokens),
                })}
                <span>·</span>
                {t("Reasoning {count}", {
                  count: formatOptionalCompact(usage?.reasoning_output_tokens),
                })}
              </p>
            </section>
            <div className="agent-session-file-row">
              <div>
                <span>{t("Session file")}</span>
                <code title={summary.path}>{summary.path}</code>
              </div>
              <span>
                {t("{records} records · {size}", {
                  records: formatCount(summary.stats.records),
                  size: formatBytes(summary.file?.size),
                })}
              </span>
              <button
                type="button"
                className="agent-history-icon"
                onClick={() => void copyTextWithFeedback(summary.path)}
                aria-label={t("Copy session file path")}
                title={t("Copy path")}
              >
                <Copy size={13} />
              </button>
            </div>
          </>
        ) : null}

        {loading ? (
          <div className="agent-session-state">
            <span className="terminal-loading-dot" />
            {t("Loading session")}
          </div>
        ) : summary?.status !== "ok" || error ? (
          <div className="agent-session-state is-error">
            <strong>{t("Session unavailable")}</strong>
            <span>{unavailableDetail}</span>
            {summary?.command ? <code>{summary.command}</code> : null}
          </div>
        ) : (
          <>
            <div className="agent-session-actions">
              <div
                className="agent-session-mode-switch"
                role="tablist"
                aria-label={t("Session Inspector view")}
              >
                <button
                  type="button"
                  className={mode === "timeline" ? "is-active" : ""}
                  onClick={() => setMode("timeline")}
                  role="tab"
                  aria-selected={mode === "timeline"}
                >
                  {t("Timeline")}
                </button>
                <button
                  type="button"
                  className={mode === "atif" ? "is-active" : ""}
                  onClick={() => setMode("atif")}
                  role="tab"
                  aria-selected={mode === "atif"}
                >
                  ATIF
                </button>
                <button
                  type="button"
                  className={mode === "raw" ? "is-active" : ""}
                  onClick={() => setMode("raw")}
                  role="tab"
                  aria-selected={mode === "raw"}
                >
                  {t("Raw")}
                </button>
              </div>
              <details className="agent-session-export-menu">
                <summary>
                  <Download size={14} />
                  {t("Export")}
                </summary>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      downloadSessionAtif(
                        pane,
                        summary.session?.value || summary.path,
                        connectionClient,
                      )
                    }
                  >
                    {t("Export ATIF")}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadSession(pane, connectionClient)}
                  >
                    {t("Export raw")}
                  </button>
                </div>
              </details>
            </div>
            {summary.truncated ? (
              <div className="file-preview-banner">
                {t(
                  "Preview truncated. Export raw to get the full session file.",
                )}
              </div>
            ) : null}
            <div className="agent-session-content">
              {mode === "timeline" ? (
                <SessionTimeline turns={turns} />
              ) : mode === "atif" ? (
                atifText ? (
                  <CodePreview text={atifText} searchable />
                ) : (
                  <div className="agent-session-state">
                    {t("No ATIF trajectory available.")}
                  </div>
                )
              ) : (
                <CodePreview text={text} searchable />
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SessionTimeline({ turns }: { turns: AgentSessionTurn[] }) {
  if (turns.length === 0) {
    return (
      <div className="agent-session-state">
        {t("No timeline items. Switch to Raw to inspect the session file.")}
      </div>
    );
  }

  return (
    <div className="agent-session-timeline">
      {turns.map((turn) => (
        <SessionTurn turn={turn} key={turn.key} />
      ))}
    </div>
  );
}

// The timeline subscribes to the global store higher up, so it re-renders on
// every unrelated app update. Turn objects are stable (memoized on the
// trajectory steps), making each turn cheap to skip.
const SessionTurn = memo(function SessionTurn({
  turn,
}: {
  turn: AgentSessionTurn;
}) {
  const metrics = stepMetricText(turn.steps);
  const firstTimestamp = turn.steps.find((step) => step.timestamp)?.timestamp;
  // Match tool results back to their calls so output rows can carry the tool
  // name regardless of which step reported the call.
  const toolNameById = new Map<string, string>();
  for (const step of turn.steps) {
    for (const tool of step.tool_calls ?? []) {
      toolNameById.set(tool.tool_call_id, tool.function_name);
    }
  }

  return (
    <article className="agent-session-turn">
      <header>
        <div>
          <strong>
            {turn.number === null
              ? t("Session setup")
              : t("Turn {number}", { number: turn.number })}
          </strong>
          {firstTimestamp ? (
            <time>{formatStepTime(firstTimestamp)}</time>
          ) : null}
        </div>
        <span>
          {turn.steps.length === 1
            ? t("1 event")
            : t("{count} events", { count: turn.steps.length })}
        </span>
      </header>
      <div className="agent-session-turn-body">
        {turn.steps.map((step) => (
          <SessionStepRows
            step={step}
            toolNameById={toolNameById}
            key={step.step_id}
          />
        ))}
        {metrics ? <footer>{metrics}</footer> : null}
      </div>
    </article>
  );
});

// Render one trajectory step in place so the timeline follows the actual
// execution order: reasoning, messages, tool calls and their results appear
// exactly where they happened instead of being regrouped by type.
function SessionStepRows({
  step,
  toolNameById,
}: {
  step: AgentSessionTrajectoryStep;
  toolNameById: Map<string, string>;
}) {
  const message = meaningfulMessage(step);
  const reasoning =
    step.reasoning_content && step.reasoning_content !== message
      ? step.reasoning_content
      : "";
  const observations = step.observation?.results ?? [];
  return (
    <>
      {reasoning ? (
        <details className="agent-session-turn-details">
          <summary>
            <ChevronRight size={12} className="agent-session-details-icon" />
            <Brain size={12} />
            <span>{t("Reasoning")}</span>
            <small>{firstLinePreview(reasoning)}</small>
          </summary>
          <pre>{reasoning}</pre>
        </details>
      ) : null}
      {step.source === "user" && message ? (
        <section className="agent-session-exchange is-user">
          <span>{t("Prompt")}</span>
          <pre>{message}</pre>
        </section>
      ) : null}
      {step.source === "agent" && message ? (
        <section className="agent-session-exchange is-agent">
          <span>{t("Response")}</span>
          <pre>{message}</pre>
        </section>
      ) : null}
      {(step.tool_calls ?? []).map((tool) => (
        <details className="agent-session-turn-details" key={tool.tool_call_id}>
          <summary>
            <ChevronRight size={12} className="agent-session-details-icon" />
            <Wrench size={12} />
            <span>{tool.function_name}</span>
            <small>
              {toolArgumentsPreview(
                tool.arguments,
                typeof tool.extra?.description === "string"
                  ? tool.extra.description
                  : undefined,
              )}
            </small>
          </summary>
          <div className="agent-session-tool-list">
            <code>
              <strong>{tool.function_name}</strong>
              {JSON.stringify(tool.arguments, null, 2)}
            </code>
          </div>
        </details>
      ))}
      {observations.map((result, index) => (
        <details
          className="agent-session-turn-details"
          key={`${result.source_call_id ?? "result"}:${index}`}
        >
          <summary>
            <ChevronRight size={12} className="agent-session-details-icon" />
            <FileText size={12} />
            <span>
              {(result.source_call_id &&
                toolNameById.get(result.source_call_id)) ||
                t("Tool output")}
            </span>
            <small>{firstLinePreview(result.content ?? "")}</small>
          </summary>
          <div className="agent-session-observation-list">
            <pre>{result.content}</pre>
          </div>
        </details>
      ))}
      {step.source === "system" && message && observations.length === 0 ? (
        <details className="agent-session-turn-details">
          <summary>
            <ChevronRight size={12} className="agent-session-details-icon" />
            <Info size={12} />
            <span>{t("System")}</span>
            <small>{firstLinePreview(message)}</small>
          </summary>
          <pre>{message}</pre>
        </details>
      ) : null}
    </>
  );
}
