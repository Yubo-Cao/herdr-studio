import { useEffect, useState } from "react";
import { bridge } from "../api";
import { store } from "../store";

const HOOKS = [
  ["setup", "Setup"],
  ["opened", "Opened"],
  ["teardown", "Teardown"],
  ["removed", "Removed"],
] as const;

type HookName = (typeof HOOKS)[number][0];

type WorktreeHookInfo = {
  key: string | null;
  enabled: boolean;
  repo_name?: string;
  repo_root?: string;
  checkout_path?: string;
  source_checkout_path?: string;
  paseo_path?: string | null;
  hooks?: Partial<Record<HookName, string>>;
  error?: string;
};

export function WorktreeHooksDialog({
  open,
  workspaceId,
  onClose,
}: {
  open: boolean;
  workspaceId?: string;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<WorktreeHookInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setInfo(null);
    bridge
      .call("settings.worktree_hooks.get", { workspace_id: workspaceId })
      .then((result) => {
        if (!cancelled) setInfo(result as WorktreeHookInfo);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  if (!open) return null;

  const setEnabled = async (enabled: boolean) => {
    if (!info?.key) return;
    setSaving(true);
    setError("");
    try {
      await store.setRepoWorktreeHooksEnabled(info.key, enabled);
      setInfo((current) => (current ? { ...current, enabled } : current));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal worktree-hooks-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Worktree hooks"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Worktree Hooks</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>
        <p className="hook-doc-note">
          Hooks are loaded from the current repository's <code>paseo.json</code>{" "}
          <code>worktree</code> config.{" "}
          <a
            href="https://paseo.sh/docs/worktrees"
            target="_blank"
            rel="noreferrer"
          >
            View docs
          </a>
        </p>

        {loading ? (
          <div className="hook-loading" role="status">
            <span className="hook-loading-mark" />
            <span>Loading worktree hooks...</span>
          </div>
        ) : (
          <>
            {error || info?.error ? (
              <p className="modal-error">{error || info?.error}</p>
            ) : null}

            <div className="hook-summary">
              <SummaryRow label="Repo" value={info?.repo_name ?? "-"} />
              <SummaryRow label="Store key" value={info?.key ?? "-"} />
              <SummaryRow label="paseo.json" value={info?.paseo_path ?? "-"} />
              <SummaryRow label="Checkout" value={info?.checkout_path ?? "-"} />
            </div>

            <label className="check-row">
              <input
                type="checkbox"
                checked={info?.enabled ?? true}
                disabled={!info?.key || saving}
                onChange={(e) => void setEnabled(e.currentTarget.checked)}
              />
              <span>
                {saving ? "Saving..." : "Enable worktree hooks for this repo"}
              </span>
            </label>

            <div className="hook-fields">
              {HOOKS.map(([name, label]) => {
                const value = info?.hooks?.[name] ?? "";
                return (
                  <section key={name} className="hook-field">
                    <span>{label}</span>
                    <pre className={value ? "" : "is-empty"}>
                      <code>{value || "Not configured"}</code>
                    </pre>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="hook-summary-row">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}
