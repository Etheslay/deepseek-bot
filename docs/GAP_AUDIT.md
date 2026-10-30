# 缺口审计与补全总任务书（GAP_AUDIT）

| 项 | 值 |
| --- | --- |
| 性质 | 缺口说明书 + 任务书 + 实现需求与实现方式（三合一） |
| 首次盘点 | 2026-10-26，逐份核对 DEVELOPMENT_PLAN §6、SPRINTS §4–§9、全部任务报告的"未验证/已知边界"与代码实况 |
| 第二次刷新 | 2026-10-28，基线 `origin/develop` = `81a0924`（PR #121）；对照第一次刷新基线 `b22ca88`（PR #89）之间合入的 #90–#121，未完成项逐个经 `git grep` 对 develop 重新核实后保留任务书原文并更新证据 |
| 刷新勘误（同日第二提交，基线 `968aa0b` = PR #123） | ① **G2 已由 PR #123 交付**（`feature/g2-bridge-staging-e8f4`，启动即 staging 桥包），移入 §1.1——本刷新首提交仍标开放，特此更正；② **G10 降级为部分完成**：Host 侧 `search.global` 已合入（#117），但渲染层 Ctrl+K 浮层仍只过滤渲染层本地索引（`global-search.tsx` 经 `filterSearch`，全渲染层 grep `search.global` 零调用），余项立为 **G10'**；③ D27 追加：whisper 配置已持久化进 settings KV（PR #118/#123） |
| 第三次刷新 | 2026-10-29，基线 `origin/develop` = `3e21112`（PR #136/#137）；对照第二次刷新基线 `968aa0b`（PR #123）之后合入的 #124–#137，关闭 **G3、G9'、G10'、G11'、D20'**，并把 D21' 收窄为真实键鼠复核；已完成项逐个经 `git grep` 与交付报告核实 |
| 第四次刷新 | 2026-10-29，基线 `origin/develop` = `db64e01`（PR #150/#151）；对照三次刷新后合入的 #138/#143–#151，关闭 **G13（#138 超额交付：计量+自动压缩）、D27'（#150 语音桌面接线）**；#151 为无编号 UX 切片；#138 的审查 P2 未处理即合入，转入治理债 §7.9；已完成项经代码与 PR 正文核实（**勘误 2026-10-30：本行及 §0 下表原本把两 PR 编号写反——以合并提交为准 #150=`feature/voice-ui-wiring`、#151=`feature/streaming-reply`**） |
| 第五次刷新 | 2026-10-29，基线 `origin/develop` = `d1cb448`（PR #152–#154）；#152/#153 合入清零在途分支；CONTRACTS 标题对齐 0.11（随本刷新修正）；d14 审查 §2.2 P3 未处理随合并入库转 §7.9；已合入项经代码核实 |
| 第六次刷新 | 2026-10-29，基线 `origin/develop` = `9d3ac5b`（PR #156–#160）；关闭 **G4 主体（#159 付费链路验收入档，残留见 §2）**、**D21' 真机指针/按键记录（#160，文档）**；G1' 回放弱化（#156/#158）与 D27 按住说话（#157）随合并入档；§7.9 的 cm P2（改文档）与 d14 P3（改代码）以两个**未推送本地分支**处置；已合入项经报告与代码核实；后续状态以 §7.10 勘误为准 |
| 第七次刷新 | 2026-10-30，基线 `origin/develop` = `5248ab6`（PR #161–#172）；对照六次刷新基线 `9d3ac5b` 之后合入的 #161–#172，**无新增缺口关闭**（均为 UX/流式/文档/加固切片）；新增 **§7.10 工作流主路径接线核对**，并据此勘误 G14 与 G11' 的完成口径；§7.9 中两处「未推送分支」更新为已由 #165/#167 合入；发现 #172 新增的 `chat.stream` 服务端推送未进契约文档（记 §7.10）；同步刷新 SPRINTS §4、§10 账目 |
| 接线后勘误（2026-10-30，本 PR） | 基线 `origin/develop` = `ad617a0`（PR #173–#177）：#173 入库第七次刷新；#174 工作流回合 token 入 `usage_events`；#175 `ui.*` 界面态契约候选；#176 工作流读面（协议 v0.12：`workflow.get`/`run.snapshot`/`approval.list`）；#177 桌面 `workflows`/`runs` 切真实 Host。据此更新 §7.10 状态、§8 第五批进度与 SPRINTS 账目；**桌面 UI 端到端人工验收仍未执行**，§7.10 结论保持「接线完成、验收未完成」 |
| 已完成并归档 | 第一次刷新已归档 G5/G9（大部）；本次归档 **G6、G7、G8、G10、G11（能力强制部分）、D19（除视觉理解）、D21（真机复核除外）、D22、D27（后端）**、拍板 #2；第三次刷新归档 **G3、G9'、G10'、G11'、D20'**，第四次刷新归档 **G13、D27'**，第六次刷新归档 **G4（主体入档）**，见 §1.1；#152/#153 为既有任务收尾，记 §1.1 附行；**第七次刷新无新增归档** |
| 红线 | 遵守 AGENTS.md 与 SPRINTS 三铁律；契约变更小型独立 PR 先行；未运行检查不得声称通过；不伪造自审；消费红线（零订阅、数据本地）见 SPRINTS §9；**付费调用已执行一次（G4，#159）；再次付费调用仍需负责人逐次授权** |
| 状态 | 待两位负责人评审、认领与拍板 |

