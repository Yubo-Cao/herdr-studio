import { useStore, store } from "../store";
import type { GitStatusSummary, Workspace } from "../types";
import { agentClass } from "../utils";
import { useEffect, useRef, useState } from "react";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { buildWorkspaceHierarchy } from "../worktree";
import { GitBranch } from "lucide-react";
import { WorktreeLifecycleDialog } from "./WorktreeLifecycleDialog";

const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_PX = 10;

function gitChangedCount(status: GitStatusSummary) {
  return status.staged + status.unstaged + status.untracked + status.conflicted;
}

function gitStatusTitle(status?: GitStatusSummary) {
  if (!status) return "";
  if (status.error) return `git status unavailable: ${status.error}`;
  const parts = [
    status.branch ? `branch: ${status.branch}` : null,
    status.upstream ? `upstream: ${status.upstream}` : null,
    status.ahead ? `ahead: ${status.ahead}` : null,
    status.behind ? `behind: ${status.behind}` : null,
    status.staged ? `staged: ${status.staged}` : null,
    status.unstaged ? `unstaged: ${status.unstaged}` : null,
    status.untracked ? `untracked: ${status.untracked}` : null,
    status.conflicted ? `conflicted: ${status.conflicted}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function GitStatusBadges({ status }: { status?: GitStatusSummary }) {
  if (!status) return null;
  if (status.error) {
    return (
      <span className="git-badge git-badge-error" title={gitStatusTitle(status)}>
        git?
      </span>
    );
  }

  const changed = gitChangedCount(status);
  const branch = status.branch || "git";
  return (
    <span className="git-status" title={gitStatusTitle(status)}>
      <span className="git-badge git-branch">{branch}</span>
      {changed > 0 ? (
        <span className="git-badge git-dirty">Δ{changed}</span>
      ) : null}
      {status.ahead > 0 ? (
        <span className="git-badge git-ahead">↑{status.ahead}</span>
      ) : null}
      {status.behind > 0 ? (
        <span className="git-badge git-behind">↓{status.behind}</span>
      ) : null}
    </span>
  );
}

export function WorkspaceTree({
  onSelect,
}: {
  onSelect?: () => void;
}) {
  const s = useStore();
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [lifecycleWorkspaceId, setLifecycleWorkspaceId] = useState<
    string | null
  >(null);

  if (s.workspaces.length === 0) {
    return (
      <>
        <div className="panel">
          <div className="panel-head">
            <h2>Workspaces</h2>
            <button
              className="panel-add"
              title="新建 workspace"
              onClick={() => setCreateOpen(true)}
            >
              +
            </button>
          </div>
          <p className="muted">
            {s.status === "connected"
              ? "No workspaces."
              : "Connect to the bridge to load workspaces."}
          </p>
        </div>
        <CreateWorkspaceDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      </>
    );
  }

  const { topLevel, childrenByParent } = buildWorkspaceHierarchy(s.workspaces);
  const focusedRepoWorkspace = s.workspaces.find(
    (workspace) => workspace.focused && workspace.worktree,
  );

  return (
    <>
      <div className="panel tree">
        <div className="panel-head">
          <h2>Workspaces</h2>
          <div className="panel-actions">
            {focusedRepoWorkspace ? (
              <button
                type="button"
                className="panel-add panel-action-icon"
                title="Worktree lifecycle"
                aria-label="Open worktree lifecycle"
                onClick={() =>
                  setLifecycleWorkspaceId(focusedRepoWorkspace.workspace_id)
                }
              >
                <GitBranch size={14} />
              </button>
            ) : null}
            <button
              className="panel-add"
              title="新建 workspace"
              onClick={() => setCreateOpen(true)}
            >
              +
            </button>
          </div>
        </div>
        {topLevel.map((w) => (
          <WorkspaceRow
            key={w.workspace_id}
            w={w}
            depth={0}
            childrenByParent={childrenByParent}
            onSelect={onSelect}
            onContextMenu={(w, x, y) => setMenu({ workspace: w, x, y })}
          />
        ))}
      </div>
      <ContextMenu
        state={menu}
        onClose={() => setMenu(null)}
      />
      <CreateWorkspaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <WorktreeLifecycleDialog
        open={!!lifecycleWorkspaceId}
        workspaceId={lifecycleWorkspaceId}
        onClose={() => setLifecycleWorkspaceId(null)}
      />
    </>
  );
}

function WorkspaceRow({
  w,
  depth,
  childrenByParent,
  onSelect,
  onContextMenu,
}: {
  w: Workspace;
  depth: number;
  childrenByParent: Map<string, Workspace[]>;
  onSelect?: () => void;
  onContextMenu: (w: Workspace, x: number, y: number) => void;
}) {
  const children = childrenByParent.get(w.workspace_id) ?? [];
  const s = useStore();
  const isChild = depth > 0;
  const isPendingFocus = s.pendingFocusWorkspaceId === w.workspace_id && !w.focused;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => clearLongPressTimer, []);

  const openMenu = (x: number, y: number) => {
    onContextMenu(w, x, y);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    longPressTriggered.current = false;
    longPressStart.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      openMenu(e.clientX, e.clientY);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = longPressStart.current;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx > LONG_PRESS_MOVE_PX || dy > LONG_PRESS_MOVE_PX) {
      clearLongPressTimer();
      longPressStart.current = null;
    }
  };

  const onPointerEnd = () => {
    clearLongPressTimer();
    longPressStart.current = null;
  };

  return (
    <>
      <div
        className={`tree-row clickable-row ${w.focused ? "is-focused" : ""} ${
          isChild ? "is-child" : ""
        } ${isPendingFocus ? "is-loading" : ""}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={(e) => {
          if (longPressTriggered.current) {
            longPressTriggered.current = false;
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          store.focusWorkspace(w.workspace_id);
          onSelect?.();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
        title={
          w.worktree
            ? [
                `${w.worktree.repo_name} · ${w.worktree.checkout_path}`,
                gitStatusTitle(w.worktree.git_status),
              ]
                .filter(Boolean)
                .join("\n")
            : w.workspace_id
        }
      >
        <span className="twisty">{isChild ? "⌞" : " "}</span>
        <strong className="ws-label">{w.label || w.workspace_id}</strong>
        {isPendingFocus ? (
          <span className="row-spinner" aria-label="Loading workspace" />
        ) : null}
        {w.worktree ? (
          <GitStatusBadges status={w.worktree.git_status} />
        ) : null}
        <span className={agentClass(w.agent_status)}>{w.agent_status}</span>
      </div>
      {children.map((child) => (
        <WorkspaceRow
          key={child.workspace_id}
          w={child}
          depth={depth + 1}
          childrenByParent={childrenByParent}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}
