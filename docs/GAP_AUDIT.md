# 缺口审计与补全总任务书（GAP_AUDIT）

| 项 | 值 |
| --- | --- |
| 性质 | 缺口说明书 + 任务书 + 实现需求与实现方式（三合一） |
| 首次盘点 | 2026-10-26，逐份核对 DEVELOPMENT_PLAN §6、SPRINTS §4–§9、全部任务报告的"未验证/已知边界"与代码实况 |
| 第二次刷新 | 2026-10-28，基线 `origin/develop` = `81a0924`（PR #121）；对照第一次刷新基线 `b22ca88`（PR #89）之间合入的 #90–#121，未完成项逐个经 `git grep` 对 develop 重新核实后保留任务书原文并更新证据 |
| 已完成并归档 | 第一次刷新已归档 G5/G9（大部）；本次归档 **G6、G7、G8、G10、G14、G11（能力强制部分）、D19（除视觉理解）、D21（真机复核除外）、D22、D27（后端）**、拍板 #2，见 §1.1 |
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
| #117 `feature/d25-host-search-5f3a`（f819dfd） | `search.global` / `search.config.get/set` / `search.results.list`（contracts methods.ts:151–154）+ Host 侧 bot/消息/工作流/产物一体检索；消息命中回有界摘要，跳转走既有 `chat.history`/`artifacts.read` | **G10 ✅** |
| #119 `feat/usage-stats` | `usage.summary`（v0.10）+ 用量页（总量/按模型/趋势/分布，估算行标记 `estimated`） | D24"本地用量统计" ✅ |
| #108–#112、#114、#116、#120 | 开关/下拉/浅色主题等 UI 修复系列 | — |
| #121 `fix/quota-exhausted-message` | 余额耗尽按 `BUDGET_EXCEEDED` 报告，不再伪装"模型不可用" | G4 验收的错误路径改善 |

双语系统核实（第一次刷新记录，仍有效）：语言切换在 设置 → 通用 → 外观 → 语言，持久化于 `deepseek-bot.settings.v2`，Host 文案随 `settings.update { patch: { "ui.locale" } }` 同步（`feature/host-dispatch-bilingual` 线，CONTRACTS.md settings.update 行已补记）。

## 1. 缺口地图（总览）

优先级定义：**P0** 数据完整性/安全（不修就是缺陷）；**P1** 用户每天碰到的标配（对标承诺已立未兑现）；**P2** 计划内切片收尾；**P3** 需拍板后才立项的产品增量。

| 编号 | 缺口 | 优先级 | 建议负责线 | 依赖 |
| --- | --- | --- | --- | --- |
| G1' | 界面状态持久化与回放补全（G1 剩余） | P0 | B（UI）+ A（ui.* 服务） | 拍板 #1（ui.* 清单） |
| G2 | 审批桥激活（`installBridgeIntoProfile`） | P0 | A | 无 |
| G3 | 原生聊天回合内 D08 工具审批 | P0 | A+B | G2 |
| G4 | 付费真实 Key 全链验收 | P0 | A+B | 负责人提供临时 Key 并授权费用 |
| G9' | D24 文档欠账（DESKTOP_SHELL/RELEASE 更新通道说明） | P2 | B | 无 |
| G11' | D17 收尾剩余（工作流模板 Host 注入） | P2 | A | 无 |
| D20' | 聊天内自动化状态通知条 + 错过触发可见 | P2 | A+B | 无 |
| D21' | 真实 Windows 键鼠与真实窗口截图/OCR 复核 | P2 | A | 真机 |
| D27' | 语音桌面 UI（按住说话/自动断句/播放接线） | P2 | B | 无 |
| G12 | 多会话管理（会话列表已上，多会话未立） | P3 | A+B | 拍板（新契约面） |
| G13 | 上下文窗口可见性 | P3 | A+B | 无（建议与 G12 同拍板） |
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
| ~~G10~~ | D25 收尾（Host 全文检索） | PR #117；契约 `search.global` 等四方法 + Host 一体检索，消息命中回有界摘要 |
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

---

## 2. P0：数据完整性与安全债

### G1' 界面状态持久化与回放补全（原 G1 剩余）

