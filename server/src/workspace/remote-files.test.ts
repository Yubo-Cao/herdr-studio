import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shQuote } from "../utils/process-utils";
import {
  listRemoteFiles,
  parseRemoteFileDelete,
  parseRemoteFileDownload,
  parseRemoteFileList,
  parseRemoteFilePreview,
  parseRemoteFileResolutions,
  parseRemoteFileUpload,
} from "./remote-files";

function b64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function runShellCommand(command: string) {
  const proc = Bun.spawn(["bash", "-lc", command], {
    stdout: "pipe",
    stderr: "pipe",
  });
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
  test("filters ignored files and follows safe directory symlinks remotely", async () => {
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
        await symlink("target", join(root, "link-dir"));
        await symlink(outside, join(root, "external-link"));
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
        ).toMatchObject({ type: "symlink", symlink_status: "external" });
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
        await expect(
          listRemoteFiles({
            host: "example.test",
            rootPath: root,
            relativePath: "external-link",
            showHidden: false,
            runProcessWithCodeTimeout: async (argv) =>
              runShellCommand(argv.at(-1) ?? ""),
            shQuote,
          }),
        ).rejects.toThrow("file explorer path escaped the workspace checkout");
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
