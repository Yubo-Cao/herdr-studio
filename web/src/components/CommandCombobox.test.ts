/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  commandFilter,
  commandPathQuery,
  normalizeSearchText,
} from "./CommandCombobox";

describe("command combobox search helpers", () => {
  test("normalizes punctuation and spacing", () => {
    expect(normalizeSearchText("Open-Diff_Viewer:/Repo")).toBe(
      "open diff viewer repo",
    );
  });

  test("uses keywords to rank synonym searches", () => {
    const workspaceScore = commandFilter(
      "Create workspace Open a new Herdr workspace",
      "new workspace",
      ["new workspace", "add workspace"],
    );
    const tabScore = commandFilter("Create tab current repo", "new workspace", [
      "new tab",
    ]);
    expect(workspaceScore).toBeGreaterThan(tabScore);
    expect(workspaceScore).toBeGreaterThan(0);
  });

  test("detects direct file path queries without treating words as paths", () => {
    expect(commandPathQuery("docs/guides/runtime.md")).toBe(
      "docs/guides/runtime.md",
    );
    expect(commandPathQuery("./README.md")).toBe("README.md");
    expect(commandPathQuery("new workspace")).toBe("");
    expect(commandPathQuery("README")).toBe("");
  });
});
