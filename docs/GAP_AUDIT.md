# 缺口审计与补全总任务书（GAP_AUDIT）

| 项 | 值 |
| --- | --- |
| 性质 | 缺口说明书 + 任务书 + 实现需求与实现方式（三合一） |
| 首次盘点 | 2026-10-26，逐份核对 DEVELOPMENT_PLAN §6、SPRINTS §4–§9、全部任务报告的"未验证/已知边界"与代码实况 |
| 第二次刷新 | 2026-10-28，基线 `origin/develop` = `81a0924`（PR #121）；对照第一次刷新基线 `b22ca88`（PR #89）之间合入的 #90–#121，未完成项逐个经 `git grep` 对 develop 重新核实后保留任务书原文并更新证据 |
| 刷新勘误（同日第二提交，基线 `968aa0b` = PR #123） | ① **G2 已由 PR #123 交付**（`feature/g2-bridge-staging-e8f4`，启动即 staging 桥包），移入 §1.1——本刷新首提交仍标开放，特此更正；② **G10 降级为部分完成**：Host 侧 `search.global` 已合入（#117），但渲染层 Ctrl+K 浮层仍只过滤渲染层本地索引（`global-search.tsx` 经 `filterSearch`，全渲染层 grep `search.global` 零调用），余项立为 **G10'**；③ D27 追加：whisper 配置已持久化进 settings KV（PR #118/#123） |
| 第三次刷新 | 2026-10-29，基线 `origin/develop` = `3e21112`（PR #136/#137）；对照第二次刷新基线 `968aa0b`（PR #123）之后合入的 #124–#137，关闭 **G3、G9'、G10'、G11'、D20'**，并把 D21' 收窄为真实键鼠复核；已完成项逐个经 `git grep` 与交付报告核实 |
| 第四次刷新 | 2026-10-29，基线 `origin/develop` = `db64e01`（PR #150/#151）；对照三次刷新后合入的 #138/#143–#151，关闭 **G13（#138 超额交付：计量+自动压缩）、D27'（#151 语音桌面接线）**；#150 为无编号 UX 切片；#138 的审查 P2 未处理即合入，转入治理债 §7.9；已完成项经代码与 PR 正文核实 |
| 第五次刷新 | 2026-10-29，基线 `origin/develop` = `d1cb448`（PR #152–#154）；#152/#153 合入清零在途分支；CONTRACTS 标题对齐 0.11（随本刷新修正）；d14 审查 §2.2 P3 未处理随合并入库转 §7.9；已合入项经代码核实 |
| 已完成并归档 | 第一次刷新已归档 G5/G9（大部）；本次归档 **G6、G7、G8、G10、G14、G11（能力强制部分）、D19（除视觉理解）、D21（真机复核除外）、D22、D27（后端）**、拍板 #2；第三次刷新归档 **G3、G9'、G10'、G11'、D20'**，第四次刷新归档 **G13、D27'**，见 §1.1；#152/#153 为既有任务收尾，记 §1.1 附行 |
| 红线 | 遵守 AGENTS.md 与 SPRINTS 三铁律；契约变更小型独立 PR 先行；未运行检查不得声称通过；不伪造自审；消费红线（零订阅、数据本地）见 SPRINTS §9；**付费真实 Key 验收（G4）在负责人明确授权前不执行** |
| 状态 | 待两位负责人评审、认领与拍板 |

---

## 0. 刷新依据（两次合并总览）

### 10-27 一日合并（第一次刷新依据，b22ca88 及之前）

develop 一天合入 12 个 PR，原审计多项缺口就此关闭：#73 深度思考开关（G5）、#75 D22 系统集成主体、#76 Manager 编排、#64 Canvas 共编侧车、#82 选项卡片回传、#78 D24 备份保险库/恢复/应用内更新（G9 大部）、#77/#83 屏幕截图、#84/#85/#87 事件规则/评审队列/规则状态历史（D20 主体）、#88/#89 设备动作审批与本地记录（D21 一部）、#81/#86 Windows helper 与设置分区修复。

### 10-28 二次刷新总览（b22ca88 → 81a0924，PR #90–#121）

