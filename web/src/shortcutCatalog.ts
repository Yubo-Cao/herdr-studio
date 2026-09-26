import { msg, t } from "./i18n";
import { SHORTCUT_NUMBERS, type ShortcutId } from "./shortcutBindings";
// Labels and groups are English source text marked with msg(); render them
// with shortcutDescriptionLabel() and t(group).
export type ShortcutDescription = {
  id: ShortcutId;
  label: string;
  group: string;
  values?: Record<string, number>;
};
type Description = [ShortcutId, string, string, Record<string, number>?];
const descriptions: Description[] = [
  ["command.menu", msg("Open or close the command menu"), msg("Global")],
  ["sidebar.toggle", msg("Toggle the desktop sidebar"), msg("Global")],
  ["inspector.toggle", msg("Toggle the Workspace Inspector"), msg("Global")],
  [
    "inspector.expand",
    msg("Expand or restore the Inspector on desktop"),
    msg("Global"),
  ],
  ["annotations.toggle", msg("Toggle Annotations"), msg("Global")],
  ["zen.toggle", msg("Toggle Zen mode on desktop"), msg("Global")],
  ["panes.recent", msg("Open the recent pane switcher"), msg("Global")],
  [
    "plugin.herdrFloat.toggle",
    msg("Toggle the Herdr Float popup shell"),
    msg("Global"),
  ],
  ["panes.search", msg("Search panes in the pane switcher"), msg("Global")],
  ["workspaces.open", msg("Open Workspaces"), msg("Global")],
  ["files.toggle", msg("Toggle File Explorer"), msg("Global")],
  ["diff.toggle", msg("Toggle Diff Viewer"), msg("Global")],
  ["tab.create", msg("Create a tab"), msg("Tabs & panes")],
  [
    "tab.close",
    msg("Close the active pane or its single-pane tab"),
    msg("Tabs & panes"),
  ],
  ["tab.previous", msg("Switch to the previous tab"), msg("Tabs & panes")],
  ["tab.next", msg("Switch to the next tab"), msg("Tabs & panes")],
  ["pane.left", msg("Focus the pane to the left"), msg("Tabs & panes")],
  ["pane.right", msg("Focus the pane to the right"), msg("Tabs & panes")],
  ["pane.up", msg("Focus the pane above"), msg("Tabs & panes")],
  ["pane.down", msg("Focus the pane below"), msg("Tabs & panes")],
  ["pane.splitRight", msg("Split the active pane right"), msg("Tabs & panes")],
  ["pane.splitDown", msg("Split the active pane down"), msg("Tabs & panes")],
  ["pane.zoom", msg("Zoom or restore the active pane"), msg("Tabs & panes")],
  ...SHORTCUT_NUMBERS.map(
    (number): Description => [
      `tab.${number}`,
      msg("Switch to tab {number}"),
      msg("Tabs & panes"),
      { number },
    ],
  ),
  ...SHORTCUT_NUMBERS.map(
    (number): Description => [
      `command.${number}`,
      msg("Run numbered action {number} in the command menu"),
      msg("Command menu"),
      { number },
    ],
  ),
  ["terminal.history", msg("Toggle agent message history"), msg("Terminal")],
  [
    "terminal.pageUp",
    msg("Page up in the application or shell history"),
    msg("Terminal"),
  ],
  [
    "terminal.pageDown",
    msg("Page down in the application or shell history"),
    msg("Terminal"),
  ],
  [
    "terminal.halfPageUp",
    msg("Scroll history up half a page"),
    msg("Terminal"),
  ],
  [
    "terminal.halfPageDown",
    msg("Scroll history down half a page"),
    msg("Terminal"),
  ],
  [
    "terminal.multiline",
    msg("Send multiline Enter to the agent"),
    msg("Terminal"),
  ],
  [
    "terminal.altEnter",
    msg("Send Alt-modified Enter to the agent"),
    msg("Terminal"),
  ],
  [
    "terminal.ctrlEnter",
    msg("Send Ctrl-modified Enter to the agent"),
    msg("Terminal"),
  ],
  [
    "terminal.lineStart",
    msg("Move to the beginning of the input line"),
    msg("Terminal"),
  ],
  [
    "terminal.lineEnd",
    msg("Move to the end of the input line"),
    msg("Terminal"),
  ],
  [
    "terminal.deleteToStart",
    msg("Delete to the beginning of the input line"),
    msg("Terminal"),
  ],
  ["terminal.copy", msg("Copy selected terminal text"), msg("Terminal")],
  ["terminal.paste", msg("Paste text or images"), msg("Terminal")],
  [
    "terminal.link",
    msg("Open links or preview workspace paths"),
    msg("Terminal"),
  ],
  [
    "composer.send",
    msg("Send the terminal composer draft"),
    msg("Terminal composer"),
  ],
  [
    "voice.pushToTalk",
    msg("Voice typing: hold to talk, tap to start or insert"),
    msg("Terminal"),
  ],
  [
    "preview.search",
    msg("Search the raw file preview or diff"),
    msg("Preview & review"),
  ],
  [
    "preview.selectAll",
    msg("Select all in the file preview"),
    msg("Preview & review"),
  ],
  ["annotation.submit", msg("Add a review comment"), msg("Preview & review")],
  ["annotations.copy", msg("Copy review feedback"), msg("Preview & review")],
  [
    "annotations.prefill",
    msg("Pre-fill agent with review feedback"),
    msg("Preview & review"),
  ],
];
export const SHORTCUT_CATALOG: ShortcutDescription[] = descriptions.map(
  ([id, label, group, values]) => ({ id, label, group, values }),
);

/** The translated action title of a catalog entry. */
export function shortcutDescriptionLabel(item: ShortcutDescription): string {
  return t(item.label, item.values);
}
