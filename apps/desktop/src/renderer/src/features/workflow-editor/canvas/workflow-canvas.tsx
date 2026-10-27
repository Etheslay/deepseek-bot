/**
 * Workflow canvas (D07 brief §3.2): nodes are absolutely-positioned cards,
 * edges an SVG layer beneath them. Node types are limited to bot/approval;
 * ports create edges via pointer drag or the keyboard "C" flow; Delete
 * removes the current selection. Panning/zoom is intentionally absent (not
 * an acceptance gate).
 */
import { useRef, useState, type JSX } from "react";
import type { Bot, NodeType } from "@deepseek-bot/contracts";
import {
  edgeKeyOf,
  type EditorSelection,
  type NodePosition,
  type WorkflowEditorState,
} from "../workflow-reducer.js";
import { t } from "../../../i18n.js";

export const NODE_W = 192;
export const NODE_H = 72;

type LinkDraft = { fromNodeId: string; x: number; y: number } | null;

type DragState = { nodeId: string; offsetX: number; offsetY: number } | null;

export type WorkflowCanvasProps = {
  state: WorkflowEditorState;
  bots: readonly Bot[];
  issueCounts: Record<string, number>;
  pendingConnectFrom: string | null;
  onSelect: (selection: EditorSelection) => void;
  onMoveNode: (nodeId: string, to: NodePosition) => void;
  onConnect: (fromNodeId: string, toNodeId: string) => void;
  onDropNode: (nodeType: NodeType, at: NodePosition) => void;
  onKeyboardConnect: (nodeId: string) => void;
  registerNodeEl: (nodeId: string, el: HTMLElement | null) => void;
};

function botNameOf(bots: readonly Bot[], botId: string | undefined): string | null {
  if (botId === undefined) {
    return null;
  }
  return bots.find((bot) => bot.id === botId)?.name ?? null;
}

function edgePath(from: NodePosition, to: NodePosition): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const bend = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