**已完成部分（不再重复立项）**：`chat.history` 契约（D30）+ 渲染层接线（PR #97/#103）——重启后每 bot 消息历史与流式最终态可见，会话列表/打开读同一份存储行（`stored-session.ts`）。

**剩余缺口（证据，2026-10-28 对 `81a0924` 核实）**：
- 契约面无任何 `ui.*` 方法（`packages/contracts/src/methods.ts`、`packages/host/src` grep 零命中）：侧栏 bot/分组排列、选中态、界面偏好仍重启即失（SPRINTS §7"全局"行）；
- 卡片已答态不随历史恢复：`ChatHistoryRow`（`desktop-service.ts:53`）无 choices meta，D30 报告与 TASK_CHOICE_CARD Q2 明确把"回放恢复已答态"列为同批处理项，至今未做；
- 历史回放消息无"历史"标记（`history: true` grep 零命中），弱化渲染缺失。

**需求**（沿第一次刷新 G1 的需求，范围收窄到剩余三项）：
- 侧栏 bot/分组排列、选中态、界面偏好重启后恢复；快照不含任何密钥/敏感数据；
- 已答选项卡从 `chat_messages` meta 恢复 `choices.answered`，且不可再次作答；
- 历史回放消息明确区分"历史回放"与"新消息"（弱化时间分隔、禁止再次触发已答卡）。

**实现方式**（按 [RENDERER_HOST_MAPPING.md](RENDERER_HOST_MAPPING.md) §3 的 B 步，不动冻结契约）：
1. Host 新增 `ui.state.get/set` 受信方法（按 key 存 JSON 快照，白名单校验：超 key/超大 payload 拒绝），渲染层状态变更防抖写入——**此项依赖拍板 #1 对 ui.* 清单的正式记录**；
2. 卡片消息从 `chat_messages` 的 meta 恢复 `choices.answered`（D30 已把提问以助手消息落库，恢复所需数据在库）；
3. 历史回放消息以 `history: true` 标记渲染。

**验收**：
- [ ] 发送 10 条消息重启应用，历史与流式最终态完整恢复（现有行为，回归确认）；
- [ ] 已答选项卡重启后仍为已答态且不可再次作答；
- [ ] `ui.*` 方法白名单校验通过，快照不含 Key；
- [ ] 拍板 #1 正式记录到 RENDERER_HOST_MAPPING §4（采纳 B 及 ui.* 清单）。

### G2 审批桥激活

**现状（证据，2026-10-28 对 `81a0924` 重新核实）**：`installBridgeIntoProfile` 在全仓仅 `packages/harness-adapter/src/profile-assets.ts:84` 定义（`index.ts:49` 导出、`profile-assets.test.ts` 单测），**apps/ 与 packages/host 内无任何调用点**——真实运行的 profile 里没有 `@deepseek-bot/harness-bridge`，钉扎 Harness 打印 `warning: 1 entry did not activate`，审批桥在真实聊天/运行中不生效。

**需求**：Host 启动装配 profile 时调用该安装，使 Harness 内的审批桥入口真正激活。

**实现方式**：Host 启动路径（创建/更新钉扎 profile 处）调用一次 `installBridgeIntoProfile`；幂等（已安装不重复写）；启动日志记录安装结果。

**验收**：
- [ ] 启动后 Harness 不再出现 `entry did not activate` 告警；
- [ ] 真实聊天回合内 bridge 事件可达 Host（为 G3 提供通道）。

### G3 原生聊天回合内的 D08 工具审批

**现状（证据）**：DEVELOPMENT_PLAN §8 进度注记原话"其他工具的原生聊天 D08 审批仍为后续范围"（对 `81a0924` 仍准确）。聊天回合内 Harness 调 fs/exec 等原生工具时的审批请求目前无处落地；`ApprovalCard` 现仅在运行监控（工作流）中使用。

**需求**：聊天回合内触发受 D08 管控的动作（fs.read/fs.write/exec.shell/screen.capture）时，聊天流内出现与工作流一致的审批卡（精确参数、允许/拒绝、超时语义）；"从不允许"在网关/D08 层拒绝而非仅 UI 隐藏。

