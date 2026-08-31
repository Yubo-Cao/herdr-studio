import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shQuote } from "../utils/process-utils";
import {
  deleteRemoteFile,
  downloadRemoteFile,
  listRemoteFiles,
  parseRemoteFileDelete,
  parseRemoteFileDownload,
  parseRemoteFileList,
  parseRemoteFilePreview,
  parseRemoteFileResolutions,
  parseRemoteFileUpload,
  readRemoteFile,
  resolveRemoteFilePaths,
  uploadRemoteFile,
} from "./remote-files";

function b64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function runShellCommand(command: string, input = "") {
  const proc = Bun.spawn(["bash", "-lc", command], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(input);
  proc.stdin.end();
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "herdr-gui-remote-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("remote file protocol parsers", () => {
  test("filters ignored files and follows explicit symlinks remotely", async () => {
    await withTempDir(async (root) => {
      const outside = await mkdtemp(join(tmpdir(), "herdr-gui-outside-"));
      try {
        await Bun.spawn(["git", "init", "-q", root]).exited;
        await writeFile(join(root, ".gitignore"), "*.tmp\n!keep.tmp\n");
        await writeFile(join(root, "ignored.tmp"), "ignored");
        await writeFile(join(root, "keep.tmp"), "keep");
        await writeFile(join(root, "tracked.tmp"), "tracked");
        expect(
          await Bun.spawn(["git", "-C", root, "add", "-f", "tracked.tmp"])
            .exited,
        ).toBe(0);
        await mkdir(join(root, "target"));
        await writeFile(join(root, "target", "child.txt"), "child");
        await mkdir(join(outside, "shared"));
        await writeFile(join(outside, "shared", "outside-child.txt"), "child");
        await writeFile(join(outside, "outside.txt"), "outside");
        await symlink("target", join(root, "link-dir"));
        await symlink(join(outside, "shared"), join(root, "external-link"));
        await symlink(
          join(outside, "outside.txt"),
          join(root, "external-file"),
        );
        await symlink("missing", join(root, "broken-link"));
        let sshCalls = 0;
        const list = await listRemoteFiles({
          host: "example.test",
          rootPath: root,
          relativePath: "",
          showHidden: false,
          runProcessWithCodeTimeout: async (argv) => {
            sshCalls += 1;
            return runShellCommand(argv.at(-1) ?? "");
          },
          shQuote,
        });

        expect(sshCalls).toBe(1);
        expect(list.entries.some((entry) => entry.name === "ignored.tmp")).toBe(
          false,
        );
        expect(list.entries.some((entry) => entry.name === "keep.tmp")).toBe(
          true,
        );
        expect(list.entries.some((entry) => entry.name === "tracked.tmp")).toBe(
          true,
        );
        expect(
          list.entries.find((entry) => entry.name === "link-dir"),
        ).toMatchObject({
          type: "symlink",
          symlink_status: "internal",
          symlink_target_type: "directory",
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

        const linked = await listRemoteFiles({
          host: "example.test",
          rootPath: root,
          relativePath: "link-dir",
          showHidden: false,
          runProcessWithCodeTimeout: async (argv) =>
            runShellCommand(argv.at(-1) ?? ""),
          shQuote,
        });
        expect(linked.entries.map((entry) => entry.name)).toEqual([
          "child.txt",
        ]);
        const runProcessWithCodeTimeout = async (argv: string[]) =>
          runShellCommand(argv.at(-1) ?? "");
        await expect(
          listRemoteFiles({
            host: "example.test",
            rootPath: root,
            relativePath: "external-link",
            showHidden: false,
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).resolves.toMatchObject({
          path: "external-link",
          entries: [{ name: "outside-child.txt" }],
        });
        await expect(
          readRemoteFile({
            host: "example.test",
            rootPath: root,
            requestedPath: "external-file",
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).resolves.toMatchObject({ path: "external-file", text: "outside" });
        await expect(
          resolveRemoteFilePaths({
            host: "example.test",
            rootPath: root,
            requestedPaths: ["external-file"],
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).resolves.toEqual(["external-file"]);
        await expect(
          uploadRemoteFile({
            host: "example.test",
            rootPath: root,
            directory: "external-link",
            filename: "uploaded.txt",
            body: Buffer.from("uploaded"),
            shQuote,
            runProcessWithInputTimeoutImpl: async (argv, input) =>
              runShellCommand(argv.at(-1) ?? "", String(input)),
          }),
        ).resolves.toEqual({
          path: "external-link/uploaded.txt",
          size: 8,
          overwritten: false,
        });
        const download = await downloadRemoteFile({
          host: "example.test",
          rootPath: root,
          requestedPath: "external-link/uploaded.txt",
          runProcessWithCodeTimeout,
          shQuote,
        });
        expect(download.path).toBe("external-link/uploaded.txt");
        expect(await new Response(download.body).text()).toBe("uploaded");
        await expect(
          deleteRemoteFile({
            host: "example.test",
            rootPath: root,
            requestedPath: "external-link/uploaded.txt",
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).resolves.toEqual({
          path: "external-link/uploaded.txt",
          type: "file",
        });
        expect(
          await Bun.file(join(outside, "shared", "uploaded.txt")).exists(),
        ).toBe(false);
        await expect(
          deleteRemoteFile({
            host: "example.test",
            rootPath: root,
            requestedPath: "external-file",
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).resolves.toEqual({ path: "external-file", type: "symlink" });
        expect(await Bun.file(join(outside, "outside.txt")).exists()).toBe(
          true,
        );

        await expect(
          listRemoteFiles({
            host: "example.test",
            rootPath: root,
            relativePath: "..",
            showHidden: false,
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).rejects.toThrow("file explorer path escaped the workspace checkout");
        await expect(
          readRemoteFile({
            host: "example.test",
            rootPath: root,
            requestedPath: "../outside.txt",
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).rejects.toThrow("file explorer path escaped the workspace checkout");
        await expect(
          downloadRemoteFile({
            host: "example.test",
            rootPath: root,
            requestedPath: "../outside.txt",
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).rejects.toThrow("file explorer path escaped the workspace checkout");
        await expect(
          uploadRemoteFile({
            host: "example.test",
            rootPath: root,
            directory: "..",
            filename: "outside.txt",
            body: Buffer.from("outside"),
            shQuote,
            runProcessWithInputTimeoutImpl: async (argv, input) =>
              runShellCommand(argv.at(-1) ?? "", String(input)),
          }),
        ).rejects.toThrow("file explorer path escaped the workspace checkout");
        await expect(
          deleteRemoteFile({
            host: "example.test",
            rootPath: root,
            requestedPath: "../outside.txt",
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).rejects.toThrow("file explorer path escaped the workspace checkout");
        await expect(
          resolveRemoteFilePaths({
            host: "example.test",
            rootPath: root,
            requestedPaths: ["../outside.txt"],
            runProcessWithCodeTimeout,
            shQuote,
          }),
        ).resolves.toEqual([]);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  test("parses remote directory listings", () => {
    const result = parseRemoteFileList(
      [
        `ROOT\t${b64("/repo")}`,
        `ENTRY\tfile\t12\t2\t${b64("b.txt")}`,
        `ENTRY\tdirectory\t0\t1\t${b64("src")}`,
        "TRUNCATED",
      ].join("\n"),
      "packages/app",
    );

    expect(result).toEqual({
      root: "/repo",
      path: "packages/app",
      truncated: true,
      entries: [
        {
          name: "src",
          path: "packages/app/src",
          type: "directory",
          size: 0,
          mtime_ms: 1000,
          hidden: false,
        },
        {
          name: "b.txt",
          path: "packages/app/b.txt",
          type: "file",
          size: 12,
          mtime_ms: 2000,
          hidden: false,
        },
      ],
    });
  });

  test("parses text and image previews", () => {
    const text = parseRemoteFilePreview(
      `META\t${b64("/repo")}\t5\t9\t${b64("README.md")}\n${b64("hello")}`,
      "README.md",
    );
    expect(text).toMatchObject({
      root: "/repo",
      path: "README.md",
      text: "hello",
      binary: false,
      size: 5,
      mtime_ms: 9000,
      truncated: false,
    });

    const image = parseRemoteFilePreview(
      `META\t${b64("/repo")}\t3\t1\t${b64("image.png")}\n${b64("png")}`,
      "image.png",
    );
    expect(image).toMatchObject({
      path: "image.png",
      binary: true,
      mime_type: "image/png",
      image_data_url: "data:image/png;base64,cG5n",
    });
  });

  test("parses resolved remote files", () => {
    expect(
      parseRemoteFileResolutions(
        [`FILE\t${b64("a/b/c.png")}`, `FILE\t${b64("/tmp/image.png")}`].join(
          "\n",
        ),
      ),
    ).toEqual(["a/b/c.png", "/tmp/image.png"]);
  });

  test("parses download, upload, and delete responses", () => {
    expect(
      parseRemoteFileDownload(
        `META\t4\t${b64("dir/a.txt")}\t${b64("a.txt")}\t${b64("text/plain")}\n${b64("data")}`,
        "dir/a.txt",
      ),
    ).toMatchObject({
      filename: "a.txt",
      path: "dir/a.txt",
      size: 4,
      contentType: "text/plain",
    });
    expect(parseRemoteFileUpload(`META\t${b64("dir/a.txt")}\t4\t1`)).toEqual({
      path: "dir/a.txt",
      size: 4,
      overwritten: true,
    });
    expect(parseRemoteFileDelete(`META\t${b64("dir")}\tdirectory`)).toEqual({
      path: "dir",
      type: "directory",
    });
  });

  test("rejects malformed remote protocol responses", () => {
    expect(() => parseRemoteFilePreview("oops", "x")).toThrow("oops");
    expect(() => parseRemoteFileDownload("oops", "x")).toThrow("oops");
    expect(() => parseRemoteFileUpload("oops")).toThrow("oops");
    expect(() => parseRemoteFileDelete("oops")).toThrow("oops");
  });
});