| PR | 内容 | 关闭的审计项 |
| --- | --- | --- |
| #97 `feature/gap-batch1`（c6d03ec） | 重新生成/编辑重发、对话导出、interrupted 恢复入口一次交付 | **G6 ✅、G7 ✅、G14 ✅** |
| #99 `docs/close-mono-shape-decision` | 拍板 #2 记录合入 develop | 治理 §7.2 ✅ |
| #103 `feature/chat-session-list-4e15` | 每 bot 存储会话列表（`stored-session.ts`，基于 `chat.history` 的单会话视图）；`listSessions/openSession` 由 D30 时的空桩改为真实数据 | G1 的"历史回放"部分 ✅（多会话仍属 G12） |
| #104 `feature/d21-device-input` | `device.action.input`：一次精确审批后由 exec daemon 执行一次指针移动/点击或允许列表内按键 | D21 真实输入切片（真机复核仍欠，见 §5） |
| #106 / #111 `feature/d26-gateway-attachments`、`feature/attachment-read-closure` | 网关附件导入 + 工作区上传（`attachment.begin/append/commit`）+ 模型工具 `read_workspace_file`（能力映射 `fs.read`，走 D16 网关检查点，`packages/host/src/attachments.ts:262`） | **G8 ✅** |
| #107 `feature/d19-stdio-credentials` | 本机 stdio MCP + 发现/调用时凭据 `cred:` 引用注入 | D19 凭据引用解析 ✅ |
| #113 `feature/voice-local-backend-8c21` | `voice.status/transcribe/speak`：whisper.cpp 本地转写 + Windows SAPI 本地播报（`packages/host/src/voice.ts`，协议 v0.9） | D27 后端 ✅（桌面语音 UI 未接） |
| #115 `feature/d17-skill-injection`（b60f4ac） | 技能随 `chat.send` 交 Host 注入提示词；技能声明的能力 id 成为该轮工具网关允许集（未声明工具在授权检查前拒绝） | **G11 的"Host 注入与能力强制"部分 ✅**（工作流模板仍未做，余项改记 G11'） |
| #117 `feature/d25-host-search-5f3a`（f819dfd） | `search.global` / `search.config.get/set` / `search.results.list`（contracts methods.ts:151–154）+ Host 侧 bot/消息/工作流/产物一体检索；消息命中回有界摘要，跳转走既有 `chat.history`/`artifacts.read` | **G10 的 Host 后端 ✅**（渲染层浮层当时未接，余项立为 G10'——勘误见上） |
| #119 `feat/usage-stats` | `usage.summary`（v0.10）+ 用量页（总量/按模型/趋势/分布，估算行标记 `estimated`） | D24"本地用量统计" ✅ |
| #108–#112、#114、#116、#120 | 开关/下拉/浅色主题等 UI 修复系列 | — |
| #118 / #123 `feature/voice-config-kv-c4d2`、`feature/g2-bridge-staging-e8f4` | whisper 本地配置持久化进 settings KV；**G2 审批桥启动 staging**（`createHost` 即调 `prepareAppToolProfile`，失败降级 stderr 记录） | **G2 ✅**、D27 配置持久化 ✅ |
| #121 `fix/quota-exhausted-message` | 余额耗尽按 `BUDGET_EXCEEDED` 报告，不再伪装"模型不可用" | G4 验收的错误路径改善 |

### 10-29 三次刷新总览（968aa0b → 3e21112，PR #124–#137）

| PR | 内容 | 关闭的审计项 |
| --- | --- | --- |
| #122 `docs/gap-audit-refresh` | 本文件第二次刷新随该 PR 入库 | — |
| #124 | 与 G2 并行重复实现，已关闭作废 | — |
| #125 `feature/g3-chat-native-approvals-9d4b`（`473ec67`） | 聊天回合内原生工具审批后端：`ChatNativeGate` 把桥转来的 file/shell/mcp/network 动作词映射到 D16 检查点，ask 落既有 AppApproval 卡（10 分钟 TTL、一次决定），渲染复用现链路 | **G3 ✅**（真实回合端到端归 G4/真机） |
| #126 `feature/d25-host-search`（`dbfeda0`） | Ctrl+K 浮层经 `search.global` 查 Host 全库（250ms 防抖、过期响应丢弃、四类命中导航、不可达降级本地） | **G10' ✅** |
| #127 `feature/g11-workflow-template-library`（`92303eb`） | 本地工作流模板库：冻结 `WorkflowDraftSchema` 归一化入架、入架剥离走私的策略字段，落库仍走 `workflow.save` 服务端校验 | **G11' ✅** |
| #129 `feature/g9-update-channel-docs`（`2eddb1e`） | DESKTOP_SHELL.md「应用内更新（D24）」节 + RELEASE.md §4.1「发布即触发更新」检查单，并修正已失实描述 | **G9' ✅** |
| #134 / #135 `feature/d20-automation-notices-3c7a`、`feature/d20-chat-notice`（`b1dae08`/`687ac1e`） | 规则启停/错过/待评审以 meta 行写入所属 bot 聊天（后端）+ 聊天内自动化通知条（折叠摘要、错过明细、去设置处理，静默降级） | **D20' ✅** |
| #128 / #130 / #131 / #133 | 设置导航扁平化；`ask_user` 限真实分叉回合且每回合 ≤3 次；用量图表可读性；侧栏底部固定修复 | — |
| #136 `feature/bot-interop`（`3e21112`） | 任意 bot 平权派发（去角色/同组门槛、跨组链放行）+ `idempotencyKey` 幂等重放；`Bot.role` 退役为遗留标签 | —（任务书 [TASK_BOT_INTEROP](TASK_BOT_INTEROP.md)） |
| #137 `feature/primitive-mode`（`fde0953`） | 作曲器「原始人」开关（`chat.send` 可选 `primitive`，最短提示组装，落库不变）+ 深度思考入口移至输入框旁 | —（任务书 [TASK_PRIMITIVE_MODE](TASK_PRIMITIVE_MODE.md)） |

