import { expect, test } from "bun:test";
import {
  absolutePath,
  isFilesystemPath,
  isWorkspaceRelativePath,
  readExplorerViewMemory,
  symlinkDescription,
  writeExplorerViewMemory,
} from "./components/fileExplorerResources";
import {
  directoryPreviewName,
  directoryPreviewPath,
  filesystemBaseName,
  filesystemBreadcrumbs,
  normalizeFilesystemPath,
  parentFilesystemPath,
} from "./filesystemPaths";

test("filesystem breadcrumbs link every ancestor from the root", () => {
  expect(filesystemBreadcrumbs("/home/me/src")).toEqual([
    { label: "/", path: "/" },
    { label: "home", path: "/home" },
    { label: "me", path: "/home/me" },
    { label: "src", path: "/home/me/src" },
  ]);
  expect(filesystemBreadcrumbs("/")).toEqual([{ label: "/", path: "/" }]);
  expect(filesystemBreadcrumbs("C:\\Users\\me")).toEqual([
    { label: "C:", path: "C:/" },
    { label: "Users", path: "C:/Users" },
    { label: "me", path: "C:/Users/me" },
  ]);
  expect(filesystemBreadcrumbs("relative/path")).toEqual([]);
  expect(filesystemBaseName("/home/me/")).toBe("me");
  expect(filesystemBaseName("/")).toBe("/");
});

test("host paths select filesystem scope and view memory stays per context", () => {
  for (const path of ["/etc", "C:/Users", "~", "~/src"]) {
    expect(isFilesystemPath(path)).toBe(true);
  }
  for (const path of ["", "src/app", "~other"]) {
    expect(isFilesystemPath(path)).toBe(false);
  }
  expect(readExplorerViewMemory("a")).toEqual({ mode: "workspace" });
  writeExplorerViewMemory("a", { mode: "filesystem", directory: "/tmp" });
  writeExplorerViewMemory("a", { directory: "/var" });
  expect(readExplorerViewMemory("a")).toEqual({
    mode: "filesystem",
    directory: "/var",
  });
  expect(readExplorerViewMemory("b")).toEqual({ mode: "workspace" });
});

test("symlink descriptions match the workspace tree wording", () => {
  const base = { name: "x", path: "x", size: 0, mtime_ms: 0, hidden: false };
  expect(symlinkDescription({ ...base, type: "file" })).toBe("");
  expect(
    symlinkDescription({ ...base, type: "symlink", symlink_status: "broken" }),
  ).toBe("broken symlink");
  expect(
    symlinkDescription({
      ...base,
      type: "directory",
      symlink_status: "external",
      symlink_target_type: "directory",
    }),
  ).toBe("external symlink");
  expect(
    symlinkDescription({
      ...base,
      type: "symlink",
      symlink_status: "internal",
      symlink_target_type: "file",
    }),
  ).toBe("symlink to file");
});

test("filesystem parents stop at POSIX, drive, and share roots", () => {
  for (const [path, parent] of [
    ["/home/user/docs", "/home/user"],
    ["/home/", "/"],
    ["/", "/"],
    ["C:\\docs\\reference", "C:/docs"],
    ["C:/docs", "C:/"],
    ["C:/", "C:/"],
    ["//server/share/docs", "//server/share"],
    ["//server/share", "//server/share"],
  ])
    expect(parentFilesystemPath(path!)).toBe(parent!);
});

test("directory preview paths resolve against the preview root", () => {
  expect(directoryPreviewPath(null)).toBe(null);
  expect(directoryPreviewPath({ root: "/repo", path: "README.md" })).toBe(null);
  expect(
    directoryPreviewPath({
      type: "directory",
      root: "/repo",
      path: "src/app",
    }),
  ).toBe("/repo/src/app");
  expect(
    directoryPreviewPath({ type: "directory", root: "/repo/", path: "/" }),
  ).toBe("/");
  expect(
    directoryPreviewPath({
      type: "directory",
      root: "/repo",
      path: "/tmp/demo/",
    }),
  ).toBe("/tmp/demo");
  expect(
    directoryPreviewPath({
      type: "directory",
      root: "C:\\repo",
      path: "C:\\repo\\src",
    }),
  ).toBe("C:/repo/src");
});

test("directory preview names use the last path component", () => {
  expect(directoryPreviewName("/repo/src/app")).toBe("app");
  expect(directoryPreviewName("/repo")).toBe("repo");
  expect(directoryPreviewName("/")).toBe("");
});

test("filesystem paths normalize separators and trailing slashes", () => {
  expect(normalizeFilesystemPath("/repo/src/")).toBe("/repo/src");
  expect(normalizeFilesystemPath("/")).toBe("/");
  expect(normalizeFilesystemPath("C:\\repo\\src")).toBe("C:/repo/src");
});

test("copy paths do not prefix an absolute filesystem entry with the workspace", () => {
  expect(isWorkspaceRelativePath("/references/r.md")).toBe(false);
  expect(isWorkspaceRelativePath("C:/references/r.md")).toBe(false);
  expect(isWorkspaceRelativePath("docs/r.md")).toBe(true);
  const entry = {
    name: "r.md",
    path: "/references/r.md",
    type: "file" as const,
    size: 0,
    mtime_ms: 0,
    hidden: false,
  };
  expect(absolutePath("/workspace", entry)).toBe("/references/r.md");
  expect(absolutePath("/workspace", { ...entry, path: "docs/r.md" })).toBe(
    "/workspace/docs/r.md",
  );
});
