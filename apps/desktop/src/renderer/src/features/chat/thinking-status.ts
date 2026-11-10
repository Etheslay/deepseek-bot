/**
 * "Thinking" status copy driven by real turn progress.
 *
 * The host mirrors the live harness session events into `chat.status`
 * (receipt → thinking, tool/call → tool with the tool's name, tool/result →
 * back to thinking), and the renderer polls it while a reply is pending. The
 * copy therefore only ever describes stages the harness actually reported —
 * no clock-driven filler and no activity the model did not perform.
 *
 * The elapsed seconds are returned separately from the sentence: the visible
 * text sits outside the `aria-live` region, and the seconds tick every second,
 * so folding them into an announced node would make screen readers repeat.
 */

import { t } from "../../i18n.js";

export type ThinkingStatus = {
  readonly text: string;
  readonly hint: string | null;
};

/** Live turn stages as reported by `chat.status` (real harness events only). */
export type ChatTurnStage = "preparing" | "thinking" | "tool";

export type ThinkingStatusInput = {
  /** Current stage from the host's progress mirror. */
  stage: ChatTurnStage;
  /** Tool name while a `tool/call` is in flight. */
  toolName?: string;
  /** How long the placeholder has been on screen. */
  elapsedMs: number;
  /** First reply chunk arrived: the bubble switches to the real text. */
  hasText: boolean;
  /** This turn is waiting on a Word/PDF body the Host is extracting. */
  readingFile?: boolean;
  /** The user asked for a Word file, or edit_document is the turn's tool. */
  makingDocument?: boolean;
  /** The user asked to turn a file into a PDF. */
  convertingToPdf?: boolean;
  /** The user asked for a deck, or write_presentation is the turn's tool. */
  makingPresentation?: boolean;
};

/** Seconds become visible only once the wait is long enough to feel stuck. */
export const ELAPSED_HINT_AFTER_MS = 10_000;

export function formatElapsed(ms: number): string {
  return `${Math.floor(Math.max(0, ms) / 1000)}s`;
}

/**
 * Null once the reply starts arriving; otherwise the copy for the reported
 * stage plus an optional elapsed-seconds hint.
 */
export function thinkingStatus(input: ThinkingStatusInput): ThinkingStatus | null {
  if (input.hasText) {
    return null;
  }
  const hint =
    input.elapsedMs >= ELAPSED_HINT_AFTER_MS ? formatElapsed(input.elapsedMs) : null;
  const editingDocument =
    input.makingDocument === true || input.toolName === "edit_document";
  const presentation =
    input.makingPresentation === true || input.toolName === "write_presentation";
  const namedTool =
    input.stage === "tool" &&
    input.toolName !== undefined &&
    input.toolName.length > 0 &&
    input.toolName !== "edit_document" &&
    input.toolName !== "write_presentation";
  const text = namedTool
    ? t("chat.thinkTool", [input.toolName ?? ""])
    : input.convertingToPdf
      ? t("chat.thinkConvertingPdf")
      : editingDocument
        ? t("chat.thinkMakingDocument")
        : presentation
          ? t("chat.thinkMakingPresentation")
          : input.readingFile
            ? t("chat.thinkReadingFile")
            : input.stage === "preparing"
              ? t("chat.thinkPreparing")
              : t("chat.thinkReasoning");
  return { text, hint };
}
