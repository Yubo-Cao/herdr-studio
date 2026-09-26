import { t } from "./i18n";
import type { GitDiffEntry } from "./types";

export type GitFileAction =
  | "stage"
  | "unstage"
  | "discard_unstaged"
  | "delete_untracked";

export type GitRepoAction =
  | "stage_all"
  | "unstage_all"
  | "discard_all_unstaged"
  | "delete_all_untracked";

export type GitFileMenuItem = {
  action: GitFileAction;
  label: string;
  danger?: boolean;
  destructive?: boolean;
};

export type GitRepoMenuItem = {
  action: GitRepoAction;
  label: string;
  count: number;
  danger?: boolean;
  destructive?: boolean;
};

export type GitWorkingCounts = {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
};

// Builds the Git menu for one changed file from every summary entry sharing
// its path, so combined states (staged + unstaged) get the matching actions.
// `plural` rewords labels for folder menus acting on many files at once.
export function buildGitFileMenuItems(
  entries: Pick<GitDiffEntry, "kind">[],
  plural = false,
): GitFileMenuItem[] {
  const kinds = new Set(entries.map((entry) => entry.kind));
  const items: GitFileMenuItem[] = [];
  if (kinds.has("untracked")) {
    items.push({
      action: "stage",
      label: plural ? t("Stage files") : t("Stage file"),
    });
  } else if (kinds.has("conflicted")) {
    items.push({
      action: "stage",
      label: plural ? t("Mark all resolved") : t("Mark resolved"),
    });
  } else if (kinds.has("unstaged")) {
    items.push({
      action: "stage",
      label: plural ? t("Stage all changes") : t("Stage changes"),
    });
  }
  if (kinds.has("staged")) {
    items.push({
      action: "unstage",
      label: plural ? t("Unstage all changes") : t("Unstage changes"),
    });
  }
  if (kinds.has("unstaged")) {
    items.push({
      action: "discard_unstaged",
      label: plural
        ? t("Discard all unstaged changes…")
        : t("Discard unstaged changes…"),
      danger: true,
      destructive: true,
    });
  }
  if (kinds.has("untracked")) {
    items.push({
      action: "delete_untracked",
      label: plural
        ? t("Delete untracked files…")
        : t("Delete untracked file…"),
      danger: true,
      destructive: true,
    });
  }
  return items;
}

export function countWorkingEntries(entries: GitDiffEntry[]): GitWorkingCounts {
  const counts: GitWorkingCounts = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };
  for (const entry of entries) {
    if (
      entry.kind === "staged" ||
      entry.kind === "unstaged" ||
      entry.kind === "untracked" ||
      entry.kind === "conflicted"
    ) {
      counts[entry.kind] += 1;
    }
  }
  return counts;
}

export function buildGitRepoMenuItems(
  counts: GitWorkingCounts,
): GitRepoMenuItem[] {
  return [
    {
      action: "stage_all",
      label: t("Stage All Changes"),
      count: counts.unstaged + counts.untracked + counts.conflicted,
    },
    {
      action: "unstage_all",
      label: t("Unstage All Changes"),
      count: counts.staged,
    },
    {
      action: "discard_all_unstaged",
      label: t("Discard All Unstaged Changes…"),
      count: counts.unstaged,
      danger: true,
      destructive: true,
    },
    {
      action: "delete_all_untracked",
      label: t("Delete All Untracked Files…"),
      count: counts.untracked,
      danger: true,
      destructive: true,
    },
  ];
}

export function gitFileActionSuccessMessage(action: GitFileAction) {
  switch (action) {
    case "stage":
      return t("File staged");
    case "unstage":
      return t("Changes unstaged");
    case "discard_unstaged":
      return t("Unstaged changes discarded");
    case "delete_untracked":
      return t("Untracked file deleted");
  }
}

export function gitRepoActionSuccessMessage(action: GitRepoAction) {
  switch (action) {
    case "stage_all":
      return t("All changes staged");
    case "unstage_all":
      return t("All changes unstaged");
    case "discard_all_unstaged":
      return t("All unstaged changes discarded");
    case "delete_all_untracked":
      return t("All untracked files deleted");
  }
}

export function gitFileActionLabel(action: GitFileAction) {
  switch (action) {
    case "stage":
      return t("Stage");
    case "unstage":
      return t("Unstage");
    case "discard_unstaged":
      return t("Discard unstaged changes");
    case "delete_untracked":
      return t("Delete untracked file");
  }
}

export function gitFileConfirmCopy(action: GitFileAction, path: string) {
  switch (action) {
    case "discard_unstaged":
      return {
        title: t("Discard Changes"),
        message: t(
          'Discard unstaged changes to "{path}"? Any staged version is kept. This cannot be undone.',
          { path },
        ),
        confirmLabel: t("Discard"),
      };
    case "delete_untracked":
      return {
        title: t("Delete Untracked File"),
        message: t('Delete untracked file "{path}"? This cannot be undone.', {
          path,
        }),
        confirmLabel: t("Delete"),
      };
    default:
      return null;
  }
}

export function gitFolderConfirmCopy(
  action: GitFileAction,
  path: string,
  count: number,
) {
  switch (action) {
    case "discard_unstaged":
      return {
        title: t("Discard Changes"),
        message:
          count === 1
            ? t(
                'Discard unstaged changes in 1 file under "{path}"? Any staged versions are kept. This cannot be undone.',
                { path },
              )
            : t(
                'Discard unstaged changes in {count} files under "{path}"? Any staged versions are kept. This cannot be undone.',
                { count, path },
              ),
        confirmLabel: t("Discard"),
      };
    case "delete_untracked":
      return {
        title: t("Delete Untracked Files"),
        message:
          count === 1
            ? t(
                'Delete 1 file under "{path}" not tracked by Git? Ignored files are kept. This cannot be undone.',
                { path },
              )
            : t(
                'Delete {count} files under "{path}" not tracked by Git? Ignored files are kept. This cannot be undone.',
                { count, path },
              ),
        confirmLabel: t("Delete"),
      };
    default:
      return null;
  }
}

export function gitRepoConfirmCopy(action: GitRepoAction, count: number) {
  switch (action) {
    case "discard_all_unstaged":
      return {
        title: t("Discard All Unstaged Changes"),
        message:
          count === 1
            ? t(
                "Discard unstaged changes in 1 file? Staged changes are kept. This cannot be undone.",
              )
            : t(
                "Discard unstaged changes in {count} files? Staged changes are kept. This cannot be undone.",
                { count },
              ),
        confirmLabel: t("Discard All"),
      };
    case "delete_all_untracked":
      return {
        title: t("Delete All Untracked Files"),
        message:
          count === 1
            ? t(
                "Delete 1 file not tracked by Git? Ignored files are kept. This cannot be undone.",
              )
            : t(
                "Delete {count} files not tracked by Git? Ignored files are kept. This cannot be undone.",
                { count },
              ),
        confirmLabel: t("Delete All"),
      };
    default:
      return null;
  }
}