双语系统核实（第一次刷新记录，仍有效）：语言切换在 设置 → 通用 → 外观 → 语言，持久化于 `deepseek-bot.settings.v2`，Host 文案随 `settings.update { patch: { "ui.locale" } }` 同步（`feature/host-dispatch-bilingual` 线，CONTRACTS.md settings.update 行已补记）。

### 10-29 四次刷新总览（968aa0b → db64e01，PR #138/#143–#151）

| PR | 内容 | 关闭的审计项 |
| --- | --- | --- |
| #138 `feature/context-meter`（`a6c7cb5`） | 上下文用量圆环 + 80% 自动压缩：迁移 `0023-chat-summaries`、受信方法 `chat.contextUsage`、`ChatManager.compressTurn`（空工具面、无审批、用量照记）、渲染层 context-ring；**历史行不删**，删摘要行即恢复全量回放 | **G13 ✅（超额：原设想仅可见性，交付含计量+自动压缩）**；审查 §2.1 P2 未处理即合入（见 §7.9） |
| #143/#145/#146/#147/#148/#149 文档系列 | 台账刷新 ×3、PREMERGE-REVIEW 入库、D22 断链、CONTRACTS 标题对齐 0.10、直接依赖许可索引、BOT_WORKSPACE 口径修正 | 治理债 §7.8 ✅；§7.4 体检全绿 |
| #150 `feature/streaming-reply`（`6659d29`） | stream-pacer：长回复按行/句自适应回放节奏（纯呈现层，契约零改动），修 finish 即 resolve 与取消不释放定时器 | —（无 D 编号 UX 切片；PR 正文即交付描述，无入库报告 → §7.9） |
| #151 `feature/voice-ui-wiring`（`db64e01`） | D27' 语音桌面接线：麦克风录音→WAV→`voice.transcribe`（只填输入框不自动发送，20s 自动停）、逐条回复朗读按钮（`voice.speak`）、按 `voice.status` 门控禁用 | **D27' ✅**（「按住说话/自动断句」交互未做；真机未验证） |

### 10-29 五次刷新总览（db64e01 → d1cb448，PR #152–#154）

| PR | 内容 | 关闭的审计项 |
| --- | --- | --- |
| #152 `feature/d17-skill-host-store`（`cf22763`） | D17' 技能库进 Host：`skillLibrary.get/save`（协议 0.11）+ settings KV `skills.library.v1` 整库校验 + 一次性迁移（composer 数组形态绝不迁移）+ 降级读 localStorage | —（D17 收尾切片） |
| #153 `feature/d14-mermaid`（`6299994`） | D14 mermaid 补齐：strict + DOMPurify svg + shadow DOM、动态 import chunk、失败回退保原文 | —（D14 收尾切片；审查 §2.2 P3 未处理随合并入库 → §7.9） |
| #154 本文件四次刷新 | 审计与台账收敛 | — |

双语系统核实（第一次刷新记录，仍有效）：

## 1. 缺口地图（总览）

优先级定义：**P0** 数据完整性/安全（不修就是缺陷）；**P1** 用户每天碰到的标配（对标承诺已立未兑现）；**P2** 计划内切片收尾；**P3** 需拍板后才立项的产品增量。

