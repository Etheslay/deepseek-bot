/**
 * The file card a finished office file leaves in the chat.
 * The body opens it. The tray button saves a copy.
 */
import type { JSX } from "react";
import type { DeliveredFile } from "@deepseek-bot/contracts";
import { t } from "../../i18n.js";
import { FileCard } from "./file-card.js";

function DownloadIcon(): JSX.Element {
  return (
    <svg className="delivered-download-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M8 10.5 12 14.5 16 10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 19h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function DeliveredFileCard(props: {
  file: DeliveredFile;
  onView: () => void;
  onDownload: () => void;
}): JSX.Element {
  const { file, onView, onDownload } = props;
  return (
    <div className="delivered-file">
      <button
        type="button"
        className="file-card-open delivered-view"
        aria-label={t("shell.viewFile", [file.name])}
        onClick={onView}
      >
        <FileCard name={file.name} size={file.bytes} />
      </button>
      <button
        type="button"
        className="delivered-download"
        aria-label={t("shell.downloadFile", [file.name])}
        onClick={onDownload}
      >
        <DownloadIcon />
      </button>
    </div>
  );
}
