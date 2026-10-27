# 接口与数据契约 v0.7

本文件定义本项目前后端契约，不是 DeepSeek Harness 官方 API。状态：v0.1 已冻结（2026-10-23，D00 验收记录见 D00 Issue）；v0.2 为 D15 写层扩展；v0.3（2026-10-26，D16 后端）新增人类权限控制方法；v0.4（2026-10-26，D28 共编侧车）新增 `artifacts.*` 方法组；v0.5（2026-10-26，manager-orchestration，TASK_MANAGER_ORCHESTRATION.md）新增 bot 协调者角色、`task.*` 方法组、`task.status` 任务事件与能力 `app.dispatch_task`，`protocolVersion` 升至 0.5，继续接受 0.1–0.4 发送方。工作流文档 `schemaVersion` 保持 0.1（存量数据可读）。后续变更按 §7 提升版本并由变更负责人自审同步使用方。可执行实现位于 `packages/contracts/`：schema、§7 夹具与双方共用契约测试见 [packages/contracts/README.md](../packages/contracts/README.md)。所有字段均需后端校验，TypeScript 类型不能替代运行时校验。

v0.5（D19 MCP HTTP 契约片）新增连接器类型、MCP 工具发现与逐机器人精确工具授权方法，以及独立能力 `mcp.call`。该契约片不代表 MCP Host、存储迁移、桌面设置或真实服务联调已经完成。

v0.6（D21 指定窗口截图与本地 OCR 契约片）新增 `screen.*` 受信桌面方法与结果元数据。当前 `protocolVersion` 为 0.7，继续接受 0.1–0.6 发送方；工作流 `schemaVersion` 仍为 0.1。Windows 采集、离线 OCR 与 Host 网关已在 develop；桌面设置页调用这些方法做本机预览。这不代表真实窗口、打包 Electron 或发布验收已经完成。实现依据见 [D21 设计](superpowers/specs/2026-10-27-local-screen-sensing-design.md)。

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
| Bot | id, revision, name, instructions, modelProfileId, workspaceId, toolPolicyId, avatar?, groupId?, role?, archivedAt | 机器人实例不保存原始 API Key；归档后禁止新执行，历史快照保留；avatar/groupId 为 v0.2 附加（nullish，缺失即未分配，UI 自行回退）；role 为 v0.5 附加（缺省 standard，存量快照可读），仅人类编辑器可写，每组至多一个 coordinator |
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
| ScreenResult | id, mode(image\|ocr), at, width, height, hasOcr | v0.6：严格元数据对象；id 为 UUID，at 为 UTC ISO，每边整数 1–8192；不含路径、窗口标题、图像或 OCR 正文 |
| ScreenStatus | supported, enabled, target, busy | v0.6：布尔状态；target 为 null 或 `{id: UUID, title: string≤512}`，id 是当前 Host 代次的不透明窗口 token |
| CapabilityPolicy | capability, mode | v0.3；全局 allow/ask/deny 默认策略，受高风险能力限制 |
| ConnectorKind | sd-webui / mcp-http | v0.5；register 省略 kind 时默认 sd-webui；现有连接器响应 kind 可选以兼容旧 Host，后续实现应始终输出类型；旧记录按 sd-webui 解释 |
| McpTool | name, description?, inputSchema | v0.5；name 为 1–200 字符精确名称，description ≤4000 字符，inputSchema 为 JSON 对象（record unknown）；发现最多 200 项，不把远端描述当指令或授权 |
| McpServerGrant | serverId, allowedTools | 单个服务器的精确工具白名单，最多 200 个唯一名称；名称 1–200 字符，禁止 `*`/`?` 通配符，不进行大小写或空白归一化；空数组表示不允许该服务器的工具 |
| PermissionGrant | id, capability, botId, mode, scope, sessionId, generation, approvalId, maxUses, uses, expiresAt, createdAt, revokedAt | v0.3；scope=policy 为全局策略行，其余为 bot 专属 once/session/permanent 授权；计数在执行前原子扣减 |
| AppApproval | id, invocationId, callerId, botId, sessionId, tool, capabilities, params, actionDigest, generation, status, createdAt, expiresAt, decidedAt | v0.3；精确参数预览与 10 分钟期限，独立于 D08 Approval；重启失效 |
| PermissionAudit | id, sequence, at, actor, callerId, botId, tool, capabilities, actionDigest, grantIds, approvalId, decision | v0.3；只追加，保存摘要与决策元数据，不保存参数原文 |
| Task | id, fromBotId, toBotId, instruction, status, resultSummary, rootTaskId, chainIndex, chainTotal, createdAt, startedAt?, finishedAt?, workerMessageIds | v0.5：协调者派发的一次指令任务；rootTaskId/chainIndex/chainTotal 标记 T7 交接链坐标（首跳 rootTaskId 即自身）；instruction ≤ 8000 字 |
| ChatMessageMeta | kind=dispatch{taskId, fromBotId} \| kind=task_notice{taskId, status, resultSummary?} | v0.5：聊天消息行的附加标记（存储列 meta_json），渲染层据此显示"派发"样式与交付通知；普通消息无此字段 |

