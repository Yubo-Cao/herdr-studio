import { describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteLocalFile,
  downloadLocalFile,
  listLocalFiles,
  readLocalFile,
  resolveLocalFilePaths,
  uploadLocalFile,
  writeLocalFile,
} from "./local-files";

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "herdr-gui-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("local workspace file operations", () => {
  test("follows explicit symlinks while rejecting lexical traversal", async () => {
    await withTempDir(async (root) => {
      const outside = await mkdtemp(join(tmpdir(), "herdr-gui-outside-"));
      try {
        await mkdir(join(root, "target-dir"));
        await writeFile(join(root, "target-dir", "child.txt"), "child");
        await writeFile(join(root, "target.txt"), "target");
        await mkdir(join(outside, "shared"));
        await writeFile(join(outside, "shared", "outside-child.txt"), "child");
        await writeFile(join(outside, "outside.txt"), "outside");
        await symlink("target-dir", join(root, "link-dir"));
        await symlink("target.txt", join(root, "link-file"));
        await symlink(join(outside, "shared"), join(root, "external-link"));
        await symlink(
          join(outside, "outside.txt"),
          join(root, "external-file"),
        );
        await symlink("missing", join(root, "broken-link"));

        const list = await listLocalFiles(root, "", false);
        expect(
          list.entries.find((entry) => entry.name === "link-dir"),
        ).toMatchObject({
          type: "symlink",
          symlink_status: "internal",
          symlink_target_type: "directory",
        });
        expect(
          list.entries.find((entry) => entry.name === "link-file"),
        ).toMatchObject({
          type: "symlink",
          symlink_status: "internal",
          symlink_target_type: "file",
        });
        expect(
          list.entries.find((entry) => entry.name === "external-link"),
        ).toMatchObject({
          type: "symlink",
          symlink_status: "external",
          symlink_target_type: "directory",
        });
        expect(
          list.entries.find((entry) => entry.name === "external-file"),
        ).toMatchObject({
          type: "symlink",
          symlink_status: "external",
          symlink_target_type: "file",
        });
        expect(
          list.entries.find((entry) => entry.name === "broken-link"),
        ).toMatchObject({ type: "symlink", symlink_status: "broken" });

        await expect(
          listLocalFiles(root, "link-dir", false),
        ).resolves.toMatchObject({ entries: [{ name: "child.txt" }] });
        await expect(readLocalFile(root, "link-file")).resolves.toMatchObject({
          text: "target",
        });
        await expect(
          listLocalFiles(root, "external-link", false),
        ).resolves.toMatchObject({
          path: "external-link",
          entries: [{ name: "outside-child.txt" }],
        });
        await expect(
          readLocalFile(root, "external-file"),
        ).resolves.toMatchObject({ path: "external-file", text: "outside" });
        await expect(
          resolveLocalFilePaths(root, ["external-file"]),
        ).resolves.toEqual(["external-file"]);

        await expect(
          uploadLocalFile(
            root,
            "external-link",
            "uploaded.txt",
            Buffer.from("uploaded"),
          ),
        ).resolves.toEqual({
          path: "external-link/uploaded.txt",
          size: 8,
          overwritten: false,
        });
        const download = await downloadLocalFile(
          root,
          "external-link/uploaded.txt",
        );
        expect(download.path).toBe("external-link/uploaded.txt");
        expect(await new Response(download.body).text()).toBe("uploaded");
        await expect(
          deleteLocalFile(root, "external-link/uploaded.txt"),
        ).resolves.toEqual({
          path: "external-link/uploaded.txt",
          type: "file",
        });
        expect(
          await Bun.file(join(outside, "shared", "uploaded.txt")).exists(),
        ).toBe(false);
        await expect(deleteLocalFile(root, "external-file")).resolves.toEqual({
          path: "external-file",
          type: "symlink",
        });
        expect(await Bun.file(join(outside, "outside.txt")).exists()).toBe(
          true,
        );
        await expect(
          listLocalFiles(root, "broken-link", false),
        ).rejects.toThrow("file explorer symlink is broken or unavailable");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  test("lists files with hidden filtering and directory-first sorting", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "README.md"), "hello");
      await writeFile(join(root, ".env"), "secret");

      const hiddenOff = await listLocalFiles(root, "", false);
      expect(hiddenOff.entries.map((entry) => entry.name)).toEqual([
        "src",
        "README.md",
      ]);

      const hiddenOn = await listLocalFiles(root, "", true);
      expect(hiddenOn.entries.some((entry) => entry.name === ".env")).toBe(
        true,
      );
    });
  });

  test("reads relative and absolute file previews", async () => {
    await withTempDir(async (root) => {
      const outsideName = `outside-${Date.now()}.txt`;
      const outside = join(root, "..", outsideName);
      await writeFile(join(root, "README.md"), "hello");
      await writeFile(outside, "outside");
      try {
        expect(await readLocalFile(root, "README.md")).toMatchObject({
          path: "README.md",
          text: "hello",
          binary: false,
        });
        const absolute = await readLocalFile(root, outside);
        expect(absolute).toMatchObject({
          text: "outside",
          binary: false,
        });
        expect(absolute.path.endsWith(`/${outsideName}`)).toBe(true);
      } finally {
        await rm(outside, { force: true });
      }
    });
  });

  test("reads directory previews instead of rejecting them", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src", "app"), { recursive: true });
      const relative = await readLocalFile(root, "src/app");
      expect(relative).toMatchObject({
        type: "directory",
        path: "src/app",
        text: null,
        binary: false,
        size: 0,
        truncated: false,
      });
      const absolute = await readLocalFile(root, join(root, "src"));
      expect(absolute.type).toBe("directory");
      expect(absolute.path.endsWith("/src")).toBe(true);
    });
  });

  test("resolves files, directories, and explicit symlinks without relative escapes", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "a", "b"), { recursive: true });
      await writeFile(join(root, "a", "b", "c.png"), "image");
      await symlink(join(root, ".."), join(root, "outside"));
      expect(
        await resolveLocalFilePaths(root, [
          "a/b/c.png",
          "a/b",
          "missing/file.png",
          "../outside.txt",
          "..",
          "outside",
          join(root, "a", "b"),
          join(root, ".."),
        ]),
      ).toEqual([
        "a/b/c.png",
        "a/b",
        "outside",
        join(root, "a", "b"),
        join(root, ".."),
      ]);
    });
  });

  test("uploads, overwrites, downloads, and deletes files", async () => {
    await withTempDir(async (root) => {
      const first = await uploadLocalFile(
        root,
        "",
        "notes.txt",
        Buffer.from("one"),
      );
      expect(first).toEqual({
        path: "notes.txt",
        size: 3,
        overwritten: false,
      });

      const second = await uploadLocalFile(
        root,
        "",
        "notes.txt",
        Buffer.from("two"),
      );
      expect(second.overwritten).toBe(true);

      const download = await downloadLocalFile(root, "notes.txt");
      expect(download).toMatchObject({
        filename: "notes.txt",
        path: "notes.txt",
        size: 3,
        contentType: "application/octet-stream",
      });
      expect(await new Response(download.body).text()).toBe("two");

      expect(await deleteLocalFile(root, "notes.txt")).toEqual({
        path: "notes.txt",
        type: "file",
      });
    });
  });

  test("rejects traversal for local relative operations", async () => {
    await withTempDir(async (root) => {
      await expect(listLocalFiles(root, "..", false)).rejects.toThrow(
        "file explorer path escaped the workspace checkout",
      );
      await expect(
        uploadLocalFile(root, "..", "x", Buffer.from("")),
      ).rejects.toThrow("file explorer path escaped the workspace checkout");
      await expect(readLocalFile(root, "../outside.txt")).rejects.toThrow(
        "file explorer path escaped the workspace checkout",
      );
      await expect(downloadLocalFile(root, "../outside.txt")).rejects.toThrow(
        "file explorer path escaped the workspace checkout",
      );
      await expect(deleteLocalFile(root, "../outside.txt")).rejects.toThrow(
        "file explorer path escaped the workspace checkout",
      );
    });
  });

  test("saves editor content atomically with conflict detection", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src", "app.ts"), "old");
      await chmod(join(root, "src", "app.ts"), 0o640);
      const opened = await readLocalFile(root, "src/app.ts");
      const saved = await writeLocalFile(
        root,
        "src/app.ts",
        Buffer.from("new"),
        {
          expectedMtimeMs: opened.mtime_ms,
        },
      );
      expect(saved).toMatchObject({
        path: "src/app.ts",
        size: 3,
        created: false,
      });
      expect(await readFile(join(root, "src", "app.ts"), "utf8")).toBe("new");
      expect((await stat(join(root, "src", "app.ts"))).mode & 0o777).toBe(
        0o640,
      );
      expect(await readdir(join(root, "src"))).toEqual(["app.ts"]);

      await expect(
        writeLocalFile(root, "src/app.ts", Buffer.from("stale"), {
          expectedMtimeMs: opened.mtime_ms - 60_000,
        }),
      ).rejects.toThrow("file changed on disk");
      await writeLocalFile(root, "src/app.ts", Buffer.from("forced"), {
        expectedMtimeMs: opened.mtime_ms - 60_000,
        force: true,
      });
      expect(await readFile(join(root, "src", "app.ts"), "utf8")).toBe(
        "forced",
      );

      await expect(
        writeLocalFile(root, "src/new.md", Buffer.from("# new")),
      ).resolves.toMatchObject({ path: "src/new.md", created: true });
      await expect(
        writeLocalFile(root, "src/gone.md", Buffer.from("x"), {
          expectedMtimeMs: 1,
        }),
      ).rejects.toThrow("no longer exists");
      await expect(
        writeLocalFile(root, "src", Buffer.from("x")),
      ).rejects.toThrow("only regular files");
      await expect(
        writeLocalFile(root, "missing/file.txt", Buffer.from("x")),
      ).rejects.toThrow();
      await expect(
        writeLocalFile(root, "../escape.txt", Buffer.from("x")),
      ).rejects.toThrow("file explorer path escaped the workspace checkout");
      await expect(
        writeLocalFile(root, join(root, "src", "app.ts"), Buffer.from("x")),
      ).rejects.toThrow("checkout-relative");
    });
  });

  test("saves through symlinks and absolute filesystem paths", async () => {
    await withTempDir(async (root) => {
      const outside = await mkdtemp(join(tmpdir(), "herdr-gui-outside-"));
      try {
        await writeFile(join(outside, "notes.txt"), "outside");
        await symlink(join(outside, "notes.txt"), join(root, "notes-link"));
        await writeLocalFile(root, "notes-link", Buffer.from("linked"));
        expect(await readFile(join(outside, "notes.txt"), "utf8")).toBe(
          "linked",
        );
        expect((await lstat(join(root, "notes-link"))).isSymbolicLink()).toBe(
          true,
        );

        const absolute = join(outside, "notes.txt");
        await expect(
          writeLocalFile(root, absolute, Buffer.from("fs"), { absolute: true }),
        ).resolves.toMatchObject({ path: absolute, size: 2 });
        expect(await readFile(absolute, "utf8")).toBe("fs");
        await expect(
          writeLocalFile(root, "notes-link", Buffer.from("x"), {
            absolute: true,
          }),
        ).rejects.toThrow("absolute path");
        await expect(
          writeLocalFile(root, "big.txt", Buffer.alloc(5 * 1024 * 1024 + 1)),
        ).rejects.toThrow("too large");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });
});
