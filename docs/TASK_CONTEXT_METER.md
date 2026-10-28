# 任务书：上下文圆圈 —— 用量可视与 80% 自动压缩

| 项 | 值 |
| --- | --- |
| 性质 | 任务书 + 实现方案（二合一）；实现随本分支提交 |
| 分支 | `feature/context-meter` → PR 目标 `develop` |
| 基线 | `origin/develop` = `fde0953`（PR #137，原始人模式已合入） |
| 上游 | TurnUsageAccumulator（真实/估算用量）、`usage_events`（0021）、D30 单会话 `chat:<botId>`、composePrompt 历史回放——全部复用；仓库此前**没有**会话摘要或历史裁剪，本任务引入 |
| 契约 | 新增受信方法 `chat.contextUsage`（只读）；附加式不升 `protocolVersion`，CONTRACTS.md 补记 |
| 红线 | 圆圈只表示用量，不承载原始人/深度思考；**历史行不删除**（压缩=摘要+水位，落库完整保留）；验证不发起付费模型调用（真实模型路径由假场景背书） |
| 负责人 | 待认领；自审由负责人本人签署 |

## 1. 背景与现状（证据，2026-10-28 对 `fde0953`）

- `composePrompt` 每轮回放最近 20 条历史（`chat_messages`），长会话的输入上下文线性增长，用户不可见、也不会收缩——"长会话静默失忆/爆窗"无人管理（G13 只做了可见性设想，无计量无压缩）。
- 用量侧已有真实信号：每回合结束 `TurnUsageAccumulator` 产出 `{inputTokens, estimated}`（Harness 上报或 chars/4 估算）写入 `usage_events(bot_id, model, session_id, input_tokens, …, source)`。
- 渲染层 composer 已有 `.composer-modes`（原始人/深度思考 chips）；本任务新增的圆圈是**第三个独立元素**，只显示用量。

## 2. 需求（验收）

1. 发消息处出现一个**圆圈**，悬停显示「上下文已用 {N}%」；圆圈只表示用量，与原始人/深度思考互不相干；
2. 用量 ≥ **80%** 时自动压缩**更早**的历史：保留最近一轮（最后一条 user+assistant）与当前用户消息；压缩后**立刻**刷新百分比；绝不等到 100%；
3. 百分比口径：分母 = 上下文窗口（Host 配置，默认 65,536 tok；per-model 精确窗口列为后续）；分子 = 最近一次完成回合的真实 `input_tokens`（`usage_events.source='harness'`），无真实上报时用 chars/4 估算并标 `estimated`；
4. **压缩 = 摘要 + 水位，不删历史**：更早的行压缩成一段要点摘要存 `chat_summaries`（每 bot 单会话一行，覆盖式），记录水位（覆盖到哪条消息）；此后提示组装 = persona + 技能块 + `【更早对话摘要】` + 水位之后的行 + `[用户消息]`；`chat_messages` 行**完整保留**（`chat.history` 回放、任务派发标记、D25 检索都不受影响）；
5. 摘要回合用该 bot 自己的模型 profile 跑一个后台压缩回合（这是真实 token 消耗，`usage_events` 照记）；失败降级：不写摘要、保持现状回放，下回合过阈值再试；
6. 压缩在后台执行（不阻塞当轮回复返回）；压缩进行中 `contextUsage` 返回 `compressing: true`，圆圈随后自动再刷新。

## 3. 实现方案

### 3.1 存储（迁移 `0022-chat-summaries`）

```sql
CREATE TABLE chat_summaries (
  bot_id TEXT NOT NULL REFERENCES bots(id),
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  covers_message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, session_id)
);
```
仓库 `repos/chat-summaries.ts`：`getChatSummary(db, botId, sessionId)` / `upsertChatSummary(db, {botId, sessionId, summary, coversMessageId})`（覆盖式）；`usage.ts` 增 `getLatestUsageForBot(db, botId)`（最近一行，含 `source`）。备份为整库快照，新表自动随行。

### 3.2 契约（`packages/contracts` + CONTRACTS.md）

`chat.contextUsage`：`{botId}` → `{percent: int 0–100, usedTokens: int, windowTokens: int, estimated: boolean, compressedAt: ISO|null, compressing: boolean}`。注释写明口径（真实优先、估算标注）。CONTRACTS.md 补一段（附加式，不升版本）。

### 3.3 Host（`packages/host`）