## 3. 方法边界

v0.5 的 MCP 控制方法只供受信桌面调用，不能注册为模型工具。`mcp-http` 后续传输仅使用本机 HTTP 回环端点，允许 `/mcp` 等路径；端点的 scheme、回环主机、凭据与重定向等检查由 Host 实现承担，当前契约仍只校验 endpoint 字符串长度与形状字段。`connector.register` 和 `connector.setEndpoint` 不因配置地址而自动调用服务。

MCP 实际调用使用独立能力 `mcp.call`，默认 `ask`，禁止全局 `allow` 与 session/permanent 授权；只允许绑定精确动作、代次与一次消费的 once 审批。`deny` 可全面禁用。既有 `connector.invoke` 策略或授权不能替代该审批；`ToolPolicy.mcp` 的服务器/工具白名单也是独立门槛，不能代替人类逐次批准。此规则本片落实为能力和授权 schema，Host 执行检查与错误路径将在后续实现片完成。

| 方法组 | 语义 | 幂等/错误重点 |
| --- | --- | --- |
| bot.list / create / update / archive | 管理机器人 | create 以 requestId 去重；update 校验 revision；create/update 可携带显式 avatar/groupId（用户指定优先） |
| bot.batchCreate | v0.2 聊天驱动批量创建（FR-12） | 单事务：newGroup 与 groupId 互斥；逐字段回退 batch defaults；头像显式优先、自动分配组内不重复（组合用尽才允许重复）；以 idempotencyKey 去重；返回 batchId 供 creation.revoke |
| creation.revoke | v0.2 整批撤销 | 归档该批全部 bot（无 revision 守卫，撤销必须生效），批次自建的组一并归档；重复撤销返回 INVALID_INPUT |
| group.create / list | v0.2 分组管理 | list 仅返回未归档组 |
| workflow.list | v0.3 工作流摘要（选择器用） | 只回 id/name/revision，不回节点图；全库摘要远低于 1 MiB 消息上限 |
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
| connector.mcp.discover | v0.5 受信桌面契约：`{id: UUID}` → `{tools: McpTool[], at: UTC ISO}` | 请求严格字段；最多 200 个工具。Host 后续负责启用状态、mcp-http 类型、端点与远端响应验证 |
| connector.mcp.grants.get | v0.5 受信桌面契约：`{botId: UUID}` → `{servers: McpServerGrant[]}` | 请求严格字段；返回最多 50 个服务器，仅当前 bot 的授权 |
| connector.mcp.grants.set | v0.5 受信桌面契约：`{botId: UUID, id: UUID, allowedTools: string[]}` → `{servers: McpServerGrant[]}` | 仅替换指定 bot 与连接器的工具白名单；最多 200 个唯一精确名称，空数组清空；不得扩大其他服务器权限。后续 Host 校验名称确实存在于该服务器的发现结果 |
| screen.status | v0.6：`{botId: UUID}` → `ScreenStatus` | 仅受信桌面；不能凭读取状态取得采集授权 |
| screen.windows.list | v0.6：`{}` → `{windows: {id: UUID, title: string≤512}[]}` | 最多 200 个窗口；不暴露 HWND、PID 或文件路径；列表仅含元数据 |
| screen.target.set | v0.6：`{botId: UUID, id: UUID\|null}` → `ScreenStatus` | null 清除目标；选择绑定当前代次，重启后重新选择；设置目标不触发采集 |
| screen.request | v0.6：`{botId: UUID, mode: image\|ocr}` → `ScreenResult` | 指定窗口截图或截图后本地 OCR；复用 `screen.capture` 默认 deny、仅单次审批；返回严格元数据 |
| screen.cancel | v0.6：`{botId: UUID}` → `{cancelled: boolean}` | 取消该 bot 等待审批或进行中的操作；仅结束应用拥有的辅助进程 |
| screen.results.list | v0.6：`{botId: UUID}` → `{results: ScreenResult[]}` | 最多 50 项，按新到旧；满额要求用户删除，不覆盖旧结果 |
| screen.result.read | v0.6：`{botId: UUID, id: UUID}` → `{result: ScreenResult, imageBase64: string≤360000, text: string≤65536\|null}` | 仅受信桌面本机预览；JPEG base64 与 OCR 正文不进入模型输出；Host 另检查实际文件字节数 |
| screen.result.delete | v0.6：`{botId: UUID, id: UUID}` → `{deleted: true}` | 仅删除该 bot 的清单产物，不能按任意路径删除 |
| memory.list / write / delete | v0.3 人类查看、写入和删除当前 bot 的记忆 | 只作用于 payload.botId；空查询返回最近记录，默认 20、最多 50；删除未命中返回 INVALID_INPUT，不暴露其他 bot 的记录 |
| memory.retention.get / set | v0.3 保留策略（记忆 + 知识共用）：retentionDays / memoryMaxPerBot / knowledgeMaxPerBot | 0 = 不限制（默认）；损坏值按 0 读——损坏的设置只会让清理变保守；Host 启动与每次写入后执行清扫 |
| knowledge.list / write / delete | v0.3 当前 bot 的独立知识文档（迁移 `0010-knowledge-docs`） | 正文上限 100000 字（独立于 4000 字记忆）；list 只回摘要（不回正文，1 MiB 消息上限安全）；删除 bot 域隔离同记忆 |
| knowledge.search | v0.3 本地向量检索：CJK 双字 + 拉丁词 TF-IDF 余弦 + 精确短语加分 | 每次查询即时分窗计算（480 字窗、100 字重叠），不预存向量、不引模型；score≤0 不返回，默认 5 条最多 10 条；数百条满幅文档内为设计边界（用 knowledgeMaxPerBot 约束） |
| artifacts.list / read / save / versions / versionContent / revert | v0.4 产物共编侧车：bot 工作区文件的列出、读取、保存、版本、版本内容与回退 | 路径必须相对且不穿越（`RelativeArtifactPathSchema` + realpath 夹紧）；内联内容 ≤ 768 KiB（1 MiB envelope 内留 JSON 转义余量），超限显式拒绝不截断；save 携带 expectedChecksum 时文件已变返回 REVISION_CONFLICT；save/revert 恒追加 author=user 版本，未入账的 bot 写入由 list/read/versions 先补记为 author=bot 版本；每文件保留最近 50 版 |
| task.dispatch / list / cancel | v0.5 任务派发（manager-orchestration） | dispatch 仅由模型工具 `dispatch_task` 经网关到达，请求携带发起者 fromBotId；Host 重验协调者规则（角色/同组/非自身）并执行排队上限（默认 10）；`chain` 预声明 T7 交接链：简单路径（botId 不重复、不含自身）、同组、全链 ≤ 4 跳（Host 可配 2–4，默认 3）；一次审批覆盖整条链，逐跳执行前重验（撤销/deny 即停，剩余跳标 skipped）。list 按 fromBotId/toBotId/rootTaskId/status 过滤；cancel 仅人类：queued 直接取消、running 转 chat.cancel 语义，queued 同链跳级联取消 |

