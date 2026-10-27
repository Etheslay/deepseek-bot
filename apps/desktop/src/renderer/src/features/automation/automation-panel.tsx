/**
 * D20 event automation: trigger rules and their review queue. Rules watch
 * the persisted event stream; firings wait here for a human to start the
 * target workflow or dismiss. Everything is plain text — no HTML injection
 * surface.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";

type TriggerRule = {
  id: string;
  name: string;
  workflowId: string;
  eventType: "run.failed" | "run.completed";
  filterWorkflowId: string | null;
  enabled: boolean;
};

type WorkflowSummary = { id: string; name: string; revision: string };

type Firing = {
  id: string;
  ruleName: string;
  workflowId: string;
  eventType: "run.failed" | "run.completed";
  reason: "event" | "missed";
  status: "pending" | "approved" | "dismissed";
  at: string;
};

const EVENT_LABEL: Record<TriggerRule["eventType"], string> = {
  "run.failed": "运行失败时",
  "run.completed": "运行完成时",
};

export function AutomationPanel(): JSX.Element {
  return (
    <>
      <div className="settings-section-title">事件自动化（规则与评审队列）</div>
      <div className="settings-card">
        <TriggerRules />
        <ReviewQueue />
      </div>
    </>
  );
}

function TriggerRules(): JSX.Element {
  const [rules, setRules] = useState<TriggerRule[] | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [name, setName] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [eventType, setEventType] = useState<TriggerRule["eventType"]>("run.failed");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const [ruleResponse, workflowResponse] = await Promise.all([
      window.deepseekBot.host.call("trigger.list", {}),
      window.deepseekBot.host.call("workflow.list", {}),
    ]);
    const parsedRules = METHOD_CONTRACTS["trigger.list"].response.parse(ruleResponse);
    const parsedWorkflows = METHOD_CONTRACTS["workflow.list"].response.parse(workflowResponse);
    setRules(parsedRules.rules);
    setWorkflows(parsedWorkflows.workflows);
    setNotice((current) => (current === "规则读取失败" ? null : current));
  }, []);

  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setNotice("规则读取失败");
    });
    return () => {
      active = false;
    };
  }, [load]);

  async function save(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || workflowId === "" || busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call("trigger.save", {
        rule: { name: trimmed, workflowId, eventType },
      });
      setName("");
      setNotice("已保存规则（默认关闭）");
      await load();
    } catch {
      setNotice("规则保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: TriggerRule): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call(rule.enabled ? "trigger.disable" : "trigger.enable", {
        id: rule.id,
      });
      setNotice(rule.enabled ? "已停用规则" : "已启用规则");
      await load();
    } catch {
      setNotice("规则更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(ruleId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call("trigger.delete", { id: ruleId });
      setNotice("已删除规则");
      await load();
    } catch {
      setNotice("规则删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div>
        <input
          aria-label="规则名称"
          value={name}
          placeholder="例如：失败即修复"
          onChange={(event) => setName(event.target.value)}
        />
        <select
          aria-label="目标工作流"
          value={workflowId}
          onChange={(event) => setWorkflowId(event.target.value)}
        >
          <option value="">选择要启动的工作流…</option>
          {workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>
        <select
          aria-label="触发事件"
          value={eventType}
          onChange={(event) => setEventType(event.target.value as TriggerRule["eventType"])}
        >
          <option value="run.failed">运行失败时</option>
          <option value="run.completed">运行完成时</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void save()}>
          保存规则
        </button>
      </div>
      {notice !== null ? <div role="status">{notice}</div> : null}
      {(rules ?? []).map((rule) => (
        <div key={rule.id}>
          <span>
            {rule.name}（{EVENT_LABEL[rule.eventType]}）
          </span>
          <span>{rule.enabled ? "已启用" : "已关闭"}</span>
          <button type="button" disabled={busy} onClick={() => void toggle(rule)}>
            {rule.enabled ? "停用" : "启用"}
          </button>
          <button type="button" disabled={busy} onClick={() => void remove(rule.id)}>
            删除
          </button>
        </div>
      ))}
    </div>
  );
}

function ReviewQueue(): JSX.Element {
  const [firings, setFirings] = useState<Firing[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const response = await window.deepseekBot.host.call("trigger.firing.list", {
      status: "pending",
    });
    const parsed = METHOD_CONTRACTS["trigger.firing.list"].response.parse(response);
    setFirings(parsed.firings);
    setNotice((current) => (current === "评审队列读取失败" ? null : current));
  }, []);

  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setNotice("评审队列读取失败");
    });
    return () => {
      active = false;
    };
  }, [load]);

  async function decide(firingId: string, decision: "start" | "dismiss"): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call("trigger.firing.decide", { firingId, decision });
      setNotice(decision === "start" ? "已批准并启动工作流" : "已忽略该触发");
      await load();
    } catch {
      setNotice("评审操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div>评审队列（触发不会自动运行，由你逐条决定）</div>
      {notice !== null ? <div role="status">{notice}</div> : null}
      {(firings ?? []).map((firing) => (
        <div key={firing.id}>
          <span>
            {firing.ruleName}（{EVENT_LABEL[firing.eventType]}
            {firing.reason === "missed" ? "，错过补记" : ""}）
          </span>
          <button type="button" disabled={busy} onClick={() => void decide(firing.id, "start")}>
            启动
          </button>
          <button type="button" disabled={busy} onClick={() => void decide(firing.id, "dismiss")}>
            忽略
          </button>
        </div>
      ))}
      {firings !== null && firings.length === 0 ? <div role="status">队列是空的</div> : null}
    </div>
  );
}
