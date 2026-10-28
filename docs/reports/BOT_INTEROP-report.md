# 互通（任意 bot 平权派发 + 跨组协作 + 派发幂等）报告

分支：`feature/bot-interop` · 目标 `develop` · 契约：`task.dispatch`/`dispatch_task` 可选 `idempotencyKey`（附加式，不升 `protocolVersion`）；`Bot.role` 降级为遗留标签 · 任务书：[TASK_BOT_INTEROP](../TASK_BOT_INTEROP.md)

## 1. 做了什么

| 层 | 内容 |
| --- | --- |
| 网关工具层 | `task-tools.ts`：删除 coordinator 角色门（`requireCoordinatorBot` → `requireDispatchingBot`，保留可信 botId 绑定 + 在册未归档）；删除目标与链跳的同组拒绝；`dispatch_task` 输入新增可选 `idempotencyKey`（uuid）并透传；`list_tasks` 放宽为任意在册 bot 的参与者视图；工具描述改写（任意 bot、跨组、非自身、幂等重试语义） |
| Host 权威层 | `task-dispatcher.ts`：`requireCoordinator` → `requireLiveSender`（去 role）；删除目标/链跳同组拒绝；新增幂等——`dispatch()` 开头按 `(fromBotId, key)` 查重，命中即审计「idempotent replay」并返回首个任务（不建行、不入队、不投递派发标记）；保留：非自身、简单路径、链上限（2–4 默认 3）、排队上限（10）、审计双身份、回执、重启清扫。`handlers.ts` 透传 `idempotencyKey` |
| 存储 | 迁移 `0022-task-idempotency`：`tasks.idempotency_key TEXT` + 部分唯一索引 `(from_bot_id, idempotency_key) WHERE IS NOT NULL`；`insertTask` 携带该列；新增 `getTaskByIdempotencyKey`（发方命名空间隔离） |
| 渲染层 | bot 编辑器**角色选择器移除**（chips + roleHint）；会话头与侧栏协调者徽标移除；`bot.update` 的 role 透传保留（存量标签不被清洗）；i18n 删除 `bots.role{Label,Standard,Coordinator,GroupAria,Hint}` 与 `shell.coordinatorBadge{,Title}` |
| 契约文档 | `CONTRACTS.md`：Bot.role 标注遗留标签；task 行改为「任意在册 bot 可派发，跨组允许」+ 幂等语义；`entities.ts` role 注释同步 |
| 不动 | `dispatch_task` 能力面（默认 ask）、审批卡、审计双身份、任务面板/交付通知/派发标记样式/配对聊天、`create_bots_batch`、`save_workflow`、T7 链机制 |

## 2. 验证证据

环境：Windows 11 x64 · Node 24.16.0 · pnpm 11.28.5 · 基线 `origin/develop` = `92303eb`（PR #127）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 网关层 | `pnpm --filter @deepseek-bot/agent-tools test` | 15 文件 / 135 用例全过：standard bot 直接派发 ✅、跨组目标 ✅、无组发送者 ✅、跨组链跳 ✅、`idempotencyKey` 透传 + 非 uuid 拒绝 ✅；自身/归档/不存在/无身份/越权伪造 authorization 仍拒绝 |
| Host 权威层 | `pnpm --filter @deepseek-bot/host test` | 283 过 / 1 skip / 1 失败（`screen-distribution`，本机环境既有，未改动基线同样失败）。改写后的 U1（worker 派活、跨组派发、方法面放行）、U8（跨组接力链执行到 done、重复 botId 与超限链仍拒）、归档拒绝、**幂等双例**（同 key 同任务 id + 单条派发标记 + 单行；无 key 行为不变）全过 |
| 存储 | `pnpm --filter @deepseek-bot/storage test` | 26 文件 / 220 用例全过（含新幂等用例：键重放、发方隔离、无键不冲突、唯一索引拒绝同键二行） |
| 渲染层 | `pnpm --filter @deepseek-bot/desktop test` | 63 文件 / 572 用例全过（manager-orchestration 角色开关测试随 UI 移除而删除；i18n 扫描过） |
| 全仓 | `pnpm -r --no-bail run test` | 其余包（shared 6 / harness-bridge 30 / contracts 149 / runtime 137 / harness-adapter 65）全绿；唯一失败 exec-daemon `windows.real` 为本机环境既有（基线同样失败，2026-10-28 对照复跑） |
| 静态 | `pnpm lint`；`pnpm typecheck` | eslint 0 问题；10 包 tsc 全过 |

## 3. 未验证（明确列出，不声称通过）

- **真机 Electron 未跑**：bot 编辑器去掉角色选择器后的表单观感、跨组派发的真实审批卡与结果回流点击链路无截图（UI 由 63 文件单测 + i18n 扫描背书）。
- **真实模型未跑**（当前指示：不发起付费调用）：跨组派发的端到端（模型点名 → 建组 → 派发 → 回流）只有假场景背书。
- exec-daemon `windows.real` 与 host `screen-distribution` 本机失败为环境既有。

## 4. 风险与回退

- **深度不再受限（自觉后果，任务书 §4 已声明）**：worker 可继续派发。兜底：`app.dispatch_task` 默认每次询问（人是闸门）、每 bot 排队 ≤10、预声明链 ≤4、非自身；如需显式递归深度上限另立任务。
- 幂等按「first write wins」：同 key 不同 payload 重放首个任务（与 `bot.batchCreate` 同口径）。
- 迁移 0022 只加列/索引；回退需连数据库备份一起（`DATA_VERSION_UNSUPPORTED` 口径，与 0021 相同）。
- 回退：`git revert -m 1 <merge-sha>`。

## 5. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿（含对「角色退役 + 深度放开」两点取舍的确认）
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
