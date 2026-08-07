import { describe, expect, test } from "bun:test";
import { shQuote } from "../utils/process-utils";
import { syncWorkspaceBranch } from "./auto-sync";

type Result = { code: number; stdout: string; stderr: string };

function runner(results: Result[], commands: string[]) {
  return async (argv: string[]) => {
    commands.push(argv.at(-1) ?? "");
    const result = results.shift();
    if (!result) throw new Error("unexpected process call");
    return result;
  };
}

describe("workspace branch auto-sync", () => {
  test("skips a workspace with uncommitted changes", async () => {
    const commands: string[] = [];
    const result = await syncWorkspaceBranch({
      root: "/repo",
      shQuote,
      runProcessWithCodeTimeout: runner(
        [
          { code: 0, stdout: "true\n", stderr: "" },
          { code: 0, stdout: "feature/test\n", stderr: "" },
          { code: 0, stdout: " M src/index.ts\n", stderr: "" },
        ],
        commands,
      ),
    });

    expect(result).toEqual({
      last_status: "skipped",
      last_message: "Skipped because the workspace has uncommitted changes.",
      last_branch: "feature/test",
    });
    expect(commands).toHaveLength(3);
    expect(commands[2]).toContain("status --porcelain=v1");
  });

  test("fetches and merges origin main into a clean branch", async () => {
    const commands: string[] = [];
    const result = await syncWorkspaceBranch({
      root: "/repo",
      shQuote,
      runProcessWithCodeTimeout: runner(
        [
          { code: 0, stdout: "true\n", stderr: "" },
          { code: 0, stdout: "feature/test\n", stderr: "" },
          { code: 0, stdout: "", stderr: "" },
          { code: 0, stdout: "before\n", stderr: "" },
          { code: 0, stdout: "", stderr: "" },
          { code: 0, stdout: "feature/test\n", stderr: "" },
          { code: 0, stdout: "", stderr: "" },
          { code: 0, stdout: "before\n", stderr: "" },
          { code: 0, stdout: "Merge made by the ort strategy.\n", stderr: "" },
          { code: 0, stdout: "after\n", stderr: "" },
        ],
        commands,
      ),
    });

    expect(result).toEqual({
      last_status: "updated",
      last_message: "Merged origin/main into feature/test.",
      last_branch: "feature/test",
    });
    expect(commands[4]).toContain("fetch origin main");
    expect(commands[8]).toContain(
      "-c commit.gpgsign=false merge --no-edit --no-stat FETCH_HEAD",
    );
  });

  test("aborts a conflicting merge", async () => {
    const commands: string[] = [];
    const result = await syncWorkspaceBranch({
      root: "/repo",
      shQuote,
      runProcessWithCodeTimeout: runner(
        [
          { code: 0, stdout: "true\n", stderr: "" },
          { code: 0, stdout: "feature/test\n", stderr: "" },
          { code: 0, stdout: "", stderr: "" },
          { code: 0, stdout: "before\n", stderr: "" },
          { code: 0, stdout: "", stderr: "" },
          { code: 0, stdout: "feature/test\n", stderr: "" },
          { code: 0, stdout: "", stderr: "" },
          { code: 0, stdout: "before\n", stderr: "" },
          { code: 1, stdout: "", stderr: "CONFLICT (content): conflict\n" },
          { code: 0, stdout: "", stderr: "" },
        ],
        commands,
      ),
    });

    expect(result).toMatchObject({
      last_status: "failed",
      last_message: "CONFLICT (content): conflict",
      last_branch: "feature/test",
    });
    expect(commands.at(-1)).toContain("merge --abort");
  });

  test("reports a workspace that is no longer a Git repository", async () => {
    const result = await syncWorkspaceBranch({
      root: "/repo",
      shQuote,
      runProcessWithCodeTimeout: runner(
        [
          {
            code: 128,
            stdout: "",
            stderr: "fatal: not a git repository\n",
          },
        ],
        [],
      ),
    });

    expect(result).toEqual({
      last_status: "failed",
      last_message: "fatal: not a git repository",
    });
  });

  test("does not merge if the checkout changes during fetch", async () => {
    const commands: string[] = [];
    const result = await syncWorkspaceBranch({
      root: "/repo",
      shQuote,
      runProcessWithCodeTimeout: runner(
        [
          { code: 0, stdout: "true\n", stderr: "" },
          { code: 0, stdout: "feature/test\n", stderr: "" },
          { code: 0, stdout: "", stderr: "" },
          { code: 0, stdout: "before\n", stderr: "" },
          { code: 0, stdout: "", stderr: "" },
          { code: 0, stdout: "feature/other\n", stderr: "" },
          { code: 0, stdout: "", stderr: "" },
          { code: 0, stdout: "after\n", stderr: "" },
        ],
        commands,
      ),
    });

    expect(result).toEqual({
      last_status: "skipped",
      last_message:
        "Skipped because the workspace changed while origin/main was being fetched.",
      last_branch: "feature/other",
    });
    expect(commands.some((command) => command.includes(" merge "))).toBe(false);
  });
});
