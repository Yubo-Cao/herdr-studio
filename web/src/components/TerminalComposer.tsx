import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CornerDownLeft, CornerDownRight, ImagePlus, X } from "lucide-react";
import {
  clearTerminalComposerDraft,
  readTerminalComposerDraft,
  terminalComposerInsertAtCaret,
  writeTerminalComposerDraft,
} from "../terminalComposer";
import {
  mobileTerminalShortcutOption,
  type MobileTerminalShortcut,
} from "../mobileTerminalShortcuts";

/**
 * Bottom-docked mobile terminal composer. A plain textarea owns all editing
 * (IME, dictation, selection, autocorrect, multiline paste) and text only
 * reaches the PTY when the user explicitly chooses Insert or Send, which
 * sidesteps the xterm helper-textarea races described in the IME recovery
 * code. Drafts are write-through to the in-memory store so pane switches and
 * virtual-keyboard resizes never lose text.
 *
 * The configurable mobile shortcut keys live at the top of the dock so the
 * composer is the single mobile control surface. Opening the composer focuses
 * the textarea (caret at the end of any restored draft) so the virtual
 * keyboard is ready immediately; the standalone shortcut panel remains for
 * keys-only interactions.
 *
 * Images arrive through clipboard paste or the file picker, upload once, and
 * land in the draft as plain paths at the caret; they reach the terminal only
 * through an explicit Insert or Send like any other text.
 */
