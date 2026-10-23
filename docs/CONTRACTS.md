# 接口与数据契约草案 v0.1

本文件定义本项目前后端契约，不是 DeepSeek Harness 官方 API。D00 由双方冻结；D03 将其实现为可执行 schema 和契约测试。所有字段均需后端校验，TypeScript 类型不能替代运行时校验。

## 1. 通用规则

- ID 使用不可预测的 UUID；时间用 UTC ISO 8601，展示/调度另外保存 IANA 时区。
- 修改对象携带 `expectedRevision`；冲突返回 `REVISION_CONFLICT`，禁止静默覆盖。
- 通信 envelope 包含 `protocolVersion`、`requestId`、`method`、`payload`；Host 只接受白名单方法。
- 请求与事件单条大小默认上限 1 MiB；大型产物以受校验的 artifactId 引用，不能塞入流事件。
- UI 不直接读取 API Key、任意文件路径或数据库；展示路径不构成操作授权。
- 实体 ID、角色指令和工作流模板中的文字均是数据，不能成为宿主执行代码。

## 2. 核心实体

| 实体 | 必要字段 | 约束 |
| --- | --- | --- |
| Bot | id, revision, name, instructions, modelProfileId, workspaceId, toolPolicyId, archivedAt | 机器人实例不保存原始 API Key；归档后禁止新执行，历史快照保留 |
| ModelProfile | id, provider, model, endpoint, credentialRef, limits | credentialRef 指向系统凭据；默认 DeepSeek HTTPS 地址，变更目标需显式操作 |
| Workspace | id, canonicalPath, grants | 授权以规范路径与操作范围表示，不仅是字符串前缀 |
| Workflow | id, revision, name, schemaVersion, nodes, edges, limits | 图无环、引用完整；导入不自动授予工具或目录权限 |
| Node | id, type, botId, instructionTemplate, inputBindings, timeoutSeconds, retryPolicy | type 首版为 bot / approval；botId 仅 bot 节点需要 |
| Edge | fromNodeId, outputKey, toNodeId, inputKey | 依赖与字段映射明确；禁止隐式读取所有机器人历史 |
| Schedule | id, workflowId, timezone, recurrence, nextRunAt, enabled, misfirePolicy | 首版 misfirePolicy 为 skip-and-notify；重复时刻最多触发一次 |
| Run | id, workflowSnapshot, botSnapshots, status, trigger, createdAt, finishedAt | 快照不可变；触发 idempotencyKey 唯一 |
| NodeRun | id, runId, nodeId, attempt, status, inputRefs, outputRefs, sessionId | 一次节点尝试对应明确 Harness 会话/轮次映射 |
| Approval | id, runId, nodeRunId, actionDigest, resource, expiresAt, status | 默认有效期 10 分钟；一次消费；启动代次绑定 |
| Artifact | id, runId, nodeRunId, relativePath, mediaType, size, checksum | 限于授权产物目录；校验后打开；预览不执行主动内容 |

## 3. 方法边界

| 方法组 | 语义 | 幂等/错误重点 |
| --- | --- | --- |
| bot.list / create / update / archive | 管理机器人 | create 以 requestId 去重；update 校验 revision |
| workflow.validate / save / export / import | 编辑与模板交换 | validate 返回可定位节点/字段的错误；import 先校验 schemaVersion |
| run.start / get / list / cancel | 运行控制 | start 以 idempotencyKey 去重；cancel 重复调用返回已有终态 |
| run.retryNode | 显式重试失败/中断节点 | 新 attempt；校验下游状态与副作用；不静默恢复旧审批 |
| events.subscribe | 按 runId + afterSequence 订阅 | 持久事件可重放；无法补齐时返回 snapshotRequired |
| approval.decide | 允许/拒绝指定动作 | 校验摘要、权限、有效期与 pending 状态；重复决定不得重复执行 |
| schedule.save / enable / disable | 本地调度 | 唯一 scheduleId + occurrenceUtc 防重复 |
| settings.testConnection / update | 接入与设置 | Key 写入与测试位于后端；前端只得到是否已配置 |
| data.backup / restore / describe | 数据管理 | restore 必须停止所有运行、校验备份、备份旧数据 |

## 4. 事件

持久事件 envelope：`eventId, runId, sequence, timestamp, type, payload`。`sequence` 在同一 Run 内单调递增。消费者按 eventId / sequence 去重；传输允许至少一次投递，不保证绝不重复。

事件类型：`run.created`、`run.statusChanged`、`node.statusChanged`、`tool.requested`、`approval.requested`、`approval.resolved`、`artifact.created`、`run.completed`、`run.failed`、`run.interrupted`。

`assistant.delta` 为瞬态流，带 streamId 与 chunkIndex，不占持久 sequence，不承诺逐片段重放；重连用已提交会话快照补齐。`run.completed` 必须在持久事务成功后发送。

## 5. 状态和失败语义

Run：`queued → running ↔ waiting_approval → succeeded / failed / cancelled`；进程退出或崩溃使未终结运行进入 `interrupted`。取消中的运行使用 `cancelling`，待子任务停止后才进入 `cancelled`。终态不可直接回到 running；恢复以新 Run 关联 `resumedFromRunId`。

NodeRun：`pending → running ↔ waiting_approval → succeeded / failed / cancelled`，未开始且依赖失败的节点为 `skipped`；崩溃时未结束节点为 `interrupted`。等待审批仅当该节点无法继续时出现；其他独立节点仍可执行。Run 只有在没有可运行节点且尚有审批时才显示 waiting_approval。

失败策略首版为 stop-descendants：失败节点的后继 skipped，独立分支可完成；任一必需节点失败则 Run 为 failed。取消停止全图。所有终态必须给出原因。

自动重试仅用于确认无副作用的临时错误，默认最多 2 次重试，指数退避并尊重 Retry-After。认证失败、权限拒绝、schema 错误不自动重试；工具结果不确定或涉及外部副作用时转人工处理。模型请求可能已计费，重试不承诺无额外费用。

## 6. 稳定错误码

`INVALID_INPUT`、`WORKFLOW_CYCLE`、`MISSING_BINDING`、`REVISION_CONFLICT`、`UNAUTHORIZED_PATH`、`APPROVAL_REQUIRED`、`APPROVAL_EXPIRED`、`AUTH_FAILED`、`RATE_LIMITED`、`MODEL_UNAVAILABLE`、`RUNTIME_UNAVAILABLE`、`TOOL_TIMEOUT`、`CANCELLED`、`DISK_FULL`、`DATA_VERSION_UNSUPPORTED`、`BUDGET_EXCEEDED`。

错误对象包含 code、用户可读 message、retryable、requestId 和脱敏 details。后端堆栈只写本地诊断日志，不返回凭据、完整环境变量或未经脱敏请求。

## 7. 变更与契约测试

新增可选字段可兼容扩展；删除/更名必需字段、状态语义或事件顺序变化需提升 protocolVersion / schemaVersion、提供迁移说明及两人评审。拒绝未知更高版本，不能默默丢字段。

契约夹具至少覆盖成功、限流、取消、审批拒绝、重复消息、并发编辑、崩溃重连、循环图、路径越界和过期审批。前端可用这些夹具开发；集成验收必须使用真实适配层。
