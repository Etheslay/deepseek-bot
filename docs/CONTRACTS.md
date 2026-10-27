# 接口与数据契约 v0.4

本文件定义本项目前后端契约，不是 DeepSeek Harness 官方 API。状态：v0.1 已冻结（2026-10-23，D00 验收记录见 D00 Issue）；v0.2 为 D15 写层扩展；v0.3（2026-10-26，D16 后端）新增人类权限控制方法；v0.4（2026-10-26，D28 共编侧车）新增 `artifacts.*` 方法组，`protocolVersion` 升至 0.4，继续接受 0.1–0.3 发送方。工作流文档 `schemaVersion` 保持 0.1（存量数据可读）。后续变更按 §7 提升版本并由变更负责人自审同步使用方。可执行实现位于 `packages/contracts/`：schema、§7 夹具与双方共用契约测试见 [packages/contracts/README.md](../packages/contracts/README.md)。所有字段均需后端校验，TypeScript 类型不能替代运行时校验。

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
| Bot | id, revision, name, instructions, modelProfileId, workspaceId, toolPolicyId, avatar?, groupId?, archivedAt | 机器人实例不保存原始 API Key；归档后禁止新执行，历史快照保留；avatar/groupId 为 v0.2 附加（nullish，缺失即未分配，UI 自行回退） |
| BotGroup | id, revision, name, archivedAt | v0.2：bot 的分组标签，成员关系存于 Bot.groupId |
| BotCreationDraft | name?, instructions?, modelProfileId?, workspaceId?, toolPolicyId?, groupId?, avatar? | v0.2：聊天生成、编辑器预览的创建草案，**不落库**；引用字段仅在真实创建方法消费时校验 |
| Avatar | shape, color | v0.2：规范形状×颜色池（14×10），批量创建据此组内去重；形状/色板演进需契约 PR |
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
| BotArtifact | relativePath, mediaType, size, updatedAt, checksum | v0.4：bot 工作区可编辑文件，按 (botId, relativePath) 寻址；mediaType 由扩展名映射，text/html 与二进制不进内联编辑（QA-14） |
| ArtifactVersion | id, botId, relativePath, revision, author(user\|bot), mediaType, size, checksum, createdAt | v0.4：只追加版本链，同文件 revision 唯一；快照内容存于数据根 `artifacts/coedit-versions/<botId>/`（含产物备份即含版本）；回退以新版本落盘，不改写历史 |
| CapabilityPolicy | capability, mode | v0.3；全局 allow/ask/deny 默认策略，受高风险能力限制 |
| PermissionGrant | id, capability, botId, mode, scope, sessionId, generation, approvalId, maxUses, uses, expiresAt, createdAt, revokedAt | v0.3；scope=policy 为全局策略行，其余为 bot 专属 once/session/permanent 授权；计数在执行前原子扣减 |
| AppApproval | id, invocationId, callerId, botId, sessionId, tool, capabilities, params, actionDigest, generation, status, createdAt, expiresAt, decidedAt | v0.3；精确参数预览与 10 分钟期限，独立于 D08 Approval；重启失效 |
| PermissionAudit | id, sequence, at, actor, callerId, botId, tool, capabilities, actionDigest, grantIds, approvalId, decision | v0.3；只追加，保存摘要与决策元数据，不保存参数原文 |

## 3. 方法边界

