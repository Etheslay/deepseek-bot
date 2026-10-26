# D15 工具网关实现报告

日期：2026-10-25。任务：D15 `feature/agent-tools`（负责人 Etheslay）。分支自 develop（PR #37 合入读层后继续推进），目标 develop。依赖 D08、D12 均已合入。

## 1. 交付内容

分两片交付：**读层**（阶段一，提交 3745285，已经 PR #37 合入 develop）与**写层**（阶段二，本 PR）。均落实在 [packages/agent-tools/](../../packages/agent-tools/README.md)，零新增外部依赖（zod 为工作区已有）。

### 1.1 读层（已合入）

`packages/agent-tools` 独立包：能力注册表 + zod 参数校验 + 审计（谁/何时/调了什么/参数摘要/结果摘要，JSONL 落 data-root logs）；`list_bots` / `list_groups` / `get_run` / `get_run_events` 全部经注入的契约调用转发（零契约变更）；未注册能力、拒绝 grant、超参调用在网关层被拒并审计；grant 检查点留桩（`AllowAllGrants`，D16 三层模型的接入口）。host 在单一装配点接线（`agentTools`）。

### 1.2 写层（本 PR）

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

### 1.3 与平台文档的对应

AGENT_PLATFORM §4 写（应用）层的本切片：`create_group`（=工具 create_group）、批量创建（=工具 create_bots_batch，带 batchId、一键撤销）、创建草案（=工具 create_bot_draft）。§5 表列的 `assign_bot_group`/`update_bot`/`create_workflow`/`add_node`/`add_edge` 与 `batch.created` 事件**未在本片实现**（见 §5 未做项）；grant/审批约束按计划由 D16 在网关 grant 检查点接入。

## 2. 过程决策（自审留痕）

- **协议版本**：AGENT_PLATFORM §5 约定本轮新方法"protocolVersion 升次版本"。实现为 `PROTOCOL_VERSION="0.2"`、`SUPPORTED=["0.1","0.2"]`（桌面 host-client 现硬编码发 0.1，仍被接受）；`WORKFLOW_SCHEMA_VERSION` 与契约版本解耦保持 `"0.1"`——工作流文档未变，避免存量 workflow/run 快照因 literal 校验失效。
- **批次原子性放 storage**：repos 自带事务，组合调用会嵌套 BEGIN；故 `createBotBatch` 在单一事务内完成全部写入（抽出 `insertBotRow`/`insertGroupRow` 内部函数复用），host 处理器只做 defaults 解析与响应映射。撤销失败中途的恢复性：bot 归档幂等、未关账可重试，二次撤销显式拒绝。
- **事件顺延**：`batch.created` 事件未加——当前事件 envelope 以 runId 为域（per-run sequence），批次不是 run，强行塞入需先扩事件模型；批次结果经方法返回值直达聊天卡片，无消费方受损。列入 §5 未做项。
- **版本夹具更新**：`version-mismatch.json` 的"未知更高版本"从 0.2 改为 0.3（0.2 现已受支持），断言语义不变。

## 3. 测试与覆盖率

根目录 `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。用例数：desktop 147、shared 6、contracts 71（+7：新实体/批量/组/撤销/头像分配，含存量快照兼容回归）、storage 124（+10：组/头像列/台账/事务化批次，含回滚与重放）、agent-tools 17（+9：草案不落库、转发、strict 拒绝、审计）、runtime 128、harness-adapter 52、harness-bridge 10、host 26+1 skipped（+7：新处理器全链路，经真实 dispatcher 含契约校验）。

包级 v8 行覆盖率：contracts 99.15%、agent-tools 96.19%、storage 91.71%、host ≥80%（阈值全过）。全量套件在本机曾出现单包在并行负载下偶发失败（不同轮次不同包，重跑即绿；用例本身确定性通过单包复跑），与本次变更无关，如实记录。

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
- 自审记录按规范留空待负责人 Etheslay 填写；PR 合并由本人确认。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
