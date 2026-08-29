import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { shallowEqual, store, useStoreSelector } from "../store";
import { AgentStatusIcon } from "./AgentStatusIcon";
import { CloseButton } from "./CloseButton";
import { summarizeTabAgents } from "./agentSession";
import { focusDialogElement } from "./dialogFocus";
import { requestCloseTab, tabName } from "./TabBar";

/**
 * Bottom-sheet tab switcher for narrow layouts. The tab strip hides itself on
 * mobile when a workspace has a single tab, so this sheet is the touch
 * affordance for creating, switching, and closing tabs there.
 */
export function MobileTabSheet({
  open,
  onClose,
  onShowSession,
}: {
  open: boolean;
  onClose: () => void;
  onShowSession: () => void;
}) {
  const s = useStoreSelector(
    (state) => ({
      panes: state.panes,
      tabs: state.tabs,
      workspaces: state.workspaces,
    }),
    shallowEqual,
  );
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  onCloseRef.current = onClose;

  const focusedWs = s.workspaces.find((w) => w.focused);
  const tabs = focusedWs
    ? s.tabs
        .filter((t) => t.workspace_id === focusedWs.workspace_id)
        .sort((a, b) => a.number - b.number)
    : [];

  useEffect(() => {
    if (!open) return;
    const cancelFocus = focusDialogElement(sheetRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Let stacked dialogs (e.g. the close-tab confirmation) handle Escape.
      if (
        document.querySelector(
          ".modal-backdrop:not(.mobile-tab-sheet-backdrop)",
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      cancelFocus();
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [open]);

  if (!open || !focusedWs) return null;

  return createPortal(
    <div
      className="modal-backdrop mobile-tab-sheet-backdrop"
      onMouseDown={onClose}
    >
      <div
        ref={sheetRef}
        className="mobile-tab-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Tabs"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mobile-tab-sheet-head">
          <h3>Tabs</h3>
          <CloseButton label="Close tab switcher" onClick={onClose} />
        </div>
        <div className="mobile-tab-sheet-list" role="list">
          {tabs.map((t) => {
            const name = tabName(t);
            const agentSummary = summarizeTabAgents(s.panes, t.tab_id);
            return (
              <div
                key={t.tab_id}
                role="listitem"
                className={`mobile-tab-sheet-row ${t.focused ? "is-active" : ""}`}
              >
                <button
                  type="button"
                  className="mobile-tab-sheet-focus"
                  onClick={() => {
                    store.focusTab(t.tab_id);
                    onClose();
                    onShowSession();
                  }}
                >
                  {agentSummary ? (
                    <span
                      className="tabbar-agent-marker"
                      aria-label={`${agentSummary.primaryAgent}, status ${agentSummary.status}`}
                    >
                      <AgentStatusIcon
                        agent={agentSummary.primaryAgent}
                        status={agentSummary.status}
                      />
                      {agentSummary.additionalAgents > 0 ? (
                        <span className="tabbar-agent-more">
                          +{agentSummary.additionalAgents}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <span className="mobile-tab-sheet-name">{name}</span>
                </button>
                <button
                  type="button"
                  className="mobile-tab-sheet-close"
                  aria-label={`Close ${name}`}
                  title={`Close ${name}`}
                  onClick={() => requestCloseTab(t.tab_id)}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="mobile-tab-sheet-new"
          onClick={() => {
            store.createTab(focusedWs.workspace_id);
            onClose();
            onShowSession();
          }}
        >
          <Plus size={15} />
          <span>New Tab</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
