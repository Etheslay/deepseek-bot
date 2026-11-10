import type { JSX } from "react";
import { formatFileCardSize } from "./attachments.js";

/** Document glyph from the drop reference: three rules and a blue bar. */
function FileGlyph(): JSX.Element {
  return (
    <svg className="file-card-icon" viewBox="0 0 36 36" aria-hidden="true">
      <rect x="4" y="5" width="22" height="3.2" rx="1.6" fill="currentColor" opacity="0.72" />
      <rect x="4" y="12" width="18" height="3.2" rx="1.6" fill="currentColor" opacity="0.72" />
      <rect x="4" y="19" width="14" height="3.2" rx="1.6" fill="currentColor" opacity="0.55" />
      <rect x="4" y="26.5" width="28" height="5" rx="2" fill="#3b82f6" />
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
    <span className="file-card">
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