---

## 0. 刷新依据（合并总览）

### 10-27 一日合并（第一次刷新依据，b22ca88 及之前）

develop 一天合入 12 个 PR，原审计多项缺口就此关闭：#73 深度思考开关（G5）、#75 D22 系统集成主体、#76 Manager 编排、#64 Canvas 共编侧车、#82 选项卡片回传、#78 D24 备份保险库/恢复/应用内更新（G9 大部）、#77/#83 屏幕截图、#84/#85/#87 事件规则/评审队列/规则状态历史（D20 主体）、#88/#89 设备动作审批与本地记录（D21 一部）、#81/#86 Windows helper 与设置分区修复。

### 10-28 二次刷新总览（b22ca88 → 81a0924，PR #90–#121）

| PR | 内容 | 关闭的审计项 |
| --- | --- | --- |
| #97 `feature/gap-batch1`（c6d03ec） | 重新生成/编辑重发、对话导出与 interrupted 运行恢复的夹具入口 | **G6 ✅、G7 ✅；G14 的桌面入口仍为夹具，见 §7.10** |
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
| #127 `feature/g11-workflow-template-library`（`92303eb`） | 本地工作流模板库：冻结 `WorkflowDraftSchema` 归一化入架、入架剥离走私的策略字段，模板入架通过渲染层 schema 校验；编辑器保存仍为内存夹具，见 §7.10 | **G11' ✅** |
| #129 `feature/g9-update-channel-docs`（`2eddb1e`） | DESKTOP_SHELL.md「应用内更新（D24）」节 + RELEASE.md §4.1「发布即触发更新」检查单，并修正已失实描述 | **G9' ✅** |
| #134 / #135 `feature/d20-automation-notices-3c7a`、`feature/d20-chat-notice`（`b1dae08`/`687ac1e`） | 规则启停/错过/待评审以 meta 行写入所属 bot 聊天（后端）+ 聊天内自动化通知条（折叠摘要、错过明细、去设置处理，静默降级） | **D20' ✅** |
| #128 / #130 / #131 / #133 | 设置导航扁平化；`ask_user` 限真实分叉回合且每回合 ≤3 次；用量图表可读性；侧栏底部固定修复 | — |
| #136 `feature/bot-interop`（`3e21112`） | 任意 bot 平权派发（去角色/同组门槛、跨组链放行）+ `idempotencyKey` 幂等重放；`Bot.role` 退役为遗留标签 | —（任务书 [TASK_BOT_INTEROP](TASK_BOT_INTEROP.md)） |
| #137 `feature/primitive-mode`（`fde0953`） | 作曲器「原始人」开关（`chat.send` 可选 `primitive`，最短提示组装，落库不变）+ 深度思考入口移至输入框旁 | —（任务书 [TASK_PRIMITIVE_MODE](TASK_PRIMITIVE_MODE.md)） |

### 10-29 四次刷新总览（968aa0b → db64e01，PR #138/#143–#151）

| PR | 内容 | 关闭的审计项 |
| --- | --- | --- |
| #138 `feature/context-meter`（`a6c7cb5`） | 上下文用量圆环 + 80% 自动压缩：迁移 `0023-chat-summaries`、受信方法 `chat.contextUsage`、`ChatManager.compressTurn`（空工具面、无审批、用量照记）、渲染层 context-ring；**历史行不删**，删摘要行即恢复全量回放 | **G13 ✅（超额：原设想仅可见性，交付含计量+自动压缩）**；审查 §2.1 P2 未处理即合入（见 §7.9） |
| #143/#145/#146/#147/#148/#149 文档系列 | 台账刷新 ×3、PREMERGE-REVIEW 入库、D22 断链、CONTRACTS 标题对齐 0.10、直接依赖许可索引、BOT_WORKSPACE 口径修正 | 治理债 §7.8 ✅；§7.4 体检全绿 |
| #151 `feature/streaming-reply`（`6659d29`） | stream-pacer：长回复按行/句自适应回放节奏（纯呈现层，契约零改动），修 finish 即 resolve 与取消不释放定时器 | —（无 D 编号 UX 切片；报告已补录 2026-10-30：[stream-pacer 报告](reports/stream-pacer-report.md)） |
| #150 `feature/voice-ui-wiring`（`db64e01`） | D27' 语音桌面接线：麦克风录音→WAV→`voice.transcribe`（只填输入框不自动发送，20s 自动停）、逐条回复朗读按钮（`voice.speak`）、按 `voice.status` 门控禁用 | **D27' ✅**（「按住说话/自动断句」交互未做，按住说话由 #157 交付；真机未验证；报告已补录 2026-10-30：[D27 语音接线报告](reports/D27-voice-wiring-report.md)） |