`permission.*` 是受信 Host 控制面，绝不注册为模型工具。设置页调用 `permission.policy.list` / `permission.policy.set` 与 `permission.grant.list` / `permission.grant.revoke`。聊天授权卡调用 `permission.approval.list` / `permission.approval.decide`。本轮应用工具通过每轮令牌认证的 Host 内部 loopback 通道调用；物理 Harness 会话从登记表绑定稳定的 `ToolCaller.botId/sessionId`，不从不透明 caller.id 解析，也不接受模型参数中的身份。八个应用工具的通道不是桌面公开契约。本片另增受信桌面方法 `question.list` / `question.answer`，只读取并回答当前 bot 聊天回合里的 `ask_user`；模型目录不包含这两个方法。另增 `search.config.get` / `search.config.set` / `search.results.list`，只由桌面读写 SearXNG 地址和当前 bot 的搜索结果，模型目录不包含这三个方法。记忆切片另增受信桌面方法 `memory.list` / `memory.write` / `memory.delete`，以及迁移 `0008-memories`。模型工具是 `memory_write` / `memory_search`，不进入八个应用工具目录，也不能删除或指定其他 bot。知识导入不新增契约方法，桌面读完一个 .txt 或 .md 文件后仍调用 `memory.write`。连接器登记另增受信桌面方法 `connector.list` / `connector.register` / `connector.enable` / `connector.disable` 和迁移 `0009-connectors`：新建默认关闭，凭据只接受引用，不解析也不调用，`ToolPolicy.mcp` 不变。知识切片（D18 收尾）另增受信桌面方法 `knowledge.list` / `knowledge.write` / `knowledge.delete` / `knowledge.search` 与 `memory.retention.get` / `memory.retention.set`，以及迁移 `0010-knowledge-docs`；导入从"写入记忆"改为写入独立知识文档（.txt/.md ≤256 KiB、UTF-8、≤100000 字），模型目录新增只读工具 `knowledge_search`（与记忆工具同路由，能力映射到 `memory.read`）。检索是本地 n-gram TF-IDF 向量 + 精确短语加分的混合排序，不引入嵌入模型或运行期网络。D28 共编侧车另增受信桌面方法 `artifacts.list` / `artifacts.read` / `artifacts.save` / `artifacts.versions` / `artifacts.versionContent` / `artifacts.revert` 和迁移 `0011-artifact-versions`（同步合入时自 0010 顺延，0010 已被知识文档占用）：产物即 bot 工作区真实文件，用户保存写回工作区（bot 下一轮经自身文件工具读到用户版本），Harness 直接写入的文件由读取路径补记版本；用户保存走 Host 直通道，不经工具网关，bot 写入仍走 Harness 工具与既有审批。协议升至 0.4。公开 `tool.invoke.callerBotId` 不构成可信授权身份。D16 网关在 schema 校验后授权，未安装检查器时默认拒绝，执行前再次同步验证。详细作用域与迁移边界见 [PERMISSIONS.md](PERMISSIONS.md)。v0.5 manager-orchestration 把聊天应用工具目录从八个扩到十一个（新增 `save_workflow` / `dispatch_task` / `list_tasks`，Host 与 harness-bridge 两侧清单同步）：`save_workflow` 绑定既有 `app.create_workflow`（validate→save，非法草案不落库）；`dispatch_task` 绑定新能力 `app.dispatch_task`（默认每次询问，可授 once/session/permanent——一次派发只是一个聊天回合的成本，与 `app.start_run` 的差异及理由见 PERMISSIONS.md §8）；协调者三重规则（角色/同组/非自身）在网关工具层给出可解释拒绝，并在 `task.dispatch` 方法层权威重验；`list_tasks` 为只读参与者视图（能力 `app.read`）。角色 `role` 只在 `bot.create`/`bot.update` 的人类入口可写，`bot.batchCreate` 的逐 bot 入参改为 strict——模型永远无法触达 role 字段。聊天应用工具的每轮就绪握手校验两侧工具清单完全一致。
| trigger.list / save / enable / disable / delete | v0.3 事件触发规则（迁移 `0013-automation-triggers`）：监听 run.failed / run.completed（可限定源工作流） | 目标/源工作流必须存在；新建默认关闭；删除级联清理其评审记录 |
| trigger.firing.list / decide | v0.3 评审队列：命中事件入队，人工决定启动或忽略 | (rule, source event) 唯一——一个事件只触发一次；队列自己启动的运行不再入队（循环防护）；Host 宕机期间积累的事件以 reason=missed 补入队列——可见、绝不静默补跑；decide 仅对 pending 有效，start 复用 run.start 的策略钉扎与幂等语义 |
| eventRule.save / list / enable / disable | 一个 bot 的本地事件规则（迁移 `0016-event-rules`）：监听 run.failed / run.completed | 受信桌面方法，不是模型工具。目标工作流必须包含该 bot；新建默认关闭，保存不能把规则打开。规则保存前的事件不回放 |
| eventRule.record.list | 同一规则的启动、重复与跳过记录 | 启用时，一条匹配的本地事件启动一个运行；同一事件再次出现只记 duplicate，不启动第二次。规则关闭时记 skipped（reason=`rule disabled`）且不启动；之后再启用也不补跑。不联网，不远程中继。评审队列 `trigger.*` 仍不自动启动 |
| （模型工具 `list_automations`） | v0.3 只读自动化总览：规则清单/启停/待评审条目 | 能力 `app.read` 默认允许；走 `/triggers` 通道；无任何写入或决定参数 |

