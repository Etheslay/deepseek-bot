# 任务书：互通 —— 任意 bot 平权派发与跨组协作（去角色/去组别门槛 + 派发幂等）

| 项 | 值 |
| --- | --- |
| 性质 | 任务书 + 实现方案（二合一）；实现随本分支提交 |
| 分支 | `feature/bot-interop` → PR 目标 `develop` |
| 基线 | `origin/develop` = `92303eb`（PR #127） |
| 上游 | 不重做既有件：往来小字、叠放头像、配对聊天、`dispatch_task`/`task.*`、`create_bots_batch`、`save_workflow`、T7 交接链全部保持 |
| 需求来源 | 负责人口述（2026-10-28）：任何 bot 都能说话，不同组也行；不要禁止名单，不要单独的分配者/经理角色；用户点名的 bot 就是普通 bot——它创建其他 bot 并交代任务，结果回流它的聊天，点灰色小字里的头像/名字看对方全文；不能改别人配置、不能替别人审批 |
| 契约 | `task.dispatch` 与 `dispatch_task` 输入新增**可选** `idempotencyKey: uuid`（幂等重放，仿 `bot.batchCreate` 先例）；`Bot.role` 降级为兼容遗留标签（运行时不再赋予任何特权）；均不升 `protocolVersion` |
| 红线 | 权柄不变式不变：派发者不拥有执行者、不改其配置、不替其审批（既有闸门不动）；未运行检查不得声称通过；不伪造自审；不发起付费调用 |

## 1. 背景与现状（证据，2026-10-28 对 `92303eb`）

v0.5 manager-orchestration（TASK_MANAGER_ORCHESTRATION.md FR-8/FR-9）把派发锁在「协调者角色 + 同组 + 非自身」三重规则上：

- **网关工具层**（`packages/agent-tools/src/task-tools.ts`）：`requireCoordinatorBot` 拒绝 standard 角色；`requireReachableTarget` 拒绝跨组目标与跨组链跳；`list_tasks` 同样要求协调者；
- **权威方法层**（`packages/host/src/task-dispatcher.ts`）：`requireCoordinator`（role 检查）、目标与链跳的 `groupId !== me.groupId` 拒绝；
- **渲染层**：bot 编辑器的角色选择器（`bot-form.tsx` standard/coordinator chips + `bots.roleHint`）、会话头与侧栏的协调者徽标（`App.tsx` 两处 `role === "coordinator"`）；
- **幂等缺失**：`dispatch()` 每次都生成新 root 任务——模型重试同一条派发会重复建任务、重复执行（消耗双份 token）。而 `bot.batchCreate` 已有可选 `idempotencyKey` 重放先例（重复提交返回首次结果）。

互通要求把「角色 + 同组」两道门拆掉，只保留身份与安全底线；同时用任务号幂等挡住重复提交。

## 2. 需求（验收）

1. **任意 bot 可派发**：不需要 coordinator 角色（standard、无组 bot 均可）；网关层与方法层一致放行；`list_tasks` 放宽为任意在册 bot 的参与者视图；
2. **跨组可派**：目标与链跳不再要求同组（含无组 ↔ 有组）；仍拒绝：派给自己、目标/链 bot 不存在或已归档、链 botId 重复（简单路径）、链超上限（2–4，默认 3）、执行者排队超上限（默认 10）、无可信 botId 的调用方；
3. **幂等**：`dispatch_task` / `task.dispatch` 带相同 `idempotencyKey` 的重复提交返回**已存在的首个任务**（不重复建行、不重复入队、不重复投递派发标记）；不带 key 的行为完全不变；
4. **角色退役**：运行时不再读取 `role` 做任何判断；bot 编辑器角色选择器与两处协调者徽标移除；`Bot.role` 契约字段保留（存量可读、`bot.update` 透传不清洗），文档标注为遗留标签；
5. **权柄不变式**：派发者仍不能改其他 bot 配置（bot.update 无模型工具入口，`bot.batchCreate` 入参 strict 且不含 role）、不能替执行者审批（审批卡仍是人类面板）；执行者回合的工具仍按其自身策略/授权/审计（既有用例保持通过）；
6. **结果回流与点击查看**：既有交付通知（`task_notice`）与任务面板不改动；点击小字头像/名字看对方全文的配对聊天路径不重做。

## 3. 实现方案

### 3.1 契约（`packages/contracts` + `docs/CONTRACTS.md`）

- `task.dispatch` 请求（strict）新增 `idempotencyKey: UuidSchema.optional()`；方法注释去掉「协调者规则（角色/同组）」表述，改为「可信在册 bot、非自身」+ 幂等语义（同 key 重放返回首个任务，first write wins）；
- `CONTRACTS.md`：v0.5 task 行更新派发规则表述；Bot 实体行 `role` 标注「互通后为兼容遗留标签，运行时无特权」；补一句幂等说明（不升版本号，附加式）；
- `entities.ts` role 注释同步（字段与校验保留，语义退役）。

### 3.2 网关工具层（`packages/agent-tools/src/task-tools.ts`）

