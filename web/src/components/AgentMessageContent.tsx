import { useState } from "react";
import { Copy, X } from "lucide-react";
import { t } from "../i18n";
import { formatUiDateTime } from "../uiLocale";
import { copyTextWithFeedback } from "../copyText";
import { CloseButton } from "./CloseButton";
import { MarkdownPreview } from "./markdown";
import "./AgentMessageContent.css";

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  kind?: "message" | "tool_call" | "tool_result" | "error";
  tool_name?: string;
  source_call_id?: string;
  is_error?: boolean;
  text: string;
  sent_at: string;
  text_bytes?: number;
};

export function agentMessageRoleLabel(message: AgentMessage) {
  if (message.role !== "tool")
    return message.role === "assistant" ? t("Assistant") : t("User");
  const tool = message.tool_name ?? t("tool");
  return message.kind === "tool_call"
    ? t("Tool arguments: {tool}", { tool })
    : message.is_error
      ? t("Tool error: {tool}", { tool })
      : t("Tool output: {tool}", { tool });
}

// Message rendering is shared by the modal and the inline History reader.
export function AgentMessageContent({
  message,
  embedded = false,
  onClose,
}: {
  message: AgentMessage;
  embedded?: boolean;
  onClose: () => void;
}) {
  const isTool = message.role === "tool";
  const [viewMode, setViewMode] = useState<"rendered" | "raw">(
    message.role === "assistant" ? "rendered" : "raw",
  );
  const [viewModeMessageId, setViewModeMessageId] = useState(message.id);
  if (message.id !== viewModeMessageId) {
    // A refreshed snapshot replaces objects, not the user's selected message.
    // Reset only when switching to another entry.
    setViewModeMessageId(message.id);
    setViewMode(message.role === "assistant" ? "rendered" : "raw");
  }
  // Redacted tool entry whose on-demand content has not arrived (yet).
  const contentPending =
    isTool && message.text.length === 0 && (message.text_bytes ?? 0) > 0;
  const roleLabel = agentMessageRoleLabel(message);

  return (
    <>
      <div
        className={`modal-head agent-message-modal-head ${embedded ? "is-embedded" : ""}`}
      >
        <div>
          <h3>{t("{role} Message", { role: roleLabel })}</h3>
          <time dateTime={message.sent_at}>
            {formatUiDateTime(message.sent_at)}
          </time>
          {message.source_call_id ? (
            <p>{t("Call ID: {id}", { id: message.source_call_id })}</p>
          ) : null}
        </div>
        <div className="agent-message-modal-actions">
          {!isTool ? (
            <button
              type="button"
              className="agent-message-mode-toggle"
              onClick={() =>
                setViewMode((mode) =>
                  mode === "rendered" ? "raw" : "rendered",
                )
              }
              aria-label={
                viewMode === "rendered"
                  ? t("Show raw markdown")
                  : t("Show rendered markdown")
              }
              title={
                viewMode === "rendered" ? t("Show raw") : t("Show rendered")
              }
            >
              {viewMode === "rendered" ? t("Raw") : t("Rendered")}
            </button>
          ) : null}
          {!contentPending ? (
            <button
              type="button"
              className="agent-history-icon"
              onClick={() => void copyTextWithFeedback(message.text)}
              aria-label={t("Copy message")}
              title={t("Copy")}
            >
              <Copy size={15} />
            </button>
          ) : null}
          {embedded ? (
            <button
              type="button"
              className="agent-history-icon"
              onClick={onClose}
              aria-label={t("Close message detail")}
              title={t("Close detail")}
            >
              <X size={15} />
            </button>
          ) : (
            <CloseButton label={t("Close message")} onClick={onClose} />
          )}
        </div>
      </div>
      {contentPending ? (
        <pre className="agent-message-modal-content">
          {t("Loading tool content…")}
        </pre>
      ) : !isTool && viewMode === "rendered" ? (
        <div className="agent-message-modal-content is-rendered">
          <MarkdownPreview
            text={message.text}
            className="agent-message-markdown"
            breaks
          />
        </div>
      ) : (
        <pre className="agent-message-modal-content">{message.text}</pre>
      )}
    </>
  );
}