| 编号 | 缺口 | 优先级 | 建议负责线 | 依赖 |
| --- | --- | --- | --- | --- |
| G1' | 界面状态持久化与回放补全（G1 剩余：ui.*） | P0 | B（UI）+ A（ui.* 服务） | 拍板 #1（ui.* 清单）；已答卡回放与 `history: true` 见 §2 |
| G4 | 付费真实 Key 全链验收 | P0 | A+B | 负责人提供临时 Key 并授权费用 |
| D21' | 真实 Windows 键鼠输入复核（真实窗口截图/OCR 已有真机证据：[D21-windows-acceptance 报告](reports/D21-windows-acceptance-report.md) §4，PR #93） | P2 | A | 真机 |
| G12 | 多会话管理（会话列表已上，多会话未立） | P3 | A+B | 拍板（新契约面） |
| — | D19 剩余（视觉理解，等模型）/ D13 性能预算实测 / D23 平台收官 | 见 §5 | 按原计划 | — |
| — | 治理债（拍板 #1/自审签署/截图/CONTRACTS.md 文档滞后） | 持续 | 双方 | §7 |

### 1.1 已完成（编号保留备查）

| 编号 | 内容 | 完成载体（证据均对 `81a0924` grep 核实） |
| --- | --- | --- |
| ~~G5~~ | 深度思考开关（reasoner） | PR #73 |
| ~~G6~~ | 重新生成 / 编辑重发 | PR #97；`App.tsx` meta `regenerate`/`edited_resend`、`chat.regeneratedMark`、`shell.regenerateTitle`、仅最新一条助手回复可重新生成 |
| ~~G7~~ | 对话导出 | PR #97；`features/chat/export-conversation.ts`、会话头部菜单 `shell.exportConversation` |
| ~~G8~~ | 附件理解闭环 | PR #106/#111；`read_workspace_file` 见 `packages/host/src/agent-permissions.ts:58`（`fs.read`）、`app-tool-channel.ts:31`、`attachments.ts:262`；上传走 `attachment.begin/append/commit` |
| ~~G9~~（大部） | D24 备份保险库 / 恢复 / 应用内更新 | PR #78；文档欠账拆为 G9'（仍开放） |
| ~~G10~~（Host 部分） | D25 Host 全文检索后端 | PR #117；契约 `search.global` 等四方法 + Host 一体检索，消息命中回有界摘要；**渲染层浮层未接，余项立为 G10'** |
| ~~G2~~ | 审批桥激活 | PR #123；`createHost` 启动即 `prepareAppToolProfile` 幂等 staging 桥包（并行重复实现 PR #124 已关闭作废）；真实 Harness 告警消失一项待真机核对 |
| — | D27 whisper 配置持久化（settings KV） | PR #118/#123（`voice-config-kv`；契约 `voice.*` 配置面扩展，见 D27-voice-config 报告） |
| ~~G11~~（大部） | D17 技能注入与能力强制 | PR #115；工作流模板注入余项改记 G11' |
| ~~G14~~ | interrupted 运行恢复入口 | PR #97；`run-monitor.tsx:403`（G14 注记）+ `run-service.ts:85`（`run.resume` 新运行经 `resumedFromRunId` 链接） |
| — | D19 主体（MCP HTTP/stdio、凭据、连接器注册、SD 生图） | PR #65/#66、D19 各报告、PR #107；**视觉理解等模型可用**（§5） |
| — | D20 主体（触发器、规则、评审队列、状态历史、桌面评审页、重复防护） | PR #66/#84/#85/#87 + D20 各报告；"同一事件不第二次启动"由本地自动启动切片完成 |
| — | D21 主体（契约、Windows 采集/OCR、设备动作审批/记录、真实输入切片） | PR #70/#74/#77/#93/#88/#89/#104；真机复核欠账记 D21' |
| — | D22 系统集成（双语、托盘、通知、Chrome 导入、硬件加速） | PR #75 + 硬件加速 `b57d46b`（`hardware-acceleration.ts`、`App.tsx:2807`、`shell.hardwareAcceleration`） |
| — | D24 本地用量统计 | PR #119 |
| — | D27 语音后端（whisper.cpp 转写 + SAPI 播报） | PR #113；桌面 UI 余项记 D27' |
| — | 每 bot 存储会话列表（G1 历史回放部分） | PR #97/#103；`host-service.ts:208–218` 已接 `chat.history`，`stored-session.ts` 单会话视图 |
| — | 拍板 #2（mono-shape 作废） | PR #99 合入 develop |
| ~~G3~~ | 聊天回合内原生 D08 审批（后端片） | PR #125；`packages/host/src/chat-gate.ts` `ChatNativeGate`（D08 句柄→D16 能力映射，ask 落 AppApproval 卡 10 分钟 TTL），渲染复用 `permission.approval.*` 卡面；真实回合端到端归 G4/真机 |
| ~~G9'~~ | D24 应用内更新通道文档 | PR #129；`docs/DESKTOP_SHELL.md`「应用内更新（D24）」节 + `docs/RELEASE.md` §4.1 检查单，断言与代码对照见 [G9' 报告](reports/G9-update-channel-docs-report.md) §2 |
| ~~G10'~~ | Ctrl+K 浮层接 Host 检索 | PR #126；`host-service.ts` 直调 `search.global`（limit 20）、`global-search.tsx` 250ms 防抖 + 过期丢弃 + 四类导航 + 失败降级本地（[报告](reports/D25-host-search-renderer-report.md)） |
| ~~G11'~~ | D17 工作流模板库 | PR #127；`features/workflow-editor/template/workflow-templates.ts` 冻结 schema 剥离走私策略字段 + Host 端不落库用例（[报告](reports/G11-workflow-template-library-report.md)） |
| ~~D20'~~ | 聊天内自动化状态通知条 | PR #134/#135；meta 行（kind automation）+ `features/automation/chat-automation-notice.tsx`（错过明细/启停/待评审，20 秒轮询、静默降级，契约零改动）（[报告](reports/D20-chat-notice-report.md)） |
| ~~G13~~ | 上下文用量可视 + 80% 自动压缩（超额） | PR #138；`chat.contextUsage` + 迁移 `0023-chat-summaries` + `compressTurn`（空工具面、无审批、用量照记）+ 渲染层 context-ring；历史行不删；**审查 §2.1 P2（并发断言）未处理随合并入库**；真实模型摘要质量与真机未验证（[报告](reports/CONTEXT_METER-report.md)） |
| ~~D27'~~ | 语音桌面接线 | PR #151；`features/voice/`（wav 编码/clip-recorder/voice-ui 门控）+ 逐条朗读按钮。按住说话在 `feature/d27-hold-to-talk-220a`：松开后 `voice.transcribe` 只填输入框、不自动发送，20 秒上限与 `voice.status` 门控保留；自动断句未做；真机未验证 |
| — | stream-pacer 流式回放节奏（无编号 UX 切片） | PR #150；`features/chat/stream-pacer.ts` 纯呈现层（按行/句自适应、≤7s），修 finish 即 resolve 与取消定时器泄漏；无入库报告 |
| — | D17' 技能库进 Host（协议 0.11） | PR #152；`skillLibrary.get/save` + settings KV `skills.library.v1` 整库校验 + 一次性迁移（composer 数组形态绝不迁移）+ 降级读 localStorage；审查 §2.3 备忘未处理（不阻塞）；真机未验证（[报告](reports/D17-skill-host-store-report.md)） |
| — | D14 补遗：本地 mermaid 渲染 | PR #153；strict + DOMPurify svg + shadow DOM、动态 import chunk、失败回退保原文；**审查 §2.2 P3 未处理随合并入库**；真机截图未做（[报告](reports/D14-mermaid-report.md)） |

