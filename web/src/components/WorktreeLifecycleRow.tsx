import {
  FileDiff,
  Focus as FocusIcon,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitMerge,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { t } from "../i18n";
import { store } from "../store";
import type { InspectorView } from "../workspaceResource";
import {
  lifecycleAutoSyncLabel,
  lifecycleGitChangeCount,
  lifecycleGitSummary,
  lifecycleWorktreeTitle,
  type WorkspaceAutoSyncInfo,
  type WorktreeLifecycleRow as LifecycleRow,
} from "../worktreeLifecycle";

export function WorktreeLifecycleRow({
  row,
  syncInfo,
  operationRunning,
  rowBusy,
  runOperation,
  onFocus,
  onOpen,
  onOpenResource,
  onRemove,
}: {
  row: LifecycleRow;
  syncInfo?: WorkspaceAutoSyncInfo;
  operationRunning: boolean;
  rowBusy: boolean;
  runOperation: (
    key: string,
    label: string,
    action: () => Promise<unknown>,
  ) => void;
  onFocus: (workspaceId: string) => void;
  onOpen: (row: LifecycleRow) => Promise<unknown>;
  onOpenResource: (row: LifecycleRow, view: InspectorView) => Promise<unknown>;
  onRemove: (row: LifecycleRow) => void;
}) {
  const workspace = row.workspace;
  const rowKey = row.worktree.path;
  const title = lifecycleWorktreeTitle(row.worktree);
  const changed = lifecycleGitChangeCount(row.gitStatus);

  return (
    <article className="lifecycle-row" role="listitem">
      <div className="lifecycle-row-main">
        <div className="lifecycle-row-title">
          <GitBranch size={16} />
          <strong>{title}</strong>
          <span className="badge">
            {row.worktree.is_linked_worktree ? t("Linked") : t("Main")}
          </span>
          <span
            className={`lifecycle-open-state ${workspace ? "is-open" : ""}`}
          >
            {workspace ? t("Open") : t("Closed")}
          </span>
        </div>
        <code title={row.worktree.path}>{row.worktree.path}</code>
        <div className="lifecycle-row-meta">
          <span className={changed ? "has-changes" : ""}>
            {lifecycleGitSummary(row.gitStatus)}
          </span>
          {workspace ? (
            <span
              className={`lifecycle-sync-status lifecycle-sync-${
                syncInfo?.running
                  ? "running"
                  : (syncInfo?.last_status ?? "idle")
              }`}
              title={syncInfo?.last_message}
            >
              {lifecycleAutoSyncLabel(syncInfo)}
            </span>
          ) : null}
          {row.worktree.is_prunable ? (
            <span className="lifecycle-prunable">{t("Prunable")}</span>
          ) : null}
        </div>
      </div>

      <div className="lifecycle-row-actions">
        {workspace ? (
          <button
            type="button"
            className="ghost"
            disabled={operationRunning}
            onClick={() => onFocus(workspace.workspace_id)}
          >
            <FocusIcon size={14} />
            {t("Focus")}
          </button>
        ) : (
          <button
            type="button"
            className="ghost"
            title={t("Open worktree")}
            disabled={operationRunning}
            onClick={() =>
              runOperation(rowKey, t("Opening worktree"), () => onOpen(row))
            }
          >
            <FolderOpen size={14} />
            {t("Open")}
          </button>
        )}
        {!workspace && !row.worktree.is_prunable ? (
          <>
            <button
              type="button"
              className="ghost"
              title={t("Open workspace and browse files")}
              disabled={operationRunning}
              onClick={() =>
                runOperation(rowKey, t("Opening Files"), () =>
                  onOpenResource(row, "files"),
                )
              }
            >
              <FolderTree size={14} />
              {t("Files")}
            </button>
            <button
              type="button"
              className="ghost"
              title={t("Open workspace and review changes")}
              disabled={operationRunning}
              onClick={() =>
                runOperation(rowKey, t("Opening Changes"), () =>
                  onOpenResource(row, "changes"),
                )
              }
            >
              <FileDiff size={14} />
              {t("Changes")}
            </button>
          </>
        ) : null}
        {workspace ? (
          <button
            type="button"
            className="ghost lifecycle-pull-button"
            aria-label={t("Pull {name}", { name: title })}
            title={t("Git pull")}
            disabled={operationRunning}
            onClick={() =>
              runOperation(rowKey, t("Pulling current branch"), () =>
                store.gitPullWorkspace(workspace.workspace_id),
              )
            }
          >
            <GitMerge size={14} />
            {t("Pull")}
          </button>
        ) : null}
        {workspace ? (
          <button
            type="button"
            aria-label={t("Auto-sync origin's default branch into {name}", {
              name: title,
            })}
            aria-pressed={syncInfo?.enabled ?? false}
            title={
              syncInfo?.enabled
                ? t(
                    "Auto sync from origin's default branch is enabled. Click to disable.",
                  )
                : t(
                    "Auto sync from origin's default branch into this branch. Click to enable.",
                  )
            }
            className={`ghost lifecycle-sync-toggle ${
              syncInfo?.enabled ? "is-active" : ""
            }`}
            disabled={!syncInfo || operationRunning}
            onClick={() =>
              runOperation(rowKey, t("Updating auto-sync policy"), () =>
                store.setWorkspaceAutoSyncEnabled(
                  workspace.workspace_id,
                  !(syncInfo?.enabled ?? false),
                ),
              )
            }
          >
            <RefreshCw size={13} />
            {t("Sync")}
          </button>
        ) : null}
        {row.worktree.is_linked_worktree && !row.worktree.is_prunable ? (
          <button
            type="button"
            className="ghost lifecycle-remove-button"
            aria-label={t("Remove {name}", { name: title })}
            title={t("Remove worktree")}
            disabled={operationRunning}
            onClick={() => onRemove(row)}
          >
            {rowBusy ? (
              <span className="hook-loading-mark" />
            ) : (
              <Trash2 size={15} />
            )}
            {t("Remove")}
          </button>
        ) : null}
      </div>
    </article>
  );
}