**实现方式**：依赖 G2 的桥通道——Harness 侧审批请求经 bridge 事件到 Host → 复用 D16 审批卡组件在聊天流渲染 → 决定经受信方法回传 Harness 继续/中止；与 D16 grant 检查点协同（策略 ask 才弹卡，deny 直接拒，allow 放行）；审批等待沿用 10 分钟 TTL 与取消语义；审计照记。

**验收**：
- [ ] 聊天中让 bot 写一个文件：卡片弹出、展示精确路径、拒绝后无副作用；
- [ ] 策略 deny 的能力直接失败且解释可读；allow 不弹卡；
- [ ] 超时/取消后 Harness 回合按既有语义终止。

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

### G9' D24 文档欠账
**现状**：备份/恢复/保险库/应用内更新/用量统计/硬件加速主体已交付（PR #78、#119、`b57d46b`）；`docs/DESKTOP_SHELL.md` 与 `docs/RELEASE.md` 仍无应用内更新通道说明（2026-10-28 grep electron-updater 在两文件零命中）。
**实现**：把"启动静默检查 → 左下角徽标 → 下载重启安装；无 Release 时软着陆"的既有行为（`apps/desktop/src/main/updates.ts`）写入两文档；RELEASE.md 补发布即触发更新的检查单。
**验收**：文档更新随 PR；描述与代码行为一致（`autoDownload = false`、`autoInstallOnAppQuit = true`）。

### G11' D17 收尾剩余（工作流模板注入）
**现状**：D17 的技能注入与能力强制已由 PR #115 交付（技能随 `chat.send` 注入、声明能力成为该轮允许集、未声明工具授权检查前拒绝）；D17-skill-injection 报告原话"工作流模板仍未做"。
**实现**：模板保存的工作流经 `workflow.save` 落库（校验照走）；模板内引用的工具策略在注入时强制重绑该 bot 的 toolPolicyId（不信任模板内嵌权限）；导入导出维持契约校验。
**验收**：从模板创建工作流后，节点工具策略以宿主 bot 现行策略为准（篡改模板策略无效的用例）。

---

## 5. 正式任务剩余项（按原计划执行，本文不重写任务书）

以下在 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) §6 已有验收定义，仅列 2026-10-28 对 `81a0924` 的现状：

- **D19 剩余**：视觉理解（DeepSeek 视觉模型可用后接入；凭据引用解析、本地 SD 生图、MCP HTTP/stdio 均已交付，见 D19 各报告与 PR #65/#107）；
- **D20 剩余**：聊天内自动化启停状态通知条、错过触发可见（触发器、规则、评审队列、规则状态历史、重复防护、桌面评审页已交付：PR #66/#84/#85/#87 + D20 各报告；"同一事件不第二次启动"由本地自动启动切片完成）；
- **D21 剩余**：真实 Windows 键鼠与真实窗口截图/OCR 复核（D21-device-input 报告自记"没有在这台 Linux 环境上执行真实 Windows 键鼠或复核真实窗口截图/OCR"；输入闸门与本地记录已交付：PR #88/#89/#104）；
- **D22**：全部完成（双语/托盘/通知/Chrome 导入 PR #75；硬件加速 `b57d46b`）；
- **D27 剩余**：桌面语音 UI——按住说话、自动断句、播放接线（后端 `voice.status/transcribe/speak` 已合入 PR #113，CONTRACTS.md v0.9 段注明"语音录制与播放接线归桌面后续联调"；渲染层 grep whisper/按住 零命中）；
- **D13 性能预算实测**（PRD §6：未测量不得宣称达标）、**D23 平台收官**：按 DEVELOPMENT_PLAN §9 顺延至阶段二收官，与发布验收合并执行。

## 6. P3：需拍板后立项的产品增量

### G12 多会话管理
**缺口**：D30 每 bot 单逻辑会话（`chat:<botId>`）；PR #103 已交付基于 `chat.history` 的**单会话**列表/打开（`stored-session.ts`，一个 bot 有消息即一个会话）。真正的多会话/重命名/清理仍未立项；Grok 对标存在多会话体验。
**实现草案**：契约附加 `chat.session.list/open/new`（每 bot 多个 session，Host 侧 session id 由 `chat:<botId>:<n>` 扩展）；UI 为 bot 会话页头部加会话下拉/列表。**涉及 chat.send 语义扩展（activeSession），须契约负责人评审后再立任务书**。