### 10-29 五次刷新总览（db64e01 → d1cb448，PR #152–#154）

| PR | 内容 | 关闭的审计项 |
| --- | --- | --- |
| #152 `feature/d17-skill-host-store`（`cf22763`） | D17' 技能库进 Host：`skillLibrary.get/save`（协议 0.11）+ settings KV `skills.library.v1` 整库校验 + 一次性迁移（composer 数组形态绝不迁移）+ 降级读 localStorage | —（D17 收尾切片） |
| #153 `feature/d14-mermaid`（`6299994`） | D14 mermaid 补齐：strict + DOMPurify svg + shadow DOM、动态 import chunk、失败回退保原文 | —（D14 收尾切片；审查 §2.2 P3 未处理随合并入库 → §7.9） |
| #154 本文件四次刷新 | 审计与台账收敛 | — |

### 10-29 六次刷新总览（d1cb448 → 9d3ac5b，PR #156–#160）

| PR | 内容 | 关闭的审计项 |
| --- | --- | --- |
| #156/#158 `feature/g1-history-replay-ddf3`、`feature/history-replay-visual-a82e` | G1' 回放收尾：已答卡从历史恢复不可再答之外，回放行整行 0.7 透明度（入场动画不再拉回 1），与实时回合明确区分 | G1' 中不依赖拍板 #1 的两项 ✅（余 ui.* 见 §2） |
| #157 `feature/d27-hold-to-talk-220a` | 按住说话：松开填入输入框不自动发送，20 秒上限保留 | D27 交互切片 |
| #159 `feature/g4-paid-chain-7a29` | G4 付费全链验收执行并入档（临时 Key，用后即弃）：chat/reasoner 探针、工作流、审批、记忆/知识/附件通过；残留如实列出 | **G4 主体** ✅（残留见 §2） |
| #160 `feature/d21-pointer-key-fc7a` | D21' 真机记录：指针移动与允许列表内按键各一次（无点击，`win32-input.ps1` 生产路径，延迟 ~0.6 s） | **D21'** ✅（点击与编辑器内按键仍开放） |

### 10-30 七次刷新总览（9d3ac5b → 5248ab6，PR #161–#172）

| PR | 内容 | 关闭的审计项 |
| --- | --- | --- |
| #161 `feature/onboarding-cards`（`fea4077`） | onboarding 改为 name-derived 卡片（`features/bots/onboarding.ts`、`choice-answer.ts` 联动、i18n），退役自由文本种子卡 | —（UX 切片；[报告](reports/ONBOARDING-CARDS-report.md)） |
| #162 `feature/humanized-errors`（`08f2e00`） | 聊天失败人类化卡片 + Host 信封错误（`packages/host/src/chat.ts` + 渲染层文案/样式） | —（错误路径 UX；[报告](reports/HUMANIZED-ERRORS-report.md)） |
| #163 `feature/release-code-signing`（`e5d4d17`） | 代码签名决策与发布要求：新增 [CODE_SIGNING](CODE_SIGNING.md)，同步 RELEASE | 发布前置文档（RELEASE §3 第 10 条） |
| #164 `feature/gap-audit-refresh6`（`5751a16`） | 本文件第六次刷新 + SPRINTS 账目 + progress.md | —（审计刷新自身） |
| #165 `feature/context-meter-concurrency-docs`（`a6a11e9`） | cm P2 文档化处置：任务书 §5 与[报告](reports/CONTEXT_METER-report.md) §4 改为如实记录压缩回合与用户发送真并发、限流/用量行交错风险 | §7.9 cm P2 ✅ |
| #166 `feature/a3-mermaid-theme-redraw`（`6d9f547`） | mermaid 主题重绘：节点/连线配色与聊天主题联动，测试随之更新 | —（D14 打磨） |
| #167 `feature/d14-mermaid-theme-reinit`（`417df1c`） | 主题切换后按 `initializedTheme` 比对在取模块时重跑 `mermaid.initialize`，切回旧主题命中缓存；测试钉住语义 | §7.9 d14 P3 ✅ |
| #168 `feature/a4-image-visibility-hint`（`de8f227`） | 图片附件「模型看不到」显式提示（文案 + 样式） | —（UX 切片） |
| #169 `feature/a2-skill-library-migration`（`c3685dd`） | 技能库一次性迁移加幂等标记（`features/skills/library-migration.ts`），失败可重试且不重复迁移 | —（D17' 收尾） |
| #170 `feature/a1-voice-settings`（`cfea9a2`） | 语音设置面板：whisper 路径经主进程对话框选取（`voice-pick.ts`）、麦克风即时解锁、i18n 与测试 | —（D27 桌面配置） |
| #171 `feature/b5-automation-dedupe`（`a6db352`） | 自动化窗口式执行前去重：迁移 `0024-event-rule-keys` + `claimEventRuleKey`/`pruneEventRuleKeys`，窗口内重复触发记「duplicate trigger within window」 | —（D20 加固） |
| #172 `feature/b6-incremental-streaming`（`5248ab6`） | 增量流式：Host 把每个 settled 助手分段经 `chat.stream` 通知推给桌面（stdio/主进程/预加载），渲染层 `stream-runner` 增量渲染；19 文件 | —（D14/D30 体验；`packages/contracts` 未改，但新增的服务端推送未入契约文档 → §7.10） |

