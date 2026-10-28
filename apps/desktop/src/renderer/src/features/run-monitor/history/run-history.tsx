/**
 * Run history tab (D09 brief §2.1 history/, FR-07): the immutable workflow
 * version snapshot, bot snapshots, artifacts with checksums, and the Harness
 * sessionId entry per node attempt. Interrupted runs show the interruption
 * reason, a pointer to the recovery run (`resumedFromRunId`) and, since G14,
 * the 恢复运行 entry: a two-step confirm that resumes into a new run.
 */
import { useState, type JSX } from "react";
import type { Run } from "@deepseek-bot/contracts";
import type { RunView } from "../events/run-view.js";
import { runStatusLabel } from "../run-list/run-list.js";
import { formatFullDateTime, t } from "../../../i18n.js";

function formatBytes(size: number): string {
  return `${size} B`;
}

export function RunHistory(props: {
  view: RunView;
  onOpenRun: (runId: string) => void;
  /** run.resume for interrupted runs; omitted when the surface is read-only. */
  onResume?: (runId: string) => Promise<Run>;
}): JSX.Element {
  const { view, onOpenRun } = props;
  const run = view.run;
  const snapshot = run.workflowSnapshot;
  const resumedFrom = run.resumedFromRunId;
  // Two-step confirm (PRD §5): resuming replays in-flight nodes, so the
  // button first states the consequence and only the second click resumes.
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resume = (): void => {
    if (props.onResume === undefined) return;
    setBusy(true);
    setError(null);
    props
      .onResume(run.id)
      .then((next) => {
        setConfirming(false);
        onOpenRun(next.id);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(`${t("runs.resumeFailed")}：${message}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="rm-history">
      <section className="rm-history-section" aria-label={t("runs.versionSnapshot")}>
        <h4>{t("runs.versionSnapshotHeading")}</h4>
        <dl className="rm-kv">
          <div className="rm-kv-row">
            <dt>{t("runs.name")}</dt>
            <dd>{snapshot.name}</dd>
          </div>
          <div className="rm-kv-row">
            <dt>{t("runs.workflowRevision")}</dt>
            <dd>
              {snapshot.id.slice(0, 8)} · {snapshot.revision.slice(0, 8)}
            </dd>
          </div>
          <div className="rm-kv-row">
            <dt>schemaVersion</dt>
            <dd>{snapshot.schemaVersion}</dd>
          </div>
          <div className="rm-kv-row">
            <dt>{t("runs.nodesEdges")}</dt>
            <dd>
              {t("runs.nodeEdgeCount", [snapshot.nodes.length, snapshot.edges.length])}
            </dd>
          </div>
          <div className="rm-kv-row">
            <dt>{t("runs.trigger")}</dt>
            <dd>
              {run.trigger.kind === "manual" ? t("runs.triggerManual") : t("runs.triggerScheduled")} ·{" "}
              {formatFullDateTime(run.createdAt)}
            </dd>
          </div>
          <div className="rm-kv-row">
            <dt>{t("runs.ended")}</dt>
            <dd>
              {run.finishedAt !== null
                ? t("d22.runFinishedAt", [
                    formatFullDateTime(run.finishedAt),
                    runStatusLabel(run.status),
                  ])
                : t("runs.notEnded")}
            </dd>
          </div>
        </dl>
        {run.botSnapshots.length > 0 && (
          <p className="rm-sub">
            {t("runs.botSnapshots", [run.botSnapshots.map((bot) => bot.name).join(t("d22.listSeparator"))])}
          </p>
        )}
      </section>

      <section className="rm-history-section" aria-label={t("shell.artifacts")}>
        <h4>{t("runs.artifactsHeading")}</h4>
        {view.artifacts.length === 0 && <p className="rm-sub">{t("shell.noArtifacts")}</p>}
        {view.artifacts.length > 0 && (
          <table className="rm-artifact-table">
            <thead>
              <tr>
                <th scope="col">{t("runs.path")}</th>
                <th scope="col">{t("runs.type")}</th>
                <th scope="col">{t("runs.size")}</th>
                <th scope="col">sha256</th>
              </tr>
            </thead>
            <tbody>
              {view.artifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <td>{artifact.relativePath}</td>
                  <td>{artifact.mediaType}</td>
                  <td>{formatBytes(artifact.size)}</td>
                  <td className="rm-digest" title={artifact.checksum.value}>
                    {artifact.checksum.value.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rm-history-section" aria-label={t("runs.sessionLocator")}>
        <h4>{t("runs.sessionLocator")}</h4>
        <ul className="rm-session-list">
          {view.nodes.flatMap((node) =>
            node.runs
              .filter((attempt) => attempt.sessionId !== null)
              .map((attempt) => (
                <li key={attempt.nodeRunId}>
                  {t("runs.nodeAttemptLabel", [node.nodeId, attempt.attempt])}
                  <code className="rm-session-id">{attempt.sessionId}</code>
                </li>
              )),
          )}
        </ul>
        <p className="rm-sub">
          {t("runs.sessionLocatorHint")}
        </p>
      </section>

      {(resumedFrom !== undefined || view.status === "interrupted") && (
        <section className="rm-history-section" aria-label={t("runs.interruptionRecovery")}>
          <h4>{t("runs.interruptionRecovery")}</h4>
          {view.status === "interrupted" && (
            <p className="rm-sub">
              {t("runs.interruptReason")}{view.interruptedReason ?? t("runs.hostProcessExited")}{t("runs.resumeNote")}
            </p>
          )}
          {view.status === "interrupted" && props.onResume !== undefined && (
            confirming ? (
              <div className="rm-resume-confirm">
                <p className="rm-sub">{t("runs.resumeConfirmNote")}</p>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={busy}
                  onClick={resume}
                >
                  {t("runs.resumeConfirm")}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  {t("shell.cancel")}
                </button>
              </div>
            ) : (
              <button type="button" className="pill-btn" onClick={() => setConfirming(true)}>
                {t("runs.resumeAction")}
              </button>
            )
          )}
          {error !== null && <p className="form-error" role="alert">{error}</p>}
          {resumedFrom !== undefined && (
            <p className="rm-sub">
              {t("runs.resumedFrom")}
              <button
                type="button"
                className="rm-link-btn"
                onClick={() => onOpenRun(resumedFrom)}
              >
                run {resumedFrom.slice(0, 8)}
              </button>
              （resumedFromRunId）。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