| 方法组 | 语义 | 幂等/错误重点 |
| --- | --- | --- |
| bot.list / create / update / archive | 管理机器人 | create 以 requestId 去重；update 校验 revision；create/update 可携带显式 avatar/groupId（用户指定优先） |
| bot.batchCreate | v0.2 聊天驱动批量创建（FR-12） | 单事务：newGroup 与 groupId 互斥；逐字段回退 batch defaults；头像显式优先、自动分配组内不重复（组合用尽才允许重复）；以 idempotencyKey 去重；返回 batchId 供 creation.revoke |
| creation.revoke | v0.2 整批撤销 | 归档该批全部 bot（无 revision 守卫，撤销必须生效），批次自建的组一并归档；重复撤销返回 INVALID_INPUT |
| group.create / list | v0.2 分组管理 | list 仅返回未归档组 |
| workflow.validate / save / export / import | 编辑与模板交换 | validate 返回可定位节点/字段的错误；import 先校验 schemaVersion |
| run.start / get / list / cancel | 运行控制 | start 以 idempotencyKey 去重；cancel 重复调用返回已有终态 |
| run.retryNode | 显式重试失败/中断节点 | 新 attempt；校验下游状态与副作用；不静默恢复旧审批 |
| events.subscribe | 按 runId + afterSequence 订阅 | 持久事件可重放；无法补齐时返回 snapshotRequired |
| approval.decide | 允许/拒绝指定动作 | 校验摘要、权限、有效期与 pending 状态；重复决定不得重复执行 |
| schedule.save / enable / disable | 本地调度 | 唯一 scheduleId + occurrenceUtc 防重复 |
| settings.testConnection / update | 接入与设置 | Key 写入与测试位于后端；前端只得到是否已配置 |
| data.backup / restore / describe | 数据管理 | restore 必须停止所有运行、校验备份、备份旧数据 |
| permission.policy.list / set | v0.3 人类读取/修改全局能力策略 | start_run 仅 ask；shell/screen 不能 allow；deny 覆盖全部授权 |
| permission.grant.list / revoke | v0.3 人类查询/撤销授权 | botId 可筛选；默认仅有效记录，最多 100；撤销已存在授权幂等 |
| permission.approval.list / decide | v0.3 人类读取精确动作/批准或拒绝 | 列表默认 pending；决定必须匹配 approvalId、expectedActionDigest、代次、期限；scope 默认 once，session 可指定 maxUses/ttlMinutes；一次消费 |
| permission.audit.list | v0.3 人类按 botId、afterSequence 查询追加式审计 | 默认最多 50，最高 100；模型不能写入/删除或调用控制方法 |
| memory.list / write / delete | v0.3 人类查看、写入和删除当前 bot 的记忆 | 只作用于 payload.botId；空查询返回最近记录，默认 20、最多 50；删除未命中返回 INVALID_INPUT，不暴露其他 bot 的记录 |
| memory.retention.get / set | v0.3 保留策略（记忆 + 知识共用）：retentionDays / memoryMaxPerBot / knowledgeMaxPerBot | 0 = 不限制（默认）；损坏值按 0 读——损坏的设置只会让清理变保守；Host 启动与每次写入后执行清扫 |
| knowledge.list / write / delete | v0.3 当前 bot 的独立知识文档（迁移 `0010-knowledge-docs`） | 正文上限 100000 字（独立于 4000 字记忆）；list 只回摘要（不回正文，1 MiB 消息上限安全）；删除 bot 域隔离同记忆 |
| knowledge.search | v0.3 本地向量检索：CJK 双字 + 拉丁词 TF-IDF 余弦 + 精确短语加分 | 每次查询即时分窗计算（480 字窗、100 字重叠），不预存向量、不引模型；score≤0 不返回，默认 5 条最多 10 条；数百条满幅文档内为设计边界（用 knowledgeMaxPerBot 约束） |
| artifacts.list / read / save / versions / versionContent / revert | v0.4 产物共编侧车：bot 工作区文件的列出、读取、保存、版本、版本内容与回退 | 路径必须相对且不穿越（`RelativeArtifactPathSchema` + realpath 夹紧）；内联内容 ≤ 768 KiB（1 MiB envelope 内留 JSON 转义余量），超限显式拒绝不截断；save 携带 expectedChecksum 时文件已变返回 REVISION_CONFLICT；save/revert 恒追加 author=user 版本，未入账的 bot 写入由 list/read/versions 先补记为 author=bot 版本；每文件保留最近 50 版 |

