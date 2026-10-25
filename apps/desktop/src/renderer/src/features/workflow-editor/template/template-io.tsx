/**
 * Template import/export dialogs (D07 brief §3.6). Import accepts pasted JSON
 * or a local file only — never a remote URL; the payload stays inert data
 * (parsed, schema-checked, never executed) and granting it any permission is
 * out of scope by contract. Export offers copy + local file download.
 */
import { useRef, useState, type JSX } from "react";
import type { WorkflowDraft } from "@deepseek-bot/contracts";
import type { WorkflowImportResult } from "../workflow-service.js";

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
        aria-label="导入工作流模板"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h3>导入模板</h3>
          <button type="button" className="modal-close" aria-label="关闭" onClick={props.onCancel}>
            ×
          </button>
        </header>
        <div className="modal-body wf-dialog-form">
          <p className="wf-dialog-hint">
            粘贴或选择本地 JSON 模板（形如 {"{ schemaVersion, workflow }"}，≤1 MiB）。不接远程 URL；模板内容只作数据校验，不执行、不授权。
          </p>
          <textarea
            className="wf-textarea wf-import-textarea"
            value={props.text}
            aria-label="模板 JSON"
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
              选择本地文件…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="wf-file-input"
              aria-label="模板文件"
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
              {props.busy ? "校验中…" : "校验模板"}
            </button>
          </div>
          {tooLarge && <p className="form-error">模板超过 1 MiB 契约消息上限。</p>}
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
          已拒绝：模板 schemaVersion 不受支持（DATA_VERSION_UNSUPPORTED）。需要显式升级，不做静默兼容。
        </p>
      </div>
    );
  }
  if (!result.accepted) {
    return (
      <div className="wf-import-result" role="alert">
        <p className="form-error">模板未通过校验（{result.errorCode ?? "INVALID_INPUT"}）：</p>
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
        模板可用：<strong>{draft.name}</strong> · {draft.nodes.length} 个节点（
        {draft.nodes.filter((node) => node.type === "bot").length} Bot /{" "}
        {draft.nodes.filter((node) => node.type === "approval").length} 审批）·{" "}
        {draft.edges.length} 条连线 · 并发 {draft.limits.maxConcurrentNodes}
      </p>
      <button
        type="button"
        className="primary-btn"
        onClick={() => props.onConfirm(draft)}
      >
        载入画布（作为未保存草稿）
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
        aria-label="导出工作流模板"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h3>导出模板 · {props.workflowName}</h3>
          <button type="button" className="modal-close" aria-label="关闭" onClick={props.onClose}>
            ×
          </button>
        </header>
        <div className="modal-body wf-dialog-form">
          <p className="wf-dialog-hint">
            workflow.export 输出的 {"{ schemaVersion, workflow }"} JSON；节点、连线与 limits 完整保留。
          </p>
          <textarea
            className="wf-textarea wf-export-textarea"
            value={props.json}
            readOnly
            aria-label="模板 JSON"
            spellCheck={false}
            onFocus={(event) => event.target.select()}
          />
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost-btn" onClick={download}>
            下载 JSON
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              void props.onCopy(props.json).then(() => setCopied(true));
            }}
          >
            {copied ? "已复制" : "复制 JSON"}
          </button>
        </footer>
      </div>
    </div>
  );
}
