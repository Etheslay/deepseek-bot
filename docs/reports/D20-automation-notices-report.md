# D20' 自动化状态聊天通知：本地事件规则 → bot 聊天通知条（后端片）

日期：2026-10-29（Asia/Shanghai）。负责人：Etheslay。分支：`feature/d20-automation-notices-3c7a`。基线：`968aa0b`（origin/develop，含 PR #125 G3）。对应 [GAP_AUDIT](../GAP_AUDIT.md) D20' 的后端半边（通知条渲染归桌面，本片不改渲染层）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论；自审必须针对该分支最新提交 SHA。

## 1. 交付行为

对标 Grok Bot 交互 #5：例行任务的禁用/错过不静默，以系统通知条出现在聊天内。数据面与写入面在本片交付：

| 块 | 实现 |
| --- | --- |
| 契约 | `ChatMessageMetaSchema` 新增 `kind: "automation"` 成员：`{ruleId: UUID, outcome: started\|skipped\|review\|enabled\|disabled\|deleted, runId: UUID\|null, reason?: string≤200}`。附加式（新联合成员），旧 meta 行与旧接收方不受影响 |
| 运行时钩子 | `evaluateEventRules(db, engine, hooks?)` 新增可选 `onRuleOutcome`：started / skipped（含"规则已停用"、"源运行由规则启动"、"触发失败"）/ review 三类结果各发一条通知；钩子抛错被吞、绝不影响评估与游标推进 |
| 通知写入 | Host 侧 `automation-notices.ts` `writeAutomationNotice`：把钩子/状态变更写成该规则所属 bot 聊天里的一条 meta 行（role assistant），文案按 live UI 语言（zh/en）在写入时定稿——与管理编排通知同语义（存储行回放进模型上下文，语言切换只影响之后的行）；写入尽力而为，失败只留本机诊断，不影响扫描/运行/设置变更 |
| 状态变更 | `eventRule.enable / disable / review` 在真实状态变化时各写一条通知（幂等重复调用不重复写；delete 方法不存在，`deleted` 枚举留待未来） |
| 边界 | `trigger.*`（工作流级规则+评审队列）无所属 bot 聊天，不在本片（桌面自动化面板已可见）；`duplicates` 不发通知（噪声）；渲染条样式归 B 线——线程注水跳过 meta 行，旧构建只是不显示、不会崩 |

## 2. 实际检查

环境：Windows 11 x64、Node v24.20.0、pnpm 11.28.5。测试需设 `APPDATA`。

| 实际命令 | 结果 |
| --- | --- |
| runtime `vitest run src/event-rules.test.ts` | 10 通过（新增钩子用例：started/skipped 各发一条、runId 非空、抛错的钩子不破坏评估） |
| host `vitest run src/event-rule-notices.test.ts` | 1 通过（端到端）：enable 幂等只写一条 enabled；review 变更一条；种子 failed-run 事件经评估入评审队并列出 review 通知；disable 一条；停用后事件以 "rule disabled" 跳过通知可见 |
| host `vitest run src/chat-gate.test.ts`（回归） | 9 通过（G3 闸门不受影响） |
| `pnpm lint` / `pnpm typecheck` | 见 PR 验证证据表（全量复跑） |

## 3. 设计取舍

- **meta 行而非新事件流**：与管理编排通知（dispatch/task_notice）同一通道——存储进 `chat_messages`、随 `chat.history` 回放、进入模型上下文（文案写入时定稿），桌面无需新订阅面。渲染层线程注水跳过 meta 行，通知条样式由 B 线按 `kind: "automation"` 增量实现。
- **钩子在 runtime、文案在 host**：runtime 保持无语言依赖；宿主闭包持有 locale 与写入器，`onRuleOutcome` 抛错被吞保证评估契约（"钩子绝不影响游标推进"）。
- **duplicates 不通知**：同一事件重复命中是防重语义的正常表现，通知只会刷屏；记录表（eventRule.record.list）里仍可查。

## 4. 未验证

- 渲染层通知条的视觉呈现与交互（B 线）；本片已确认旧线程注水跳过 meta 行不崩（`thread-history.ts` 的既有行为，未新增渲染层改动）。
- 真实 Electron 手测与远程 CI（Actions 分钟额度已用尽）。
- `deleted` outcome 目前无产生路径（eventRule 无 delete 方法），枚举为未来留位。

## 5. Etheslay 本人自审

- 已审提交 SHA / 日期：
- 差异、需求和错误路径检查结果：
- 测试证据 / 兼容性与权限影响：
- 遗留问题与处理方式：
- 自审结论：

新增提交后更新本节；自审留给 Etheslay 本人填写，此处不代填。
