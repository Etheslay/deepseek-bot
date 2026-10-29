# 上下文圆圈（用量可视 + 80% 自动压缩）报告

分支：`feature/context-meter` · 目标 `develop` · 契约：新增受信方法 `chat.contextUsage`（附加式，不升 `protocolVersion`）· 迁移 `0023-chat-summaries` · 任务书：[TASK_CONTEXT_METER](../TASK_CONTEXT_METER.md)

## 1. 做了什么

| 层 | 内容 |
| --- | --- |
| 契约 | `chat.contextUsage {botId}` → `{percent, usedTokens, windowTokens, estimated, compressedAt, compressing}`；CONTRACTS.md 补记（附加式） |
| 存储 | 迁移 `0023-chat-summaries`：`chat_summaries(bot_id, session_id, summary, covers_message_id, created_at)`，每 bot 会话一行；`repos/chat-summaries.ts`（get/upsert 覆盖式/delete）；`usage.ts` 增 `getLatestUsageForBot`。备份为整库快照自动随行；**`chat_messages` 行不删除**——删摘要行即恢复全量回放 |
| Host 计量 | `HostOptions.contextWindowTokens`（默认 65,536；per-model 精确窗口列为后续）。百分比口径：无摘要时取最近完成回合的真实 input tokens（`source='harness'`，否则估算标 `estimated`）；有摘要时按 chars/4 估算"下次提示组装量"（persona+摘要+水位后行+2k 富余）——这正是压缩后**立刻刷新**的数字 |
| Host 压缩 | 回合完成后后台触发（fire-and-forget，不阻塞回复返回）：percent ≥ 80 → 把除最近一轮外的全部行折叠为一次摘要回合（`ChatManager.compressTurn`：复用既有回合机制，**不写 chat_messages、无审批面**，用量照记 `usage_events`）；摘要 + 水位落库（增量合并：带上一次摘要要求合并重写）；`compressing` 内存标志防重入；失败静默降级保持现状回放，下次过阈值再试 |
| Host 组装 | `composePrompt` 支持 `summary`：有摘要时插入 `【更早对话摘要】` 块（技能块之后、最近对话之前），回放只带水位后的行；与原始人模式互不干扰（primitive 本就不回放） |
| 渲染层 | 新组件 `features/chat/context-ring.tsx`：SVG 圆环 + 悬停「上下文已用 {N}%」，≥80% 警示色；位于 composer 模式开关组与麦克风之间，**纯展示，无任何开关职责**；刷新时机 = 打开会话 / 每次回合 settle / `compressing=true` 时 2 秒后再查；fixture 返回诚实空值（浏览器预览 0%） |
| i18n/样式 | `shell.contextUsed`（zh/en）；`.context-ring` 圆环样式（track/fill/warn/value） |

## 2. 验证证据

环境：Windows 11 x64 · Node 24.16.0 · pnpm 11.28.5 · 基线 `origin/develop` = `fde0953`（PR #137）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 存储层 | `pnpm --filter @deepseek-bot/storage test` | 27 文件 / 223 用例全过（新增 chat-summaries 4 例：空态/upsert 覆盖/删除恢复/按 bot 隔离；既有迁移不变量 `schemaVersion === MIGRATIONS.length` 保持——本片迁移重编号为 0023，紧跟互通片 0022） |
| Host 计量与压缩 | `pnpm --filter @deepseek-bot/host test` | 287 过 / 1 skip / 1 失败（`screen-distribution`，本机环境既有，基线同样失败）。新增 context-meter 4 例全过：① 空会话 percent 0；② **自动压缩 e2e**（8k 窗口 + 大消息若干轮）：≥80% 触发 → `chat_summaries` 落行 → 百分比立刻回落（<80，估算口径）→ `chat_messages` 行数不减 → 下一轮 prompt 含 `【更早对话摘要】` 且位于 `【最近对话】` 之前、回放段以水位后第一行开头；③ 低于阈值不压缩；④ 带摘要的下一轮提示形状（echo 场景：摘要块 + 水位过滤 + `[用户消息]` 位置） |
| 渲染层 | `pnpm --filter @deepseek-bot/desktop test` | 66 文件 / 588 用例全过（新增 context-ring 3 例：76% 弧长与悬停文案、80% 警示色、空态安静圆环；i18n 扫描过） |
| 契约 | `pnpm --filter @deepseek-bot/contracts test` | 149/149 全过（METHODS 119→120 白名单断言同步） |
| 全仓 | `pnpm -r --no-bail run test` | 其余包全绿；唯一失败 exec-daemon `windows.real` 为本机环境既有（基线同样失败，2026-10-28 对照复跑） |
| 静态 | `pnpm lint`；`pnpm typecheck` | eslint 0 问题；10 包 tsc 全过 |

## 3. 未验证（明确列出，不声称通过）

- **真实模型未跑**（当前指示：不发起付费调用）：摘要质量、真实窗口（DeepSeek 官方 64K/128K 差异）下的百分比准确度、压缩回合的延迟体感，均只有假场景背书（`ok` 场景摘要为固定短回复，`echo` 场景验证提示形状）。
- **真机 Electron 未跑**：圆圈悬停观感、两主题样式、压缩中的二次刷新节奏无截图。
- exec-daemon `windows.real` 与 host `screen-distribution` 本机失败为环境既有。

## 4. 风险与回退

- 摘要质量依赖模型；丢失关键细节时删除 `chat_summaries` 对应行即恢复全量回放（无 UI，手工 SQL 路径，报告如实注明）。
- 后台压缩回合与用户下一条消息并发：ChatManager 每 bot 忙锁下，压缩占用期间新 sends 排队（既有 RATE_LIMITED 语义）；压缩提示已限字数（行 800/总 24k）以缩短窗口。
- 压缩回合的用量照记 `usage_events`（真实成本）：账单页会出现一条不对应可见消息的行，属已知表现。
- 迁移编号说明：初版曾取 0022，与后合入的互通片（PR #136，`0022-task-idempotency`）冲突；变基后本片重编号为 **0023**，与 develop 现状连续。
- 回退：`git revert -m 1 <merge-sha>`；迁移 0023 只加新表，回退需连数据库备份（`DATA_VERSION_UNSUPPORTED` 既有口径）。

## 5. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
