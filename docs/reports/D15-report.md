# D15 工具网关实现报告

更新日期：2026-10-26（Asia/Shanghai）。任务：D15 `feature/agent-tools`（负责人 Etheslay）。读层、写层分别经 PR #37、#38 合入 develop；本切片将分支快进至最新 develop `d4a3f35` 后继续实现 `ask_user` 后端，目标 develop。依赖 D08、D12 均已合入。

## 1. 交付内容

分片交付：**读层**（提交 3745285，PR #37 已合入）、**写层**（提交 12d163f，PR #38 已合入）与 **`ask_user` 后端**（本切片）。网关能力落实在 [packages/agent-tools/](../../packages/agent-tools/README.md)，零新增外部依赖（zod 为工作区已有）。

### 1.1 读层（已合入）

`packages/agent-tools` 独立包：能力注册表 + zod 参数校验 + 审计（谁/何时/调了什么/参数摘要/结果摘要，JSONL 落 data-root logs）；`list_bots` / `list_groups` / `get_run` / `get_run_events` 全部经注入的契约调用转发（零契约变更）；未注册能力、拒绝 grant、超参调用在网关层被拒并审计；grant 检查点留桩（`AllowAllGrants`，D16 三层模型的接入口）。host 在单一装配点接线（`agentTools`）。

### 1.2 写层（PR #38 已合入）

FR-12 聊天驱动创建（创建分组/bot；创建前可预览，创建后可整批撤销）+ SPRINTS §6 #7 头像自动分配：

| 领域 | 实现 |
| --- | --- |
| 契约（v0.2 附加式） | 新实体 `BotGroup`、`Avatar`（14 形状×10 颜色规范池）与 `BotCreationDraft`（**不落库**草案，全字段可选）；Bot 增 `avatar`/`groupId`（nullish——缺失键保持解析，D15 之前的存量 botSnapshots 不受影响）；新方法 `group.create`/`group.list`/`bot.batchCreate`/`creation.revoke`；`bot.create`/`bot.update` 可携带显式 avatar/groupId（null 清除）。`protocolVersion` 升 0.2 且继续接受 0.1 发送方；工作流文档 `schemaVersion` 保持 0.1，存量 workflow/run 数据可读 |
| 头像自动分配（纯函数，contracts） | `assignBatchAvatars`：显式指定**以用户为准**（允许重复）；自动位取规范池首个未用组合，与本批显式值、既有组员互斥；**组合用尽才允许重复**（池序循环）。池即契约数据，渲染层 Grok Ball 的 14 形状/10 色板与之一致 |
| 事务化批量创建（storage） | `createBotBatch` 单事务覆盖：建组（newGroup）→ 读组员头像定去重范围 → 逐 bot 校验引用+落库 → 批次台账行；任一失败整体回滚，撤销永远精确对应一次成功调用。`idempotencyKey` 重放返回原批次（含原 batchId），不重复建 bot |
| 批次台账 | `creation_batches`（migration `0004-creation-batches`）：目标组/自建组/成员 bot ids/requestId/撤销时间。撤销后标记，二次撤销拒绝（INVALID_INPUT） |
| 整批撤销 | `creation.revoke`：逐 bot `archiveBotUnchecked`（无 revision 守卫——成员创建后被编辑过撤销也必须生效；幂等），批次自建的组一并归档，最后关账；响应回报本次实际归档的 bot/组 |
| 工具能力（agent-tools） | `create_bot_draft`（纯校验回显草案，零契约调用——不落库）、`create_group`、`create_bots_batch`、`revoke_batch`；工具 schema 为契约请求的 strict 镜像（模型笔误在网关层即拒），dispatch 内契约校验仍是权威。`list_groups` 读工具从空集占位改为转发 `group.list` |
| host 装配 | 四个新方法处理器（batchCreate 含 defaults 回退与缺省拒绝、revoke 编排）；写层能力注册进网关（同一审计通道）；`bot.create`/`bot.update` 透传 avatar/groupId 并校验目标组存在且未归档 |

### 1.3 `ask_user` 后端（本切片）

