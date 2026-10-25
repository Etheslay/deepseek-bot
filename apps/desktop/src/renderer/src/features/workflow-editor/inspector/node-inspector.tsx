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
  return { value: bot.id, label: `${bot.name}（已归档）` };
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
      {sectionTitle("工作流")}
      <p className="wf-insp-hint">选中画布节点编辑参数；此处编辑工作流级字段。</p>
      <label className="wf-field">
        名称
        <input
          id="wf-insp-name"
          className="name-input"
          value={draft.name}
          maxLength={200}
          aria-label="工作流名称"
          onChange={(event) => props.callbacks.onUpdateMeta({ name: event.target.value })}
        />
      </label>
      <label className="wf-field">
        并发上限 maxConcurrentNodes（1–8）
        <CustomSelect
          value={draft.limits.maxConcurrentNodes}
          options={[1, 2, 3, 4, 5, 6, 7, 8].map((value) => ({ value, label: String(value) }))}
          onChange={(value) => props.callbacks.onUpdateMeta({ maxConcurrentNodes: Number(value) })}
          ariaLabel="并发上限"
        />
      </label>
      <p className="wf-insp-hint">limits 仅编辑与展示，执行期强制由运行引擎负责（D06，不在本编辑器内）。</p>
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
        {sectionTitle("节点")}
        <p className="wf-insp-hint">节点不存在（可能已删除）。</p>
      </div>
    );
  }
  const bots = props.bots ?? [];
  const archived = archivedBotOption(bots, node.botId);
  const botOptions = archived ? [archived, ...activeBotOptions(bots)] : activeBotOptions(bots);
  const nodeIssues = props.issues.filter((issue) => issue.nodeId === node.id);
  const variableHint =
    node.inputBindings.length > 0
      ? node.inputBindings.map((binding) => `{{${binding.inputKey}}}`).join("  ")
      : "（暂无输入绑定，可在下方添加）";

  return (
    <div className="wf-insp">
      {sectionTitle(`节点 ${node.id}`)}
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
        <span className="wf-field-label">类型</span>
        <span className="wf-field-value">
          {node.type === "bot" ? "Bot 节点" : "审批节点（approval）"}
        </span>
      </div>
      {node.type === "bot" ? (
        <label className="wf-field">
          机器人
          <span className="wf-field-control">
            <CustomSelect
              value={node.botId ?? ""}
              options={botOptions}
              onChange={(value) => props.callbacks.onUpdateNode(node.id, { botId: value })}
              ariaLabel="机器人"
              disabled={botOptions.length === 0}
            />
          </span>
          {archived && <span className="form-error">该机器人已归档：保存前需更换（归档机器人不可选）。</span>}
        </label>
      ) : (
        <p className="wf-insp-hint">审批节点不能绑定机器人（契约禁止 approval 携带 botId）。</p>
      )}
      <label className="wf-field">
        指令模板 instructionTemplate
        <textarea
          id="wf-insp-instructionTemplate"
          className="wf-textarea"
          value={node.instructionTemplate}
          maxLength={100_000}
          aria-label="指令模板"
          placeholder="例：总结 {{input}} 并输出评审意见"
          onChange={(event) =>
            props.callbacks.onUpdateNode(node.id, { instructionTemplate: event.target.value })
          }
        />
      </label>
      <p className="wf-insp-hint">可用变量：{variableHint}（模板仅在执行时由引擎解析，编辑器不执行）。</p>
      {sectionTitle("输入绑定 inputBindings")}
      {node.inputBindings.length === 0 && <p className="wf-insp-hint">无输入绑定。</p>}
      {node.inputBindings.map((binding, index) => (
        <div key={index} className="wf-binding-row" id={`wf-insp-binding-${binding.inputKey}`}>
          <input
            className="name-input wf-binding-key"
            value={binding.inputKey}
            maxLength={100}
            aria-label={`输入键 ${index + 1}`}
            onChange={(event) =>
              props.callbacks.onUpdateBinding(node.id, index, { inputKey: event.target.value })
            }
          />
          <label className="wf-binding-required">
            <input
              type="checkbox"
              checked={binding.required}
              aria-label={`${binding.inputKey} 是否必填`}
              onChange={(event) =>
                props.callbacks.onUpdateBinding(node.id, index, { required: event.target.checked })
              }
            />
            必填
          </label>
          <button
            type="button"
            className="pill-btn"
            aria-label={`删除输入绑定 ${binding.inputKey}`}
            onClick={() => props.callbacks.onRemoveBinding(node.id, index)}
          >
            删除
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ghost-btn wf-binding-add"
        onClick={() => props.callbacks.onAddBinding(node.id)}
      >
        添加输入绑定
      </button>
      {sectionTitle("执行参数")}
      <label className="wf-field">
        超时 timeoutSeconds（可空，1–86400）
        <input
          id="wf-insp-timeoutSeconds"
          className="name-input"
          type="number"
          min={1}
          max={86400}
          value={node.timeoutSeconds ?? ""}
          aria-label="超时秒数"
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
        重试 retryPolicy.maxRetries（0–2）
        <span className="wf-field-control">
          <CustomSelect
            value={node.retryPolicy.maxRetries}
            options={[0, 1, 2].map((value) => ({ value, label: String(value) }))}
            onChange={(value) =>
              props.callbacks.onUpdateNode(node.id, { retryMaxRetries: Number(value) })
            }
            ariaLabel="最大重试次数"
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
        {sectionTitle("连线")}
        <p className="wf-insp-hint">连线不存在（可能已删除）。</p>
      </div>
    );
  }
  return (
    <div className="wf-insp">
      {sectionTitle("连线")}
      <div className="wf-field-row">
        <span className="wf-field-label">连接</span>
        <span className="wf-field-value">
          {edge.fromNodeId} → {edge.toNodeId}
        </span>
      </div>
      <label className="wf-field">
        输出键 outputKey（源节点端口）
        <input
          id="wf-insp-edge-output"
          className="name-input"
          value={edge.outputKey}
          maxLength={100}
          aria-label="输出键"
          onChange={(event) =>
            props.callbacks.onUpdateEdge(props.edgeKey, { outputKey: event.target.value })
          }
        />
      </label>
      <label className="wf-field">
        输入键 inputKey（目标节点端口）
        <input
          id="wf-insp-edge-input"
          className="name-input"
          value={edge.inputKey}
          maxLength={100}
          aria-label="输入键"
          onChange={(event) =>
            props.callbacks.onUpdateEdge(props.edgeKey, { inputKey: event.target.value })
          }
        />
      </label>
      <p className="wf-insp-hint">输入键应与目标节点声明的 inputBindings.inputKey 对应，required 输入缺连线会在校验中报 MISSING_BINDING。</p>
      <button
        type="button"
        className="danger-btn wf-edge-delete"
        onClick={() => props.callbacks.onRemoveEdge(props.edgeKey)}
      >
        删除连线
      </button>
    </div>
  );
}
