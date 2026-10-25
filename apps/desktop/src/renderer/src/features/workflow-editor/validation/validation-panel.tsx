/**
 * Validation panel (D07 brief §3.4): issues grouped by node, click to locate
 * the offending node and focus the inspector field. The list is the single
 * source of truth — the save button elsewhere is disabled while it is
 * non-empty and the count is shown here.
 */
import type { JSX } from "react";
import type { WorkflowIssue } from "@deepseek-bot/contracts";
import { groupIssuesByNode } from "./issues.js";

export function ValidationPanel(props: {
  issues: readonly WorkflowIssue[];
  remoteResult: { valid: boolean; count: number } | null;
  onValidate: () => void;
  onLocate: (issue: WorkflowIssue) => void;
}): JSX.Element {
  const groups = groupIssuesByNode(props.issues);
  return (
    <section className="wf-validation" aria-label="校验面板">
      <header className="wf-validation-head">
        <button type="button" className="ghost-btn" onClick={props.onValidate}>
          校验
        </button>
        {props.issues.length > 0 ? (
          <span className="wf-validation-status err">
            {props.issues.length} 个错误 · 保存已禁用
          </span>
        ) : (
          <span className="wf-validation-status ok">校验通过 · 可保存</span>
        )}
        {props.remoteResult && (
          <span className="wf-validation-remote">
            服务端校验：{props.remoteResult.valid ? "valid" : `${props.remoteResult.count} 个错误`}
          </span>
        )}
      </header>
      {groups.length === 0 ? (
        <p className="wf-validation-empty">暂无错误。环 / 悬空边 / 缺失绑定 / 重复项都会在这里定位到节点与字段。</p>
      ) : (
        <ul className="wf-validation-list">
          {groups.map((group) => (
            <li key={group.nodeId || "-"} className="wf-validation-group">
              <span className="wf-validation-node">
                {group.nodeId === "" ? "工作流" : `节点 ${group.nodeId}`}
              </span>
              <ul>
                {group.issues.map((issue, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="wf-issue"
                      onClick={() => props.onLocate(issue)}
                      title="点击定位到节点与字段"
                    >
                      <span className="wf-issue-code">{issue.code}</span>
                      <span className="wf-issue-message">{issue.message}</span>
                      <span className="wf-issue-where">
                        {issue.nodeId ?? "—"}·{issue.field ?? "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
