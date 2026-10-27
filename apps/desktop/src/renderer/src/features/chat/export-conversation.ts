/**
 * Conversation export (GAP_AUDIT G7): the whole visible thread of one bot as a
 * local Markdown file. Pure-local — the blob goes straight to a download, no
 * host method, no network. Roles, timestamps, quotes, attachment names and
 * choice-card answers are included; system/delivery notices become quote
 * blocks so the file reads like the timeline did.
 */
import { formatFullDateTime, t } from "../../i18n.js";

/** Structural view of a chat message (kept decoupled from App's Msg type). */
export type ExportableMessage = {
  from: "bot" | "user";
  text: string;
  time: number;
  quote?: { name: string; text: string } | null | undefined;
  attachments?: { name: string; kind: string }[] | null | undefined;
  choices?: { question: string; answered?: string | null | undefined } | undefined;
  notice?: { label: string } | null | undefined;
  system?: boolean | undefined;
};

/** Characters Windows filenames reject, plus control chars. */
function safeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "_").trim() || "bot";
}

function fileStamp(at: number): string {
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function buildConversationMarkdown(botName: string, msgs: ExportableMessage[]): string {
  const lines: string[] = [
    `# ${t("shell.exportTitle", [botName])}`,
    "",
    `${t("shell.exportMeta", [formatFullDateTime(new Date().toISOString()), String(msgs.length)])}`,
    "",
    "---",
    "",
  ];
  if (msgs.length === 0) {
    lines.push(`> ${t("shell.sessionEmpty")}`);
  }
  for (const msg of msgs) {
    if (msg.system || msg.notice !== null && msg.notice !== undefined) {
      const label = msg.notice?.label ?? "";
      const body = [label, msg.text].filter((part) => part.length > 0).join(" ");
      lines.push(`> [${t("shell.exportSystemMark")}] ${body}`);
      lines.push("");
      continue;
    }
    const who = msg.from === "user" ? t("shell.me") : botName;
    lines.push(`**${who}** · ${formatFullDateTime(new Date(msg.time).toISOString())}`);
    if (msg.quote !== null && msg.quote !== undefined) {
      lines.push(`> ${t("shell.quotedMessage", [msg.quote.name, msg.quote.text])}`);
    }
    if (msg.choices !== undefined) {
      lines.push(
        msg.choices.answered != null && msg.choices.answered !== ""
          ? `> ${t("shell.exportCardAnswered", [msg.choices.question, msg.choices.answered])}`
          : `> ${t("shell.exportCardOpen", [msg.choices.question])}`,
      );
    }
    lines.push(msg.text);
    for (const file of msg.attachments ?? []) {
      lines.push(`- ${t("shell.exportAttachment", [file.name, file.kind])}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Build the Markdown and hand it to the browser's download path. */
export function exportConversation(botName: string, msgs: ExportableMessage[]): void {
  const blob = new Blob([buildConversationMarkdown(botName, msgs)], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(botName)}-${fileStamp(Date.now())}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
