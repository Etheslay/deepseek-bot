/**
 * Template import/export dialogs (D07 brief §3.6). Import accepts pasted JSON
 * or a local file only — never a remote URL; the payload stays inert data
 * (parsed, schema-checked, never executed) and granting it any permission is
 * out of scope by contract. Export offers copy + local file download.
 */
import { useRef, useState, type JSX } from "react";
import type { WorkflowDraft } from "@deepseek-bot/contracts";
import type { WorkflowImportResult } from "../workflow-service.js";
import { t } from "../../../i18n.js";

const MAX_TEMPLATE_BYTES = 1_048_576;

export function ImportDialog(props: {
  text: string;
  result: WorkflowImportResult | null;
  busy: boolean;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onConfirm: (draft: WorkflowDraft) => void;
  onCancel: () => void;
}): JSX.Element {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const tooLarge = new TextEncoder().encode(props.text).length > MAX_TEMPLATE_BYTES;

  const readLocalFile = (file: File): void => {
    void file.text().then((content) => props.onTextChange(content));
  };

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal wf-import-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("workflow.importDialogTitle")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h3>{t("workflow.importTitle")}</h3>
          <button type="button" className="modal-close" aria-label={t("shell.close")} onClick={props.onCancel}>
            ×
          </button>
        </header>
        <div className="modal-body wf-dialog-form">
          <p className="wf-dialog-hint">
            {t("workflow.importHint", ["{ schemaVersion, workflow }"])}
          </p>
          <textarea
            className="wf-textarea wf-import-textarea"
            value={props.text}
            aria-label={t("workflow.templateJson")}
            placeholder='{"schemaVersion":"0.1","workflow":{...}}'
            spellCheck={false}
            onChange={(event) => props.onTextChange(event.target.value)}
          />
          <div className="wf-import-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={props.busy}
              onClick={() => fileRef.current?.click()}
            >
              {t("workflow.chooseLocalFile")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="wf-file-input"
              aria-label={t("workflow.templateFile")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  readLocalFile(file);
                }
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="primary-btn"
              disabled={props.busy || props.text.trim().length === 0 || tooLarge}
              onClick={props.onSubmit}
            >
              {props.busy ? t("workflow.validatingTemplate") : t("workflow.validateTemplate")}
            </button>
          </div>
          {tooLarge && <p className="form-error">{t("workflow.templateSizeExceeded")}</p>}
          {props.result && <ImportResultView result={props.result} onConfirm={props.onConfirm} />}
        </div>
      </div>
    </div>
  );
}

function ImportResultView(props: {
  result: WorkflowImportResult;
  onConfirm: (draft: WorkflowDraft) => void;
}): JSX.Element {
  const { result } = props;
  if (result.errorCode === "DATA_VERSION_UNSUPPORTED") {
    return (
      <div className="wf-import-result" role="alert">
        <p className="form-error">
          {t("workflow.templateVersionRejected")}
        </p>
      </div>
    );
  }
  if (!result.accepted) {
    return (
      <div className="wf-import-result" role="alert">
        <p className="form-error">{t("workflow.templateValidationFailed", [result.errorCode ?? "INVALID_INPUT"])}</p>
        <ul className="wf-import-errors">
          {result.errors.map((issue, index) => (
            <li key={index}>
              <span className="wf-issue-code">{issue.code}</span> {issue.message}
              {(issue.nodeId !== undefined || issue.field !== undefined) && (
                <span className="wf-issue-field">
                  （{issue.nodeId ?? "—"}·{issue.field ?? "—"}）
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const draft = result.draft!;
  return (
    <div className="wf-import-result accepted" role="status">
      <p>
        {t("workflow.templateAccepted")}<strong>{draft.name}</strong> {t("workflow.templateSummary", [draft.nodes.length, draft.nodes.filter((node) => node.type === "bot").length, draft.nodes.filter((node) => node.type === "approval").length, draft.edges.length, draft.limits.maxConcurrentNodes])}
      </p>
      <button
        type="button"
        className="primary-btn"
        onClick={() => props.onConfirm(draft)}
      >
        {t("workflow.loadAsDraft")}
      </button>
    </div>
  );
}

export function ExportDialog(props: {
  json: string;
  workflowName: string;
  onCopy: (text: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const download = (): void => {
    const blob = new Blob([props.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${props.workflowName || "workflow"}.template.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal wf-export-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("workflow.exportDialogTitle")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h3>{t("workflow.exportTitle", [props.workflowName])}</h3>
          <button type="button" className="modal-close" aria-label={t("shell.close")} onClick={props.onClose}>
            ×
          </button>
        </header>
        <div className="modal-body wf-dialog-form">
          <p className="wf-dialog-hint">
            {t("workflow.exportHint", ["{ schemaVersion, workflow }"])}
          </p>
          <textarea
            className="wf-textarea wf-export-textarea"
            value={props.json}
            readOnly
            aria-label={t("workflow.templateJson")}
            spellCheck={false}
            onFocus={(event) => event.target.select()}
          />
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost-btn" onClick={download}>
            {t("workflow.downloadJson")}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              void props.onCopy(props.json).then(() => setCopied(true));
            }}
          >
            {copied ? t("shell.copied") : t("workflow.copyJson")}
          </button>
        </footer>
      </div>
    </div>
  );
}
