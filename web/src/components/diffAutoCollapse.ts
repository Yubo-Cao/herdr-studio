import { t } from "../i18n";
import type { GitDiffEntry, GitDiffFile } from "../types";

export const LARGE_DIFF_CHANGED_LINES = 1000;

export type DiffAutoCollapseInfo = {
  reason: "generated" | "large" | "truncated";
  label: string;
};

export function diffChangedLineCount(entry: GitDiffEntry) {
  return (entry.additions ?? 0) + (entry.deletions ?? 0);
}

export function diffAutoCollapseInfo(
  entry: GitDiffEntry,
  file?: GitDiffFile | null,
): DiffAutoCollapseInfo | null {
  if (entry.generated) {
    return { reason: "generated", label: t("generated file") };
  }
  if (file?.truncated) {
    return { reason: "truncated", label: t("large diff") };
  }
  const changedLines = diffChangedLineCount(entry);
  if (changedLines >= LARGE_DIFF_CHANGED_LINES) {
    return {
      reason: "large",
      label: t("{count} changed lines", {
        count: changedLines.toLocaleString("en-US"),
      }),
    };
  }
  return null;
}