### 10-30 接线勘误总览（5248ab6 → ad617a0，PR #173–#177）

| PR | 内容 | 关闭 / 更新的审计项 |
| --- | --- | --- |
| #173 `feature/workflow-contract-audit`（`0999eac`） | 本文件第七次刷新 + §7.10 工作流主路径接线核对 + SPRINTS 账目 + progress.md | §7.10 立项；G14/G11' 完成口径勘误 |
| #174 `feature/workflow-usage-accounting`（`20d919a`） | 工作流节点回合 token 写入 `usage_events`（`model=null`/`source=estimated`）；用量解析迁入 `@deepseek-bot/harness-adapter`，执行器结果加可选 `NodeTurnUsage` | §2 G4 残留之一「工作流模型回合 token 不入 `usage_events`」 ✅ |
| #175 `feature/ui-state-contract`（`6254d04`） | `packages/contracts/src/ui-state.ts`：`UiStateSchema`（strict；bot/分组顺序与选中态；≤1000 唯一 UUID） | G1' 的 `ui.*` **契约候选**入库；Host 方法与渲染接线仍未做（§2） |
| #176 `feature/workflow-read-surface`（`776b873`） | 协议 v0.12：`workflow.get`、`run.snapshot`、`approval.list` + Host 处理器与契约测试 + CONTRACTS/RENDERER_HOST_MAPPING 同步 | §7.10 的「契约缺项」 ✅ |
| #177 `feature/workflow-host-wiring`（`ad617a0`） | 桌面 `createHostService` 以 host 版 `workflows`/`runs` 覆盖夹具；导入惰性；`playback` 标记；审批 status 回退文案 | §7.10 的「桌面夹具」 ✅；**桌面 UI 端到端人工验收仍欠** |

双语系统核实（第一次刷新记录，仍有效）：语言切换在 设置 → 通用 → 外观 → 语言，持久化于 `deepseek-bot.settings.v2`，Host 文案随 `settings.update { patch: { "ui.locale" } }` 同步（`feature/host-dispatch-bilingual` 线，CONTRACTS.md settings.update 行已补记）。

## 1. 缺口地图（总览）

优先级定义：**P0** 数据完整性/安全（不修就是缺陷）；**P1** 用户每天碰到的标配（对标承诺已立未兑现）；**P2** 计划内切片收尾；**P3** 需拍板后才立项的产品增量。