---

## 2. P0：数据完整性与安全债

### G1' 界面状态持久化与回放补全（原 G1 剩余）

**已完成部分（不再重复立项）**：`chat.history` 契约（D30）+ 渲染层接线（PR #97/#103）——重启后每 bot 消息历史与流式最终态可见，会话列表/打开读同一份存储行（`stored-session.ts`）。

**剩余缺口（ui.*，仍等拍板 #1）**：
- 契约面无任何 `ui.*` 方法（`packages/contracts/src/methods.ts`、`packages/host/src` grep 零命中）：侧栏 bot/分组排列、选中态、界面偏好仍重启即失（SPRINTS §7"全局"行）。本片不新增 `ui.state.get/set`。

**已补、不依赖拍板 #1**：
- 已答选项卡：`question.answer` 在助手消息写入 `meta.kind = "choice"`（问题、展示选项、`answered`）。`historyThreadMessages` 恢复 `choices.answered`；卡片折叠，`canAnswerChoice` 对 `history: true` 或已有 `answered` 返回 false，不能再次作答。存量无该 meta 的提问行仍是纯文本。
- 从 `chat.history` 装入的消息带 `history: true`（并保留 `origin: "history"`）。回放行的时间分隔使用更弱的样式，与本会话新消息区分。

**需求**（沿第一次刷新 G1 的需求，范围收窄到剩余三项）：
- 侧栏 bot/分组排列、选中态、界面偏好重启后恢复；快照不含任何密钥/敏感数据；
- ~~已答选项卡从 `chat_messages` meta 恢复 `choices.answered`，且不可再次作答~~；
- ~~历史回放消息明确区分"历史回放"与"新消息"（弱化时间分隔、禁止再次触发已答卡）~~（`history: true`）。

