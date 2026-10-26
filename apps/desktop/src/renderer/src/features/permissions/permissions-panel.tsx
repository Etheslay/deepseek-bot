/**
 * Settings panel for the D16 permission model: per-capability policy
 * (始终允许 / 每次询问 / 从不允许) plus the human-issued grant list with
 * revoke. Reads and writes go through the contract (`policy.*`, `grant.*`).
 */
import { useCallback, useEffect, useState } from "react";

type PolicyLevel = "always" | "ask" | "never";

interface GrantRow {
  readonly id: string;
  readonly capability: string;
  readonly botId: string | null;
  readonly scope: "once" | "session" | "persistent";
  readonly maxUses: number;
  readonly used: number;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

const CAPABILITY_LABELS: Record<string, string> = {
  "app.read": "读取应用数据（列表 / 运行详情）",
  "app.write": "创建或修改 Bot、分组与工作流草案",
  "connector.invoke": "调用连接器（联网搜索等）",
  "app.start_run": "启动工作流运行（固定每次询问）",
  "screen.capture": "窗口截图与 OCR（固定从不允许）",
};

const POLICY_LABELS: Record<PolicyLevel, string> = {
  always: "始终允许",
  ask: "每次询问",
  never: "从不允许",
};

const FORCED = new Set(["app.start_run", "screen.capture"]);

export function PermissionsPanel() {
  const [policies, setPolicies] = useState<Record<string, PolicyLevel> | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const [policyResponse, grantResponse] = await Promise.all([
      window.deepseekBot.host.call("policy.get", {}) as Promise<{
        policies: Record<string, PolicyLevel>;
      }>,
      window.deepseekBot.host.call("grant.list", {}) as Promise<{ grants: GrantRow[] }>,
    ]);
    setPolicies(policyResponse.policies);
    setGrants(grantResponse.grants);
  }, []);

  useEffect(() => {
    void reload().catch(() => setNotice("权限数据读取失败"));
  }, [reload]);

  if (policies === null) {
    return null;
  }

  return (
    <div className="settings-card">
      <div className="settings-row">
        <span>模型能力策略</span>
        <span className="settings-soon">调用工具前先过策略与授权</span>
      </div>
      {Object.entries(policies).map(([capability, policy]) => (
        <div className="settings-row" key={capability}>
          <span>{CAPABILITY_LABELS[capability] ?? capability}</span>
          <select
            className="settings-select"
            value={policy}
            disabled={FORCED.has(capability)}
            aria-label={`${capability} 策略`}
            onChange={(event) => {
              const next = event.target.value as PolicyLevel;
              void window.deepseekBot.host
                .call("policy.set", { capability, policy: next })
                .then(() => {
                  setNotice(`已保存：${CAPABILITY_LABELS[capability] ?? capability} → ${POLICY_LABELS[next]}`);
                  void reload();
                });
            }}
          >
            {(Object.keys(POLICY_LABELS) as PolicyLevel[]).map((level) => (
              <option key={level} value={level}>
                {POLICY_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="settings-row">
        <span>已发放授权</span>
        <span className="settings-soon">{grants.length === 0 ? "暂无" : `${grants.length} 条`}</span>
      </div>
      {grants.slice(0, 8).map((grant) => (
        <div className="settings-row" key={grant.id}>
          <span>
            {grant.capability} · {grant.scope} ·{" "}
            {grant.revokedAt !== null
              ? "已撤销"
              : `已用 ${grant.used}/${grant.maxUses === 0 ? "∞" : grant.maxUses}`}
          </span>
          {grant.revokedAt === null ? (
            <button
              type="button"
              className="pill-btn"
              onClick={() => {
                void window.deepseekBot.host
                  .call("grant.revoke", { id: grant.id })
                  .then(() => {
                    setNotice("授权已撤销");
                    void reload();
                  });
              }}
            >
              撤销
            </button>
          ) : null}
        </div>
      ))}
      {notice !== null ? <p className="settings-ok">{notice}</p> : null}
    </div>
  );
}
