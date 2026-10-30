# 工作流模型回合用量入账报告（G4 残留收口）

分支：`feature/workflow-usage-accounting` · 目标 `develop` · 无契约变化（仅内部 `NodeExecutor` 结果类型扩展）· 基线 `origin/develop` = `5248ab6`

## 1. 问题

GAP_AUDIT §2 的 G4 残留：**工作流模型回合的 token 不入 `usage_events`**。聊天回合在 `packages/host/src/host.ts` 里把每轮回填用量 best-effort 写入账本，工作流节点经 `DshSdkExecutor` 走完全独立的执行路径，`BotNodeExecutionResult` 只带 `outputs` 与 `sessionId`，用量在适配器里被丢弃——于是设置页用量汇总只统计聊天，工作流（含多机器人编排）产生的那部分 Token 成本在账本里不可见。

## 2. 做了什么

| 层 | 内容 |
| --- | --- |
| 用量解析所有权 | 把 `packages/host/src/usage-capture.ts` 的防御式解析（snake_case / camelCase / 嵌套 `usage` / 累计帧取最大值 / 无帧估算）**移入 `packages/harness-adapter/src/usage.ts`**：session 事件线格式归适配器所有，聊天与工作流两条路径因此共用同一解析器，不再各写一份。host 侧 `usage-capture.ts` 保留为 re-export 壳，调用点（`chat.ts`/`handlers.ts`）零改动；对应 4 组用例随模块迁到 `packages/harness-adapter/src/usage.test.ts` |
| 执行器 | `DshSdkExecutor.executeBotNode` 把本次 attempt 收集到的 `TurnOutcome.events` 喂给 `TurnUsageAccumulator`，`finish(prompt, finalResponse)` 得到 `{ inputTokens, outputTokens, cachedInputTokens, model, estimated }` 并随结果返回 |
| 端口 | `packages/runtime/src/executor.ts` 新增 `NodeTurnUsage` 类型与 `BotNodeExecutionResult.usage?: NodeTurnUsage`（可选字段，向后兼容：其他执行器/测试桩不填即视为无法上报） |
| Host 记账 | `host.ts` 提取共享写入器 `recordTurnUsage`（聊天回调改用它，行为不变），并用 `usageRecordingExecutor` 包装执行器后交给 `WorkflowEngine`：每次 attempt 成功且计数非零、`sessionId` 存在时写一行。重试按 attempt 各记一行（每次 attempt 都是单独计费的回合）；写入仍 best-effort，失败不牵连 run |
| 归属 | 账本 `bot_id` 取节点所属 bot、`session_id` 取本次 attempt 的 Harness 会话；harness 未上报用量时如实记 `source = "estimated"`（估算规则：约 4 字符/token），与聊天路径一致，不把估算伪装成账单值 |

## 3. 验证证据

环境：Windows 11 x64 · Node 24 · 基线 `origin/develop` = `5248ab6`

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 新用例（红→绿） | `pnpm --filter @deepseek-bot/host exec vitest run src/host.test.ts -t "runs a workflow end to end through the method surface"` | 实现前失败：`expected [] to have a length of 1 but got +0`；实现后通过 |
| 用例内容 | 同上 | 假 Harness 单节点工作流跑成功后，`usage_events` 按 `bot_id` 查到 1 行，`model = null`、`source = "estimated"`、`session_id` 非空、输入/输出 token 均 > 0 |
| 适配器全量 | `pnpm --filter @deepseek-bot/harness-adapter test` | 10 文件 / 76 用例全过；`usage.ts` 行覆盖 98%、分支 94% |
| 静态 | `pnpm --filter @deepseek-bot/contracts --filter @deepseek-bot/runtime --filter @deepseek-bot/harness-adapter --filter @deepseek-bot/host run typecheck` | 4 包 tsc 全过 |
| host 受到影响的两文件 | `vitest run src/host.test.ts src/task-dispatch.test.ts` | 27 用例全过 |

## 4. 未验证（明确列出）

- **真实 Harness 的用量帧**：假 Harness 的 `ok` 场景不发送任何 usage 帧，因此本 PR 的自动化只覆盖「无帧 → 估算」路径；「有帧 → `source = "harness"` 且带 model」由 `packages/harness-adapter/src/usage.test.ts` 的解析用例背书，未在真机回合里跑通并核对账单。
- host 全量套件在本机跑出 3 个失败（`mcp-chat` / `real-app-tools` / `task-dispatch` 各一，均为 Harness `initialize` 超时或时序），**基线 `5248ab6` 同样失败**（stash 后复跑基线首轮 2 失败、次轮全过），与本改动无关；未在本 PR 内修。
- Electron 真机未跑：本 PR 不触碰渲染层与桌面主进程，设置页用量汇总界面未截图。

## 5. 风险与回退

- 写入量增加：工作流每个成功节点多一次 SQLite 插入（best-effort，事务外），对本地 SQLite 无压力；失败被吞掉，不影响 run 状态机。
- 估算与真实值可能偏差数倍（4 字符/token 规则），已在账本标 `estimated`，汇总页可区分；未把估算值并入 `harness` 来源。
- 契约面零变化（`packages/contracts` 未改，IPC 方法面未改），工作流数据结构未变。
- 回退：`git revert -m 1 <merge-sha>`；无迁移。

## 6. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