`permission.*` 是受信 Host 控制面，绝不注册为模型工具。设置页调用 `permission.policy.list` / `permission.policy.set` 与 `permission.grant.list` / `permission.grant.revoke`。聊天授权卡调用 `permission.approval.list` / `permission.approval.decide`。本轮应用工具通过每轮令牌认证的 Host 内部 loopback 通道调用；物理 Harness 会话从登记表绑定稳定的 `ToolCaller.botId/sessionId`，不从不透明 caller.id 解析，也不接受模型参数中的身份。八个应用工具的通道不是桌面公开契约。本片另增受信桌面方法 `question.list` / `question.answer`，只读取并回答当前 bot 聊天回合里的 `ask_user`；模型目录不包含这两个方法。另增 `search.config.get` / `search.config.set` / `search.results.list`，只由桌面读写 SearXNG 地址和当前 bot 的搜索结果，模型目录不包含这三个方法。记忆切片另增受信桌面方法 `memory.list` / `memory.write` / `memory.delete`，以及迁移 `0008-memories`。模型工具是 `memory_write` / `memory_search`，不进入八个应用工具目录，也不能删除或指定其他 bot。知识导入不新增契约方法，桌面读完一个 .txt 或 .md 文件后仍调用 `memory.write`。连接器登记另增受信桌面方法 `connector.list` / `connector.register` / `connector.enable` / `connector.disable` 和迁移 `0009-connectors`：新建默认关闭，凭据只接受引用，不解析也不调用，`ToolPolicy.mcp` 不变。知识切片（D18 收尾）另增受信桌面方法 `knowledge.list` / `knowledge.write` / `knowledge.delete` / `knowledge.search` 与 `memory.retention.get` / `memory.retention.set`，以及迁移 `0010-knowledge-docs`；导入从"写入记忆"改为写入独立知识文档（.txt/.md ≤256 KiB、UTF-8、≤100000 字），模型目录新增只读工具 `knowledge_search`（与记忆工具同路由，能力映射到 `memory.read`）。检索是本地 n-gram TF-IDF 向量 + 精确短语加分的混合排序，不引入嵌入模型或运行期网络。D28 共编侧车另增受信桌面方法 `artifacts.list` / `artifacts.read` / `artifacts.save` / `artifacts.versions` / `artifacts.versionContent` / `artifacts.revert` 和迁移 `0011-artifact-versions`（同步合入时自 0010 顺延，0010 已被知识文档占用）：产物即 bot 工作区真实文件，用户保存写回工作区（bot 下一轮经自身文件工具读到用户版本），Harness 直接写入的文件由读取路径补记版本；用户保存走 Host 直通道，不经工具网关，bot 写入仍走 Harness 工具与既有审批。协议升至 0.4。连接器调用切片（D19 第二片）另增受信方法 `connector.setEndpoint` 与迁移 `0012-connectors-endpoint`（回环端点列），模型目录新增 `connector_invoke` 工具（能力 `connector.invoke`，默认 ask，每次调用带精确参数审批）：首个官方动作 `txt2img` 调用本机 SD WebUI API（`/sdapi/v1/txt2img`，120 秒超时），生成图片写入数据根 `connector-outputs/<connectorId>/` 并以绝对路径返回——图片字节不进契约信封（1 MiB 上限），该目录不进备份。D20 事件自动化另增受信 `workflow.list`、`trigger.*` 方法与迁移 `0013-automation-triggers`；模型只读工具 `list_automations` 走 `app.read`，评审队列由人类决定启动或忽略。公开 `tool.invoke.callerBotId` 不构成可信授权身份。D16 网关在 schema 校验后授权，未安装检查器时默认拒绝，执行前再次同步验证。详细作用域与迁移边界见 [PERMISSIONS.md](PERMISSIONS.md)。

