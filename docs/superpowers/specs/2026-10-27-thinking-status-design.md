# 「思考中」状态行设计（任务相关文案）

日期：2026-10-27。负责人：Destinyian。状态：设计已确认，实现中。

## 0. 问题与边界

聊天等待回复时，气泡里只有 `…`（`App.tsx` 的 `{stream.text || "…"}`），用户无法感知"在推进"以及"在推进什么"。

当前链路的硬事实：`chat.send` 一次性返回 `{sessionId, messageId, text, at}`，**没有思考流**；`service.chat.stream` 只回调 `onDelta`，连 `onTool` 都没有接。因此"模型真实在做什么"拿不到，唯一可用的任务信息是**用户这条请求文本**。

本轮只做渲染层：按请求文本归类意图 + 回显兜底 + 耗时读数。真实思考流（需改 `harness-adapter` / `host` 与契约）与工具活动文案（需先接 `onTool`）留给后续，明确记录为缺口。

## 1. 纯函数 `features/chat/thinking-status.ts`

```ts
export type ThinkingStatus = { readonly text: string; readonly hint: string | null };
export type ThinkingStatusInput = {
  request: string;     // 用户这条消息的原文（不含技能上下文）
  elapsedMs: number;   // 气泡已存在时长
  hasText: boolean;    // 首个回复分块是否已到达
};
export function thinkingStatus(input: ThinkingStatusInput): ThinkingStatus | null;
export function summarizeRequest(request: string): string;
export function formatElapsed(ms: number): string;
```

规则（顺序即优先级）：

1. `hasText` → `null`（气泡交给正文渲染）。
2. 意图词表命中 → `text` 为对应文案（见下表）。
3. 未命中 → `text = 正在处理「<摘要>」`；请求为空（或全是空白/只有 @提及）→ `正在处理…`。
4. `elapsedMs >= 10_000` → `hint = "<秒>s"`，否则 `null`。**秒数单独返回**而不是拼进 `text`：`text` 进 `aria-live` 朗读区，秒数每秒变化必须排除在朗读之外。

意图词表（有序，首个命中生效）：

| 触发词（正则，忽略大小写） | 文案 |
| --- | --- |
| 工作流、workflow、编排 | 正在起草工作流 |
| 搜索、搜一下、查一下、查询、资料、联网、上网 | 正在查资料 |
| 记忆、笔记、知识 | 正在翻记忆 |
| 代码、实现、重构、测试、函数、bug、报错 | 正在读代码 |
| 评审、检查、审阅、复查 | 正在评审 |
| 计划、方案、设计、架构 | 正在拟定方案 |
| 文件、文档、整理、总结、周报、纪要 | 正在整理内容 |

`summarizeRequest`：去掉行首/行中的 `@提及`，把连续空白压成单空格，首尾去空白，超过 24 个字符截断并追加 `…`。

## 2. 渲染 `features/chat/thinking-line.tsx`

- 自带 1 秒 `setInterval`，卸载时清理；起始时刻取组件挂载时间（不改 `StreamState` 模型，避免动 reducer 与其用例）。
- 结构：`<span role="status" aria-live="polite">{text}</span>` + `<span aria-hidden="true">{hint}</span>`。
- 挂载位置：替换 `App.tsx` 流式气泡里的 `…`，请求文本由 `startChatStream` 记入的 `streamRequest` 状态提供（该状态与 `stream` 同时设置，切换 bot 时随面板重建）。

## 3. 测试 `tests/features/thinking-status.test.ts`

- 七类意图各命中一次；
- 未命中 → 回显摘要；超长请求截断到 24 字 + `…`；
- `@提及` 与多余空白被清理；空请求 → `正在处理…`；
- 9_999ms 无 hint、10_000ms 起 hint 为 `10s`；
- `hasText` 返回 `null`；
- 多个词表同时命中时按表序取第一个。

## 4. 缺口（如实记录）

- 文案是"请求文本 + 词表"推测，不是模型自报，也不反映真实思考内容；
- 工具活动（`onTool`）未接入，工具阶段仍显示同一句；
- 文案未抽词条，双语（D22）时需迁移；
- 未处理"请求与后续工具调用不一致"的情况（例如用户说"看看这个"，词表不会命中，只回显）。

## 5. v2：等待态头像球 + 流光 + 真实事件驱动文案（2026-10-27，需求人：Destinyian）

用户拍板三点，并明确否决了"按时间跳变的固定文案"（那是一段不动的假文字）：

1. **等待态头像球**：首块回复分块到达前，流式行显示 bot 的 GrokBall（`AvatarView` 新增 `state` 覆盖参数）+ 状态行 + 取消按钮；文本到达后恢复普通气泡（无名字、无头像）。
2. **流动光亮**：可见状态文字以 `background-clip: text` 线性渐变扫光（2s 循环），`prefers-reduced-motion` 降级为静态灰。
3. **文案必须来自真实过程**：Harness 子进程在整个回合期间实时推送 `session.event`（收据 → tool/call → tool/result → turn/end，含工具名与参数）。真实链路：
   - `harness-adapter` 的 `runTurn` 增加可选 `onEvent`，把收据之后的事件实时回调；
   - host `ChatManager` 把事件镜像为每 bot 的 `TurnProgress`（preparing → thinking → tool[toolName] → thinking，finally 归 idle），新增 `status(botId)`；
   - 契约新增 **`chat.status`**（小型契约面：request `{botId}`，response `{active, stage, toolName?, startedAt?}`）——按仓库规范本应独立契约 PR 先行，本分支合并为同一 PR，评审时请把契约面单独过目；
   - renderer 的 `ThinkingLine` 每秒轮询 `chat.status`（与 question.list 同款轮询模式），文案严格映射真实阶段：`正在准备` / `正在深度思考` / `正在调用 {toolName}`；10s 耗时提示保留；不再有基于时钟的假阶段（正在查阅文档/正在完成已删除），请求回显文案一并移除。

无障碍：可见阶段文案随真实事件变化，保持 `aria-hidden`；`aria-live` 朗读区只播报稳定的「正在处理…」一句。头像球状态映射：thinking 阶段 = 球的 `thinking` 态，tool 阶段 = `working` 态——也是真实数据。

诚实边界：`chat.send` 仍一次性返回最终文本（假分块喂 `onDelta` 的现状未动）；本设计只把**工具活动与阶段**实时化，逐 token 流式仍是后续工程。
