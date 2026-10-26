# Agent tools（D15）

模型工具网关：能力注册、严格参数校验、grant 检查点及摘要审计。Host 负责装配，网关不直接访问数据库。

## `ask_user` 后端切片

`ask_user` 接受 `question`、`options: [{ id, label }]` 与 `allowOther`（默认 `true`）。问题与标签去除首尾空白后必须非空；问题最多 2,000 字符，标签最多 1,000 字符。选项数为 2–4，ID 只能为 A–D 且不能重复。

工具调用返回的 Promise 会等待人类回答。Host 的 `userQuestions.listPending(callerId?)` 返回独立快照，包含请求 ID、所属调用方、问题、选项及创建/过期时间；不应将这个内部控制面直接开放给模型。

```ts
const caller = { id: "chat:<sessionId>/<botId>" };
const result = host.agentTools.call(caller, "ask_user", {
  question: "先处理哪项？",
  options: [{ id: "A", label: "整理资料" }, { id: "B", label: "起草报告" }],
  allowOther: true,
}, { signal });

// 由受信 Host 调用方读取请求，在真正得到人类回答后提交：
host.userQuestions.answer(requestId, caller.id, { optionId: "A" });
// 或 { text: "其他安排" }；两种形式互斥，自由文本去除空白后为 1–4,000 字符。
await result; // { requestId, optionId: "A", text: "整理资料" }
```

`caller.id` 是不透明的所有者标识，不从字符串解析会话或 bot。受信入口必须使用原始调用方 ID；仅凭请求 ID 或不同调用方 ID 不能回答/取消。无效答案不会消费请求，成功答案只消费一次。网关不注册提交答案、取消等待或修改授权的工具。

`userQuestions.cancel(requestId, callerId)` 与调用的 `AbortSignal` 以 `CANCELLED` 结束等待。等待 30 分钟后以 `TOOL_TIMEOUT` 结束；回答入口也会检查期限，迟到答案不能抢在延迟的定时器前生效。Host 关闭以 `RUNTIME_UNAVAILABLE` 结束全部等待，同时清除定时器与监听器；重启不恢复问题。此时上层需要重新发起提问。

问题与答案只存在 Host 内存。JSONL 审计沿用网关的参数/结果 SHA-256 摘要，错误消息使用固定文本。未来聊天接线负责显示卡片并将结构化答案回写会话；本切片没有桌面 IPC、真实 Harness 调用方或会话持久化。

## 检查

`pnpm --filter @deepseek-bot/agent-tools test`（含覆盖率）与 `pnpm --filter @deepseek-bot/agent-tools typecheck`。Host 集成验证位于 `packages/host/src/ask-user.test.ts`。
