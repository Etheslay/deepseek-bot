/**
 * D20 event automation: trigger rules and their review queue. Rules watch
 * the persisted event stream; firings wait here for a human to start the
 * target workflow or dismiss. Everything is plain text — no HTML injection
 * surface.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { type MessageKey, type Notice, noticeText, t, useLanguage } from "../../i18n.js";
import { CustomSelect } from "../../components/custom-select.js";

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

const EVENT_LABEL_KEYS: Record<TriggerRule["eventType"], MessageKey> = {
  "run.failed": "automation.eventRunFailed",
  "run.completed": "automation.eventRunCompleted",
};

/** Event labels live in a module table, so they are read through a function. */
export function eventLabel(eventType: TriggerRule["eventType"]): string {
  return t(EVENT_LABEL_KEYS[eventType]);
}

export function AutomationPanel(): JSX.Element {
  return (
    <>
      <div className="settings-section-title">{t("automation.automationSectionTitle")}</div>
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
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);
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
    setNotice((current) => (current?.key === "automation.ruleLoadFailed" ? null : current));
  }, []);

  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setNotice({ key: "automation.ruleLoadFailed" });
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
      setNotice({ key: "automation.ruleSaved" });
      await load();
    } catch {
      setNotice({ key: "automation.ruleSaveFailed" });
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
      setNotice(rule.enabled ? { key: "automation.ruleDisabled" } : { key: "automation.ruleEnabled" });
      await load();
    } catch {
      setNotice({ key: "automation.ruleUpdateFailed" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(ruleId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call("trigger.delete", { id: ruleId });
      setNotice({ key: "automation.ruleDeleted" });
      await load();
    } catch {
      setNotice({ key: "automation.ruleDeleteFailed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div>
        <input
          aria-label={t("automation.ruleNameField")}
          value={name}
          placeholder={t("automation.ruleNamePlaceholder")}
          onChange={(event) => setName(event.target.value)}
        />
        <CustomSelect
          ariaLabel={t("automation.targetWorkflowField")}
          value={workflowId}
          options={[
            { value: "", label: t("automation.selectWorkflowOption") },
            ...workflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
          ]}
          onChange={(next) => setWorkflowId(next)}
        />
        <CustomSelect
          ariaLabel={t("automation.triggerEventField")}
          value={eventType}
          options={[
            { value: "run.failed", label: eventLabel("run.failed") },
            { value: "run.completed", label: eventLabel("run.completed") },
          ]}
          onChange={(next) => setEventType(next as TriggerRule["eventType"])}
        />
        <button type="button" disabled={busy} onClick={() => void save()}>
          {t("automation.saveRule")}
        </button>
      </div>
      {notice !== null ? <div role="status">{noticeText(notice)}</div> : null}
      {(rules ?? []).map((rule) => (
        <div key={rule.id}>
          <span>
            {t("automation.ruleEventSummary", [rule.name, eventLabel(rule.eventType)])}
          </span>
          <span>{rule.enabled ? t("automation.statusEnabled") : t("automation.statusDisabled")}</span>
          <button type="button" disabled={busy} onClick={() => void toggle(rule)}>
            {rule.enabled ? t("automation.disable") : t("automation.enable")}
          </button>
          <button type="button" disabled={busy} onClick={() => void remove(rule.id)}>
            {t("shell.delete")}
          </button>
        </div>
      ))}
    </div>
  );
}

function ReviewQueue(): JSX.Element {
  const [firings, setFirings] = useState<Firing[] | null>(null);
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const response = await window.deepseekBot.host.call("trigger.firing.list", {
      status: "pending",
    });
    const parsed = METHOD_CONTRACTS["trigger.firing.list"].response.parse(response);
    setFirings(parsed.firings);
    setNotice((current) => (current?.key === "automation.reviewQueueLoadFailed" ? null : current));
  }, []);

  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setNotice({ key: "automation.reviewQueueLoadFailed" });
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
      setNotice(decision === "start" ? { key: "automation.workflowApprovedStarted" } : { key: "automation.triggerDismissed" });
      await load();
    } catch {
      setNotice({ key: "automation.reviewActionFailed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div>{t("automation.reviewQueueTitle")}</div>
      {notice !== null ? <div role="status">{noticeText(notice)}</div> : null}
      {(firings ?? []).map((firing) => (
        <div key={firing.id}>
          <span>
            {t("automation.firingEventSummary", [
              firing.ruleName,
              eventLabel(firing.eventType),
              firing.reason === "missed" ? t("automation.missedCatchUp") : "",
            ])}
          </span>
          <button type="button" disabled={busy} onClick={() => void decide(firing.id, "start")}>
            {t("automation.start")}
          </button>
          <button type="button" disabled={busy} onClick={() => void decide(firing.id, "dismiss")}>
            {t("automation.dismiss")}
          </button>
        </div>
      ))}
      {firings !== null && firings.length === 0 ? <div role="status">{t("automation.queueEmpty")}</div> : null}
    </div>
  );
}