## 4. 事件

持久事件 envelope：`eventId, runId, sequence, timestamp, type, payload`。`sequence` 在同一 Run 内单调递增。消费者按 eventId / sequence 去重；传输允许至少一次投递，不保证绝不重复。

事件类型：`run.created`、`run.statusChanged`、`node.statusChanged`、`tool.requested`、`approval.requested`、`approval.resolved`、`artifact.created`、`run.completed`、`run.failed`、`run.interrupted`。

v0.5 任务事件（T7）：`task.status`。派发任务不进 runs 事件日志（其外键锚定 runs），持久化于独立 `task_events` 表，投递语义与 run 事件一致（eventId 去重、每任务 sequence 单调、`events.subscribe` 的 `taskId` 分支按 afterSequence 重放）。载荷 `{taskId, from, to, reason?}`，终态必须携带 reason。

`assistant.delta` 为瞬态流，带 streamId 与 chunkIndex，不占持久 sequence，不承诺逐片段重放；重连用已提交会话快照补齐。`run.completed` 必须在持久事务成功后发送。

## 5. 状态和失败语义

Run：`queued → running ↔ waiting_approval → succeeded / failed / cancelled`；进程退出或崩溃使未终结运行进入 `interrupted`。取消中的运行使用 `cancelling`，待子任务停止后才进入 `cancelled`。终态不可直接回到 running；恢复以新 Run 关联 `resumedFromRunId`。

