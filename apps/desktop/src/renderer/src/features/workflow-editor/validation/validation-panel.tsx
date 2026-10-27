/**
 * Validation panel (D07 brief §3.4): issues grouped by node, click to locate
 * the offending node and focus the inspector field. The list is the single
 * source of truth — the save button elsewhere is disabled while it is
 * non-empty and the count is shown here.
 */
import type { JSX } from "react";
import type { WorkflowIssue } from "@deepseek-bot/contracts";
import { groupIssuesByNode } from "./issues.js";
import { t } from "../../../i18n.js";

export function ValidationPanel(props: {
  issues: readonly WorkflowIssue[];
  remoteResult: { valid: boolean; count: number } | null;
  onValidate: () => void;
  onLocate: (issue: WorkflowIssue) => void;
}): JSX.Element {
  const groups = groupIssuesByNode(props.issues);
  return (
    <section className="wf-validation" aria-label={t("workflow.validationPanel")}>
      <header className="wf-validation-head">
        <button type="button" className="ghost-btn" onClick={props.onValidate}>
          {t("workflow.validate")}
        </button>
        {props.issues.length > 0 ? (
          <span className="wf-validation-status err">
            {t("workflow.errorsSaveBlocked", [props.issues.length])}
          </span>
        ) : (
          <span className="wf-validation-status ok">{t("workflow.validationPassedReady")}</span>
        )}
        {props.remoteResult && (
          <span className="wf-validation-remote">
            {t("workflow.serverValidation")}{props.remoteResult.valid ? "valid" : t("workflow.errorCount", [props.remoteResult.count])}
          </span>
        )}
      </header>
      {groups.length === 0 ? (
        <p className="wf-validation-empty">{t("workflow.noIssues")}</p>
      ) : (
        <ul className="wf-validation-list">
          {groups.map((group) => (
            <li key={group.nodeId || "-"} className="wf-validation-group">
              <span className="wf-validation-node">
                {group.nodeId === "" ? t("workflow.title") : t("workflow.nodeRef", [group.nodeId])}
              </span>
              <ul>
                {group.issues.map((issue, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="wf-issue"
                      onClick={() => props.onLocate(issue)}
                      title={t("workflow.locateIssue")}
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