| 编号 | 缺口 | 优先级 | 建议负责线 | 依赖 |
| --- | --- | --- | --- | --- |
| G1' | 界面状态持久化与回放补全（G1 剩余：ui.*） | P0 | B（UI）+ A（ui.* 服务） | 拍板 #1（ui.* 清单）；已答卡回放与 `history: true` 见 §2 |
| G4 | ~~付费真实 Key 全链验收~~ 已执行入档（#159，残留见 §2） | ~~P0~~ | A+B | ~~临时 Key~~ 已执行 |
| D21' | 真实 Windows 键鼠输入复核（真机指针/按键已记录：[D21-pointer-key 报告](reports/D21-pointer-key-report.md)，PR #160；点击与编辑器内按键仍开放） | P2 | A | 真机 |
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
| G14 | interrupted 运行恢复入口 | Host 已提供 `run.resume`；桌面运行监控当前仍使用夹具，不能据此认定真实恢复入口已贯通，见 §7.10 |
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
| ~~D27'~~ | 语音桌面接线 | PR #150；`features/voice/`（wav 编码/clip-recorder/voice-ui 门控）+ 逐条朗读按钮。按住说话在 `feature/d27-hold-to-talk-220a`（PR #157）：松开后 `voice.transcribe` 只填输入框、不自动发送，20 秒上限与 `voice.status` 门控保留；自动断句未做；真机未验证（[报告](reports/D27-voice-wiring-report.md)，2026-10-30 补录） |
| — | stream-pacer 流式回放节奏（无编号 UX 切片） | PR #151；`features/chat/stream-pacer.ts` 纯呈现层（按行/句自适应、≤7s），修 finish 即 resolve 与取消定时器泄漏（[报告](reports/stream-pacer-report.md)，2026-10-30 补录） |
| — | D17' 技能库进 Host（协议 0.11） | PR #152；`skillLibrary.get/save` + settings KV `skills.library.v1` 整库校验 + 一次性迁移（composer 数组形态绝不迁移）+ 降级读 localStorage；审查 §2.3 备忘未处理（不阻塞）；真机未验证（[报告](reports/D17-skill-host-store-report.md)） |
| — | D14 补遗：本地 mermaid 渲染 | PR #153；strict + DOMPurify svg + shadow DOM、动态 import chunk、失败回退保原文；**审查 §2.2 P3 未处理随合并入库**；真机截图未做（[报告](reports/D14-mermaid-report.md)） |

---

## 2. P0：数据完整性与安全债

### G1' 界面状态持久化与回放补全（原 G1 剩余）

**已完成部分（不再重复立项）**：`chat.history` 契约（D30）+ 渲染层接线（PR #97/#103）——重启后每 bot 消息历史与流式最终态可见，会话列表/打开读同一份存储行（`stored-session.ts`）。

**剩余缺口（ui.*，仍等拍板 #1）**：
- 契约面无任何 `ui.*` 方法（`packages/contracts/src/methods.ts`、`packages/host/src` grep 零命中）：侧栏 bot/分组排列、选中态、界面偏好仍重启即失（SPRINTS §7"全局"行）。本片不新增 `ui.state.get/set`。（2026-10-30：`UiStateSchema` 契约候选已由 #175 入库，仅类型与校验；Host 方法、渲染接线与拍板 #1 记录仍缺。）

**已补、不依赖拍板 #1**：
- 已答选项卡：`question.answer` 在助手消息写入 `meta.kind = "choice"`（问题、展示选项、`answered`）。`historyThreadMessages` 恢复 `choices.answered`；卡片折叠，`canAnswerChoice` 对 `history: true` 或已有 `answered` 返回 false，不能再次作答。存量无该 meta 的提问行仍是纯文本。
- 从 `chat.history` 装入的消息带 `history: true`（并保留 `origin: "history"`）。回放气泡整行比本会话新消息更弱（透明度 0.7，入场动画不会把它拉回 1），时间分隔同样更弱。已答卡不可再次提交。

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

### G4 付费真实 Key 全链验收 —— **已执行并入档（PR #159，2026-10-29 合入），残留项如下**

PR #159 以用户临时 Key（仅进程环境变量注入、用后即弃、不入库不入报告）完成一次贯通验收，[G4 报告](reports/G4-paid-chain-report.md) 归档：`chat.send`（chat/reasoner 档案各一轮，回复符合提示）、`run.start` 单机器人模型节点、工作流审批节点、`chat.attach` 导入审批、`memory.write/list`、`knowledge.write/search`、`web_search` 未配置关闭路径均通过，用量 `estimated=false`（source=harness）。**残留（报告 §4 如实列出，未验证不得声称通过）**：账单侧模型名未核对（`usage_events.model` 为空、汇总 `unknown`、未开账单页）；`web_search` 未取得真实结果（公网 SearXNG 429 即止，本机无实例）；语音转写/朗读/按住说话未跑（无 whisper 配置、Linux 无 SAPI）；原生 Harness 工具真实回合审批卡（G3 端到端）未观察；工作流模型回合 token 不入 `usage_events`；钉扎 Harness 启动 stderr 未留存（`entry did not activate` 核对仍欠）。再次付费调用仍需负责人逐次授权。

---

## 3. P1：对标快赢（SPRINTS §9.1）

**本节四项已全部完成（2026-10-28 对 `81a0924` 逐项核实），移入 §1.1**：深度思考开关（PR #73）、重新生成/编辑重发（PR #97）、对话导出（PR #97）、附件理解闭环（PR #106/#111）。SPRINTS §9.1 表的对应注记随本刷新更新。

