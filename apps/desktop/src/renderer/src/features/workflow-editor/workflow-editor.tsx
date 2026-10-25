/**
 * Workflow editor root (D07 brief §3.1). Toolbar / palette / canvas /
 * inspector / validation panel composition plus the edge-key, import and
 * export dialogs and the revision-conflict banner.
 */
import { useCallback, type JSX } from "react";
import { CustomSelect } from "../../components/custom-select.js";
import { useWorkflowEditor } from "./use-workflow-editor.js";
import type { WorkflowNodePatch } from "./workflow-reducer.js";
import { EdgeKeyDialog, WorkflowCanvas } from "./canvas/workflow-canvas.js";
import { InspectorPanel } from "./inspector/node-inspector.js";
import { ValidationPanel } from "./validation/validation-panel.js";
import { ExportDialog, ImportDialog } from "./template/template-io.js";

export function WorkflowEditor(props: { onClose: () => void }): JSX.Element {
  const editor = useWorkflowEditor();
  const { state, dispatch } = editor;
  const canSave = editor.issues.length === 0 && !editor.busy;
  const saveTitle =
    editor.issues.length > 0 ? `存在 ${editor.issues.length} 个校验错误，修复后可保存` : undefined;

  const onUpdateNode = useCallback(
    (nodeId: string, patch: WorkflowNodePatch) => {
      dispatch({ type: "updateNode", nodeId, patch });
    },
    [dispatch],
  );

  const registerNodeEl = useCallback(
    (nodeId: string, el: HTMLElement | null) => {
      if (el) {
        editor.nodeEls.current.set(nodeId, el);
      } else {
        editor.nodeEls.current.delete(nodeId);
      }
    },
    [editor.nodeEls],
  );

  const edgeDialogTarget = state.draft.nodes.find((node) => node.id === editor.edgeDialog?.to);
  const defaultInputKey =
    edgeDialogTarget?.inputBindings.find((binding) => binding.required)?.inputKey ??
    edgeDialogTarget?.inputBindings[0]?.inputKey ??
    "in";

  return (
    <div className="wf-editor">
      <header className="wf-toolbar">
        <button type="button" className="ghost-btn" onClick={props.onClose}>
          ← 返回对话
        </button>
        <span className="wf-toolbar-divider" aria-hidden="true" />
        <span className="wf-catalog">
          <CustomSelect
            value={state.loadedFrom?.id ?? ""}
            options={[
              { value: "", label: state.loadedFrom ? state.draft.name : "未保存草稿" },
              ...editor.catalog
                .filter((entry) => entry.id !== state.loadedFrom?.id)
                .map((entry) => ({ value: entry.id, label: entry.name })),
            ]}
            onChange={editor.selectWorkflow}
            ariaLabel="选择工作流"
          />
        </span>
        <span className="wf-toolbar-actions">
          <button type="button" className="ghost-btn" onClick={editor.newWorkflow}>
            新建
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!canSave}
            title={saveTitle}
            onClick={editor.save}
          >
            保存{editor.issues.length > 0 ? `（${editor.issues.length} 个错误）` : ""}
          </button>
          <button type="button" className="ghost-btn" onClick={editor.copyWorkflow}>
            复制
          </button>
          <button type="button" className="ghost-btn" onClick={editor.openImport}>
            导入
          </button>
          <button type="button" className="ghost-btn" onClick={editor.openExport}>
            导出
          </button>
        </span>
      </header>

      {editor.conflict && (
        <div className="wf-conflict" role="alert">
          <span>
            保存被拒绝：工作流已被其他窗口修改（REVISION_CONFLICT）。刷新后基于最新版本重试；不会覆盖他人修改。
          </span>
          <span className="wf-conflict-actions">
            <button type="button" className="primary-btn" onClick={editor.refreshAfterConflict}>
              刷新并重试
            </button>
            <button type="button" className="ghost-btn" onClick={editor.dismissConflict}>
              稍后
            </button>
          </span>
        </div>
      )}

      <div className="wf-body">
        <aside className="wf-palette" aria-label="节点面板">
          <div className="wf-palette-title">节点</div>
          <button
            type="button"
            className="wf-palette-item"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-wf-node", "bot");
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => editor.addNode("bot")}
          >
            <span className="wf-palette-badge bot">Bot</span>
            <span>机器人节点</span>
          </button>
          <button
            type="button"
            className="wf-palette-item"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-wf-node", "approval");
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => editor.addNode("approval")}
          >
            <span className="wf-palette-badge approval">审批</span>
            <span>人工审批节点</span>
          </button>
          <p className="wf-palette-hint">点击添加，或拖入画布。画布内：拖动移动节点；输出端口拖到输入端口连线；选中后 Delete 删除；聚焦节点按 C 键盘连线。</p>
        </aside>

        <WorkflowCanvas
          state={state}
          bots={editor.bots ?? []}
          issueCounts={editor.issueCounts}
          pendingConnectFrom={editor.pendingConnectFrom}
          onSelect={(selection) => dispatch({ type: "select", selection })}
          onMoveNode={(nodeId, to) => dispatch({ type: "moveNode", nodeId, to })}
          onConnect={editor.connectNodes}
          onDropNode={editor.dropNode}
          onKeyboardConnect={editor.keyboardConnect}
          registerNodeEl={registerNodeEl}
        />

        <aside className="wf-inspector-wrap" aria-label="参数检查器">
          <InspectorPanel
            state={state}
            bots={editor.bots}
            issues={editor.issues}
            callbacks={{
              onUpdateNode,
              onAddBinding: (nodeId) => dispatch({ type: "addBinding", nodeId }),
              onUpdateBinding: (nodeId, index, patch) =>
                dispatch({ type: "updateBinding", nodeId, index, patch }),
              onRemoveBinding: (nodeId, index) => dispatch({ type: "removeBinding", nodeId, index }),
              onUpdateMeta: (patch) => dispatch({ type: "updateMeta", patch }),
              onUpdateEdge: (edgeKey, patch) => dispatch({ type: "updateEdge", edgeKey, patch }),
              onRemoveEdge: (edgeKey) => dispatch({ type: "removeEdge", edgeKey }),
            }}
          />
        </aside>
      </div>

      <ValidationPanel
        issues={editor.issues}
        remoteResult={editor.remoteResult}
        onValidate={editor.runValidate}
        onLocate={editor.locate}
      />

      {editor.edgeDialog && (
        <EdgeKeyDialog
          from={editor.edgeDialog.from}
          to={editor.edgeDialog.to}
          defaultInputKey={defaultInputKey}
          onCancel={editor.cancelEdgeDialog}
          onConfirm={editor.confirmEdgeDialog}
        />
      )}

      {editor.importOpen && (
        <ImportDialog
          text={editor.importText}
          result={editor.importResult}
          busy={editor.importBusy}
          onTextChange={editor.setImportText}
          onSubmit={editor.submitImport}
          onConfirm={editor.confirmImport}
          onCancel={editor.closeImport}
        />
      )}

      {editor.exportJson !== null && (
        <ExportDialog
          json={editor.exportJson}
          workflowName={state.draft.name}
          onCopy={async (text) => {
            await navigator.clipboard.writeText(text);
          }}
          onClose={editor.closeExport}
        />
      )}

      {editor.toast && (
        <div className="toast" role="status">
          {editor.toast}
        </div>
      )}
    </div>
  );
}
