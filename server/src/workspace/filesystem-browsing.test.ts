import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { HerdrClient } from "../bridge/herdr-client";
import { runProcessWithCode, shQuote } from "../utils/process-utils";
import {
  expandHomePath,
  sanitizeFilesystemPath,
  splitFilesystemPath,
} from "./file-paths";
import { createFileHandlers } from "./files";
import { listRemoteFiles } from "./remote-files";

async function fixture(
  run: (root: string, workspace: string, refs: string) => Promise<void>,
) {
  // Canonicalize: handlers resolve real paths (macOS /var -> /private/var).
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "herdr-filesystem-")),
  );
  try {
    const workspace = join(root, "workspace");
    const refs = join(root, "reference materials");
    await mkdir(workspace);
    await mkdir(refs);
    await writeFile(join(workspace, "workspace.md"), "workspace");
    await writeFile(join(refs, "readme.md"), "reference");
    await writeFile(join(refs, ".hidden.md"), "hidden");
    await symlink(refs, join(workspace, "external"), "dir");
    await run(root, workspace, refs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function handlers(workspace: string) {
  return createFileHandlers({
    herdr: {
      call: async (method: string) => {
        expect(method).toBe("workspace.get");
        return {
          workspace: { workspace_id: "w1", label: "Workspace", cwd: workspace },
        };
      },
    } as unknown as HerdrClient,
    sshHost: () => undefined,
    runProcessWithCodeTimeout: async () => {
      throw new Error("Unexpected remote call");
    },
    shQuote,
  });
}

test("filesystem paths must be explicit, absolute, and NUL-free", () => {
  expect(sanitizeFilesystemPath("/tmp/../refs")).toBe("/tmp/../refs");
  expect(sanitizeFilesystemPath("C:\\refs")).toBe("C:/refs");
  expect(sanitizeFilesystemPath("~")).toBe("~");
  expect(sanitizeFilesystemPath("~/src")).toBe("~/src");
  for (const path of [undefined, "", "refs", "../refs", "/refs\0", "~other"]) {
    expect(() => sanitizeFilesystemPath(path)).toThrow("absolute path");
  }
});

test("home expansion and entry splitting keep explicit host paths", () => {
  expect(expandHomePath("~", "/home/me/")).toBe("/home/me");
  expect(expandHomePath("~/a/b", "/home/me")).toBe("/home/me/a/b");
  expect(expandHomePath("~/a", "/")).toBe("/a");
  expect(expandHomePath("/etc", "/home/me")).toBe("/etc");
  expect(splitFilesystemPath("/tmp/notes.md")).toEqual({
    parent: "/tmp",
    name: "notes.md",
  });
  expect(splitFilesystemPath("/etc/")).toEqual({ parent: "/", name: "etc" });
  expect(splitFilesystemPath("C:/Users")).toEqual({
    parent: "C:/",
    name: "Users",
  });
  for (const path of ["/", "/tmp/..", "/tmp/."]) {
    expect(() => splitFilesystemPath(path)).toThrow();
  }
});

test("workspace listings stay lexically confined; opt-in browsing can leave the checkout", async () => {
  await fixture(async (_root, workspace, refs) => {
    const files = handlers(workspace);
    const defaultList = await files.listWorkspaceFiles({ workspace_id: "w1" });
    expect(defaultList.root).toBe(workspace);
    expect(defaultList.entries.map((e) => e.path)).toEqual([
      "external",
      "workspace.md",
    ]);
    // Explicit symlinks inside the checkout may be followed; lexical escapes
    // and absolute paths still require filesystem scope.
    const followed = await files.listWorkspaceFiles({
      workspace_id: "w1",
      path: "external",
    });
    expect(followed.entries.map((e) => e.path)).toEqual(["external/readme.md"]);
    for (const params of [
      { path: "../reference materials" },
      { path: refs, scope: "workspace" },
    ]) {
      await expect(
        files.listWorkspaceFiles({ workspace_id: "w1", ...params }),
      ).rejects.toThrow();
    }
    const list = await files.listWorkspaceFiles({
      workspace_id: "w1",
      scope: "filesystem",
      path: join(workspace, "..", "reference materials"),
    });
    expect(list).toMatchObject({
      root: refs,
      checkout_path: workspace,
      scope: "filesystem",
    });
    expect(list.entries.map((e) => e.path)).toEqual([join(refs, "readme.md")]);
    const hidden = await files.listWorkspaceFiles({
      workspace_id: "w1",
      scope: "filesystem",
      path: refs,
      show_hidden: true,
    });
    expect(hidden.entries).toHaveLength(2);
    const rootList = await files.listWorkspaceFiles({
      workspace_id: "w1",
      scope: "filesystem",
      path: workspace,
    });
    expect(rootList.entries.find((e) => e.name === "external")?.type).toBe(
      "directory",
    );
    const linked = await files.listWorkspaceFiles({
      workspace_id: "w1",
      scope: "filesystem",
      path: join(workspace, "external"),
    });
    expect(linked.root).toBe(refs);
    expect((await files.listWorkspaceFiles({ workspace_id: "w1" })).root).toBe(
      workspace,
    );
  });
});

test("external references preview and download only with filesystem scope", async () => {
  await fixture(async (_root, workspace, refs) => {
    const files = handlers(workspace);
    const path = join(refs, "readme.md");
    expect(
      await files.readWorkspaceFile({ workspace_id: "w1", path }),
    ).toMatchObject({ path, text: "reference" });
    const response = await files.downloadWorkspaceFile({
      workspace_id: "w1",
      path,
      scope: "filesystem",
    });
    expect(await response.text()).toBe("reference");
    await expect(
      files.downloadWorkspaceFile({ workspace_id: "w1", path }),
    ).rejects.toThrow();
  });
});

test("filesystem scope uploads, creates, and deletes explicit host paths", async () => {
  await fixture(async (_root, workspace, refs) => {
    const files = handlers(workspace);
    const uploaded = await files.uploadWorkspaceFile(
      {
        workspace_id: "w1",
        directory: refs,
        filename: "notes.txt",
        scope: "filesystem",
      },
      new Request("http://test", { method: "POST", body: "notes" }),
    );
    expect(uploaded).toMatchObject({
      scope: "filesystem",
      path: join(refs, "notes.txt"),
      overwritten: false,
    });
    expect(await readFile(join(refs, "notes.txt"), "utf8")).toBe("notes");

    const folder = await files.createWorkspaceEntry({
      workspace_id: "w1",
      path: join(refs, "drafts"),
      kind: "directory",
      scope: "filesystem",
    });
    expect(folder).toMatchObject({
      path: join(refs, "drafts"),
      type: "directory",
    });
    const empty = await files.createWorkspaceEntry({
      workspace_id: "w1",
      path: join(refs, "drafts", "todo.md"),
      kind: "file",
      scope: "filesystem",
    });
    expect(empty.type).toBe("file");
    expect(await readFile(join(refs, "drafts", "todo.md"), "utf8")).toBe("");
    await expect(
      files.createWorkspaceEntry({
        workspace_id: "w1",
        path: join(refs, "drafts"),
        kind: "directory",
        scope: "filesystem",
      }),
    ).rejects.toThrow("already exists");
    await expect(
      files.createWorkspaceEntry({
        workspace_id: "w1",
        path: join(refs, "missing", "child"),
        kind: "file",
        scope: "filesystem",
      }),
    ).rejects.toThrow("parent directory");

    const deleted = await files.deleteWorkspaceFile({
      workspace_id: "w1",
      path: join(refs, "drafts"),
      scope: "filesystem",
    });
    expect(deleted).toMatchObject({
      path: join(refs, "drafts"),
      type: "directory",
    });
    await expect(
      files.deleteWorkspaceFile({
        workspace_id: "w1",
        path: "/",
        scope: "filesystem",
      }),
    ).rejects.toThrow();
  });
});

test("workspace scope mutations stay lexically confined", async () => {
  await fixture(async (_root, workspace) => {
    const files = handlers(workspace);
    const created = await files.createWorkspaceEntry({
      workspace_id: "w1",
      path: "src",
      kind: "directory",
    });
    expect(created).toMatchObject({ path: "src", type: "directory" });
    for (const path of ["../escape", "src/../../escape"]) {
      await expect(
        files.createWorkspaceEntry({ workspace_id: "w1", path, kind: "file" }),
      ).rejects.toThrow();
    }
    await expect(
      files.createWorkspaceEntry({
        workspace_id: "w1",
        path: "anything",
        kind: "socket",
      }),
    ).rejects.toThrow("kind");
    await expect(
      files.deleteWorkspaceFile({ workspace_id: "w1", path: "" }),
    ).rejects.toThrow();
  });
});

test("filesystem paths expand ~ against the local runtime home", async () => {
  await fixture(async (_root, workspace) => {
    const files = handlers(workspace);
    const home = await realpath(homedir());
    const list = await files.listWorkspaceFiles({
      workspace_id: "w1",
      scope: "filesystem",
      path: "~",
    });
    expect(list.root).toBe(home);
  });
});

test("SSH filesystem paths expand ~ with the remote shell's home", async () => {
  await fixture(async (root, workspace) => {
    const remoteHome = join(root, "remote home");
    await mkdir(join(remoteHome, "projects"), { recursive: true });
    const files = createFileHandlers({
      herdr: {
        call: async () => ({
          workspace: { workspace_id: "w1", label: "Workspace", cwd: workspace },
        }),
      } as unknown as HerdrClient,
      sshHost: () => "fixture",
      shQuote,
      // Execute the generated command locally with a distinct $HOME, standing
      // in for the SSH host, so expansion cannot come from the bridge.
      runProcessWithCodeTimeout: (argv) =>
        runProcessWithCode([
          "env",
          `HOME=${remoteHome}`,
          "bash",
          "-c",
          argv.at(-1)!,
        ]),
    });
    const list = await files.listWorkspaceFiles({
      workspace_id: "w1",
      scope: "filesystem",
      path: "~",
    });
    expect(list.root).toBe(remoteHome);
    expect(list.entries.map((entry) => entry.path)).toEqual([
      join(remoteHome, "projects"),
    ]);
    const created = await files.createWorkspaceEntry({
      workspace_id: "w1",
      path: "~/projects/plan.md",
      kind: "file",
      scope: "filesystem",
    });
    expect(created.path).toBe(join(remoteHome, "projects", "plan.md"));
    expect(await readFile(created.path, "utf8")).toBe("");
    const deleted = await files.deleteWorkspaceFile({
      workspace_id: "w1",
      path: "~/projects/plan.md",
      scope: "filesystem",
    });
    expect(deleted).toMatchObject({ type: "file" });
    await expect(
      files.deleteWorkspaceFile({
        workspace_id: "w1",
        path: "~",
        scope: "filesystem",
      }),
    ).rejects.toThrow();
  });
});

// Keep the two shell integrations on independent test deadlines.
test.each(["quoted external directories", "filesystem root"])(
  "SSH directory listings support %s",
  async (target) => {
    await fixture(async (_root, _workspace, refs) => {
      const path = target === "filesystem root" ? "/" : refs;
      const list = await listRemoteFiles({
        host: "fixture",
        rootPath: path,
        relativePath: "",
        showHidden: false,
        shQuote,
        // Execute only the generated command locally, as an SSH host fixture.
        runProcessWithCodeTimeout: (argv) =>
          runProcessWithCode(["bash", "-c", argv.at(-1)!]),
      });
      expect(list.root).toBe(path);
      if (path === refs)
        expect(list.entries.map((e) => e.name)).toEqual(["readme.md"]);
    });
  },
);