---

## 4. P2：计划内切片收尾

### G9' D24 文档欠账 —— **已完成（PR #129，2026-10-28 合入），移入 §1.1**

`docs/DESKTOP_SHELL.md` 新增「应用内更新（D24）」一节并修正已失实描述（更新通道已接入、设置六分区可用）；`docs/RELEASE.md` §4.1 新增「发布即触发更新的检查单」。文档断言与代码行为逐条对照见 [G9' 报告](reports/G9-update-channel-docs-report.md) §2。

### G11' D17 收尾剩余（工作流模板注入）—— **已完成（PR #127，2026-10-28 合入），移入 §1.1**

渲染层本地模板库（冻结 `WorkflowDraftSchema` 归一化入架、剥离走私的策略字段）+「走私字段不落库」的渲染/Host 双层用例；模板内嵌权限不可信；当前桌面编辑器的保存仍调用内存夹具，尚未接 Host 的 `workflow.save`，不能宣称从桌面落库。Electron 真机手测与截图未做（[报告](reports/G11-workflow-template-library-report.md) §3）。

---

## 5. 正式任务剩余项（按原计划执行，本文不重写任务书）

以下在 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) §6 已有验收定义，仅列 2026-10-28 对 `81a0924` 的现状：

- **D19 剩余**：视觉理解（DeepSeek 视觉模型可用后接入；凭据引用解析、本地 SD 生图、MCP HTTP/stdio 均已交付，见 D19 各报告与 PR #65/#107）；
- **D20**：计划内切片全部交付——聊天内状态通知条与错过可见已由 PR #134/#135 补齐（触发器、规则、评审队列、规则状态历史、重复防护、桌面评审页此前已交付：PR #66/#84/#85/#87 + D20 各报告；"同一事件不第二次启动"由本地自动启动切片完成）；
- **D21 剩余**：真机指针移动与允许列表内按键各一次已由 PR #160 入档（`win32-input.ps1` 生产路径、精确仅本次审批、延迟 ~0.6 s；无点击，未把键送进编辑器——[D21-pointer-key 报告](reports/D21-pointer-key-report.md) §3/§6 如实列出）；真实窗口截图/OCR 已有真机证据（[D21-windows-acceptance 报告](reports/D21-windows-acceptance-report.md) §4，PR #93）；输入闸门与本地记录已交付（PR #88/#89/#104）；点击与编辑器内按键场景仍开放；
- **D22**：全部完成（双语/托盘/通知/Chrome 导入 PR #75；硬件加速 `b57d46b`）；
- **D27**：计划内切片全部交付——桌面语音接线由 PR #150 交付（麦克风录音转写只填输入框、逐条朗读、`voice.status` 门控禁用）。按住说话由 `feature/d27-hold-to-talk-220a` 接上（松开填入输入框，不自动发送，20 秒上限保留）；自动断句仍未做，与原验收措辞的差异由归属人自审确认；
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

