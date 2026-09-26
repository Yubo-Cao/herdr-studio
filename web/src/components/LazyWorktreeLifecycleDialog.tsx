import { type ComponentProps, Suspense } from "react";
import { lazyWithReload } from "../lazyWithReload";
import type { WorktreeLifecycleDialog as Dialog } from "./WorktreeLifecycleDialog";

// The lifecycle dialog is only needed once a user opens it; keep it out of
// the initial bundle that phones download on slow links.
const WorktreeLifecycleDialog = lazyWithReload("worktree-lifecycle", () =>
  import("./WorktreeLifecycleDialog").then((module) => ({
    default: module.WorktreeLifecycleDialog,
  })),
);

export function LazyWorktreeLifecycleDialog(
  props: ComponentProps<typeof Dialog>,
) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <WorktreeLifecycleDialog {...props} />
    </Suspense>
  );
}