- 注册交互能力 `ask_user`，问题 + 2–4 个 A–D 唯一选项 + `allowOther`，严格校验；默认允许其他文本。返回的 Promise 等待人类回答，答案为 `{ requestId, optionId?, text }`，不改变授权。
- 每个 Host 持有内存协调器。`host.userQuestions` 只向受信进程内调用方暴露 `listPending(callerId?)` / `answer(requestId, callerId, answer)` / `cancel(requestId, callerId)`；读取返回独立快照，匹配原调用方，成功答案单次消费。答案/取消入口不注册为模型能力，也不进入 CONTRACTS 或 stdio。
- `ToolGateway.call` 增加可选第四参数 `{ signal }` 并传递给工具上下文。等待取消返回 `CANCELLED`，30 分钟超时返回 `TOOL_TIMEOUT`，Host 关闭返回 `RUNTIME_UNAVAILABLE`。回答前复核过期时间，清理定时器与 abort 监听器；重启不恢复等待。
- 问题与答案只留内存；网关沿用参数/结果摘要审计，失败使用固定消息，不记录问题/答案原文。无新增依赖、数据库迁移或协议版本变更。
- 真正的聊天调用、卡片显示与答案回写会话仍待后续接线；`ask_user` 的存在不代表完整聊天闭环通过。

### 1.4 与平台文档的对应

AGENT_PLATFORM §4 写（应用）层的本切片：`create_group`（=工具 create_group）、批量创建（=工具 create_bots_batch，带 batchId、一键撤销）、创建草案（=工具 create_bot_draft）。§5 表列的 `assign_bot_group`/`update_bot`/`create_workflow`/`add_node`/`add_edge` 与 `batch.created` 事件**未在本片实现**（见 §5 未做项）；grant/审批约束按计划由 D16 在网关 grant 检查点接入。

## 2. 过程决策（自审留痕）

- **协议版本**：AGENT_PLATFORM §5 约定本轮新方法"protocolVersion 升次版本"。实现为 `PROTOCOL_VERSION="0.2"`、`SUPPORTED=["0.1","0.2"]`（桌面 host-client 现硬编码发 0.1，仍被接受）；`WORKFLOW_SCHEMA_VERSION` 与契约版本解耦保持 `"0.1"`——工作流文档未变，避免存量 workflow/run 快照因 literal 校验失效。
- **批次原子性放 storage**：repos 自带事务，组合调用会嵌套 BEGIN；故 `createBotBatch` 在单一事务内完成全部写入（抽出 `insertBotRow`/`insertGroupRow` 内部函数复用），host 处理器只做 defaults 解析与响应映射。撤销失败中途的恢复性：bot 归档幂等、未关账可重试，二次撤销显式拒绝。
- **事件顺延**：`batch.created` 事件未加——当前事件 envelope 以 runId 为域（per-run sequence），批次不是 run，强行塞入需先扩事件模型；批次结果经方法返回值直达聊天卡片，无消费方受损。列入 §5 未做项。
- **版本夹具更新**：`version-mismatch.json` 的"未知更高版本"从 0.2 改为 0.3（0.2 现已受支持），断言语义不变。

## 3. 测试与覆盖率

以下先保留写层交付时的证据；本次 `ask_user` 切片的独立验证记录见下方追加段。