1. **拍板 #1**（Renderer→Host 方案）：聊天/历史部分已上线（`chat.history` 接线、存储会话列表）；D 步的工作流编辑器和运行监控仍为夹具，见 §7.10，但 **G1' 剩余的 ui.* 界面态持久化仍需拍板 #1 对 ui.* 清单的正式记录**（记录到 RENDERER_HOST_MAPPING §4）后开工；
2. ~~拍板 #2~~ **已定案并合入 develop（PR #99，2026-10-27）**：develop 头像线为基准，`feature/mono-shape` 作废；
3. **自审签署**：B 线四项（D14/D24/D25/D26）、D17、D18/D19 报告的自审栏仍空；10-28/29 合入的 G3、G9'、G10'、G11'、D20'（两份）、D21-windows-acceptance、BOT_INTEROP、PRIMITIVE_MODE 各报告自审栏同样留空，PR #136/#137 任务书 §6 亦未填，#152/#153 两份报告自审栏同样留空（不追认，由负责人本人针对最新提交 SHA 签署）；
4. **手测截图**：`docs/reports/assets/` 现有 chat-diag/d02/d05/d07/d09/d16/d19-mcp/d21/d22/d24-data/d28/d30/settings-nav/sidebar-footer/ui-settings/usage-charts/usage-stats，**d14/d17/d25/d26 仍缺**（d21 两张为合成文本证据图）；
5. ~~SPRINTS §7 审计表刷新~~ **随本刷新更新**（语言、备份、更新、设置持久化、附件、搜索、硬件加速行改为已完成并登记去向 GAP_AUDIT）；
6. ~~快赢安家~~ **SPRINTS §9.1 表已注记四项全部完成及载体**（随本刷新）；
7. ~~本文件入库~~ **随 docs/gap-audit-refresh 分支提交**；
8. ~~CONTRACTS.md 文档滞后~~ **已收口（2026-10-29 契约补记）**：`chat.send` / `chat.history` / `chat.cancel` / `chat.status` / `chat.attach` 五行已补入 §3 方法表，内容以 `packages/contracts` 冻结 schema 为准（此前 `chat.status` 全文零提及）；skills、primitive 与附件分块细节仍指向既有 D17/D26 节与 §4 事件段，两处漂移风险就此消除；
9. **无报告合入与审查发现项处置（2026-10-29 四次刷新新增；同日第六次刷新记录处置；30 日七次刷新更新合入状态）**：~~#150（stream-pacer）/ #151（语音接线）未按 §9「每编号 + 报告」入库报告文件~~ **报告已于 2026-10-30 补录**（[stream-pacer 报告](reports/stream-pacer-report.md)、[D27 语音接线报告](reports/D27-voice-wiring-report.md)；补录时依合并提交勘误此前台账互换的编号：#151=`feature/streaming-reply`、#150=`feature/voice-ui-wiring`）；~~#138 的 cm P2~~ **已处置（选改文档，`feature/context-meter-concurrency-docs` → PR #165 `a6a11e9`）**——[任务书](TASK_CONTEXT_METER.md) §5 与[报告](reports/CONTEXT_METER-report.md) §4 改为如实记录「压缩回合与用户发送真并发（busy 仅约束 send，重入由 `compressingChats` 防护）」及 provider 限流/用量行交错/`chat.contextUsage` 最近行抖动风险；不改锁的理由：压缩是静默后台维护回合，复用忙锁会把 RATE_LIMITED 在用户不可控的时刻递给用户，审查已确认数据完整性不受影响；~~d14 §2.2 P3~~ **已修复（选改代码，`feature/d14-mermaid-theme-reinit` → PR #167 `417df1c`）**——按 `initializedTheme` 比对在渲染取模块时重跑 initialize，切回曾用主题命中该主题缓存不触碰全局配置，语义由新增测试钉住（[报告](reports/D14-mermaid-theme-report.md)）。两分支在第六次刷新时尚未推送，现均已合入 develop；
10. **#161–#172 无入库报告（2026-10-30 七次刷新新增）**：#163/#164/#166/#168/#169/#170/#171/#172 八项没有 `docs/reports/` 交付报告，与 §9「每编号 + 报告」不一致（#163 为签名决策文档、#164 为审计刷新本体，是否补报告由归属人定）；#161/#162/#165/#167 已有入库报告。是否补录由各归属人自行决定，不追认事前自审；

### 7.10 工作流主路径接线核对（2026-10-30）

基线：`origin/develop` `5248ab6`，静态调用链核对；这不是端到端测试或负责人自审。

- Electron 的 `createHostService` 先展开 `createFixtureService()`，没有覆盖 `workflows` 或 `runs`。编辑器的 `desktop.workflows.save` 因此保存到内存，运行监控的 `desktop.runs` 列表、快照、审批和恢复是夹具。监控中的 `desktop.tasks` 有单独的 Host 实现，不能把整个监控页面一概归为夹具。
- Host 已提供 `workflow.list/validate/save/export/import`、`run.start/get/list/cancel/retryNode/resume`、`events.subscribe` 和 `approval.decide`；契约未暴露独立 `workflow.get`、运行快照或跨运行的工作流审批列表。`workflow.export` 要求当前 revision，可结合 `workflow.list` 评估读取；需要处理列表与读取之间的版本冲突。聊天的 `permission.approval.list` 属于不同审批面。
- 由桌面线负责接线、平台线核对 Host 所需接口和兼容性。通过事件重放能否完整恢复节点、审批与产物需另行验证；如现有契约不足，先提交独立契约变更，不以演示数据代替真实数据。
- 目标验收：桌面创建并保存工作流，重启后读取，真实 Host 启动三机器人流程，显示节点与审批，验证拒绝、取消、重启恢复和历史；报告记录代码 SHA、环境、实际结果与未验证项。
- 第六次刷新记载的两个“未推送分支”已分别由 PR #165、#167 合入；#165 只修正文档对并发的描述，没有消除并发风险。
- 增量流式（#172）新增服务端推送通知 `chat.stream`（`packages/host/src/stdio.ts` 的 `notifyChatStream`，桌面 `apps/desktop/src/main/host-client.ts:204` 消费，等同 `schedule.missed` 的通知位）。~~`packages/contracts` 没有该通知的 schema，CONTRACTS.md 也没有条目~~ **已由 PR #179 收口（2026-10-30）**：`ChatStreamNoticeSchema` 钉进 contracts、host/桌面单一类型源、CONTRACTS.md §4 补两通知通道（[报告](reports/B6-chat-stream-contract-report.md)）。