- `HostOptions.contextWindowTokens?: number`（默认 65,536），经 handlers context 下发；
- `chat.ts`：
  - `composePrompt(bot, text, history, skills, opts?: { primitive?, summary? })`：有 summary 时插入 `【更早对话摘要】\n…` 块（位于技能块之后、最近对话之前）；
  - 新增 `compressTurn(bot, prompt): Promise<{ text, usage }>`——复用既有回合机制（resolveBotInputs → prepareProfile → openTurn → attempt → runTurn），**不写** `chat_messages`、不走审批（无工具调用面）；usage 经既有 `onTurnUsage` 照记。
- `handlers.ts`：
  - `chat.send`：装 prompt 时读 `chat_summaries`——水位后的行才进入回放历史（行本身不删）；回合完成后 `void maybeCompress(bot)`（fire-and-forget）；
  - `maybeCompress`：按 §2.3 口径算 percent；≥80 且水位未覆盖到最后一轮 assistant 行 → 取"除最后一轮外的全部行"拼待压缩文本 → `chat.compressTurn` → `upsertChatSummary`；全程 try/catch（失败即放弃本次）；
  - `chat.contextUsage`：有摘要 → chars/4 估算（persona + 摘要 + 水位后行 + 富余 2k）；否则最近 `usage_events` 行（真实或估算）；`compressedAt` = 摘要行 `created_at`；`compressing` = 内存标志（per createHost 闭包）；
  - 估算函数 `estimateTokens(text) = ceil(chars/4)` 与 TurnUsageAccumulator 同口径。
- 待压缩文本逐行截断（每行 ≤800 字、总 ≤24k 字符），摘要提示要求"保留任务、结论、决定、未决事项；不寒暄不复述"。

### 3.4 渲染层（`apps/desktop`）

- 新组件 `features/chat/context-ring.tsx`：SVG 圆环（`stroke-dasharray` 按百分比），≥80% 变警示色；`title` 悬停「上下文已用 {0}%」；只读展示，无任何开关职责；
- `desktop-service.ts`：`chat` 节新增 `contextUsage(botId): Promise<ContextUsageView>`；`host-service` 直调契约方法并解析；fixture 返回全零（浏览器预览诚实空态）；
- `App.tsx` composer（`BotsPlaceholder`）：挂 `<ContextRing>`（位于模式开关组与麦克风之间）；查询时机 = 选中 bot 打开、每次回合 settle 后、`compressing === true` 时 2 秒后再查一次；
- i18n：`shell.contextUsed`（上下文已用 {0}% / Context {0}% used）；样式 `.context-ring`。

### 3.5 测试

- **storage**：`chat-summaries.test.ts`（upsert 覆盖、get、主键幂等）+ `usage` 最新行查询；
- **host `chat.test.ts` / 新文件 `context-meter.test.ts`**：
  1. 有摘要的下一轮：prompt 含 `【更早对话摘要】` 与最近一轮，不含水位之前的行；
  2. 自动压缩 e2e（`contextWindowTokens` 调小 + echo-model）：一条足够长的消息后过阈值 → `chat_summaries` 落行、`chat.contextUsage` percent 显著下降且 `compressedAt` 非空、`chat_messages` 行数不减；
  3. 低于阈值不压缩、无摘要行；
  4. 摘要回合失败（假场景抛错）→ 无摘要行、下一轮行为与现状一致（降级）；
  5. `chat.contextUsage` 空会话返回 percent 0。
- **desktop**：`context-ring.test.ts`（百分比渲染、title 文案、≥80% 警示类名）；store/服务无新增状态面。

## 4. 边界与非目标

- per-model 精确上下文窗口（chat/reasoner 官方窗口差异）不做——单一 Host 配置 + 默认值，任务书声明；
- 压缩不追求"摘要质量最优"（无分层/多段摘要）；摘要提示词为一版，后续可调；
- 不做手动"立即压缩"按钮（只做自动阈值触发）；不做裁剪恢复/撤销（原历史完整保留，天然可逆——删摘要行即回到全量回放）；
- 不改原始人/深度思考任何逻辑（primitive 本就不回放历史，圆圈仍按上轮真实用量显示）；
- 摘要回合的用量照记 `usage_events`（真实成本，不隐藏）；账单页会出现无 session 对应消息的行，属已知表现（报告注明）。

## 5. 风险与回退

- 摘要质量依赖模型：压缩后若丢关键细节，用户可删 `chat_summaries` 行恢复全量回放（未提供 UI，报告注明手工 SQL 路径）；
- 后台压缩回合与用户下一条消息并发：ChatManager 每 bot 忙锁下，压缩回合占用期间新 sends 会排队（RATE_LIMITED 语义既有）——压缩回合应尽量短（提示已限字数）；把并发窗口如实告知；
- 回退：`git revert -m 1 <merge-sha>`；迁移 0023 只加新表，回退需连数据库备份（`DATA_VERSION_UNSUPPORTED` 既有口径）。

## 6. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
