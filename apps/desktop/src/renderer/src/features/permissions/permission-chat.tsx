/**
 * Chat authorization cards for pending D16 approvals.
 * Lists permission.approval.list for the open bot and decides through
 * permission.approval.decide. Once / session / permanent follow the contract:
 * per-action capabilities and missing sessions cannot take a longer grant.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  PERMISSION_METHODS,
  requiresPerActionApproval,
  type AppApproval,
  type CapabilityId,
  type PermissionDecisionRequest,
} from "@deepseek-bot/contracts";

const CAPABILITY_LABELS: Record<CapabilityId, string> = {
  "app.read": "读取应用数据",
  "app.create_group": "创建分组",
  "app.create_bot": "创建 bot",
  "app.update_bot": "修改 bot",
  "app.create_workflow": "修改工作流",
  "app.start_run": "启动运行",
  "app.cancel_run": "取消运行",
  "app.revoke_creation": "撤销创建批次",
  "interaction.ask_user": "向用户提问",
  "network.search": "联网搜索",
  "memory.read": "检索记忆",
  "memory.write": "写入记忆",
  "fs.read": "读取工作目录文件",
  "fs.write": "写入工作目录文件",
  "exec.shell": "执行本地命令",
  "screen.capture": "屏幕与窗口感知",
  "connector.invoke": "调用连接器",
};

const SESSION_USES = 5;
const SESSION_MINUTES = 120;

type GrantChoice = "once" | "session" | "permanent";
type CardChoice = GrantChoice | "deny";

export function approvalChoices(
  approval: Pick<AppApproval, "capabilities" | "sessionId">,
): GrantChoice[] {
  if (approval.capabilities.some((capability) => requiresPerActionApproval(capability))) {
    return ["once"];
  }
  if (approval.sessionId === null) return ["once", "permanent"];
  return ["once", "session", "permanent"];
}

export function approvalDecision(
  approval: Pick<AppApproval, "id" | "actionDigest">,
  choice: CardChoice,
): PermissionDecisionRequest {
  if (choice === "deny") {
    return {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "denied",
      scope: "once",
    };
  }
  if (choice === "session") {
    return {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "session",
      maxUses: SESSION_USES,
      ttlMinutes: SESSION_MINUTES,
    };
  }
  return {
    approvalId: approval.id,
    expectedActionDigest: approval.actionDigest,
    decision: "approved",
    scope: choice,
  };
}

const CHOICE_LABEL: Record<CardChoice, string> = {
  once: "仅本次",
  session: "本会话",
  permanent: "永久允许",
  deny: "拒绝",
};

function capabilityLine(capabilities: readonly CapabilityId[]): string {
  return capabilities.map((capability) => CAPABILITY_LABELS[capability]).join("、");
}

export function PermissionChatCards({ botId }: { botId: string }): JSX.Element | null {
  // Each bot owns its component lifetime: a completed request from a closed
  // chat must never replace the next bot's approval cards or notices.
  return <BotPermissionChatCards key={botId} botId={botId} />;
}

function BotPermissionChatCards({ botId }: { botId: string }): JSX.Element | null {
  const [approvals, setApprovals] = useState<AppApproval[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = useRef(true);
  const loadSequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    const response = await window.deepseekBot.host.call("permission.approval.list", { botId });
    const parsed = PERMISSION_METHODS["permission.approval.list"].response.parse(response);
    if (!active.current || sequence !== loadSequence.current) return;
    setApprovals(
      parsed.approvals.filter(
        (approval) => approval.status === "pending" && approval.botId === botId,
      ),
    );
    setNotice((current) => (current === "授权请求读取失败" ? null : current));
  }, [botId]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const run = (): void => {
      void load().catch(() => {
        if (!cancelled) setNotice("授权请求读取失败");
      });
    };
    run();
    const timer = setInterval(run, 4_000);
    return () => {
      active.current = false;
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  const choose = (approval: AppApproval, choice: CardChoice): void => {
    setBusyId(approval.id);
    void window.deepseekBot.host
      .call("permission.approval.decide", approvalDecision(approval, choice))
      .then((response) => {
        PERMISSION_METHODS["permission.approval.decide"].response.parse(response);
        if (!active.current) return;
        setNotice(choice === "deny" ? "已拒绝" : `已允许：${CHOICE_LABEL[choice]}`);
        return load();
      })
      .catch(() => {
        if (active.current) setNotice("审批决定失败");
      })
      .finally(() => {
        if (active.current) setBusyId(null);
      });
  };

  if ((approvals === null || approvals.length === 0) && notice === null) return null;

  return (
    <div className="permission-chat-cards">
      {approvals?.map((approval) => {
        const choices = approvalChoices(approval);
        return (
          <div
            key={approval.id}
            className="choice-card"
            role="group"
            aria-label={`授权 ${approval.tool}`}
          >
            <div className="choice-question">是否允许这些操作？</div>
            <p className="choice-answered">申请：{approval.tool}</p>
            <p className="choice-answered">能力：{capabilityLine(approval.capabilities)}</p>
            <p className="choice-answered">待执行参数：</p>
            <pre className="permission-params" aria-label="待执行参数">
              {JSON.stringify(approval.params, null, 2)}
            </pre>
            <p className="choice-answered">仅本次 1 次，到期 {approval.expiresAt}</p>
            {choices.includes("session") ? (
              <p className="choice-answered">
                本会话 {SESSION_USES} 次、{SESSION_MINUTES / 60} 小时
              </p>
            ) : null}
            {choices.includes("permanent") ? <p className="choice-answered">永久不限次数</p> : null}
            <div className="choice-options">
              {choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className="choice-option"
                  disabled={busyId === approval.id}
                  onClick={() => choose(approval, choice)}
                >
                  {CHOICE_LABEL[choice]}
                </button>
              ))}
              <button
                type="button"
                className="choice-option"
                disabled={busyId === approval.id}
                onClick={() => choose(approval, "deny")}
              >
                {CHOICE_LABEL.deny}
              </button>
            </div>
          </div>
        );
      })}
      {notice !== null ? <p className="sys-line">{notice}</p> : null}
    </div>
  );
}
