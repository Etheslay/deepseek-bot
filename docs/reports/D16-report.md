# D16 权限与授权实现报告

日期：2026-10-25。任务：D16 `feature/permissions-grants`（负责人 Etheslay）。依赖 D08、D15 均已合入。

## 1. 交付内容

| 层 | 实现 |
| --- | --- |
| 契约 | 新增 `grant.create/list/revoke`、`policy.get/set`、`tool.invoke`（METHODS 37→含 grant/policy/tool 三组）；`tool.invoke` 是模型调用工具网关的唯一入口，参数只接受注册 schema |
| 存储 | 迁移 `0006-grants`：`grants(id, capability, bot_id, scope, max_uses, used, expires_at, revoked_at, created_at)`；`createGrant/findValidGrant/consumeGrant/revokeGrant/listGrants` |
| Host | `PolicyGate`（三层：策略 → 授权 → 拒绝）接入 D15 `ToolGateway` 的 grant checkpoint；`app.start_run` 固定每次询问、`screen.capture` 固定从不允许；内置 `web_search` 默认始终允许，自定义连接器默认询问；Host 关闭时 gate 放行让下游报正确的 RUNTIME_UNAVAILABLE |
| 渲染层 | 设置页新增「电脑与权限」面板：每能力三档下拉（固定项禁用）、已发放授权列表与撤销；聊天失败气泡在 `UNAUTHORIZED_PATH + grant required:` 时显示授权卡片（仅本次 / 本会话 / 永久允许），点击发 grant 并自动重试 |

## 2. 验证

- `pnpm lint` 0；`pnpm typecheck` 0；全仓测试通过：contracts 71、storage 129（+3 grants）、runtime 128、harness-adapter 52、host 45（+5 permissions）、desktop 179；
- 新增测试：storage `grants.test.ts`（3 例：消费/作用域/过期）、host `permissions.test.ts`（5 例：默认询问、once 消费、always/never、撤销、读层默认放行）；
- 审计：网关原有 jsonl 审计覆盖所有拒绝与成功调用（`logs/agent-tools-audit.jsonl`），grant 拒绝以 `UNAUTHORIZED_PATH + grant required: <capability>` 记录。

## 3. 未验证 / 已知边界

- **模型侧路由未接**：harness-bridge 尚未把上游 tool 请求转发到 `tool.invoke`，因此模型发起的写操作目前仍走契约直连；gate 对「经网关的调用」已生效（含 UI 未来的 tool.invoke 使用）。桥接路由列为 D16 后续小片；
- 设置面板与授权卡片的 UI 截图未留证（本切片以自动化测试为准）；
- `session` 作用域目前按 bot 维度匹配，未绑定 Harness 会话生命周期（重启后同 bot 仍有效，直到用完/过期/撤销）；
- 审批（D09 approval）与 grant 是两条线：grant 管「能不能调」，approval 管「这次调用的参数」。

## 4. 自审记录

（AI 执行记录，需负责人 Etheslay 确认：提交 SHA、检查证据、结论。）
