/**
 * Inspector (D07 brief §3.3): parameter editing for the selection — node
 * (bot/approval), edge, or workflow meta when nothing is selected. Field
 * element ids follow the `wf-insp-*` convention so validation issues can
 * focus the exact field they point at.
 */
import type { JSX } from "react";
import type { Bot, WorkflowIssue } from "@deepseek-bot/contracts";
import { CustomSelect } from "../../../components/custom-select.js";
import type { CustomSelectOption } from "../../../components/custom-select.js";
import type {
  WorkflowEditorState,
  WorkflowNodePatch,
} from "../workflow-reducer.js";
import { t } from "../../../i18n.js";

export type InspectorCallbacks = {
  onUpdateNode: (nodeId: string, patch: WorkflowNodePatch) => void;
  onAddBinding: (nodeId: string) => void;
  onUpdateBinding: (nodeId: string, index: number, patch: { inputKey?: string; required?: boolean }) => void;
  onRemoveBinding: (nodeId: string, index: number) => void;
  onUpdateMeta: (patch: { name?: string; maxConcurrentNodes?: number }) => void;
  onUpdateEdge: (edgeKey: string, patch: { outputKey?: string; inputKey?: string }) => void;
  onRemoveEdge: (edgeKey: string) => void;
};

/** Bot options for the bot picker: archived bots are never offered. */
export function activeBotOptions(bots: readonly Bot[]): CustomSelectOption[] {
  return bots
    .filter((bot) => bot.archivedAt === null)
    .map((bot) => ({ value: bot.id, label: bot.name }));
}

/** Display option for a bot that was selected before it got archived. */
export function archivedBotOption(bots: readonly Bot[], botId: string | undefined): CustomSelectOption | null {
  if (botId === undefined) {
    return null;
  }
  const bot = bots.find((entry) => entry.id === botId);
  if (!bot || bot.archivedAt === null) {
    return null;
  }
  return { value: bot.id, label: t("workflow.botArchivedSuffix", [bot.name]) };
}

export function InspectorPanel(props: {
  state: WorkflowEditorState;
  bots: Bot[] | null;
  issues: readonly WorkflowIssue[];
  callbacks: InspectorCallbacks;
}): JSX.Element {
  const { state, bots, callbacks } = props;
  const selection = state.selection;

  if (selection?.kind === "node") {
    return (
      <NodeInspector
        nodeId={selection.nodeId}
        state={state}
        bots={bots}
        issues={props.issues}
        callbacks={callbacks}
      />
    );
  }
  if (selection?.kind === "edge") {
    return <EdgeInspector edgeKey={selection.edgeKey} state={state} callbacks={callbacks} />;
  }
  return <WorkflowInspector state={state} callbacks={callbacks} />;
}

function sectionTitle(text: string): JSX.Element {
  return <div className="wf-insp-title">{text}</div>;
}

function WorkflowInspector(props: {
  state: WorkflowEditorState;
  callbacks: InspectorCallbacks;
}): JSX.Element {
  const draft = props.state.draft;
  return (
    <div className="wf-insp">
      {sectionTitle(t("workflow.title"))}
      <label className="wf-field">
        {t("runs.name")}
        <input
          id="wf-insp-name"
          className="name-input"
          value={draft.name}
          maxLength={200}
          aria-label={t("workflow.workflowName")}
          onChange={(event) => props.callbacks.onUpdateMeta({ name: event.target.value })}
        />
      </label>
      <label className="wf-field">
        {t("workflow.concurrencyLimitField")}
        <CustomSelect
          value={draft.limits.maxConcurrentNodes}
          options={[1, 2, 3, 4, 5, 6, 7, 8].map((value) => ({ value, label: String(value) }))}
          onChange={(value) => props.callbacks.onUpdateMeta({ maxConcurrentNodes: Number(value) })}
          ariaLabel={t("workflow.concurrencyLimit")}
        />
      </label>
    </div>
  );
}