Task（v0.5）：`queued → running → done / failed`；queued 可直接 `cancelled`（级联同链 queued 跳），running 取消经 chat.cancel 后落 `cancelled`；T7 接力链中上游失败/被拒时剩余 queued 跳标 `skipped`；Host 重启时 queued/running 一律 `interrupted`（FR-10），人类可重新派发。终态不可回退；迁移 `0012-manager-orchestration-tasks`。

NodeRun：`pending → running ↔ waiting_approval → succeeded / failed / cancelled`，未开始且依赖失败的节点为 `skipped`；崩溃时未结束节点为 `interrupted`。等待审批仅当该节点无法继续时出现；其他独立节点仍可执行。Run 只有在没有可运行节点且尚有审批时才显示 waiting_approval。

失败策略首版为 stop-descendants：失败节点的后继 skipped，独立分支可完成；任一必需节点失败则 Run 为 failed。取消停止全图。所有终态必须给出原因。

自动重试仅用于确认无副作用的临时错误，默认最多 2 次重试，指数退避并尊重 Retry-After。认证失败、权限拒绝、schema 错误不自动重试；工具结果不确定或涉及外部副作用时转人工处理。模型请求可能已计费，重试不承诺无额外费用。

## 6. 稳定错误码

`INVALID_INPUT`、`WORKFLOW_CYCLE`、`MISSING_BINDING`、`REVISION_CONFLICT`、`UNAUTHORIZED_PATH`、`APPROVAL_REQUIRED`、`APPROVAL_EXPIRED`、`AUTH_FAILED`、`RATE_LIMITED`、`MODEL_UNAVAILABLE`、`RUNTIME_UNAVAILABLE`、`TOOL_TIMEOUT`、`CANCELLED`、`DISK_FULL`、`DATA_VERSION_UNSUPPORTED`、`BUDGET_EXCEEDED`。