export function WorkflowCanvas(props: WorkflowCanvasProps): JSX.Element {
  const { state, bots, issueCounts, pendingConnectFrom } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const [linking, setLinking] = useState<LinkDraft>(null);

  const contentPoint = (clientX: number, clientY: number): NodePosition => {
    const content = contentRef.current;
    if (!content) {
      return { x: 0, y: 0 };
    }
    const rect = content.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const canvasWidth =
    state.draft.nodes.reduce(
      (max, node) => Math.max(max, (state.positions[node.id]?.x ?? 0) + NODE_W),
      600,
    ) + 160;
  const canvasHeight =
    state.draft.nodes.reduce(
      (max, node) => Math.max(max, (state.positions[node.id]?.y ?? 0) + NODE_H),
      360,
    ) + 120;

  const selectedEdgeKey = state.selection?.kind === "edge" ? state.selection.edgeKey : null;
  const linkingFromPos =
    linking !== null ? state.positions[linking.fromNodeId] : undefined;

  return (
    <div
      className="wf-canvas"
      ref={wrapRef}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-wf-node")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const nodeType = event.dataTransfer.getData("application/x-wf-node");
        if (nodeType !== "bot" && nodeType !== "approval") {
          return;
        }
        event.preventDefault();
        const point = contentPoint(event.clientX, event.clientY);
        props.onDropNode(nodeType, { x: Math.max(0, point.x - NODE_W / 2), y: Math.max(0, point.y - NODE_H / 2) });
      }}
    >
      <div
        className="wf-canvas-content"
        ref={contentRef}
        style={{ width: canvasWidth, height: canvasHeight }}
        onPointerMove={(event) => {
          if (linking !== null) {
            setLinking({ ...linking, ...contentPoint(event.clientX, event.clientY) });
          }
          const drag = dragRef.current;
          if (drag && contentRef.current) {
            const rect = contentRef.current.getBoundingClientRect();
            props.onMoveNode(drag.nodeId, {
              x: Math.max(0, event.clientX - rect.left - drag.offsetX),
              y: Math.max(0, event.clientY - rect.top - drag.offsetY),
            });
          }
        }}
        onPointerUp={() => {
          dragRef.current = null;
          setLinking(null);
        }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            props.onSelect(null);
          }
        }}
      >
        <svg
          className="wf-edges"
          width={canvasWidth}
          height={canvasHeight}
          aria-hidden="true"
        >
          <defs>
            <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" className="wf-edge-arrow" />
            </marker>
          </defs>
          {state.draft.edges.map((edge) => {
            const from = state.positions[edge.fromNodeId];
            const to = state.positions[edge.toNodeId];
            if (!from || !to) {
              return null;
            }
            const key = edgeKeyOf(edge);
            const selected = selectedEdgeKey === key;
            const d = edgePath(from, to);
            return (
              <g key={key} className={"wf-edge" + (selected ? " selected" : "")}>
                <path
                  d={d}
                  className="wf-edge-hit"
                  style={{ pointerEvents: "stroke" }}
                  onClick={() => props.onSelect({ kind: "edge", edgeKey: key })}
                />
                <path d={d} className="wf-edge-line" markerEnd="url(#wf-arrow)" />
                <text
                  x={(from.x + NODE_W + to.x) / 2}
                  y={(from.y + to.y) / 2 + NODE_H / 2 - 4}
                  className="wf-edge-label"
                >
                  {edge.outputKey} → {edge.inputKey}
                </text>
              </g>
            );
          })}
          {linking !== null && linkingFromPos !== undefined && (
            <path
              d={edgePath(linkingFromPos, { x: linking.x, y: linking.y })}
              className="wf-edge-linking"
            />
          )}
        </svg>
        {state.draft.nodes.map((node) => {
          const pos = state.positions[node.id] ?? { x: 0, y: 0 };
          const selected = state.selection?.kind === "node" && state.selection.nodeId === node.id;
          const errorCount = issueCounts[node.id] ?? 0;
          const connectSource = pendingConnectFrom === node.id;
          const botName = node.type === "bot" ? botNameOf(bots, node.botId) : null;
          return (
            <div
              key={node.id}
              ref={(el) => props.registerNodeEl(node.id, el)}
              className={
                "wf-node" +
                (node.type === "approval" ? " approval" : "") +
                (selected ? " selected" : "") +
                (connectSource ? " connect-source" : "") +
                (errorCount > 0 ? " has-error" : "")
              }
              style={{ left: pos.x, top: pos.y, width: NODE_W }}
              role="button"
              tabIndex={0}
              aria-label={t("workflow.nodeAriaLabel", [node.id, node.type === "bot" ? "Bot" : t("runs.approval"), errorCount > 0 ? t("workflow.errorCountSuffix", [errorCount]) : ""])}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }
                props.onSelect({ kind: "node", nodeId: node.id });
                const content = contentRef.current;
                if (!content) {
                  return;
                }
                const rect = content.getBoundingClientRect();
                dragRef.current = {
                  nodeId: node.id,
                  offsetX: event.clientX - rect.left - pos.x,
                  offsetY: event.clientY - rect.top - pos.y,
                };
              }}
              onKeyDown={(event) => {
                if (event.key === "Delete" || event.key === "Backspace") {
                  // Selection removal is handled by the window-level editor
                  // shortcut; nodes only make sure they are selected first.
                  event.preventDefault();
                  return;
                }
                if (event.key === "c" || event.key === "C") {
                  event.preventDefault();
                  props.onKeyboardConnect(node.id);
                }
              }}
            >
              <span className="wf-node-type">{node.type === "bot" ? "Bot" : t("runs.approval")}</span>
              <span className="wf-node-title">{node.id}</span>
              <span className="wf-node-sub">
                {node.type === "bot" ? (botName ?? t("workflow.noBotSelected")) : t("workflow.manualApproval")}
              </span>
              <span
                className={"wf-node-badge" + (errorCount > 0 ? " err" : " ok")}
                title={errorCount > 0 ? t("workflow.validationErrorCount", [errorCount]) : t("workflow.validationPassed")}
              >
                {errorCount > 0 ? errorCount : "✓"}
              </span>
              <button
                type="button"
                className="wf-port in"
                aria-label={t("workflow.connectToNodeInput", [node.id])}
                title={t("workflow.inputPort")}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  if (linking !== null && linking.fromNodeId !== node.id) {
                    props.onConnect(linking.fromNodeId, node.id);
                  }
                  setLinking(null);
                }}
              />
              <button
                type="button"
                className="wf-port out"
                aria-label={t("workflow.dragEdgeFromNode", [node.id])}
                title={t("workflow.outputPortHint")}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  const point = contentPoint(event.clientX, event.clientY);
                  setLinking({ fromNodeId: node.id, x: point.x, y: point.y });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Dialog for the two keys a new edge needs (output → input). */
export function EdgeKeyDialog(props: {
  from: string;
  to: string;
  defaultInputKey: string;
  onCancel: () => void;
  onConfirm: (outputKey: string, inputKey: string) => void;
}): JSX.Element {
  const [outputKey, setOutputKey] = useState("out");
  const [inputKey, setInputKey] = useState(props.defaultInputKey);
  const valid = outputKey.trim().length > 0 && inputKey.trim().length > 0;
  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal compact wf-edge-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("workflow.createEdge")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h3>
            {t("workflow.connectFromTo", [props.from, props.to])}
          </h3>
        </header>
        <div className="modal-body wf-dialog-form">
          <label>
            {t("workflow.outputKeyLabel")}
            <input
              className="name-input"
              value={outputKey}
              maxLength={100}
              autoFocus
              aria-label={t("workflow.outputKeyLabel")}
              onChange={(event) => setOutputKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && valid) {
                  props.onConfirm(outputKey.trim(), inputKey.trim());
                }
              }}
            />
          </label>
          <label>
            {t("workflow.inputKeyLabel")}
            <input
              className="name-input"
              value={inputKey}
              maxLength={100}
              aria-label={t("workflow.inputKeyLabel")}
              onChange={(event) => setInputKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && valid) {
                  props.onConfirm(outputKey.trim(), inputKey.trim());
                }
              }}
            />
          </label>
          <p className="wf-dialog-hint">
            {t("workflow.edgeDialogHint")}
          </p>
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost-btn" onClick={props.onCancel}>
            {t("shell.cancel")}
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!valid}
            onClick={() => props.onConfirm(outputKey.trim(), inputKey.trim())}
          >
            {t("workflow.connect")}
          </button>
        </footer>
      </div>
    </div>
  );
}
