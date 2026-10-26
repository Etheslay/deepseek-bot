# D30 聊天运行时报告

日期：2026-10-25。任务：D30 `feature/chat-runtime`（负责人 Etheslay）。依赖 D12（Host/适配层）、D15（工具网关）均已合入。

## 1. 交付内容

| 层 | 实现 |
| --- | --- |
| 契约 | 新增 `chat.send` / `chat.history` / `chat.cancel`（附加式，不改旧方法）；`METHODS` 28 → 31，方法组新增 `chat` |
| 存储 | 迁移 `0005-chat-messages`：`chat_messages(id, bot_id, session_id, role, text, created_at)`；`appendChatMessage` / `listChatMessages` |
| Host | `ChatManager`：每 bot 一个稳定会话 `chat:<botId>`；每轮新建钉扎 Harness attempt，续轮走 `session/resume`（D01 验证过的恢复路径）；会话上下文存 Harness home；`chat.send` 前后落库用户/助手消息；`chat.cancel` 处置活跃 attempt；shutdown 时 `disposeAll` |
| 桌面主进程 | 无新增（复用 `host:call` 白名单，新方法自动放行） |
| 渲染层 | `host-service.ts` 的 `chat.stream` 改为调用 `chat.send`，回复按 32 字符分块投递以保留流式观感；`cancel` 转发 `chat.cancel`；**删除 App 内的占位回复模拟器**（原「（占位回复）已收到…」） |

## 2. 验证

- `pnpm lint` 0；`pnpm typecheck` 0（10 包）；全仓测试通过：contracts 71、storage 128、runtime 128、harness-adapter 52、host 40（+1 skip）、desktop 179；
- 新增测试：storage `chat.test.ts`（2 例）、host `chat.test.ts`（3 例，fake harness 全链路）、desktop `host-service.test.ts` 聊天 3 例；
- 实机探针（假 Key）：聊天发送不再出现占位回复，返回真实失败气泡 `RUNTIME_UNAVAILABLE / 请求失败，请检查模型配置`，证明渲染层→主进程→Host→Harness 链路已通；
- 证据截图：`docs/reports/assets/d30/d30-chat-live.png`。

## 3. 未验证 / 已知边界

- **真实 Key 回复未验证**：本机无可用测试 Key；假 Key 下钉扎 Harness 在 initialize/turn 阶段退出，表现为 RUNTIME_UNAVAILABLE。持有效 Key 应得到真实流式回复（分块投递）；
- 流式是「整轮回复分块」，不是 token 级增量（Harness attempt 的 delta 事件未向渲染层开放通道）；
- 聊天历史回放 UI 未接（`chat.history` 已可用，`listSessions/openSession` 暂返回空）；
- 聊天会话的审批 fail-closed：chat 会话不注册进审批桥，需要审批的工具会被拒绝（安全默认）；
- `chat.cancel` 只能终止当前轮（dispose attempt），不能暂停已完成的轮次。

## 4. 自审记录

（AI 执行记录，需负责人 Etheslay 确认：提交 SHA、检查证据、结论。）


