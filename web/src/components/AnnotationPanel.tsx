import {
  ArrowDown,
  ArrowUp,
  Clipboard,
  MessageSquareText,
  Pin,
  PinOff,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  diffReviewLineDisplayLabel,
  fileReviewLineDisplayLabel,
  terminalAnnotationTitle,
  type ReviewAnnotation,
} from "../annotations";
import { t } from "../i18n";
import {
  getShortcutSnapshot,
  shortcutLabel,
  shortcutMatches,
  shortcutTitle,
  useShortcutPreferences,
} from "../shortcutPreferences";
import type { Pane } from "../types";
import { ConfirmDialog } from "./ModalDialogs";
import { ThemedSelect } from "./ThemedSelect";
import "./AnnotationPanel.css";

function annotationLocation(annotation: ReviewAnnotation) {
  if (annotation.source === "terminal")
    return t("Terminal · {title} · selected passage", {
      title: annotation.title,
    });
  if (annotation.source === "diff") {
    return t("Diff · {path} · {lines}", {
      path: annotation.path,
      lines: diffReviewLineDisplayLabel(annotation),
    });
  }
  if (annotation.anchor === "line") {
    return t("File · {path} · {lines}", {
      path: annotation.path,
      lines: fileReviewLineDisplayLabel(annotation),
    });
  }
  return annotation.section.length
    ? t("Markdown · {path} · {section}", {
        path: annotation.path,
        section: annotation.section.join(" › "),
      })
    : t("Markdown · {path} · selected passage", { path: annotation.path });
}

function paneLabel(pane: Pane) {
  return terminalAnnotationTitle(pane);
}

