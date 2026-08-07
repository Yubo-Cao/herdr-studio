import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, X } from "lucide-react";
import { useStore } from "../store";
import type { Pane } from "../types";
import { shortId } from "../utils";
import { AgentIcon } from "./AgentIcon";
import { CodePreview } from "./CodePreview";
import {
  type AgentSessionTrajectoryStep,
  type AgentSessionTurn,
  type AgentSessionSummary,
  downloadSession,
  downloadSessionAtif,
  formatBytes,
  formatCount,
  formatOptionalCompact,
  formatTokenTotal,
  groupTrajectoryTurns,
} from "./agentSession";
import { focusDialogElement } from "./dialogFocus";

function formatStepTime(timestamp?: string) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSessionTime(timestamp?: string) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString([], {
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
      ? `Input ${formatOptionalCompact(latest.prompt_tokens)}`
      : "",
    latest.cached_tokens !== undefined
      ? `Cached ${formatOptionalCompact(latest.cached_tokens)}`
      : "",
    latest.completion_tokens !== undefined
      ? `Output ${formatOptionalCompact(latest.completion_tokens)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function meaningfulMessage(step: AgentSessionTrajectoryStep) {
  if (!step.message || (step.metrics && step.message === "Token usage")) return "";
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
  const appState = useStore();
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
    appState.workspaces.find(
      (workspace) => workspace.workspace_id === pane.workspace_id,
    )?.label ?? pane.workspace_id;
  const usage = summary?.stats.token_usage;
  const text = summary?.text ?? "";
  const atifText = summary?.trajectory
    ? JSON.stringify(summary.trajectory, null, 2)
    : "";
  const unavailableDetail =
    error ||
    summary?.detail ||
    "No readable session transcript was reported for this agent.";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal agent-session-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Session Inspector"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head agent-session-modal-head">
          <div className="agent-session-identity">
            <AgentIcon agent={pane.agent} />
            <div>
              <h3>Session Inspector</h3>
              <span>
                {workspaceLabel} · {pane.agent ?? "Agent"} ·{" "}
                {shortId(pane.pane_id)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="agent-history-icon"
            onClick={onClose}
            aria-label="Close Session Inspector"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {summary?.status === "ok" ? (
          <>
            <section
              className="agent-session-overview"
              aria-label="Session overview"
            >
              <div>
                <strong>{formatCount(summary.stats.turns)}</strong>
                <span>Turns</span>
              </div>
              <div>
                <strong>{formatTokenTotal(summary)}</strong>
                <span>Total tokens</span>
              </div>
              <div>
                <strong title={formatSessionTime(summary.updated_at)}>
                  {formatSessionTime(summary.updated_at)}
                </strong>
                <span>Updated</span>
              </div>
              <p>
                Input {formatOptionalCompact(usage?.input_tokens)}
                <span>·</span>
                Cached {formatOptionalCompact(usage?.cached_input_tokens)}
                <span>·</span>
                Output {formatOptionalCompact(usage?.output_tokens)}
                <span>·</span>
                Reasoning{" "}
                {formatOptionalCompact(usage?.reasoning_output_tokens)}
              </p>
            </section>
            <div className="agent-session-file-row">
              <div>
                <span>Session file</span>
                <code title={summary.path}>{summary.path}</code>
              </div>
              <span>
                {formatCount(summary.stats.records)} records ·{" "}
                {formatBytes(summary.file?.size)}
              </span>
              <button
                type="button"
                className="agent-history-icon"
                onClick={() => void navigator.clipboard?.writeText(summary.path)}
                aria-label="Copy session file path"
                title="Copy path"
              >
                <Copy size={13} />
              </button>
            </div>
          </>
        ) : null}

        {loading ? (
          <div className="agent-session-state">
            <span className="terminal-loading-dot" />
            Loading session
          </div>
        ) : summary?.status !== "ok" || error ? (
          <div className="agent-session-state is-error">
            <strong>Session unavailable</strong>
            <span>{unavailableDetail}</span>
            {summary?.command ? <code>{summary.command}</code> : null}
          </div>
        ) : (
          <>
            <div className="agent-session-actions">
              <div
                className="agent-session-mode-switch"
                role="tablist"
                aria-label="Session Inspector view"
              >
                <button
                  type="button"
                  className={mode === "timeline" ? "is-active" : ""}
                  onClick={() => setMode("timeline")}
                  role="tab"
                  aria-selected={mode === "timeline"}
                >
                  Timeline
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
                  Raw
                </button>
              </div>
              <details className="agent-session-export-menu">
                <summary>
                  <Download size={14} />
                  Export
                </summary>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      downloadSessionAtif(
                        pane,
                        summary.session?.value || summary.path,
                      )
                    }
                  >
                    Export ATIF
                  </button>
                  <button type="button" onClick={() => downloadSession(pane)}>
                    Export raw
                  </button>
                </div>
              </details>
            </div>
            {summary.truncated ? (
              <div className="file-preview-banner">
                Preview truncated. Export raw to get the full session file.
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
                    No ATIF trajectory available.
                  </div>
                )
              ) : (
                <CodePreview text={text} searchable />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SessionTimeline({ turns }: { turns: AgentSessionTurn[] }) {
  if (turns.length === 0) {
    return (
      <div className="agent-session-state">
        No timeline items. Switch to Raw to inspect the session file.
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

function SessionTurn({ turn }: { turn: AgentSessionTurn }) {
  const userMessages = turn.steps.filter(
    (step) => step.source === "user" && meaningfulMessage(step),
  );
  const agentMessages = turn.steps.filter(
    (step) => step.source === "agent" && meaningfulMessage(step),
  );
  const systemMessages = turn.steps.filter(
    (step) => step.source === "system" && meaningfulMessage(step),
  );
  const reasoning = turn.steps.filter(
    (step) =>
      step.reasoning_content &&
      step.reasoning_content !== meaningfulMessage(step),
  );
  const toolCalls = turn.steps.flatMap((step) => step.tool_calls ?? []);
  const observations = turn.steps.flatMap(
    (step) => step.observation?.results ?? [],
  );
  const metrics = stepMetricText(turn.steps);
  const firstTimestamp = turn.steps.find((step) => step.timestamp)?.timestamp;

  return (
    <article className="agent-session-turn">
      <header>
        <div>
          <strong>
            {turn.number === null ? "Session setup" : `Turn ${turn.number}`}
          </strong>
          {firstTimestamp ? <time>{formatStepTime(firstTimestamp)}</time> : null}
        </div>
        <span>
          {turn.steps.length} {turn.steps.length === 1 ? "event" : "events"}
        </span>
      </header>
      <div className="agent-session-turn-body">
        {userMessages.map((step) => (
          <section className="agent-session-exchange is-user" key={step.step_id}>
            <span>Prompt</span>
            <pre>{step.message}</pre>
          </section>
        ))}
        {agentMessages.map((step) => (
          <section className="agent-session-exchange is-agent" key={step.step_id}>
            <span>Response</span>
            <pre>{step.message}</pre>
          </section>
        ))}
        {systemMessages.length > 0 ? (
          <details className="agent-session-turn-details">
            <summary>System context ({systemMessages.length})</summary>
            {systemMessages.map((step) => (
              <pre key={step.step_id}>{step.message}</pre>
            ))}
          </details>
        ) : null}
        {reasoning.length > 0 ? (
          <details className="agent-session-turn-details">
            <summary>Reasoning ({reasoning.length})</summary>
            {reasoning.map((step) => (
              <pre key={step.step_id}>{step.reasoning_content}</pre>
            ))}
          </details>
        ) : null}
        {toolCalls.length > 0 ? (
          <details className="agent-session-turn-details">
            <summary>Tool calls ({toolCalls.length})</summary>
            <div className="agent-session-tool-list">
              {toolCalls.map((tool) => (
                <code key={tool.tool_call_id}>
                  <strong>{tool.function_name}</strong>
                  {JSON.stringify(tool.arguments, null, 2)}
                </code>
              ))}
            </div>
          </details>
        ) : null}
        {observations.length > 0 ? (
          <details className="agent-session-turn-details">
            <summary>Tool output ({observations.length})</summary>
            <div className="agent-session-observation-list">
              {observations.map((result, index) => (
                <pre key={`${result.source_call_id ?? "result"}:${index}`}>
                  {result.content}
                </pre>
              ))}
            </div>
          </details>
        ) : null}
        {metrics ? <footer>{metrics}</footer> : null}
      </div>
    </article>
  );
}
