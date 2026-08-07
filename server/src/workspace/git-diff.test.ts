import { describe, expect, test } from "bun:test";
import {
  parseBranchSummary,
  parseStatusSummary,
  statusLabel,
} from "./git-diff";

describe("git diff summary parsing", () => {
  test("labels git statuses", () => {
    expect(statusLabel("A", "staged")).toBe("added");
    expect(statusLabel("D", "unstaged")).toBe("deleted");
    expect(statusLabel("M", "branch")).toBe("modified");
    expect(statusLabel("M", "untracked")).toBe("untracked");
    expect(statusLabel("M", "conflicted")).toBe("conflicted");
  });

  test("parses working tree porcelain status", () => {
    const entries = parseStatusSummary(
      [
        " M src/changed.ts",
        "A  src/staged.ts",
        "?? src/new.ts",
        "UU src/conflict.ts",
        "R  src/old.ts -> src/renamed.ts",
      ].join("\n"),
    );

    expect(entries).toEqual([
      {
        path: "src/changed.ts",
        kind: "unstaged",
        status: "modified",
      },
      {
        path: "src/conflict.ts",
        kind: "conflicted",
        status: "conflicted",
      },
      {
        path: "src/new.ts",
        kind: "untracked",
        status: "untracked",
      },
      {
        path: "src/renamed.ts",
        old_path: "src/old.ts",
        kind: "staged",
        status: "renamed",
      },
      {
        path: "src/staged.ts",
        kind: "staged",
        status: "added",
      },
    ]);
  });

  test("parses branch name-status output", () => {
    expect(parseBranchSummary("M\tapp.ts\nR100\told.ts\tnew.ts\n")).toEqual([
      {
        path: "app.ts",
        old_path: undefined,
        kind: "branch",
        status: "modified",
      },
      {
        path: "new.ts",
        old_path: "old.ts",
        kind: "branch",
        status: "renamed",
      },
    ]);
  });
});