错误对象包含 code、用户可读 message、retryable、requestId 和脱敏 details。后端堆栈只写本地诊断日志，不返回凭据、完整环境变量或未经脱敏请求。

## 7. 变更与契约测试

新增可选字段可兼容扩展；删除/更名必需字段、状态语义或事件顺序变化需提升 protocolVersion / schemaVersion、提供迁移说明，由变更负责人自审并同步使用方。拒绝未知更高版本，不能默默丢字段。

契约夹具至少覆盖成功、限流、取消、审批拒绝、重复消息、并发编辑、崩溃重连、循环图、路径越界和过期审批。前端可用这些夹具开发；集成验收必须使用真实适配层。

## D21 屏幕感知边界（实现要求）

`screen.*` 全部仅供受信桌面调用，请求与响应严格校验字段，不接受用户路径、命令、原生窗口句柄或任意输入模式。模型工具 `screen_capture` 只接受 `mode`，可信 bot 身份从 Host 会话登记表取得；内部授权参数绑定 `mode`、`selectionId` 与 `windowTitle`，不能由模型更改目标或策略。模型仅得到 `ScreenResult` 元数据，`screen.result.read` 的图像与文本仅供受信界面读取；识别正文不自动进入聊天、Harness、审计或遥测。窗口标题和 OCR 文本都按数据转义显示。

后续 Host/执行实现负责批准前后目标快照与授权重验、跨 bot 隔离、全局单操作锁（忙时拒绝，不排队）、取消与超时、路径/链接/文件类型检查和原子发布。采集最多 8192×8192 中的 1600 万像素、PNG 8 MiB、JPEG 预览 256 KiB、OCR UTF-8 正文 64 KiB；schema 的字符串长度上限不能代替文件字节校验。超限拒绝并清理本次临时产物，不截断结果。采集 10 秒、OCR 60 秒，审批 10 分钟。停用、清除目标、bot 归档、策略变更、聊天取消和 Host 关闭使相关操作失效。

产物保存在工作区之外的数据根 `screen-outputs/<botId>/<resultId>/`，重启仅恢复产物，不恢复窗口选择；产物目录与正文不进入元数据备份，缺失产物明确报不可用。审计仅存摘要、决定与稳定错误码，不存标题、图像或 OCR 原文。OCR 必须使用随附本地资源；缺失资源报 `RUNTIME_UNAVAILABLE`。任意 shell、键鼠输入、全桌面回退、任意路径 OCR、实时视频和远程识别不在此契约片范围。

## 8. 库导出文件（协议面之外）

D17 新增：技能/模板库的统一导出文件格式，定义见 `packages/contracts/src/library-export.ts`，设计见 `docs/superpowers/specs/2026-10-25-skill-library-design.md`。该格式**不进入 Host 协议面**：不经 IPC envelope、不参与 `PROTOCOL_VERSION` 协商，只用于导入/导出文件校验。

- `format` 固定 `"deepseek-bot-library"`、`formatVersion` 固定 `1`；导入先整份校验，不过即整份拒绝，不做部分导入；
- `skills[]` 镜像渲染层 `SkillDefinition`（id/name/instructions/capabilities/version/createdAt/updatedAt）；`capabilities` 仅为声明元数据，强制校验归 D16 三层模型；
- `templates[]` 镜像渲染层模板条目（name + bot{name, instructions, avatarUi}）；`avatarUi` 为渲染层头像派生快照，**不是**契约 `Avatar` 规范池 id；
- 未知对象键按 zod object 默认行为剥离（由契约测试固定）；文件格式升级需契约 PR 提升 `formatVersion` 并写明兼容策略。
