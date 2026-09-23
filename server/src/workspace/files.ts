import { homedir } from "node:os";
import type { HerdrClient } from "../bridge/herdr-client";
import { sshCommandArgv } from "../bridge/ssh-command";
import { checkoutPath as getCheckoutPath } from "./utils";
import {
  downloadContentDisposition,
  expandHomePath,
  inlineContentDisposition,
  isHomeRelativePath,
  sanitizeExplorerPath,
  sanitizeFilesystemPath,
  sanitizePreviewPath,
  sanitizeUploadFilename,
  splitFilesystemPath,
} from "./file-paths";
import type {
  FileCreateResult,
  FileResolution,
  RunProcessWithCodeTimeout,
} from "./file-types";
import {
  createLocalEntry,
  deleteLocalFile,
  downloadLocalFile,
  listLocalFiles,
  readLocalFile,
  resolveLocalFilePaths,
  uploadLocalFile,
} from "./local-files";
import {
  createRemoteEntry,
  deleteRemoteFile,
  downloadRemoteFile,
  listRemoteFiles,
  readRemoteFile,
  readRemoteHome,
  resolveRemoteFilePaths,
  uploadRemoteFile,
} from "./remote-files";
import {
  pullGit,
  readDiffFile,
  readDiffSummary,
  type LastStepBaselineStore,
} from "./git-diff";
import { runGitFileAction, runGitRepoAction } from "./git-actions";
import { collectIgnoredNames } from "./git-ignore";
import { GIT_DIFF_TIMEOUT_MS } from "./file-constants";
import { inlinePreviewMimeForPath } from "./preview";
import {
  HTML_PREVIEW_MAX_BYTES,
  isHtmlPath,
} from "../../../shared/filePreview";
import { HtmlPreviewError, readHtmlPreviewFile } from "./html-preview-files";
import { HTML_PREVIEW_CSP, renderHtmlPreview } from "./html-preview";

const MAX_FILE_RESOLUTION_CANDIDATES = 32;
const MAX_FILE_RESOLUTION_PATH_LENGTH = 4096;

