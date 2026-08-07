import { useEffect, useRef } from "react";
import { Copy, X } from "lucide-react";
import { focusDialogElement } from "./dialogFocus";

type AgentMessage = {
  role: "user" | "assistant";
  text: string;
  sent_at: string;
};

function formatMessageTime(sentAt: string) {
  const time = new Date(sentAt);
  if (Number.isNaN(time.getTime())) return sentAt;
  return time.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AgentMessageDialog({
  message,
  onClose,
}: {
  message: AgentMessage | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!message) return;
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
  }, [message, onClose]);

  if (!message) return null;
  const roleLabel = message.role === "assistant" ? "Assistant" : "User";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal agent-message-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Full ${roleLabel.toLowerCase()} message`}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head agent-message-modal-head">
          <div>
            <h3>{roleLabel} Message</h3>
            <time>{formatMessageTime(message.sent_at)}</time>
          </div>
          <div className="agent-message-modal-actions">
            <button
              type="button"
              className="agent-history-icon"
              onClick={() => void navigator.clipboard?.writeText(message.text)}
              aria-label="Copy message"
              title="Copy"
            >
              <Copy size={15} />
            </button>
            <button
              type="button"
              className="agent-history-icon"
              onClick={onClose}
              aria-label="Close message"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <pre className="agent-message-modal-content">{message.text}</pre>
      </div>
    </div>
  );
}
