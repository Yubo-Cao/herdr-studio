import { isAbsolute, relative, sep } from "node:path";
import type { FileExplorerEntry } from "./file-types";

export function sanitizeExplorerPath(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part.includes("\0"))) {
    throw new Error("invalid file explorer path");
  }
  return parts.join("/");
}

/**
 * Filesystem browsing requires an explicit absolute host path. `~` and `~/...`
 * are accepted here and expanded against the runtime host's home directory.
 */
export function sanitizeFilesystemPath(value: unknown): string {
  const path =
    typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
  if (
    (!path.startsWith("/") &&
      !/^[a-z]:\//i.test(path) &&
      !isHomeRelativePath(path)) ||
    path.includes("\0")
  ) {
    throw new Error("filesystem browsing requires an absolute path");
  }
  return path;
}

export function isHomeRelativePath(path: string) {
  return path === "~" || path.startsWith("~/");
}

/** Replace a leading `~` with `home`; other paths are returned unchanged. */
export function expandHomePath(path: string, home: string) {
  if (!isHomeRelativePath(path)) return path;
  const base = home.replace(/\/+$/, "") || "/";
  const rest = path.slice(2).replace(/^\/+/, "");
  if (!rest) return base;
  return base === "/" ? `/${rest}` : `${base}/${rest}`;
}

/** Split an absolute host path into its parent directory and final name. */
export function splitFilesystemPath(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  const name = slash >= 0 ? trimmed.slice(slash + 1) : "";
  if (!name || name === "." || name === "..") {
    throw new Error("filesystem path must name an entry inside a directory");
  }
  const parent = trimmed.slice(0, slash);
  return {
    parent: parent && !/^[a-z]:$/i.test(parent) ? parent : `${parent}/`,
    name,
  };
}

export function sanitizePreviewPath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw.replace(/\\/g, "/");
  const absolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part.includes("\0"))) {
    throw new Error("invalid file preview path");
  }
  return absolute ? `/${parts.join("/")}` : parts.join("/");
}

export function sanitizeUploadFilename(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (
    !raw ||
    raw === "." ||
    raw === ".." ||
    raw.includes("/") ||
    raw.includes("\\") ||
    raw.includes("\0")
  ) {
    throw new Error("invalid upload filename");
  }
  return raw;
}

export function entrySort(a: FileExplorerEntry, b: FileExplorerEntry) {
  const aIsDirectory =
    a.type === "directory" ||
    (a.type === "symlink" &&
      a.symlink_status !== "broken" &&
      a.symlink_target_type === "directory");
  const bIsDirectory =
    b.type === "directory" ||
    (b.type === "symlink" &&
      b.symlink_status !== "broken" &&
      b.symlink_target_type === "directory");
  if (aIsDirectory && !bIsDirectory) return -1;
  if (!aIsDirectory && bIsDirectory) return 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function relativeExplorerPath(parentPath: string, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function assertInsideRoot(rootReal: string, targetReal: string) {
  const rel = relative(rootReal, targetReal);
  if (rel && (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))) {
    throw new Error("file explorer path escaped the workspace checkout");
  }
}

export function relativePreviewPath(rootReal: string, targetReal: string) {
  return relative(rootReal, targetReal).split(sep).join("/");
}

function contentDisposition(
  filename: string,
  disposition: "attachment" | "inline",
) {
  const fallback = filename.replace(/[^\x20-\x7e]|["\r\n]/g, "_") || "download";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function downloadContentDisposition(filename: string) {
  return contentDisposition(filename, "attachment");
}

export function inlineContentDisposition(filename: string) {
  return contentDisposition(filename, "inline");
}
