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

## 5. 后续修复（复测：Key 测试成功但聊天无响应）

实机复测定位到三个缺陷，均已修复：

1. **忙碌标记泄漏**：`resolveBotInputs` 与 Harness 解析在 `try` 之外抛错时 `busy` 永远为 `true`，之后每条消息都返回「already answering」。现全部移入 `try/finally`。
2. **会话 id 复用冲突**：钉扎 Harness 拒绝复用已存在的 session（`session "...": already exists`），`session/resume` 也只在同一 runtime 内有效。改为**每轮新建 session**，由 Host 从 `chat_messages` 回放最近 20 条历史作为上下文，多轮语义仍然成立。
3. **失败原因不可见**：聊天失败只显示通用文案。失败气泡现在附带 Host 返回的真实 `message`（分类后的 provider 原文）。

实机验证（用户临时 Key，仅以 safeStorage 密文存于本机 `.tmp` 数据根，未提交、未入库）：`chat.send` 返回真实回复「我是由 DeepSeek Harness 驱动的 AI 编程助手，当前使用的模型是 deepseek-chat」；追问「刚才我们聊了什么」能正确复述上文。截图：`assets/chat-diag/chat-real-reply.png`。

新增诊断开关：`DSB_HOST_DEBUG=1` 时桌面主进程把 Host 的 stderr 转发到控制台。

**仍存在的集成缺口**：`installBridgeIntoProfile` 从未在 Host 启动时调用，真实运行的 profile 里没有 `@deepseek-bot/harness-bridge`，钉扎 Harness 会打印 `warning: 1 entry did not activate`，审批桥在真实聊天/运行中不生效（基础聊天不受影响）。列为 D16 后续小片。