**实现方式**（按 [RENDERER_HOST_MAPPING.md](RENDERER_HOST_MAPPING.md) §3 的 B 步；ui.* 不进冻结契约）：
1. Host 新增 `ui.state.get/set` 受信方法（按 key 存 JSON 快照，白名单校验：超 key/超大 payload 拒绝），渲染层状态变更防抖写入——**此项依赖拍板 #1 对 ui.* 清单的正式记录，本片未做**；
2. ~~卡片消息从 `chat_messages` 的 meta 恢复 `choices.answered`~~（`ChatMessageMeta` 增加可选 `kind: "choice"`，不升 `protocolVersion`）；
3. ~~历史回放消息以 `history: true` 标记渲染~~。

**验收**：
- [ ] 发送 10 条消息重启应用，历史与流式最终态完整恢复（现有行为，回归确认；本片未做 Electron 重启）；
- [ ] 已答选项卡重启后仍为已答态且不可再次作答（单测覆盖 meta 落库与回放拒答；未做真机重启）；
- [ ] `ui.*` 方法白名单校验通过，快照不含 Key；
- [ ] 拍板 #1 正式记录到 RENDERER_HOST_MAPPING §4（采纳 B 及 ui.* 清单）。

### G2 审批桥激活 —— **已完成（PR #123，2026-10-28 合入），移入 §1.1**

`createHost` 启动即调 `prepareAppToolProfile` 把桥包幂等拷入钉扎 profile（失败不阻断启动、stderr 记录）。首次刷新建议的 `installBridgeIntoProfile`（pnpm file:）路径未采用，与最终实现一致；验收第一条（真实钉扎 Harness 不再打印 `entry did not activate`）仍待真实启动核对。

### G10' D25 后半：渲染层浮层接 Host 检索 —— **已完成（PR #126，2026-10-28 合入），移入 §1.1**

Ctrl+K 浮层经 `search.global` 检索 Host 全库：250ms 防抖 + latest-ref、过期响应丢弃、bot/message/workflow/artifact 四类命中同列表键盘导航、Host 不可达时降级本地并如实提示。真机 Electron 手测与真实数据下的检索质量仍未验证（[报告](reports/D25-host-search-renderer-report.md) §3）。

### G3 原生聊天回合内的 D08 工具审批 —— **已完成（PR #125，2026-10-28 合入），移入 §1.1**

`ChatNativeGate` 把桥转来的原生工具审批路由到 D16 检查点（fs/exec 能力 + 聊天网络缝 + mcp.call），ask 落既有 AppApproval 卡面（10 分钟 TTL、一次决定）；桌面渲染复用现链路。**真实 Harness 回合内的端到端（弹卡、拒绝无副作用、超时/取消终止回合）仍未验证**，归 G4 授权后或真机复核执行。

### G4 付费真实 Key 全链验收

**现状（证据）**：D30/D16 等多份报告标注"真实 Key 回复未验证/付费模型验收未执行"；仅 D30 验收时用过一次用户临时 Key。PR #121 改善了余额耗尽的错误路径（`BUDGET_EXCEEDED`）。

**需求**：以用户临时 Key（safeStorage 密文本地保存，不提交不入库）对聊天、工作流运行、审批、记忆/知识、web_search、附件（G8 已合入）、深度思考、语音（D27 后端）做一次贯通验收，记录用量、延迟与失败样例，归档报告。

**约束（2026-10-28 新增）**：按当前工作指示，**不发起付费模型调用**；本项保持开放，待负责人提供临时 Key 并明确授权费用后执行。验收前所有"真实模型回复"类结论一律标注未验证。

**验收**：
- [ ] 全链清单逐项打勾，含账单侧模型名核对（reasoner/chat 各至少一轮）；
- [ ] 报告如实区分"验证通过"与"未验证"。

---

## 3. P1：对标快赢（SPRINTS §9.1）