- `requireCoordinatorBot` → `requireDispatchingBot`：保留可信 botId 绑定 + 在册未归档检查，**删除 role 检查**；
- `requireReachableTarget`：**删除同组检查**（保留非自身 + 在册未归档）；链跳校验同步；
- `dispatch_task` 输入 schema 新增 `idempotencyKey: z.string().uuid().optional()` 并透传 `deps.dispatch`；
- `list_tasks`：同一放行（参与者视图不变）；
- 工具描述改写：任意 bot、跨组允许、非自身拒绝、链上限与幂等语义。

### 3.3 Host 权威层（`packages/host/src/task-dispatcher.ts` + `handlers.ts`）

- `requireCoordinator` → `requireLiveSender`（去 role 检查）；删除目标与链跳的同组拒绝（含注释同步）；其余不变（非自身、简单路径、链上限、排队上限、审计双身份、回执、清扫）；
- `DispatchInput` 增加 `idempotencyKey?`：`dispatch()` 开头查 `(fromBotId, key)`——命中即审计「dedup」并返回既有 root 任务（不插行、不入队、不发派发标记）；
- `handlers.ts` `task.dispatch` 把 `payload.idempotencyKey` 透传。

### 3.4 存储（`packages/storage`）

- 迁移 `0022-task-idempotency`：`ALTER TABLE tasks ADD COLUMN idempotency_key TEXT;` + `CREATE UNIQUE INDEX tasks_from_idem ON tasks(from_bot_id, idempotency_key) WHERE idempotency_key IS NOT NULL;`
- `repos/tasks.ts`：`insertTask` 携带该列；新增 `getTaskByIdempotencyKey(db, fromBotId, key)`；
- 备份/恢复随 tasks 表整体走，无需特判。

### 3.5 渲染层（`apps/desktop`）

- `bot-form.tsx`：移除角色选择器（chips + `bots.roleHint` 提示行）与表单内 role 状态；保存补丁不再包含 role 字段以外的改动——`App.tsx:2357` 的 `role: editingBot.bot.role` 透传**保留**（避免保存时清掉存量角色标签）；
- `App.tsx`：移除会话头 `coord-badge` 与侧栏协调者徽标两处；
- i18n：删除 `bots.roleLabel/roleStandard/roleCoordinator/roleDescription/roleGroupAria/roleHint`（确认无其他引用后）；
- 不动：任务面板/交付通知/派发标记样式/配对聊天。

### 3.6 测试改写与新增

- **host `task-dispatch.test.ts`**：
  - 原 U1「拒绝 standard/跨组/自身/无身份」改写：standard bot 与跨组目标（`workerA → outsider`）**派发成功**（任务创建并执行）；自身（INVALID_INPUT）与无身份调用（UNAUTHORIZED_PATH）仍拒绝；权威面 `task.dispatch` 以 workerA 为发起者直接成功；
  - 原 U8「duplicate, cross-group and over-limit chains」改写：跨组链放行；链内 botId 重复与超上限仍拒绝（改名）；
  - 新增幂等用例：同 key 二次提交返回同一任务 id、`chat_messages` 仅一条派发标记、任务行不翻倍；
- **agent-tools `task-tools.test.ts`**：改写「拒绝 standard」「拒绝跨组/无组协调者」「list_tasks 共享协调者要求」「跨组链拒绝」四组为放行断言（保留自身/归档/不存在/无身份/schema 拒绝）；description 断言更新；新增 idempotencyKey 透传断言；
- **storage `tasks.test.ts`**：新增 idempotency 列读写与 `getTaskByIdempotencyKey` 用例 + 唯一索引存在性；
- **渲染层**：bot-form 相关测试若断言角色选择器则同步删改。

## 4. 边界与自觉后果（请负责人评审确认）

- **深度不再受限**：原「深度恰为 1」是角色门的副产物。放开后，被派发的 worker 也可以继续派发。现有兜底：`app.dispatch_task` 默认每次询问（人是最深闸门）、每 bot 排队上限 10、预声明链 ≤4 跳、非自身拒绝。若需要显式深度上限（如 root 链路计数防递归刷任务），另行立项，不塞进本片。
- `role` 字段与「每组至多一个 coordinator」校验保留为兼容死代码（无 UI 可再产生 coordinator；存量数据不受影响）；
- `app.dispatch_task` 权限面（默认 ask / once / session / permanent）不变；
- 不做 bot 间自由聊天通道（沟通仍经任务指令/交接摘要/工作区产物——与原任务书非目标一致）。

## 5. 风险与回退

- 放行面扩大 = 更多审批卡（默认 ask 下每次派发都问人），不会静默执行；
- 幂等列对旧行为 NULL，索引部分索引，旧库迁移只加列与索引；
- 回退：`git revert -m 1 <merge-sha>`；迁移 0022 只加列/索引，回退代码后旧版本因 schema 版本更高拒开库（`DATA_VERSION_UNSUPPORTED`），需连数据库备份一起回退（与 usage 0021 同口径）。

## 6. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