根目录 `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。用例数：desktop 147、shared 6、contracts 71（+7：新实体/批量/组/撤销/头像分配，含存量快照兼容回归）、storage 124（+10：组/头像列/台账/事务化批次，含回滚与重放）、agent-tools 17（+9：草案不落库、转发、strict 拒绝、审计）、runtime 128、harness-adapter 52、harness-bridge 10、host 26+1 skipped（+7：新处理器全链路，经真实 dispatcher 含契约校验）。

包级 v8 行覆盖率：contracts 99.15%、agent-tools 96.19%、storage 91.71%、host ≥80%（阈值全过）。全量套件在本机曾出现单包在并行负载下偶发失败（不同轮次不同包，重跑即绿；用例本身确定性通过单包复跑），与本次变更无关，如实记录。

### `ask_user` 验证（2026-10-26）

- 基线：agent-tools 17 通过；host 26 通过、1 跳过。先新增 Host 注册行为测试，因能力列表缺少 `ask_user` 而失败，再实现能力并验证通过。
- 新增 17 项网关/协调器测试与 4 项 Host 集成测试：选项/其他文本、严格参数、并发隔离、调用方不匹配、无效/重复/迟到答案、期限与定时器、信号/受信取消、Host 关闭与重启、摘要审计、模型入口隔离。
- 最终全仓检查：`pnpm lint`、`pnpm typecheck`、`pnpm test` 与 `git diff --check` 均退出 0。测试为 desktop 147、shared 6、contracts 71、storage 124、agent-tools 34、runtime 128、harness-adapter 52、harness-bridge 10、host 30 通过 + 1 跳过，合计 **602 通过、1 跳过**；本切片新增 21 项测试。
- 最终覆盖率：agent-tools 行 **99.09%**、分支 **93.69%**（`ask-user.ts` 行 100%、分支 95.65%）；host 行 **88.12%**、分支 **80.31%**，各包既有阈值均通过。初轮未格式化新增文件时 agent-tools 行覆盖为 99.03%，以上为最终全仓运行结果。
- 执行环境：本地 Windows、Node **24.15.0**、当前 `pnpm --version` 为 **11.25.0**（与 packageManager 声明的 11.28.5 有差异，本次未更改工具链或依赖）。首次执行时间 2026-10-26 10:47–10:55（Asia/Shanghai）。检查对应本切片实现树，基线为 `d4a3f35`；实现提交 SHA 以 Git 历史及 PR 为准，提交后须由负责人更新自审 SHA 与检查证据。
- 独立 AI 差异审查未发现有证据的 P1/P2 问题；其未重复运行测试，不构成 Etheslay 本人的自审结论。远程 CI 尚未运行本切片。
- 用户授权推送后的提交前复验（2026-10-26 10:59–11:00，Asia/Shanghai）：全仓 lint/typecheck/test 再次退出 0，602 通过、1 跳过；agent-tools 行 99.09%、分支 93.75%，host 行 88.12%、分支 80.31%。本地证据不代替推送后 CI 结果。
- 初次沙箱运行因依赖文件读取 EPERM 未执行测试；获准在沙箱外运行后完成。类型检查首次发现联合类型在回调内失去缩窄，修正为局部变量后通过。
- 未执行真实 API、真实 Harness `ask_user` 或桌面聊天端到端；现有真实 API 冒烟按无显式开关跳过。

## 4. 依赖与文档同步

- 无新增运行时依赖；lockfile 无变化。
- storage migration 0004 附加式，0001–0003 校验和不变；备份为 `VACUUM INTO` 全库快照，新表自动纳入。
- 同步：`docs/CONTRACTS.md`（v0.2 状态头、实体/方法表）、`progress.md`。

## 5. 未做项与边界

- **grant/审批**：写层当前走读层同一个 default-allow 桩——本地单机下任何会话可建组/批量建 bot/撤销。D16 三层模型落地前这是**已知缺口**，接入口即网关 `GrantCheckpoint`（接口已就位，拒绝与审计路径均有测试）。
- **聊天接线**：网关尚无聊天侧调用方（D14 交互片/D16 授权弹层）；`handleMethod` 面（group.list 等）已对渲染层可用，头像/组的 UI 呈现归 B 线（渲染层仍按 bot id 哈希派生，直到接入 `bot.avatar`）。
- **未实现的写工具**：`assign_bot_group`（=bot.update patch 已可改组，未包成独立工具）、`update_bot`、`create_workflow`/`add_node`/`add_edge`；读工具 `get_workflow` 需新增 `workflow.get` 契约方法，顺延。
- **`batch.created` 事件**：见 §2，需事件模型扩展后另立小 PR。
- **未验证**：真实 Harness 进程联动、真实 API 请求、聊天端到端（模型发起工具调用）均未执行；本报告数值为本地 Windows 11 x64 + Node 24 + pnpm 实测，CI 结果以分支推送后的真实运行为准。
- **D15 剩余切片**：内置 `web_search` 尚未实现；`ask_user` 当前完成后端等待/回答能力，未完成真实聊天接线。
- 自审记录按规范留空待负责人 Etheslay 填写；PR 合并由本人确认。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