**本节四项已全部完成（2026-10-28 对 `81a0924` 逐项核实），移入 §1.1**：深度思考开关（PR #73）、重新生成/编辑重发（PR #97）、对话导出（PR #97）、附件理解闭环（PR #106/#111）。SPRINTS §9.1 表的对应注记随本刷新更新。

---

## 4. P2：计划内切片收尾

### G9' D24 文档欠账 —— **已完成（PR #129，2026-10-28 合入），移入 §1.1**

`docs/DESKTOP_SHELL.md` 新增「应用内更新（D24）」一节并修正已失实描述（更新通道已接入、设置六分区可用）；`docs/RELEASE.md` §4.1 新增「发布即触发更新的检查单」。文档断言与代码行为逐条对照见 [G9' 报告](reports/G9-update-channel-docs-report.md) §2。

### G11' D17 收尾剩余（工作流模板注入）—— **已完成（PR #127，2026-10-28 合入），移入 §1.1**

渲染层本地模板库（冻结 `WorkflowDraftSchema` 归一化入架、剥离走私的策略字段）+「走私字段不落库」的渲染/Host 双层用例；应用模板仍经 `workflow.save` 服务端校验落库，模板内嵌权限不可信。Electron 真机手测与截图未做（[报告](reports/G11-workflow-template-library-report.md) §3）。

---

## 5. 正式任务剩余项（按原计划执行，本文不重写任务书）

以下在 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) §6 已有验收定义，仅列 2026-10-28 对 `81a0924` 的现状：

- **D19 剩余**：视觉理解（DeepSeek 视觉模型可用后接入；凭据引用解析、本地 SD 生图、MCP HTTP/stdio 均已交付，见 D19 各报告与 PR #65/#107）；
- **D20**：计划内切片全部交付——聊天内状态通知条与错过可见已由 PR #134/#135 补齐（触发器、规则、评审队列、规则状态历史、重复防护、桌面评审页此前已交付：PR #66/#84/#85/#87 + D20 各报告；"同一事件不第二次启动"由本地自动启动切片完成）；
- **D21 剩余**：真实键鼠输入复核（真实窗口截图/OCR 已有真机证据：[D21-windows-acceptance 报告](reports/D21-windows-acceptance-report.md) §4，PR #93；D21-device-input 报告自记"没有在这台 Linux 环境上执行真实 Windows 键鼠或复核真实窗口截图/OCR"；输入闸门与本地记录已交付：PR #88/#89/#104；键鼠真机复核与真实设备动作验收合并排期）；
- **D22**：全部完成（双语/托盘/通知/Chrome 导入 PR #75；硬件加速 `b57d46b`）；
- **D27**：计划内切片全部交付——桌面语音接线由 PR #151 交付（麦克风录音转写只填输入框、逐条朗读、`voice.status` 门控禁用）。按住说话由 `feature/d27-hold-to-talk-220a` 接上（松开填入输入框，不自动发送，20 秒上限保留）；自动断句仍未做，与原验收措辞的差异由归属人自审确认；
- **D13 性能预算实测**（PRD §6：未测量不得宣称达标）、**D23 平台收官**：按 DEVELOPMENT_PLAN §9 顺延至阶段二收官，与发布验收合并执行。

## 6. P3：需拍板后立项的产品增量

### G12 多会话管理
**缺口**：D30 每 bot 单逻辑会话（`chat:<botId>`）；PR #103 已交付基于 `chat.history` 的**单会话**列表/打开（`stored-session.ts`，一个 bot 有消息即一个会话）。真正的多会话/重命名/清理仍未立项；Grok 对标存在多会话体验。
**实现草案**：契约附加 `chat.session.list/open/new`（每 bot 多个 session，Host 侧 session id 由 `chat:<botId>:<n>` 扩展）；UI 为 bot 会话页头部加会话下拉/列表。**涉及 chat.send 语义扩展（activeSession），须契约负责人评审后再立任务书**。

### G13 上下文窗口可见性 —— **已完成（PR #138，2026-10-29 合入，超额交付计量+自动压缩），移入 §1.1**

> 原 §6 草案正文保留如下作历史记录。
**缺口**：每轮回放"近期历史"的截断策略用户不可见，长会话静默失忆（`contextTurns` grep 零命中）。
**实现草案**：Host 在回合结果事件中携带 `contextTurns`（本轮实际携带条数/截断数），消息 meta 展示"本轮携带历史 N 条"；超出时的提示条。小活，可与 G12 同期或独立做。

---

## 7. 治理与流程债（不修完不算完善）

