/**
 * Settings panel for the D16 permission model: per-capability policy
 * (始终允许 / 每次询问 / 从不允许) plus issued grant records with revoke.
 * Reads and writes go through `permission.policy.*` and `permission.grant.*`.
 */
import { useCallback, useEffect, useState } from "react";
import {
  PERMISSION_METHODS,
  isPermissionModeAllowed,
  type CapabilityId,
  type PermissionGrant,
  type PermissionMode,
} from "@deepseek-bot/contracts";

const MODE_LABELS: Record<PermissionMode, string> = {
  allow: "始终允许",
  ask: "每次询问",
  deny: "从不允许",
};

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
  "fs.read": "读取工作目录文件",
  "fs.write": "写入工作目录文件",
  "exec.shell": "执行本地命令",
  "screen.capture": "屏幕与窗口感知",
  "connector.invoke": "调用连接器",
};

const SCOPE_LABELS = {
  once: "本次",
  session: "本会话",
  permanent: "永久",
} as const;

const MODES = ["allow", "ask", "deny"] as const satisfies readonly PermissionMode[];

type IssuedGrant = PermissionGrant & { scope: keyof typeof SCOPE_LABELS };

function isIssuedGrant(grant: PermissionGrant): grant is IssuedGrant {
  return grant.scope === "once" || grant.scope === "session" || grant.scope === "permanent";
}

function allowedModes(capability: CapabilityId): PermissionMode[] {
  return MODES.filter((mode) => isPermissionModeAllowed(capability, mode));
}

function isMode(value: string): value is PermissionMode {
  return value === "allow" || value === "ask" || value === "deny";
}

type HostCall = (method: string, payload: unknown) => Promise<unknown>;

async function loadPermissionSettings(call: HostCall): Promise<{
  policies: { capability: CapabilityId; mode: PermissionMode }[];
  grants: IssuedGrant[];
}> {
  const [policyResponse, grantResponse] = await Promise.all([
    call("permission.policy.list", {}),
    call("permission.grant.list", {}),
  ]);
  return {
    policies: PERMISSION_METHODS["permission.policy.list"].response.parse(policyResponse).policies,
    grants: PERMISSION_METHODS["permission.grant.list"].response
      .parse(grantResponse)
      .grants.filter(isIssuedGrant),
  };
}

function grantUsage(grant: IssuedGrant): string {
  if (grant.revokedAt !== null) return "已撤销";
  const limit = grant.maxUses === null ? "不限" : String(grant.maxUses);
  return `已用 ${grant.uses}/${limit}`;
}

export function PermissionsPanel() {
  const [policies, setPolicies] = useState<
    { capability: CapabilityId; mode: PermissionMode }[] | null
  >(null);
  const [grants, setGrants] = useState<IssuedGrant[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const snapshot = await loadPermissionSettings((method, payload) =>
      window.deepseekBot.host.call(method, payload),
    );
    setPolicies(snapshot.policies);
    setGrants(snapshot.grants);
  }, []);

  useEffect(() => {
    void reload().catch(() => {
      setNoticeError(true);
      setNotice("权限数据读取失败");
    });
  }, [reload]);

  if (policies === null) {
    return (
      <div className="settings-card">
        <p className={noticeError ? "form-error" : "settings-soon"}>{notice ?? "正在读取权限…"}</p>
      </div>
    );
  }

  const savePolicy = (capability: CapabilityId, mode: PermissionMode): void => {
    if (!isPermissionModeAllowed(capability, mode)) return;
    void window.deepseekBot.host
      .call("permission.policy.set", { capability, mode })
      .then((response) => {
        PERMISSION_METHODS["permission.policy.set"].response.parse(response);
        setNoticeError(false);
        setNotice(`已保存：${CAPABILITY_LABELS[capability]} → ${MODE_LABELS[mode]}`);
        return reload();
      })
      .catch(() => {
        setNoticeError(true);
        setNotice("策略保存失败");
      });
  };

  return (
    <div className="settings-card">
      <div className="settings-row">
        <span>模型能力策略</span>
        <span className="settings-soon">调用工具前先过策略与授权</span>
      </div>
      {policies.map((policy) => {
        const choices = allowedModes(policy.capability);
        return (
          <div className="settings-row" key={policy.capability}>
            <span>{CAPABILITY_LABELS[policy.capability]}</span>
            <select
              className="settings-select"
              value={policy.mode}
              disabled={choices.length < 2}
              aria-label={`${policy.capability} 策略`}
              onChange={(event) => {
                const next = event.target.value;
                if (isMode(next)) savePolicy(policy.capability, next);
              }}
            >
              {choices.map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <div className="settings-row">
        <span>已发放授权</span>
        <span className="settings-soon">
          {grants.length === 0 ? "暂无" : `${grants.length} 条`}
        </span>
      </div>
      {grants.map((grant) => (
        <div className="settings-row" key={grant.id}>
          <span>
            {CAPABILITY_LABELS[grant.capability]} · {SCOPE_LABELS[grant.scope]} ·{" "}
            {grantUsage(grant)}
          </span>
          {grant.revokedAt === null ? (
            <button
              type="button"
              className="pill-btn"
              onClick={() => {
                void window.deepseekBot.host
                  .call("permission.grant.revoke", { grantId: grant.id })
                  .then((response) => {
                    PERMISSION_METHODS["permission.grant.revoke"].response.parse(response);
                    setNoticeError(false);
                    setNotice("授权已撤销");
                    return reload();
                  })
                  .catch(() => {
                    setNoticeError(true);
                    setNotice("撤销失败");
                  });
              }}
            >
              撤销
            </button>
          ) : null}
        </div>
      ))}
      {notice !== null ? (
        <p className={noticeError ? "form-error" : "settings-ok"}>{notice}</p>
      ) : null}
    </div>
  );
}