export function TerminalComposer({
  draftKey,
  shortcutRows,
  onRunShortcut,
  onClose,
  onSubmit,
  onUploadImage,
  onError,
}: {
  draftKey: string;
  shortcutRows: MobileTerminalShortcut[][];
  onRunShortcut: (shortcut: MobileTerminalShortcut) => void;
  onClose: () => void;
  onSubmit: (text: string, submit: boolean) => Promise<void>;
  onUploadImage: (file: File) => Promise<string>;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState(() => readTerminalComposerDraft(draftKey));
  const [submitting, setSubmitting] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  // Latest draft text, mirrored synchronously on every write path so async
  // upload continuations never read a stale render closure.
  const textRef = useRef(text);

  // Load the incoming pane's draft. Writes happen in the change handler, so
  // a key change never carries the previous pane's text into the new key.
  useEffect(() => {
    const draft = readTerminalComposerDraft(draftKey);
    textRef.current = draft;
    setText(draft);
  }, [draftKey]);

  // Focus on open so the virtual keyboard appears, with the caret parked at
  // the end of any restored draft. Mount-only: pane switches must not yank
  // the caret out of an in-progress edit.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }, []);

  // Autosize within the CSS max-height.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [text]);

  // Restore the caret after a programmatic insertion (e.g. an uploaded image
  // path), which collapses the selection to the end otherwise.
  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(caret, caret);
  }, [text]);

  // No visualViewport lift here: the app shell already lifts its content
  // above the keyboard with --keyboard-inset-content padding (App.tsx
  // useVisualViewportCssVars), and the CSS bottom calc adds the small iOS
  // trim back so the floating form accessory bar clears the action row. A
  // full second lift would push the composer a keyboard height too high.
  const updateText = (value: string) => {
    textRef.current = value;
    setText(value);
    writeTerminalComposerDraft(draftKey, value);
  };

  const insertAtCaret = (insertion: string) => {
    const currentText = textRef.current;
    const textarea = textareaRef.current;
    const selectionStart = textarea
      ? textarea.selectionStart
      : currentText.length;
    const selectionEnd = textarea ? textarea.selectionEnd : selectionStart;
    const next = terminalComposerInsertAtCaret(
      currentText,
      selectionStart,
      selectionEnd,
      insertion,
    );
    pendingCaretRef.current = next.caret;
    updateText(next.text);
  };

  const uploadAndInsert = async (files: File[]) => {
    const images = files.filter(
      (file) => file.type === "" || file.type.startsWith("image/"),
    );
    if (images.length === 0) return;
    setUploadCount((count) => count + 1);
    try {
      for (const file of images) {
        const path = await onUploadImage(file);
        insertAtCaret(path);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setUploadCount((count) => count - 1);
    }
  };

  const submit = async (sendEnter: boolean) => {
    const draft = text;
    if (!draft || submitting || uploadCount > 0) return;
    setSubmitting(true);
    try {
      await onSubmit(draft, sendEnter);
      // Remove only the submitted text: anything typed while the request was
      // in flight stays in the draft so it cannot be sent twice or lost.
      setText((current) => {
        const next = current.startsWith(draft)
          ? current.slice(draft.length)
          : current;
        textRef.current = next;
        if (next) {
          writeTerminalComposerDraft(draftKey, next);
        } else {
          clearTerminalComposerDraft(draftKey);
        }
        return next;
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to send input");
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus({ preventScroll: true });
    }
  };

  const keepTextareaFocus = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.blur();
  };

  const busy = submitting || uploadCount > 0;
  const shortcutColumns = Math.max(1, ...shortcutRows.map((row) => row.length));

  return (
    <div
      className="terminal-composer"
      role="dialog"
      aria-label="Terminal composer"
    >
      {shortcutRows.some((row) => row.length > 0) ? (
        <div
          className="terminal-composer-shortcuts"
          style={
            {
              "--mobile-shortcut-columns": shortcutColumns,
            } as CSSProperties
          }
          aria-label="Terminal shortcuts"
        >
          {shortcutRows.map((row, rowIndex) => (
            <div
              className="terminal-composer-shortcut-row"
              key={`composer-shortcut-row-${rowIndex}`}
            >
              {row.map((shortcut) => {
                const option = mobileTerminalShortcutOption(shortcut.action);
                return (
                  <button
                    type="button"
                    title={option?.label ?? shortcut.label}
                    aria-label={`Send ${option?.label ?? shortcut.label}`}
                    onPointerDown={keepTextareaFocus}
                    onClick={() => onRunShortcut(shortcut)}
                    key={shortcut.id}
                  >
                    {shortcut.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        className="terminal-composer-input"
        value={text}
        rows={1}
        placeholder="Compose input for the terminal…"
        autoComplete="off"
        aria-label="Terminal input draft"
        onChange={(e) => updateText(e.target.value)}
        onPaste={(e) => {
          const images = Array.from(e.clipboardData?.items ?? [])
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
          // No image on the clipboard: let the native text paste proceed.
          if (images.length === 0) return;
          e.preventDefault();
          void uploadAndInsert(images);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit(true);
          }
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Reset so picking the same file again still fires change.
          e.target.value = "";
          if (files.length > 0) void uploadAndInsert(files);
        }}
      />
      <div className="terminal-composer-actions">
        <button
          type="button"
          className="terminal-composer-close"
          title="Close composer"
          aria-label="Close composer"
          onPointerDown={keepTextareaFocus}
          onClick={onClose}
        >
          <X size={15} />
        </button>
        <button
          type="button"
          className="terminal-composer-attach"
          title="Add an image"
          aria-label="Add an image"
          disabled={busy}
          onPointerDown={keepTextareaFocus}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={15} />
        </button>
        <span className="terminal-composer-hint">
          {uploadCount > 0 ? "Uploading image…" : submitting ? "Sending…" : ""}
        </span>
        <button
          type="button"
          className="terminal-composer-submit"
          title="Insert into the terminal without executing"
          aria-label="Insert draft into the terminal"
          disabled={!text || busy}
          onPointerDown={keepTextareaFocus}
          onClick={() => void submit(false)}
        >
          <CornerDownRight size={14} />
          Insert
        </button>
        <button
          type="button"
          className="terminal-composer-submit is-primary"
          title="Insert into the terminal and send Enter"
          aria-label="Send draft to the terminal"
          disabled={!text || busy}
          onPointerDown={keepTextareaFocus}
          onClick={() => void submit(true)}
        >
          <CornerDownLeft size={14} />
          Send
        </button>
      </div>
    </div>
  );
}