**2026-10-30 接线结果（更新，基线 `ad617a0`）**：

- 契约与 Host：PR #176 补齐 `workflow.get`、`run.snapshot`、`approval.list`（协议 v0.12），handlers 是既有存储读的薄封装；CONTRACTS §3 与 RENDERER_HOST_MAPPING §6 已同步。`workflow.get` 同时补上 `workflow.list` 只有摘要、`export` 又要 revision 的空档。
- 桌面：PR #177 用 `createHostWorkflowService`/`createHostRunService` 覆盖 `workflows`/`runs`，`createFixtureService()` 退为离线开发底座；编辑器导入只做预览校验（`workflow.validate`）不落库；运行监控按 `RunServiceApi.playback` 显隐夹具回放控件；审批卡在 Host 不透出 `resolvedAt` 时按 status 推导已决定文案。
- **仍存差异（未消项）**：`approval.requestedAt` 由 `expiresAt - APPROVAL_DEFAULT_TTL_MS` 近似；`invalidReason="generation"` 只有夹具路径；`pullTransient` 真实路径恒空；`advanceScenario` 真实路径明确拒绝；~~`chat.stream` 仍未进契约文档~~（已由 #179 收口，见上）；桌面端不调用宿主 `workflow.import`（该处理器会直接落库，与编辑器「确认后才载入画布」语义冲突）。
- **未完成那一步**：桌面 UI 端到端人工验收（保存→重启读回→三机器人运行→审批/拒绝/取消/重启恢复/历史）尚未执行，步骤与证据表见 [WORKFLOW-MAIN-PATH-ACCEPTANCE-checklist](reports/WORKFLOW-MAIN-PATH-ACCEPTANCE-checklist.md)。现有证据只到 Host 层主路径测试（`packages/host/src/host.test.ts` 的 `runs a workflow end to end through the method surface`）与桌面服务层单测（`apps/desktop/tests/services/host-service.test.ts` 的 12 例 host-backed 用例）。
- 结论：§7.10 的「桌面夹具」缺口可关闭，「验收」仍开放；D23 前必须补人工验收记录。

## 8. 建议排期（依赖驱动的批次，可多晚并行）

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| ~~第一批~~ | G10'（#126）、G9'（#129）、G3（#125）、G11'（#127）、D20'（#134/#135） | 10-28/29 已全部交付，见 §1.1 |
| 第二批 | G1' 的 ui.*（等拍板 #1 记录 ui.* 清单） | **仍开放**：G1' 其余两项（已答卡回放、`history: true`、回放弱化）已由 #97/#103/#156/#158 交付 |
| ~~第三批~~ | ~~D21'（真实键鼠，真机）~~；语音实机联调（录音/朗读真机验收，#151/#157 已接线） | D21' 真机指针/按键已记录（#160；点击与编辑器内按键仍开放）；语音实机仍欠 |
| ~~第四批~~ | ~~G4 全链验收~~（#159 已入档）+ D13/D23 收官 | 剩 **D13 性能预算实测 + D23 平台验收**（收官，与发布验收合并执行） |
| 第五批（收口，2026-10-30 排定） | ①工作流主路径接线：契约 + Host（#176）与桌面替换夹具（#177）**已合入**，剩桌面端到端人工验收报告 → ②G1' 的 ui.*（契约候选 #175 已入库，待拍板 #1 后做 Host 方法与渲染接线）→ ③D13/D23 与 v0.1.0 发布验收 | 主路径是 D07/D09 的集成验收与 D23 前置；释放前 P0/P1 必须清零 |
| 另行立项 | G12（拍板后）；D19 视觉理解（等模型） | G13 已完成（#138） |

并行保障：G2→G3 为 Host/桥一线；G9'/G1'/D20'/D27' 主要在渲染层与文档，文件面与 Host 线基本不交叉；跨线任务按 SPRINTS 铁律拆分文件边界。

## 9. 全局验收门槛

- 每个编号独立 feature 分支 + PR + 报告，逐条验收打勾并附证据（截图/命令输出）；
- 契约变更（G1' 的 ui.*、G12 若立项）走小型独立 PR 先合 develop；
- 全量 `pnpm lint / typecheck / test` 与 desktop build 在合入前全绿；
- 收官判定以 D13/D23 的发布门槛为准：本文全部 P0/P1 项完成是 D23"无 P0/P1 缺陷"结论的前置；
- 本文件每次刷新须注明基线 commit 并对每条"已完成"给出 grep/报告证据；未运行检查不得声称通过。
