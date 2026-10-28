/**
 * Copy a rendered code block to the clipboard (chat code-block toolbar).
 *
 * The chat markdown is injected as sanitized innerHTML, so the button cannot own
 * a React handler: ChatMarkdown delegates clicks here instead. The text is read
 * from the block's own <code> element, which keeps the clipboard in step with
 * what the user sees — no duplicated payload that could drift from the render.
 */
import { t } from "../../i18n.js";

const FEEDBACK_MS = 1_400;
const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/** Write text, falling back to the legacy path when the async API is denied. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path below */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("aria-hidden", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Briefly relabel the button so the click has an observable result. */
function feedback(button: HTMLButtonElement, ok: boolean): void {
  const previous = timers.get(button);
  if (previous !== undefined) {
    clearTimeout(previous);
  }
  if (button.dataset.idleLabel === undefined) {
    /* remember the label the renderer produced, in the current language */
    button.dataset.idleLabel = button.textContent ?? "";
  }
  button.textContent = ok ? t("chat.copiedCode") : t("chat.copyCodeFailed");
  button.classList.toggle("copied", ok);
  button.classList.toggle("failed", !ok);
  timers.set(
    button,
    setTimeout(() => {
      button.textContent = button.dataset.idleLabel ?? t("chat.copyCode");
      button.classList.remove("copied", "failed");
      timers.delete(button);
    }, FEEDBACK_MS),
  );
}

/**
 * Copy the block that owns `button`. Returns whether the clipboard accepted the
 * text; the button always shows the outcome.
 */
export async function copyCodeBlock(button: HTMLElement): Promise<boolean> {
  const code = button.closest(".md-code")?.querySelector("code") ?? null;
  if (code === null || !(button instanceof HTMLButtonElement)) {
    return false;
  }
  const ok = await writeClipboard(code.textContent ?? "");
  feedback(button, ok);
  return ok;
}