1. **拍板 #1**（Renderer→Host 方案）：D 步与 B 步的聊天/历史部分已事实上线（运行监控真实化、`chat.history` 接线、存储会话列表），但 **G1' 剩余的 ui.* 界面态持久化仍需拍板 #1 对 ui.* 清单的正式记录**（记录到 RENDERER_HOST_MAPPING §4）后开工；
2. ~~拍板 #2~~ **已定案并合入 develop（PR #99，2026-10-27）**：develop 头像线为基准，`feature/mono-shape` 作废；
3. **自审签署**：B 线四项（D14/D24/D25/D26）、D17、D18/D19 报告的自审栏仍空；10-28/29 合入的 G3、G9'、G10'、G11'、D20'（两份）、D21-windows-acceptance、BOT_INTEROP、PRIMITIVE_MODE 各报告自审栏同样留空，PR #136/#137 任务书 §6 亦未填，#152/#153 两份报告自审栏同样留空（不追认，由负责人本人针对最新提交 SHA 签署）；
4. **手测截图**：`docs/reports/assets/` 现有 chat-diag/d02/d05/d07/d09/d16/d19-mcp/d21/d22/d24-data/d28/d30/settings-nav/sidebar-footer/ui-settings/usage-charts/usage-stats，**d14/d17/d25/d26 仍缺**（d21 两张为合成文本证据图）；
5. ~~SPRINTS §7 审计表刷新~~ **随本刷新更新**（语言、备份、更新、设置持久化、附件、搜索、硬件加速行改为已完成并登记去向 GAP_AUDIT）；
6. ~~快赢安家~~ **SPRINTS §9.1 表已注记四项全部完成及载体**（随本刷新）；
7. ~~本文件入库~~ **随 docs/gap-audit-refresh 分支提交**；
8. ~~CONTRACTS.md 文档滞后~~ **已收口（2026-10-29 契约补记）**：`chat.send` / `chat.history` / `chat.cancel` / `chat.status` / `chat.attach` 五行已补入 §3 方法表，内容以 `packages/contracts` 冻结 schema 为准（此前 `chat.status` 全文零提及）；skills、primitive 与附件分块细节仍指向既有 D17/D26 节与 §4 事件段，两处漂移风险就此消除；
9. **无报告合入与 P2 未处理（2026-10-29 四次刷新新增）**：#150（stream-pacer）/ #151（语音接线）未按 §9「每编号 + 报告」入库报告文件（PR 正文模板齐全，是否补报告由归属人定）；#138 合并时未处理 PREMERGE-REVIEW §2.1 的 P2——压缩回合与用户发送真并发 vs 任务书/报告「忙锁排队」断言的分歧已随合并进入 develop，处理方式（改锁或改文档）待归属人；d14 §2.2 P3（主题切换后新图仍用旧主题）同样未处理随 #153 入库（`setMermaidTheme` 仍不重新 initialize）。

## 8. 建议排期（依赖驱动的批次，可多晚并行）

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| ~~第一批~~ | G10'（#126）、G9'（#129）、G3（#125）、G11'（#127）、D20'（#134/#135） | 10-28/29 已全部交付，见 §1.1 |
| 第二批 | G1' 的 ui.*（等拍板 #1 记录 ui.* 清单） | 已答卡回放与 `history: true` 不在此等待；P0 其余为 G4 |
| 第三批 | D21'（真实键鼠，真机）；语音实机联调（录音/朗读真机验收，#151 已接线） | 需真机环境 |
| 第四批 | G4 全链验收（需临时 Key 与费用授权）+ D13/D23 收官 | 各项主体合入后执行 |
| 另行立项 | G12、G13（拍板后）；D19 视觉理解（等模型） | — |

并行保障：G2→G3 为 Host/桥一线；G9'/G1'/D20'/D27' 主要在渲染层与文档，文件面与 Host 线基本不交叉；跨线任务按 SPRINTS 铁律拆分文件边界。

## 9. 全局验收门槛

- 每个编号独立 feature 分支 + PR + 报告，逐条验收打勾并附证据（截图/命令输出）；
- 契约变更（G1' 的 ui.*、G12 若立项）走小型独立 PR 先合 develop；
- 全量 `pnpm lint / typecheck / test` 与 desktop build 在合入前全绿；
- 收官判定以 D13/D23 的发布门槛为准：本文全部 P0/P1 项完成是 D23"无 P0/P1 缺陷"结论的前置；
- 本文件每次刷新须注明基线 commit 并对每条"已完成"给出 grep/报告证据；未运行检查不得声称通过。
