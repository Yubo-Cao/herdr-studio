import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ellipsis,
  Eye,
  EyeOff,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionClient } from "../api";
import { createFileSearchMatcher } from "../fileSearch";
import {
  filesystemBaseName,
  filesystemBreadcrumbs,
  normalizeFilesystemPath,
  parentFilesystemPath,
} from "../filesystemPaths";
import { store, useStoreSelector } from "../store";
import type { FileExplorerEntry, FileExplorerList } from "../types";
import {
  createExplorerEntry,
  displaySize,
  isExplorerDirectoryEntry,
  readExplorerViewMemory,
  symlinkDescription,
  uploadExplorerFile,
  writeExplorerViewMemory,
} from "./fileExplorerResources";
import { TextInputDialog } from "./ModalDialogs";
import { Button } from "./ui/Button";
import { Token } from "./ui/Token";
import "./FilesystemBrowser.css";

type Place = { key: string; label: string; path: string; title: string };

function joinHostPath(directory: string, name: string) {
  return `${directory.replace(/[\\/]+$/, "")}/${name.replace(/^[\\/]+/, "")}`;
}

/**
 * Host filesystem explorer. Mode and directory live in session memory only;
 * nothing here is a persisted permission to leave the checkout.
 */
export function FilesystemBrowser({
  client,
  workspaceId,
  memoryContext,
  initialPath,
  workspaceRoot,
  showHidden,
  onShowHiddenChange,
  activePath,
  refreshToken = 0,
  onSelect,
  onMenu,
}: {
  client: ConnectionClient;
  workspaceId: string;
  /** Connection + workspace key for the session-only directory memory. */
  memoryContext: string;
  initialPath: string;
  workspaceRoot?: string;
  showHidden: boolean;
  onShowHiddenChange: (value: boolean) => void;
  activePath?: string;
  /** Incremented by the owner after it mutates the listed directory. */
  refreshToken?: number;
  onSelect: (entry: FileExplorerEntry) => void;
  onMenu: (entry: FileExplorerEntry, x: number, y: number) => void;
}) {
  const [directory, setDirectory] = useState(
    () => readExplorerViewMemory(memoryContext).directory || initialPath,
  );
  const [history, setHistory] = useState<{
    back: string[];
    forward: string[];
  }>({ back: [], forward: [] });
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(directory);
  const [search, setSearch] = useState("");
  const [list, setList] = useState<FileExplorerList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState<"file" | "directory" | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const paneCwdKey = useStoreSelector((state) =>
    state.panes
      .filter((pane) => pane.workspace_id === workspaceId)
      .map((pane) => pane.foreground_cwd ?? pane.cwd ?? "")
      .filter(Boolean)
      .join("\n"),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client
      .call("file.list", {
        workspace_id: workspaceId,
        path: directory,
        show_hidden: showHidden,
        scope: "filesystem",
      })
      .then((result: FileExplorerList & { scope?: string }) => {
        if (cancelled || !client.isCurrent()) return;
        if (result.scope !== "filesystem") {
          throw new Error(
            "Filesystem browsing requires an updated Studio bridge.",
          );
        }
        setList(result);
        writeExplorerViewMemory(memoryContext, { directory: result.root });
        // Do not replace a directory the user started typing while loading.
        setPathInput((draft) => (draft === directory ? result.root : draft));
      })
      .catch((reason: Error) => {
        if (!cancelled && client.isCurrent()) {
          setList(null);
          setError(reason.message);
        }
      })
      .finally(() => {
        if (!cancelled && client.isCurrent()) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    workspaceId,
    memoryContext,
    directory,
    showHidden,
    refresh,
    refreshToken,
  ]);

  useEffect(() => {
    if (editingPath) pathInputRef.current?.select();
  }, [editingPath]);

  const entries = useMemo(
    () => (list?.entries ?? []).filter(createFileSearchMatcher(search)),
    [list, search],
  );
  const currentPath = list?.root ?? directory;
  const parent = parentFilesystemPath(currentPath);
  const atRoot =
    !currentPath ||
    normalizeFilesystemPath(parent) === normalizeFilesystemPath(currentPath);
  const breadcrumbs = filesystemBreadcrumbs(currentPath);
  // Keep the root and the deepest three segments; the middle opens the editor.
  const visibleCrumbs: Array<{
    label: string;
    path: string;
    collapsed?: boolean;
  }> =
    breadcrumbs.length > 5
      ? [
          breadcrumbs[0]!,
          {
            label: "...",
            path: breadcrumbs[breadcrumbs.length - 4]!.path,
            collapsed: true,
          },
          ...breadcrumbs.slice(-3),
        ]
      : breadcrumbs;

  const places = useMemo(() => {
    const seen = new Set<string>();
    const result: Place[] = [];
    const add = (key: string, label: string, path: string, title = path) => {
      const normalized = path.startsWith("~")
        ? path
        : normalizeFilesystemPath(path);
      if (!path || seen.has(normalized)) return;
      seen.add(normalized);
      result.push({ key, label, path, title });
    };
    if (workspaceRoot) add("workspace", "Workspace", workspaceRoot);
    for (const cwd of paneCwdKey ? paneCwdKey.split("\n") : []) {
      add(`cwd:${cwd}`, filesystemBaseName(cwd), cwd, `Pane directory ${cwd}`);
    }
    add("home", "Home", "~", "Home directory on the connected host");
    add("root", "/", "/", "Filesystem root");
    return result;
  }, [paneCwdKey, workspaceRoot]);

  const navigate = (
    path: string,
    mode: "push" | "back" | "forward" = "push",
  ) => {
    const target = path.trim();
    if (!target) return;
    setEditingPath(false);
    setSearch("");
    setPathInput(target);
    if (mode === "push" && target !== currentPath) {
      setHistory((current) => ({
        back: [...current.back, currentPath].slice(-50),
        forward: [],
      }));
    }
    setDirectory(target);
    setRefresh((value) => value + 1);
  };
  const goBack = () => {
    const previous = history.back[history.back.length - 1];
    if (!previous) return;
    setHistory((current) => ({
      back: current.back.slice(0, -1),
      forward: [currentPath, ...current.forward],
    }));
    navigate(previous, "back");
  };
  const goForward = () => {
    const next = history.forward[0];
    if (!next) return;
    setHistory((current) => ({
      back: [...current.back, currentPath],
      forward: current.forward.slice(1),
    }));
    navigate(next, "forward");
  };
  const openEntry = (entry: FileExplorerEntry) => {
    if (isExplorerDirectoryEntry(entry)) {
      navigate(entry.path);
      return;
    }
    if (entry.symlink_status === "broken") {
      store.notify({
        kind: "error",
        message: "Cannot open symlink",
        detail: "The symlink target does not exist or cannot be resolved.",
      });
      return;
    }
    onSelect(entry);
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length || !list) return;
    const target = list.root;
    setUploading((count) => count + files.length);
    let uploaded = 0;
    for (const file of files) {
      try {
        await uploadExplorerFile(client, workspaceId, target, file);
        uploaded += 1;
      } catch (reason) {
        if (!client.isCurrent()) return;
        store.notify({
          kind: "error",
          message: `Upload failed: ${file.name}`,
          detail: (reason as Error).message,
        });
      } finally {
        setUploading((count) => Math.max(0, count - 1));
      }
    }
    if (!client.isCurrent()) return;
    if (uploaded) {
      store.notify({
        kind: "success",
        message:
          uploaded === 1 ? "File uploaded" : `${uploaded} files uploaded`,
        detail: target,
        autoDismissMs: 5000,
      });
    }
    setRefresh((value) => value + 1);
  };

  const createEntry = async (kind: "file" | "directory", name: string) => {
    if (!list || !name.trim()) return;
    const path = joinHostPath(list.root, name.trim());
    try {
      const created = await createExplorerEntry(
        client,
        workspaceId,
        path,
        kind,
      );
      if (!client.isCurrent()) return;
      setRefresh((value) => value + 1);
      if (kind === "file") {
        onSelect({
          name: created.path.split("/").pop() ?? name,
          path: created.path,
          type: "file",
          size: 0,
          mtime_ms: Date.now(),
          hidden: name.startsWith("."),
        });
      }
    } catch (reason) {
      if (!client.isCurrent()) return;
      store.notify({
        kind: "error",
        message:
          kind === "file" ? "Cannot create file" : "Cannot create folder",
        detail: (reason as Error).message,
      });
    }
  };

  const focusRow = (from: HTMLElement, key: string) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-file-path]",
      ) ?? [],
    );
    const index = rows.indexOf(from as HTMLButtonElement);
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? rows.length - 1
          : index + (key === "ArrowDown" ? 1 : -1);
    rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
  };

  return (
    <div className="filesystem-browser">
      <div className="ui-bar filesystem-nav">
        <Button
          icon
          title="Back"
          aria-label="Back"
          disabled={!history.back.length}
          onClick={goBack}
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          icon
          title="Forward"
          aria-label="Forward"
          disabled={!history.forward.length}
          onClick={goForward}
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          icon
          title="Parent directory"
          aria-label="Parent directory"
          disabled={atRoot}
          onClick={() => navigate(parent)}
        >
          <ArrowUp size={14} />
        </Button>
        {editingPath ? (
          <form
            className="filesystem-path-form"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(pathInput);
            }}
          >
            <input
              ref={pathInputRef}
              className="filesystem-path-input"
              aria-label="Directory path"
              value={pathInput}
              placeholder="/absolute/path or ~/path on the connected host"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setPathInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                setPathInput(currentPath);
                setEditingPath(false);
              }}
              onBlur={() => {
                setPathInput(currentPath);
                setEditingPath(false);
              }}
            />
          </form>
        ) : (
          <div
            className="filesystem-breadcrumbs"
            role="navigation"
            aria-label="Directory path"
            title="Click empty space to type a path"
            onClick={(event) => {
              if (event.target === event.currentTarget) setEditingPath(true);
            }}
          >
            {visibleCrumbs.length ? (
              visibleCrumbs.map((crumb, index) => (
                <span
                  className={`filesystem-crumb ${
                    index > 0 &&
                    index < visibleCrumbs.length - 1 &&
                    !crumb.collapsed
                      ? "is-ancestor"
                      : ""
                  }`}
                  key={crumb.path}
                >
                  {index > 0 && visibleCrumbs[index - 1]?.label !== "/" ? (
                    <span className="filesystem-crumb-separator">/</span>
                  ) : null}
                  {crumb.collapsed ? (
                    <button
                      type="button"
                      title={crumb.path}
                      aria-label={`Show ancestors of ${currentPath}`}
                      onClick={() => setEditingPath(true)}
                    >
                      ...
                    </button>
                  ) : (
                    <button
                      type="button"
                      title={crumb.path}
                      aria-current={
                        crumb.path === breadcrumbs[breadcrumbs.length - 1]?.path
                          ? "location"
                          : undefined
                      }
                      onClick={() => navigate(crumb.path)}
                    >
                      {crumb.label}
                    </button>
                  )}
                </span>
              ))
            ) : (
              <span className="filesystem-crumb">
                <button
                  type="button"
                  aria-current="location"
                  onClick={() => setEditingPath(true)}
                >
                  {currentPath}
                </button>
              </span>
            )}
            <button
              type="button"
              className="filesystem-path-edit"
              aria-label="Edit path"
              title="Type a path"
              onClick={() => setEditingPath(true)}
            />
          </div>
        )}
        <Button
          icon
          title="Refresh"
          aria-label="Refresh files"
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={14} className={loading ? "is-spinning" : ""} />
        </Button>
      </div>
      <div className="filesystem-places" aria-label="Locations">
        {places.map((place) => (
          <button
            type="button"
            key={place.key}
            className="ui-token filesystem-place"
            data-tone={
              normalizeFilesystemPath(place.path) ===
              normalizeFilesystemPath(currentPath)
                ? "accent"
                : "neutral"
            }
            title={place.title}
            onClick={() => navigate(place.path)}
          >
            {place.key === "workspace" || place.key.startsWith("cwd:") ? (
              <Folder size={11} />
            ) : null}
            {place.label}
          </button>
        ))}
      </div>
      <div className="ui-bar filesystem-tools">
        <label className="filesystem-filter">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown") return;
              event.preventDefault();
              listRef.current
                ?.querySelector<HTMLButtonElement>("button[data-file-path]")
                ?.focus();
            }}
            placeholder="Filter"
            aria-label="Filter loaded entries"
            maxLength={512}
            title="Filter loaded names or paths. Globs: r*md, ?.txt, **/*.md, *.{md,txt}"
          />
        </label>
        {list ? (
          <Token title={`${list.entries.length} entries`}>
            {search ? `${entries.length}/` : ""}
            {list.entries.length}
          </Token>
        ) : null}
        <Button
          icon
          aria-pressed={showHidden}
          title={showHidden ? "Hide hidden files" : "Show hidden files"}
          aria-label="Show hidden files"
          onClick={() => onShowHiddenChange(!showHidden)}
        >
          {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>
        <Button
          icon
          title="New file"
          aria-label="New file"
          disabled={!list}
          onClick={() => setCreating("file")}
        >
          <FilePlus size={14} />
        </Button>
        <Button
          icon
          title="New folder"
          aria-label="New folder"
          disabled={!list}
          onClick={() => setCreating("directory")}
        >
          <FolderPlus size={14} />
        </Button>
        <Button
          icon
          title="Upload files here"
          aria-label="Upload files"
          disabled={!list}
          onClick={() => uploadInputRef.current?.click()}
        >
          <Upload size={14} />
        </Button>
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void uploadFiles(files);
          }}
        />
      </div>
      {error ? (
        <p className="filesystem-message is-error" role="alert">
          {error}
        </p>
      ) : null}
      {list?.truncated ? (
        <p className="filesystem-message">
          Showing the first {list.entries.length} entries.
        </p>
      ) : null}
      {uploading ? (
        <p className="filesystem-message" role="status">
          <span className="row-spinner" /> Uploading {uploading} file
          {uploading === 1 ? "" : "s"}
        </p>
      ) : null}
      <div
        ref={listRef}
        className={`filesystem-list ${dropActive ? "is-drop-target" : ""}`}
        role="list"
        aria-label="Filesystem entries"
        aria-busy={loading}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files") || !list) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropActive(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          setDropActive(false);
          void uploadFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {dropActive ? (
          <div className="filesystem-message" role="status">
            <Upload size={13} /> Drop to upload to {currentPath}
          </div>
        ) : null}
        {loading && !list ? (
          <div className="filesystem-message" role="status">
            Loading directory...
          </div>
        ) : null}
        {!loading && !error && !entries.length ? (
          <div className="filesystem-message">
            {search ? "No loaded entries match." : "Empty directory"}
          </div>
        ) : null}
        {entries.map((entry) => {
          const directoryEntry = isExplorerDirectoryEntry(entry);
          const meta = [symlinkDescription(entry), displaySize(entry)]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              className={`filesystem-entry ${
                entry.path === activePath ? "is-selected" : ""
              } ${entry.hidden ? "is-hidden-entry" : ""}`}
              role="listitem"
              key={entry.path}
              onContextMenu={(event) => {
                event.preventDefault();
                onMenu(entry, event.clientX, event.clientY);
              }}
            >
              <button
                type="button"
                className="filesystem-row"
                data-file-path={entry.path}
                title={entry.path}
                onClick={() => openEntry(entry)}
                onKeyDown={(event) => {
                  if (
                    (event.key === "Backspace" || event.key === "ArrowLeft") &&
                    !atRoot
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    navigate(parent);
                    return;
                  }
                  if (event.key === "ArrowRight" && directoryEntry) {
                    event.preventDefault();
                    event.stopPropagation();
                    openEntry(entry);
                    return;
                  }
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    onMenu(entry, rect.left + 24, rect.bottom);
                    return;
                  }
                  if (
                    !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  focusRow(event.currentTarget, event.key);
                }}
              >
                {directoryEntry ? (
                  <Folder size={14} className="filesystem-icon is-directory" />
                ) : (
                  <File size={14} className="filesystem-icon" />
                )}
                <span className="filesystem-name">{entry.name}</span>
                {meta ? <span className="filesystem-meta">{meta}</span> : null}
              </button>
              <button
                type="button"
                className="filesystem-entry-action"
                aria-label={`Actions for ${entry.name}`}
                title={`Actions for ${entry.name}`}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  onMenu(entry, rect.right, rect.bottom);
                }}
              >
                <Ellipsis size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <TextInputDialog
        open={creating !== null}
        title={creating === "directory" ? "New Folder" : "New File"}
        label={`Name inside ${currentPath}`}
        placeholder={creating === "directory" ? "folder-name" : "file.txt"}
        submitLabel="Create"
        onClose={() => setCreating(null)}
        onSubmit={(value) => {
          const kind = creating;
          setCreating(null);
          if (kind) void createEntry(kind, value);
        }}
      />
    </div>
  );
}
