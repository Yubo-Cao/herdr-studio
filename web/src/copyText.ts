import { t } from "./i18n";
import { store } from "./store";
import { copyTextFromUserGesture } from "./terminalClipboard";

let copySequence = 0;

export async function copyTextWithFeedback(text: string) {
  const sequence = ++copySequence;
  try {
    await copyTextFromUserGesture(text);
    if (sequence !== copySequence) return;
    store.notify({
      kind: "success",
      message: t("Copied to clipboard"),
      autoDismissMs: 3000,
    });
  } catch (error) {
    if (sequence !== copySequence) return;
    store.notify({
      kind: "error",
      message: t("Failed to copy to clipboard"),
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
