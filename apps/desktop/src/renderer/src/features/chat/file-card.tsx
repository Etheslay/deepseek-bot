import type { JSX } from "react";
import { formatFileCardSize } from "./attachments.js";

/** Word is blue, PowerPoint orange, PDF red, Excel green. Other files stay blue. */
export function fileCardTone(name: string): "word" | "ppt" | "pdf" | "sheet" | "file" {
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.pptx?$/i.test(name)) return "ppt";
  if (/\.docx?$/i.test(name)) return "word";
  if (/\.xlsx$/i.test(name)) return "sheet";
  return "file";
}

/** Document glyph: three rules and a colored bar. */
function FileGlyph(): JSX.Element {
  return (
    <svg className="file-card-icon" viewBox="0 0 36 36" aria-hidden="true">
      <rect x="4" y="5" width="22" height="3.2" rx="1.6" fill="currentColor" opacity="0.72" />
      <rect x="4" y="12" width="18" height="3.2" rx="1.6" fill="currentColor" opacity="0.72" />
      <rect x="4" y="19" width="14" height="3.2" rx="1.6" fill="currentColor" opacity="0.55" />
      <rect className="file-card-bar" x="4" y="26.5" width="28" height="5" rx="2" />
    </svg>
  );
}

export function FileCard(props: {
  name: string;
  size: number;
  flag?: string;
  onRemove?: () => void;
  removeLabel?: string;
}): JSX.Element {
  return (
    <span className="file-card" data-tone={fileCardTone(props.name)}>
      <FileGlyph />
      <span className="file-card-copy">
        <span className="file-card-name">{props.name}</span>
        <span className="file-card-size">{formatFileCardSize(props.size)}</span>
        {props.flag ? <span className="file-card-flag">{props.flag}</span> : null}
      </span>
      {props.onRemove ? (
        <button
          type="button"
          className="file-card-remove"
          aria-label={props.removeLabel ?? props.name}
          onClick={props.onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