function NodeInspector(props: {
  nodeId: string;
  state: WorkflowEditorState;
  bots: Bot[] | null;
  issues: readonly WorkflowIssue[];
  callbacks: InspectorCallbacks;
}): JSX.Element {
  const node = props.state.draft.nodes.find((entry) => entry.id === props.nodeId);
  if (!node) {
    return (
      <div className="wf-insp">
        {sectionTitle(t("workflow.node"))}
        <p className="wf-insp-hint">{t("workflow.nodeMissing")}</p>
      </div>
    );
  }
  const bots = props.bots ?? [];
  const archived = archivedBotOption(bots, node.botId);
  const botOptions = archived ? [archived, ...activeBotOptions(bots)] : activeBotOptions(bots);
  const nodeIssues = props.issues.filter((issue) => issue.nodeId === node.id);

  return (
    <div className="wf-insp">
      {sectionTitle(t("workflow.nodeRef", [node.id]))}
      {nodeIssues.length > 0 && (
        <ul className="wf-insp-issues">
          {nodeIssues.map((issue, index) => (
            <li key={index}>
              <span className="wf-issue-code">{issue.code}</span> {issue.message}
              {issue.field !== undefined && <span className="wf-issue-field">（{issue.field}）</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="wf-field-row">
        <span className="wf-field-label">{t("runs.type")}</span>
        <span className="wf-field-value">
          {node.type === "bot" ? t("runs.botNode") : t("workflow.approvalNodeType")}
        </span>
      </div>
      {node.type === "bot" ? (
        <label className="wf-field">
          {t("shell.bot")}
          <span className="wf-field-control">
            <CustomSelect
              value={node.botId ?? ""}
              options={botOptions}
              onChange={(value) => props.callbacks.onUpdateNode(node.id, { botId: value })}
              ariaLabel={t("shell.bot")}
              disabled={botOptions.length === 0}
            />
          </span>
          {archived && <span className="form-error">{t("workflow.archivedBotError")}</span>}
        </label>
      ) : (
        <p className="wf-insp-hint">{t("workflow.approvalNoBot")}</p>
      )}
      <label className="wf-field">
        {t("workflow.instructionTemplateField")}
        <textarea
          id="wf-insp-instructionTemplate"
          className="wf-textarea"
          value={node.instructionTemplate}
          maxLength={100_000}
          aria-label={t("workflow.instructionTemplate")}
          placeholder={t("workflow.instructionExamplePlaceholder")}
          onChange={(event) =>
            props.callbacks.onUpdateNode(node.id, { instructionTemplate: event.target.value })
          }
        />
      </label>
      {sectionTitle(t("workflow.inputBindingsSection"))}
      {node.inputBindings.length === 0 && <p className="wf-insp-hint">{t("workflow.noBindings")}</p>}
      {node.inputBindings.map((binding, index) => (
        <div key={index} className="wf-binding-row" id={`wf-insp-binding-${binding.inputKey}`}>
          <input
            className="name-input wf-binding-key"
            value={binding.inputKey}
            maxLength={100}
            aria-label={t("workflow.inputKeyNumbered", [index + 1])}
            onChange={(event) =>
              props.callbacks.onUpdateBinding(node.id, index, { inputKey: event.target.value })
            }
          />
          <label className="wf-binding-required">
            <input
              type="checkbox"
              checked={binding.required}
              aria-label={t("workflow.bindingRequiredToggle", [binding.inputKey])}
              onChange={(event) =>
                props.callbacks.onUpdateBinding(node.id, index, { required: event.target.checked })
              }
            />
            {t("workflow.required")}
          </label>
          <button
            type="button"
            className="pill-btn"
            aria-label={t("workflow.deleteBinding", [binding.inputKey])}
            onClick={() => props.callbacks.onRemoveBinding(node.id, index)}
          >
            {t("shell.delete")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ghost-btn wf-binding-add"
        onClick={() => props.callbacks.onAddBinding(node.id)}
      >
        {t("workflow.addBinding")}
      </button>
      {sectionTitle(t("workflow.executionParams"))}
      <label className="wf-field">
        {t("workflow.timeoutField")}
        <input
          id="wf-insp-timeoutSeconds"
          className="name-input"
          type="number"
          min={1}
          max={86400}
          value={node.timeoutSeconds ?? ""}
          aria-label={t("workflow.timeoutSecondsLabel")}
          onChange={(event) => {
            const raw = event.target.value.trim();
            if (raw === "") {
              props.callbacks.onUpdateNode(node.id, { timeoutSeconds: null });
              return;
            }
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) {
              props.callbacks.onUpdateNode(node.id, { timeoutSeconds: Math.trunc(parsed) });
            }
          }}
        />
      </label>
      <label className="wf-field">
        {t("workflow.retryField")}
        <span className="wf-field-control">
          <CustomSelect
            value={node.retryPolicy.maxRetries}
            options={[0, 1, 2].map((value) => ({ value, label: String(value) }))}
            onChange={(value) =>
              props.callbacks.onUpdateNode(node.id, { retryMaxRetries: Number(value) })
            }
            ariaLabel={t("workflow.maxRetries")}
          />
        </span>
      </label>
    </div>
  );
}

function EdgeInspector(props: {
  edgeKey: string;
  state: WorkflowEditorState;
  callbacks: InspectorCallbacks;
}): JSX.Element {
  const edge = props.state.draft.edges.find(
    (entry) =>
      `${entry.fromNodeId}(${entry.outputKey})->${entry.toNodeId}(${entry.inputKey})` ===
      props.edgeKey,
  );
  if (!edge) {
    return (
      <div className="wf-insp">
        {sectionTitle(t("workflow.edge"))}
        <p className="wf-insp-hint">{t("workflow.edgeMissing")}</p>
      </div>
    );
  }
  return (
    <div className="wf-insp">
      {sectionTitle(t("workflow.edge"))}
      <div className="wf-field-row">
        <span className="wf-field-label">{t("workflow.connect")}</span>
        <span className="wf-field-value">
          {edge.fromNodeId} → {edge.toNodeId}
        </span>
      </div>
      <label className="wf-field">
        {t("workflow.outputKeyField")}
        <input
          id="wf-insp-edge-output"
          className="name-input"
          value={edge.outputKey}
          maxLength={100}
          aria-label={t("workflow.outputKey")}
          onChange={(event) =>
            props.callbacks.onUpdateEdge(props.edgeKey, { outputKey: event.target.value })
          }
        />
      </label>
      <label className="wf-field">
        {t("workflow.inputKeyField")}
        <input
          id="wf-insp-edge-input"
          className="name-input"
          value={edge.inputKey}
          maxLength={100}
          aria-label={t("workflow.inputKey")}
          onChange={(event) =>
            props.callbacks.onUpdateEdge(props.edgeKey, { inputKey: event.target.value })
          }
        />
      </label>
      <button
        type="button"
        className="danger-btn wf-edge-delete"
        onClick={() => props.callbacks.onRemoveEdge(props.edgeKey)}
      >
        {t("workflow.deleteEdge")}
      </button>
    </div>
  );
}