export function createFileHandlers({
  herdr,
  sshHost,
  runProcessWithCodeTimeout,
  shQuote,
  lastStepBaselines,
}: {
  herdr: HerdrClient;
  sshHost: () => string | undefined;
  runProcessWithCodeTimeout: RunProcessWithCodeTimeout;
  shQuote: (value: string) => string;
  lastStepBaselines?: LastStepBaselineStore;
}) {
  const remoteHomes = new Map<string, Promise<string>>();

  /** Home of the runtime user on the host that owns the files. */
  async function hostHome(host: string | undefined) {
    if (!host) return homedir();
    let home = remoteHomes.get(host);
    if (!home) {
      home = readRemoteHome({ host, runProcessWithCodeTimeout, shQuote });
      remoteHomes.set(host, home);
      home.catch(() => {
        if (remoteHomes.get(host) === home) remoteHomes.delete(host);
      });
    }
    return home;
  }

  /** Sanitize an explicit host path and expand `~` on the runtime host. */
  async function filesystemPath(value: unknown, host: string | undefined) {
    const path = sanitizeFilesystemPath(value);
    return isHomeRelativePath(path)
      ? expandHomePath(path, await hostHome(host))
      : path;
  }

  async function explorerRoot(
    workspaceId: string,
    workspace: any,
  ): Promise<string> {
    const checkoutPath = getCheckoutPath(workspace);
    if (checkoutPath) return checkoutPath;
    const paneResult = await herdr.call("pane.list");
    const panes = Array.isArray((paneResult as any)?.panes)
      ? (paneResult as any).panes
      : [];
    const pane =
      panes.find((p: any) => p?.workspace_id === workspaceId && p?.focused) ??
      panes.find((p: any) => p?.workspace_id === workspaceId);
    return (
      (typeof pane?.foreground_cwd === "string" && pane.foreground_cwd) ||
      (typeof pane?.cwd === "string" && pane.cwd) ||
      ""
    );
  }

  async function getWorkspace(workspaceId: string) {
    const result = await herdr.call("workspace.get", {
      workspace_id: workspaceId,
    });
    return (result as any)?.workspace ?? result;
  }

  async function fileTarget(params: Record<string, unknown>, method: string) {
    const workspaceId = String(params.workspace_id ?? "");
    if (!workspaceId) throw new Error(`${method} requires workspace_id`);
    const path =
      params.scope === "filesystem"
        ? await filesystemPath(params.path, sshHost())
        : sanitizePreviewPath(params.path);
    if (!path) throw new Error(`${method} requires path`);
    const workspace = await getWorkspace(workspaceId);
    const checkoutPath = await explorerRoot(workspaceId, workspace);
    if (!checkoutPath) throw new Error("workspace has no directory path");
    return { workspaceId, workspace, checkoutPath, path };
  }

  async function downloadTarget(params: Record<string, unknown>) {
    const workspaceId = String(params.workspace_id ?? "");
    if (!workspaceId) throw new Error("file.download requires workspace_id");
    const path =
      params.scope === "filesystem"
        ? await filesystemPath(params.path, sshHost())
        : sanitizeExplorerPath(params.path);
    if (!path) throw new Error("file.download requires path");
    const workspace = await getWorkspace(workspaceId);
    const checkoutPath = await explorerRoot(workspaceId, workspace);
    if (!checkoutPath) throw new Error("workspace has no directory path");
    return { checkoutPath, path };
  }

  /**
   * Upload, delete, and create run against a root plus a root-relative path.
   * Workspace scope roots at the checkout and confines the path lexically.
   * Filesystem scope roots at the explicit host directory itself (upload) or
   * at the named entry's parent (delete/create), so the same helpers apply.
   */
  async function mutationTarget(
    params: Record<string, unknown>,
    method: string,
    pathKey: "path" | "directory",
  ) {
    const workspaceId = String(params.workspace_id ?? "");
    if (!workspaceId) throw new Error(`${method} requires workspace_id`);
    const workspace = await getWorkspace(workspaceId);
    const checkoutPath = await explorerRoot(workspaceId, workspace);
    if (!checkoutPath) throw new Error("workspace has no directory path");
    if (params.scope !== "filesystem") {
      const path = sanitizeExplorerPath(params[pathKey]);
      if (!path && pathKey === "path")
        throw new Error(`${method} requires path`);
      return { workspaceId, rootPath: checkoutPath, path, filesystem: false };
    }
    const absolute = await filesystemPath(params[pathKey], sshHost());
    if (pathKey === "directory") {
      return { workspaceId, rootPath: absolute, path: "", filesystem: true };
    }
    const { parent, name } = splitFilesystemPath(absolute);
    return { workspaceId, rootPath: parent, path: name, filesystem: true };
  }

  function joinFilesystemPath(root: string, name: string) {
    return `${root.replace(/\/+$/, "")}/${name}`;
  }

  async function listFiles(params: Record<string, unknown>) {
    const workspaceId = String(params.workspace_id ?? "");
    if (!workspaceId) throw new Error("file.list requires workspace_id");
    const workspace = await getWorkspace(workspaceId);
    const checkoutPath = await explorerRoot(workspaceId, workspace);
    if (!checkoutPath) throw new Error("workspace has no directory path");
    const filesystem = params.scope === "filesystem";
    const host = sshHost();
    const rootPath = filesystem
      ? await filesystemPath(params.path || checkoutPath, host)
      : checkoutPath;
    const relativePath = filesystem ? "" : sanitizeExplorerPath(params.path);
    const showHidden = params.show_hidden === true;
    const list = host
      ? await listRemoteFiles({
          host,
          rootPath,
          relativePath,
          showHidden,
          runProcessWithCodeTimeout,
          shQuote,
        })
      : await listLocalFiles(rootPath, relativePath, showHidden, filesystem);
    if (list.entries.length) {
      const ignored = await collectIgnoredNames({
        host,
        directory: relativePath ? `${list.root}/${relativePath}` : list.root,
        names: list.entries.map((entry) => entry.name),
        shQuote,
      });
      if (ignored.size) {
        list.entries = list.entries.map((entry) =>
          ignored.has(entry.name) ? { ...entry, ignored: true } : entry,
        );
      }
    }
    if (filesystem) {
      const directory = list.root.replace(/\\/g, "/").replace(/\/+$/, "");
      list.entries = list.entries.map((entry) => ({
        ...entry,
        path: `${directory}/${entry.name}`,
      }));
    }
    return {
      ...list,
      ...(filesystem ? { scope: "filesystem" as const } : {}),
      workspace_id: workspaceId,
      repo_name: workspace?.worktree?.repo_name ?? workspace?.label ?? "",
      checkout_path: checkoutPath,
    };
  }

  async function readFile(params: Record<string, unknown>) {
    const { workspaceId, workspace, checkoutPath, path } = await fileTarget(
      params,
      "file.read",
    );
    const host = sshHost();
    const preview = host
      ? await readRemoteFile({
          host,
          rootPath: checkoutPath,
          requestedPath: path,
          runProcessWithCodeTimeout,
          shQuote,
        })
      : await readLocalFile(checkoutPath, path);
    return {
      ...preview,
      workspace_id: workspaceId,
      repo_name: workspace?.worktree?.repo_name ?? workspace?.label ?? "",
      checkout_path: checkoutPath,
    };
  }

  async function resolveFiles(params: Record<string, unknown>) {
    const workspaceId = String(params.workspace_id ?? "");
    if (!workspaceId) throw new Error("file.resolve requires workspace_id");
    const rawPaths = Array.isArray(params.paths) ? params.paths : [];
    const candidates: FileResolution[] = [];
    const seen = new Set<string>();
    for (const value of rawPaths.slice(0, MAX_FILE_RESOLUTION_CANDIDATES)) {
      if (typeof value !== "string") continue;
      const candidate = value.trim();
      if (
        !candidate ||
        candidate.length > MAX_FILE_RESOLUTION_PATH_LENGTH ||
        seen.has(candidate)
      ) {
        continue;
      }
      try {
        const sanitized = sanitizePreviewPath(candidate);
        const path = sanitized.startsWith("/")
          ? sanitized
          : sanitized
              .split("/")
              .filter((part) => part && part !== ".")
              .join("/");
        if (!path) continue;
        candidates.push({ candidate, path });
        seen.add(candidate);
      } catch {
        // Invalid candidates are unresolved rather than failing the whole batch.
      }
    }
    if (candidates.length === 0) {
      return { workspace_id: workspaceId, files: [] };
    }
    const workspace = await getWorkspace(workspaceId);
    const checkoutPath = await explorerRoot(workspaceId, workspace);
    if (!checkoutPath) throw new Error("workspace has no directory path");
    const paths = Array.from(new Set(candidates.map((entry) => entry.path)));
    const host = sshHost();
    const existing = host
      ? await resolveRemoteFilePaths({
          host,
          rootPath: checkoutPath,
          requestedPaths: paths,
          runProcessWithCodeTimeout,
          shQuote,
        })
      : await resolveLocalFilePaths(checkoutPath, paths);
    const existingPaths = new Set(existing);
    return {
      workspace_id: workspaceId,
      checkout_path: checkoutPath,
      files: candidates.filter((entry) => existingPaths.has(entry.path)),
    };
  }

  async function downloadFile(params: Record<string, unknown>) {
    const { checkoutPath, path } = await downloadTarget(params);
    const host = sshHost();
    if (params.inline === true && isHtmlPath(path)) {
      const headers = {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": inlineContentDisposition(path.split("/").pop()!),
        "content-security-policy": HTML_PREVIEW_CSP,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      };
      try {
        const readResource = (resourcePath: string, limit: number) =>
          readHtmlPreviewFile({
            rootPath: checkoutPath,
            path: resourcePath,
            limit,
            host,
            runProcessWithCodeTimeout,
            shQuote,
          });
        const document = await readResource(path, HTML_PREVIEW_MAX_BYTES);
        return new Response(await renderHtmlPreview(document, readResource), {
          headers,
        });
      } catch (error) {
        const status = error instanceof HtmlPreviewError ? error.status : 400;
        const message =
          status === 413
            ? "HTML is too large to render, or its static resources exceed the preview limits. Use Source or Download."
            : "Unable to render HTML. Preview requires a readable UTF-8 HTML file and static resources inside the workspace. Use Source or Download.";
        return new Response(message, {
          status,
          headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
        });
      }
    }
    const download = host
      ? await downloadRemoteFile({
          host,
          rootPath: checkoutPath,
          requestedPath: path,
          runProcessWithCodeTimeout,
          shQuote,
        })
      : await downloadLocalFile(checkoutPath, path);
    const inlineMime =
      params.inline === true ? inlinePreviewMimeForPath(download.path) : null;
    const headers: Record<string, string> = {
      "content-type": inlineMime ?? download.contentType,
      "content-length": String(download.size),
      "content-disposition": inlineMime
        ? inlineContentDisposition(download.filename)
        : downloadContentDisposition(download.filename),
      "x-file-path": encodeURIComponent(download.path),
    };
    if (inlineMime) {
      headers["cache-control"] = "private, no-store";
      headers["x-content-type-options"] = "nosniff";
    }
    if (inlineMime === "image/svg+xml") {
      // SVGs are inert in <img>. Keep direct navigation to the same endpoint
      // isolated too, without granting workspace content the Studio origin.
      headers["content-security-policy"] =
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    }
    return new Response(download.body, { headers });
  }

  async function uploadFile(params: Record<string, unknown>, request: Request) {
    const filename = sanitizeUploadFilename(params.filename);
    const {
      workspaceId,
      rootPath,
      path: directory,
      filesystem,
    } = await mutationTarget(params, "file.upload", "directory");
    const body = Buffer.from(await request.arrayBuffer());
    const host = sshHost();
    const upload = host
      ? await uploadRemoteFile({
          host,
          rootPath,
          directory,
          filename,
          body,
          shQuote,
        })
      : await uploadLocalFile(rootPath, directory, filename, body);
    return {
      workspace_id: workspaceId,
      directory: filesystem ? rootPath : directory,
      filename,
      ...upload,
      ...(filesystem
        ? {
            scope: "filesystem" as const,
            path: joinFilesystemPath(rootPath, filename),
          }
        : {}),
    };
  }

  async function deleteFile(params: Record<string, unknown>) {
    const { workspaceId, rootPath, path, filesystem } = await mutationTarget(
      params,
      "file.delete",
      "path",
    );
    const host = sshHost();
    if (
      filesystem &&
      joinFilesystemPath(rootPath, path) ===
        (await hostHome(host)).replace(/\/+$/, "")
    ) {
      throw new Error("refusing to delete the home directory");
    }
    const deleted = host
      ? await deleteRemoteFile({
          host,
          rootPath,
          requestedPath: path,
          runProcessWithCodeTimeout,
          shQuote,
        })
      : await deleteLocalFile(rootPath, path);
    return {
      workspace_id: workspaceId,
      ...deleted,
      ...(filesystem
        ? {
            scope: "filesystem" as const,
            path: joinFilesystemPath(rootPath, path),
          }
        : {}),
    };
  }

  async function createEntry(params: Record<string, unknown>) {
    const kind: FileCreateResult["type"] =
      params.kind === "directory"
        ? "directory"
        : params.kind === "file"
          ? "file"
          : (() => {
              throw new Error('file.mkdir kind must be "directory" or "file"');
            })();
    const { workspaceId, rootPath, path, filesystem } = await mutationTarget(
      params,
      "file.mkdir",
      "path",
    );
    const host = sshHost();
    const created = host
      ? await createRemoteEntry({
          host,
          rootPath,
          requestedPath: path,
          kind,
          runProcessWithCodeTimeout,
          shQuote,
        })
      : await createLocalEntry(rootPath, path, kind);
    return {
      workspace_id: workspaceId,
      ...created,
      ...(filesystem
        ? {
            scope: "filesystem" as const,
            path: joinFilesystemPath(rootPath, path),
          }
        : {}),
    };
  }

  async function gitRoot(workspaceId: string, workspace: any) {
    const host = sshHost();
    const tried = new Set<string>();
    let lastError = "workspace is not inside a git repository";

    const resolveCandidate = async (candidate: unknown) => {
      if (typeof candidate !== "string" || !candidate || tried.has(candidate)) {
        return null;
      }
      tried.add(candidate);
      const argv = host
        ? sshCommandArgv(
            host,
            `git -C ${shQuote(candidate)} rev-parse --show-toplevel`,
          )
        : ["git", "-C", candidate, "rev-parse", "--show-toplevel"];
      const result = await runProcessWithCodeTimeout(argv, GIT_DIFF_TIMEOUT_MS);
      if (result.code === 0 && result.stdout.trim())
        return result.stdout.trim();
      lastError = (
        result.stderr ||
        result.stdout ||
        "workspace is not inside a git repository"
      )
        .trim()
        .slice(0, 1000);
      return null;
    };

    // A pane's foreground process can belong to an agent plugin rather than
    // the checkout. Use stable workspace identity first, then probe pane cwd,
    // and only treat foreground_cwd as a final fallback for interactive shells.
    const workspaceRoot = await resolveCandidate(getCheckoutPath(workspace));
    if (workspaceRoot) return workspaceRoot;

    const paneResult = await herdr.call("pane.list");
    const panes = Array.isArray((paneResult as any)?.panes)
      ? (paneResult as any).panes
      : [];
    const pane =
      panes.find(
        (item: any) => item?.workspace_id === workspaceId && item?.focused,
      ) ?? panes.find((item: any) => item?.workspace_id === workspaceId);
    for (const candidate of [pane?.cwd, pane?.foreground_cwd]) {
      const root = await resolveCandidate(candidate);
      if (root) return root;
    }
    if (tried.size === 0) throw new Error("workspace has no directory path");
    throw new Error(lastError);
  }

  async function workspaceAndGitRoot(
    params: Record<string, unknown>,
    method = "git diff",
  ) {
    const workspaceId = String(params.workspace_id ?? "");
    if (!workspaceId) throw new Error(`${method} requires workspace_id`);
    const workspace = await getWorkspace(workspaceId);
    const root = await gitRoot(workspaceId, workspace);
    return { workspaceId, workspace, root };
  }

  async function readGitDiffSummary(params: Record<string, unknown>) {
    const { workspaceId, workspace, root } = await workspaceAndGitRoot(params);
    return readDiffSummary({
      workspaceId,
      workspace,
      root,
      params,
      host: sshHost(),
      shQuote,
      runProcessWithCodeTimeout,
      lastStepBaselines,
    });
  }

  async function readGitDiffFile(params: Record<string, unknown>) {
    const { workspaceId, root } = await workspaceAndGitRoot(params);
    return readDiffFile({
      workspaceId,
      root,
      params,
      host: sshHost(),
      shQuote,
      runProcessWithCodeTimeout,
      lastStepBaselines,
    });
  }

  async function runGitPull(params: Record<string, unknown>) {
    const { workspaceId, root } = await workspaceAndGitRoot(params);
    return pullGit({
      workspaceId,
      root,
      host: sshHost(),
      shQuote,
      runProcessWithCodeTimeout,
    });
  }

  async function runWorkspaceGitFileAction(params: Record<string, unknown>) {
    const { workspaceId, root } = await workspaceAndGitRoot(
      params,
      "git.file_action",
    );
    const result = await runGitFileAction({
      context: { root, host: sshHost(), shQuote, runProcessWithCodeTimeout },
      params,
    });
    return { workspace_id: workspaceId, root, ...result };
  }

  async function runWorkspaceGitRepoAction(params: Record<string, unknown>) {
    const { workspaceId, root } = await workspaceAndGitRoot(
      params,
      "git.repo_action",
    );
    const result = await runGitRepoAction({
      context: { root, host: sshHost(), shQuote, runProcessWithCodeTimeout },
      params,
    });
    return { workspace_id: workspaceId, root, ...result };
  }

  return {
    listWorkspaceFiles: listFiles,
    resolveWorkspaceFiles: resolveFiles,
    readWorkspaceFile: readFile,
    downloadWorkspaceFile: downloadFile,
    uploadWorkspaceFile: uploadFile,
    deleteWorkspaceFile: deleteFile,
    createWorkspaceEntry: createEntry,
    readGitDiffSummary,
    readGitDiffFile,
    runGitPull,
    runWorkspaceGitFileAction,
    runWorkspaceGitRepoAction,
    resolveWorkspaceGitRoot: workspaceAndGitRoot,
  };
}