export function AnnotationPanel({
  open,
  floating,
  onToggleFloating,
  annotations,
  agentPanes,
  preferredPaneId,
  busy,
  focusedAnnotationId,
  onClose,
  onUpdateComment,
  onDelete,
  onMove,
  onClear,
  onCopy,
  onSend,
  onGoToAgent,
}: {
  open: boolean;
  floating: boolean;
  onToggleFloating?: () => void;
  annotations: readonly ReviewAnnotation[];
  agentPanes: readonly Pane[];
  preferredPaneId?: string;
  busy: boolean;
  focusedAnnotationId?: string | null;
  onClose: () => void;
  onUpdateComment: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onClear: () => void;
  onCopy: () => void;
  onSend: (paneId: string | null) => void;
  onGoToAgent?: () => void;
}) {
  useShortcutPreferences();
  const copyShortcut = shortcutLabel("annotations.copy");
  const prefillShortcut = shortcutLabel("annotations.prefill");
  const { bindings } = getShortcutSnapshot().preset;
  const hasCopyShortcut = bindings["annotations.copy"].length > 0;
  const hasPrefillShortcut = bindings["annotations.prefill"].length > 0;
  const hasFeedback = annotations.some((annotation) =>
    annotation.comment.trim(),
  );
  const [targetPaneId, setTargetPaneId] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (preferredPaneId) setTargetPaneId(preferredPaneId);
  }, [preferredPaneId]);

  useEffect(() => {
    const preferred = agentPanes.find(
      (pane) => pane.pane_id === preferredPaneId,
    );
    setTargetPaneId((current) => {
      if (agentPanes.some((pane) => pane.pane_id === current)) return current;
      return preferred?.pane_id ?? agentPanes[0]?.pane_id ?? "";
    });
  }, [agentPanes, preferredPaneId]);

  useEffect(() => {
    if (!open || !focusedAnnotationId) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const card = Array.from(
          document.querySelectorAll<HTMLElement>("[data-review-annotation-id]"),
        ).find(
          (element) =>
            element.dataset.reviewAnnotationId === focusedAnnotationId,
        );
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        card?.querySelector("textarea")?.focus({ preventScroll: true });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedAnnotationId, open]);

  if (!open) return null;

  return (
    <aside
      className={`annotation-panel ${floating ? "is-floating" : ""}`}
      aria-label={t("Review annotations")}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          confirmClear ||
          !(event.target instanceof Node) ||
          !event.currentTarget.contains(event.target)
        )
          return;
        const copy = shortcutMatches(event.nativeEvent, "annotations.copy");
        const prefill = shortcutMatches(
          event.nativeEvent,
          "annotations.prefill",
        );
        if (!copy && !prefill) return;
        event.preventDefault();
        event.stopPropagation();
        if (busy || !hasFeedback || event.repeat) return;
        if (copy) onCopy();
        else onSend(targetPaneId || null);
      }}
    >
      <header className="annotation-panel-head">
        <div>
          <strong>{t("Review feedback")}</strong>
          <span>
            {annotations.length === 1
              ? t("1 comment")
              : t("{count} comments", { count: annotations.length })}
          </span>
        </div>
        {onToggleFloating ? (
          <button
            type="button"
            className="annotation-icon-button annotation-mode-button"
            aria-label={
              floating ? t("Pin annotations") : t("Float annotations")
            }
            title={floating ? t("Fixed layout") : t("Floating layout")}
            aria-pressed={!floating}
            onClick={onToggleFloating}
          >
            {floating ? <Pin size={16} /> : <PinOff size={16} />}
          </button>
        ) : null}
        <button
          type="button"
          className="annotation-icon-button"
          aria-label={t("Close review feedback")}
          title={t("Close")}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="annotation-panel-list">
        {annotations.length === 0 ? (
          <div className="annotation-panel-empty">
            <MessageSquareText size={24} />
            <strong>{t("No review comments yet")}</strong>
            <span>
              {t(
                "Click or drag across diff line numbers or a source gutter, or select rendered Markdown or terminal text.",
              )}
            </span>
          </div>
        ) : (
          annotations.map((annotation, index) => (
            <article
              key={annotation.id}
              data-review-annotation-id={annotation.id}
              className={`annotation-card ${
                annotation.id === focusedAnnotationId ? "is-focused" : ""
              }`}
            >
              <div className="annotation-card-head">
                <strong title={annotationLocation(annotation)}>
                  {index + 1}. {annotationLocation(annotation)}
                </strong>
                {annotation.stale ? (
                  <span>
                    {annotation.source === "terminal"
                      ? t("Pane unavailable")
                      : t("Stale anchor")}
                  </span>
                ) : null}
              </div>
              <blockquote
                tabIndex={0}
                aria-label={t("Selected text for comment {number}", {
                  number: index + 1,
                })}
              >
                {annotation.quote || t("Blank line")}
              </blockquote>
              <textarea
                value={annotation.comment}
                rows={3}
                maxLength={10_000}
                aria-label={t("Comment {number}", { number: index + 1 })}
                onChange={(event) =>
                  onUpdateComment(annotation.id, event.currentTarget.value)
                }
              />
              <div className="annotation-card-actions">
                <button
                  type="button"
                  className="annotation-icon-button"
                  disabled={index === 0}
                  aria-label={t("Move comment {number} up", {
                    number: index + 1,
                  })}
                  title={t("Move up")}
                  onClick={() => onMove(annotation.id, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="annotation-icon-button"
                  disabled={index === annotations.length - 1}
                  aria-label={t("Move comment {number} down", {
                    number: index + 1,
                  })}
                  title={t("Move down")}
                  onClick={() => onMove(annotation.id, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className="annotation-icon-button is-danger"
                  aria-label={t("Delete comment {number}", {
                    number: index + 1,
                  })}
                  title={t("Delete")}
                  onClick={() => onDelete(annotation.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      <footer className="annotation-panel-footer">
        {agentPanes.length > 1 ? (
          <label className="annotation-target-picker">
            <span>{t("Agent pane")}</span>
            <ThemedSelect
              aria-label={t("Agent pane")}
              value={targetPaneId}
              options={agentPanes.map((pane) => ({
                value: pane.pane_id,
                label: paneLabel(pane),
              }))}
              onChange={setTargetPaneId}
            />
          </label>
        ) : agentPanes.length === 1 ? (
          <div className="annotation-target-summary">
            {t("Agent pane: {pane}", { pane: paneLabel(agentPanes[0]) })}
          </div>
        ) : (
          <div className="annotation-target-summary">
            {t("No agent pane; Send uses the clipboard.")}
          </div>
        )}
        <div className="annotation-delivery-actions">
          <button
            type="button"
            className="ghost"
            disabled={busy || !hasFeedback}
            onClick={onCopy}
            title={shortcutTitle(t("Copy review feedback"), "annotations.copy")}
          >
            <Clipboard size={14} /> {t("Copy")}
            {hasCopyShortcut ? <kbd>{copyShortcut}</kbd> : null}
          </button>
          <button
            type="button"
            disabled={busy || !hasFeedback}
            onClick={() => onSend(targetPaneId || null)}
            title={shortcutTitle(
              agentPanes.length ? t("Pre-fill agent") : t("Copy feedback"),
              "annotations.prefill",
            )}
          >
            {agentPanes.length ? <Send size={14} /> : <Clipboard size={14} />}
            {agentPanes.length ? t("Pre-fill agent") : t("Copy feedback")}
            {hasPrefillShortcut ? <kbd>{prefillShortcut}</kbd> : null}
          </button>
        </div>
        {onGoToAgent ? (
          <button type="button" className="ghost" onClick={onGoToAgent}>
            {t("Go to agent")}
          </button>
        ) : null}
        <button
          type="button"
          className="annotation-clear-button"
          disabled={busy || annotations.length === 0}
          onClick={() => setConfirmClear(true)}
        >
          {t("Clear draft")}
        </button>
      </footer>
      <ConfirmDialog
        open={confirmClear}
        title={t("Clear review feedback?")}
        message={t("This removes every unsent review comment from this draft.")}
        confirmLabel={t("Clear feedback")}
        danger
        onConfirm={onClear}
        onClose={() => setConfirmClear(false)}
      />
    </aside>
  );
}
