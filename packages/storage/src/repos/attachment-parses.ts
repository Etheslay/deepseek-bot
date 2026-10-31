/**
 * Attachment body parse cache (B4' 附件正文解析). One row per committed
 * binary attachment: the Host extracts the body after `attachment.commit`
 * lands the file in the workspace and the chat.send assembly reads it back.
 * A `parse_failed` row is a first-class result — "why no body is available"
 * is recorded, never guessed — and `source_checksum` ties the cache to the
 * exact committed bytes.
 */
import type { OpenedDatabase } from "../database.js";
import { isoNow } from "./shared.js";

export type AttachmentParseStatus = "ok" | "parse_failed";

export interface AttachmentParseRow {
  readonly botId: string;
  readonly path: string;
  readonly mediaType: string;
  readonly sourceChecksum: string;
  readonly status: AttachmentParseStatus;
  readonly text: string;
  readonly truncated: boolean;
  readonly originalChars: number;
  readonly pages: number | null;
  readonly paragraphs: number | null;
  readonly errorReason: string | null;
  readonly parsedAt: string;
}

interface AttachmentParseDbRow {
  bot_id: string;
  path: string;
  media_type: string;
  source_checksum: string;
  status: string;
  text: string;
  truncated: number;
  original_chars: number;
  pages: number | null;
  paragraphs: number | null;
  error_reason: string | null;
  parsed_at: string;
}

function rowToParse(row: AttachmentParseDbRow): AttachmentParseRow {
  return {
    botId: row.bot_id,
    path: row.path,
    mediaType: row.media_type,
    sourceChecksum: row.source_checksum,
    status: row.status === "ok" ? "ok" : "parse_failed",
    text: row.text,
    truncated: row.truncated === 1,
    originalChars: row.original_chars,
    pages: row.pages,
    paragraphs: row.paragraphs,
    errorReason: row.error_reason,
    parsedAt: row.parsed_at,
  };
}

export function getAttachmentParse(
  db: OpenedDatabase,
  botId: string,
  path: string,
): AttachmentParseRow | undefined {
  const row = db.raw
    .prepare("SELECT * FROM attachment_parses WHERE bot_id = ? AND path = ?;")
    .get(botId, path) as unknown as AttachmentParseDbRow | undefined;
  return row === undefined ? undefined : rowToParse(row);
}

/** Replace-on-write: a re-parse of the same path replaces the cached body. */
export function upsertAttachmentParse(
  db: OpenedDatabase,
  input: {
    botId: string;
    path: string;
    mediaType: string;
    sourceChecksum: string;
    status: AttachmentParseStatus;
    text: string;
    truncated: boolean;
    originalChars: number;
    pages?: number | null;
    paragraphs?: number | null;
    errorReason?: string | null;
  },
): AttachmentParseRow {
  db.raw
    .prepare(
      "INSERT INTO attachment_parses " +
        "(bot_id, path, media_type, source_checksum, status, text, truncated, original_chars, pages, paragraphs, error_reason, parsed_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (bot_id, path) DO UPDATE SET " +
        "media_type = excluded.media_type, source_checksum = excluded.source_checksum, " +
        "status = excluded.status, text = excluded.text, truncated = excluded.truncated, " +
        "original_chars = excluded.original_chars, pages = excluded.pages, " +
        "paragraphs = excluded.paragraphs, error_reason = excluded.error_reason, " +
        "parsed_at = excluded.parsed_at;",
    )
    .run(
      input.botId,
      input.path,
      input.mediaType,
      input.sourceChecksum,
      input.status,
      input.text,
      input.truncated ? 1 : 0,
      input.originalChars,
      input.pages ?? null,
      input.paragraphs ?? null,
      input.errorReason ?? null,
      isoNow(db.now),
    );
  const row = db.raw
    .prepare("SELECT * FROM attachment_parses WHERE bot_id = ? AND path = ?;")
    .get(input.botId, input.path) as unknown as AttachmentParseDbRow;
  return rowToParse(row);
}