### G13 上下文窗口可见性
**缺口**：每轮回放"近期历史"的截断策略用户不可见，长会话静默失忆（`contextTurns` grep 零命中）。
**实现草案**：Host 在回合结果事件中携带 `contextTurns`（本轮实际携带条数/截断数），消息 meta 展示"本轮携带历史 N 条"；超出时的提示条。小活，可与 G12 同期或独立做。

---

## 7. 治理与流程债（不修完不算完善）

1. **拍板 #1**（Renderer→Host 方案）：D 步与 B 步的聊天/历史部分已事实上线（运行监控真实化、`chat.history` 接线、存储会话列表），但 **G1' 剩余的 ui.* 界面态持久化仍需拍板 #1 对 ui.* 清单的正式记录**（记录到 RENDERER_HOST_MAPPING §4）后开工；
2. ~~拍板 #2~~ **已定案并合入 develop（PR #99，2026-10-27）**：develop 头像线为基准，`feature/mono-shape` 作废；
3. **自审签署**：B 线四项（D14/D24/D25/D26）、D17、D18/D19 报告的自审栏仍空（不追认，由负责人本人签署）；
4. **手测截图**：`docs/reports/assets/` 现有 chat-diag/d02/d05/d07/d09/d16/d19-mcp/d21/d22/d24-data/d28/d30/ui-settings/usage-stats，**d14/d17/d25/d26 仍缺**；
5. ~~SPRINTS §7 审计表刷新~~ **随本刷新更新**（语言、备份、更新、设置持久化、附件、搜索、硬件加速行改为已完成并登记去向 GAP_AUDIT）；
6. ~~快赢安家~~ **SPRINTS §9.1 表已注记四项全部完成及载体**（随本刷新）；
7. ~~本文件入库~~ **随 docs/gap-audit-refresh 分支提交**；
8. **CONTRACTS.md 文档滞后（2026-10-28 新增）**：`chat.history`/`chat.cancel`（D30）、`search.*`（#117）、`chat.send` 技能注入字段（#115）等已在 `packages/contracts` 冻结并合入，但 CONTRACTS.md 正文未逐项收录（仅 v0.9/v0.10 段提及 voice/usage）。建议随下一次契约 PR 补正文或在该文件头部明确"以 packages/contracts 为准"的指引，避免两处漂移。

## 8. 建议排期（依赖驱动的批次，可多晚并行）

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| 第一批 | G2（小件）；G9'（纯文档） | 无依赖、无契约变更，立即开工 |
| 第二批 | G1'（拍板 #1 记录后）；G3（依赖 G2）；G11'；D20' | G11'/D20' 无契约变更可先行 |
| 第三批 | D21'（真机）；D27'（语音 UI 联调） | 需真机/联调环境 |
| 第四批 | G4 全链验收（需临时 Key 与费用授权）+ D13/D23 收官 | 各项主体合入后执行 |
| 另行立项 | G12、G13（拍板后）；D19 视觉理解（等模型） | — |

并行保障：G2→G3 为 Host/桥一线；G9'/G1'/D20'/D27' 主要在渲染层与文档，文件面与 Host 线基本不交叉；跨线任务按 SPRINTS 铁律拆分文件边界。

## 9. 全局验收门槛

- 每个编号独立 feature 分支 + PR + 报告，逐条验收打勾并附证据（截图/命令输出）；
- 契约变更（G1' 的 ui.*、G12 若立项）走小型独立 PR 先合 develop；
- 全量 `pnpm lint / typecheck / test` 与 desktop build 在合入前全绿；
- 收官判定以 D13/D23 的发布门槛为准：本文全部 P0/P1 项完成是 D23"无 P0/P1 缺陷"结论的前置；
- 本文件每次刷新须注明基线 commit 并对每条"已完成"给出 grep/报告证据；未运行检查不得声称通过。