`permission.*` 是受信 Host 控制面，绝不注册为模型工具。设置页调用 `permission.policy.list` / `permission.policy.set` 与 `permission.grant.list` / `permission.grant.revoke`。聊天授权卡调用 `permission.approval.list` / `permission.approval.decide`。本轮应用工具通过每轮令牌认证的 Host 内部 loopback 通道调用；物理 Harness 会话从登记表绑定稳定的 `ToolCaller.botId/sessionId`，不从不透明 caller.id 解析，也不接受模型参数中的身份。八个应用工具的通道不是桌面公开契约。本片另增受信桌面方法 `question.list` / `question.answer`，只读取并回答当前 bot 聊天回合里的 `ask_user`；模型目录不包含这两个方法。另增 `search.config.get` / `search.config.set` / `search.results.list`，只由桌面读写 SearXNG 地址和当前 bot 的搜索结果，模型目录不包含这三个方法。记忆切片另增受信桌面方法 `memory.list` / `memory.write` / `memory.delete`，以及迁移 `0008-memories`。模型工具是 `memory_write` / `memory_search`，不进入八个应用工具目录，也不能删除或指定其他 bot。知识导入不新增契约方法，桌面读完一个 .txt 或 .md 文件后仍调用 `memory.write`。连接器登记另增受信桌面方法 `connector.list` / `connector.register` / `connector.enable` / `connector.disable` 和迁移 `0009-connectors`：新建默认关闭，凭据只接受引用，不解析也不调用，`ToolPolicy.mcp` 不变。知识切片（D18 收尾）另增受信桌面方法 `knowledge.list` / `knowledge.write` / `knowledge.delete` / `knowledge.search` 与 `memory.retention.get` / `memory.retention.set`，以及迁移 `0010-knowledge-docs`；导入从"写入记忆"改为写入独立知识文档（.txt/.md ≤256 KiB、UTF-8、≤100000 字），模型目录新增只读工具 `knowledge_search`（与记忆工具同路由，能力映射到 `memory.read`）。检索是本地 n-gram TF-IDF 向量 + 精确短语加分的混合排序，不引入嵌入模型或运行期网络。D28 共编侧车另增受信桌面方法 `artifacts.list` / `artifacts.read` / `artifacts.save` / `artifacts.versions` / `artifacts.versionContent` / `artifacts.revert` 和迁移 `0011-artifact-versions`（同步合入时自 0010 顺延，0010 已被知识文档占用）：产物即 bot 工作区真实文件，用户保存写回工作区（bot 下一轮经自身文件工具读到用户版本），Harness 直接写入的文件由读取路径补记版本；用户保存走 Host 直通道，不经工具网关，bot 写入仍走 Harness 工具与既有审批。协议升至 0.4。连接器调用切片（D19 第二片）另增受信方法 `connector.setEndpoint` 与迁移 `0012-connectors-endpoint`（回环端点列），模型目录新增 `connector_invoke` 工具（能力 `connector.invoke`，默认 ask，每次调用带精确参数审批）：首个官方动作 `txt2img` 调用本机 SD WebUI API（`/sdapi/v1/txt2img`，120 秒超时），生成图片写入数据根 `connector-outputs/<connectorId>/` 并以绝对路径返回——图片字节不进契约信封（1 MiB 上限），该目录不进备份。公开 `tool.invoke.callerBotId` 不构成可信授权身份。D16 网关在 schema 校验后授权，未安装检查器时默认拒绝，执行前再次同步验证。详细作用域与迁移边界见 [PERMISSIONS.md](PERMISSIONS.md)。

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

新增可选字段可兼容扩展；删除/更名必需字段、状态语义或事件顺序变化需提升 protocolVersion / schemaVersion、提供迁移说明，由变更负责人自审并同步使用方。拒绝未知更高版本，不能默默丢字段。

契约夹具至少覆盖成功、限流、取消、审批拒绝、重复消息、并发编辑、崩溃重连、循环图、路径越界和过期审批。前端可用这些夹具开发；集成验收必须使用真实适配层。

## 8. 库导出文件（协议面之外）

D17 新增：技能/模板库的统一导出文件格式，定义见 `packages/contracts/src/library-export.ts`，设计见 `docs/superpowers/specs/2026-10-25-skill-library-design.md`。该格式**不进入 Host 协议面**：不经 IPC envelope、不参与 `PROTOCOL_VERSION` 协商，只用于导入/导出文件校验。

- `format` 固定 `"deepseek-bot-library"`、`formatVersion` 固定 `1`；导入先整份校验，不过即整份拒绝，不做部分导入；
- `skills[]` 镜像渲染层 `SkillDefinition`（id/name/instructions/capabilities/version/createdAt/updatedAt）；`capabilities` 仅为声明元数据，强制校验归 D16 三层模型；
- `templates[]` 镜像渲染层模板条目（name + bot{name, instructions, avatarUi}）；`avatarUi` 为渲染层头像派生快照，**不是**契约 `Avatar` 规范池 id；
- 未知对象键按 zod object 默认行为剥离（由契约测试固定）；文件格式升级需契约 PR 提升 `formatVersion` 并写明兼容策略。
