# 冲刺计划（双人单晚系列）

状态：执行中。阶段二按 §5 双线并行队列推进，各任务交付状态见 §4 执行记录；§2 的冲刺一正文保留为当时的排期切片记录。开发者：Etheslay、Destinyian。

本文件把 [开发计划](DEVELOPMENT_PLAN.md) §6 的阶段二任务切成**两人并行、一晚可完成**的冲刺。每个冲刺遵守三条铁律：

1. **并行零交叉**：两人分支不改动同一文件；契约与依赖变更不进冲刺（除非冲刺明确声明）；
2. **验收先写死**：开工前本文件已定义退出条件，完成后只对证据负责；
3. **砍范围不砍验收**：超时先砍可选项（各冲刺标注"可顺延"项），核心项必须全达成。

## 1. 与开发计划的关系

- 任务编号沿用 [开发计划](DEVELOPMENT_PLAN.md) §6（D14–D23）；冲刺只做切片与排期，不改验收语义；
- 应负责人要求，D13 顺延至阶段二收官后与发布验收合并执行；阶段二各任务的实际依赖（D05/D08/D12）均已合入，随时可启动；
- 每个冲刺一个独立文档节，完成后在 §4 勾选证据链接；未完成项自动滚入下一冲刺并在 §5 队列标注。

## 2. 冲刺一（M5 夜）：聊天工作台

- 目标里程碑：M5（见 [AGENT_PLATFORM](AGENT_PLATFORM.md) §7）；
- 时间盒：一晚约 4 小时（T+0 起），两个分支全程并行；
- 冲刺范围：**D14 渲染片（聊天体验前半）+ D15 阶段一（工具网关读层）**；契约零变更。D14 的交互片（选项卡片/提及/通知条）排在冲刺二。

### 2.1 分工与文件边界

| | Destinyian — D14 `feature/chat-experience`（渲染片） | Etheslay — D15 `feature/agent-tools`（读层） |
| --- | --- | --- |
| 交付 | 聊天内 Markdown / 代码高亮 / KaTeX / 流程图渲染；产物预览沿用 D05 通道 | `packages/agent-tools/` 网关骨架：能力注册、参数校验、审计；读层工具（list_bots / list_groups / get_run / get_run_events） |
| 只许改 | `apps/desktop/src/renderer/src/**`（chat 相关）、`apps/desktop/package.json` | `packages/agent-tools/**`、host 装配的单一注册点（与 D14 无交集） |
| 不许碰 | packages/**、契约、lockfile（依赖先行提交后不再动） | 渲染层、契约（`get_workflow` 等新方法顺延到冲刺二） |
| 依赖 | D05（已合入） | D08、D12（已合入） |
| 验收 | 见 2.3 | 见 2.3 |

并行保障：T+0 时 Destinyian **先提交渲染依赖**（lockfile 变更单独小提交），Etheslay 的新包只复用工作区已有依赖（zod 等），lockfile 全晚只动一次。

### 2.2 时间线

| 时点 | 事项 |
| --- | --- |
| T+0 | 冲刺会（15 分钟）：确认本表、各自从最新 develop 开分支；Destinyian 提交依赖小 PR 并自审合入 |
| T+0–T+2 | 并行开发，互不等待 |
| T+2 | 检查点一（15 分钟）：互相推 WIP、10 分钟交叉过一遍接口与范围、必要时砍"可顺延"项 |
| T+2–T+3.5 | 完成实现与测试；各自 PR 自审记录 |
| T+3.5 | 检查点二：两 PR 均自审通过后合入 develop（merge commit），跑合并后全量检查 |
| T+4 | 合并烟测：聊天里渲染样例消息 + 网关调用 `list_bots` 出审计记录；更新本文件 §4 勾选 |

### 2.3 验收（退出条件）

**D14（渲染）**：

1. bot 回复中的 Markdown（标题/列表/表格）、代码块（带语言标注与高亮）、KaTeX 公式、mermaid 流程图在聊天内正确渲染；
2. 渲染资源全部本地打包：运行期无任何 CDN/远程请求（网络面板或 CSP 日志留证）；
3. 富文本入口有净化（HTML 注入不生效），新增渲染单测通过；
4. 原 120 个 desktop 测试与全量检查不回归。

可顺延项：mermaid（超时则砍，顺延冲刺二）；KaTeX 字体本地化细节（超时接受 v1 用系统回退）。

**D15 夜（网关读层）**：

1. `packages/agent-tools` 独立包：能力注册表 + 参数校验（zod）+ 审计记录（谁/何时/调了什么/参数摘要/结果摘要）；
2. 四个读工具可用且默认允许：`list_bots`、`list_groups`、`get_run`、`get_run_events`，全部经既有契约方法取数，**不新增契约方法**；
3. 未注册能力与超参调用在网关层被拒（单测覆盖）；
4. grant 检查点留桩（接口就位、默认放行读层），写层与审批在冲刺二接入。

可顺延项：host 装配的端到端接线（超时则包级单测留证，接线进冲刺二）。

**合并烟测（两人各 10 分钟）**：develop 上同时呈现——聊天渲染样例（含公式与流程图）+ 网关读层调用与审计记录。

## 3. 冲刺纪律

- 遵循 [Git 工作流](GIT_WORKFLOW.md)：独立 feature 分支、负责人自审、merge commit、不force push；
- 检查点迟到 15 分钟即触发砍范围，不熬夜透支次日；
- 冲刺内发现的新需求一律记入 §5 队列，不当场扩范围；
- 自审记录按 [开发计划](DEVELOPMENT_PLAN.md) §4 完成定义落在各自 PR。

## 4. 执行记录

自 §5 改为双线并行队列后，本表按**任务 / 分支**记录交付，不再使用"冲刺N"编号（§2 的冲刺一正文保留为当时的排期切片记录）。

| 任务 | 状态 | 分支 → merge | 证据 |
| --- | --- | --- | --- |
| D15 工具网关读层 | 已交付 | `feature/agent-tools` → `80e2074` | [D15-report](reports/D15-report.md) |
| D15 工具网关写层 | 已交付 | `feature/agent-tools` → `d4a3f35` | [D15-report](reports/D15-report.md) |
| D15 `ask_user` 后端 | 已交付 | `feature/agent-tools` → `0350e40` | [D15-report](reports/D15-report.md) |
| D15 `web_search` 后端 | 后端已合入；聊天接线见 [web_search 聊天报告](reports/D16-web-search-chat-report.md) | `feature/agent-tools`（`573421e`）→ PR #42 `b693c5b` | [D15-report](reports/D15-report.md) |
| D16 授权后端与设置/聊天卡 | 已合入 | PR #47 `a0af1f5`、#49 `8a8e01c`、#51 `9ebab3a` | [D16-report](reports/D16-report.md) |
| D16 真实聊天应用工具 | 已交付 | `feature/harness-tool-gateway` → PR #52 `bb8dfc3` | [D16-harness-tools-report](reports/D16-harness-tools-report.md) |
| D16 `ask_user` 聊天回传 | 已交付 | `feature/ask-user-chat` → PR #54 `134306a` | [D16-ask-user-chat-report](reports/D16-ask-user-chat-report.md) |
| D16 `web_search` 聊天接线 | 已交付 | `feature/web-search-chat` → PR #56 `b57c29e` | [D16-web-search-chat-report](reports/D16-web-search-chat-report.md) |
| D30 聊天运行时 | 已交付 | `feature/chat-runtime` → PR #44 `19057e6` | [D30-report](reports/D30-report.md) |
| D14 渲染片 + 交互片 | 已交付（mermaid 由 `feature/d14-mermaid` 本地补齐，验收达成，见 [D14-mermaid 报告](reports/D14-mermaid-report.md)） | `feature/chat-experience` → `feature/settings-updates` → `0f20970` | [D14-report](reports/D14-report.md) |
| 头像打磨（Grok Ball 视线与节奏） | 已交付 | `feature/gaze-avatar` → PR #61 `cc4a379`、#62 `5533ea6` | [B-AVATAR-02-report](reports/B-AVATAR-02-report.md) |
| D25 全局搜索 | 已交付（host 检索按计划后接） | 同上 → `0f20970` | [D25-report](reports/D25-report.md) |
| D26 聊天附件 | **切片交付（渲染层）；D26 收尾（附件理解闭环）另见 [D26 附件读取报告](reports/D26-attachment-read-report.md)**：附件分片上传进 bot 工作区 `attachments/`、模型工具 `read_workspace_file`（fs.read 授权）按需读取、阈值注入（≤16 KiB 文本内联，超限走工具）、图片/二进制卡片说明 | 同上 → `0f20970`；收尾在 `feature/attachment-read-closure` | [D26-report](reports/D26-report.md)、[D26-attachment-read-report](reports/D26-attachment-read-report.md) |
| D26 附件经网关进工作区 | **已在 develop（PR #106）**。`chat.attach` 与 `fs.write` 审批写入工作区，模型用 `read` 读取。本分支与理解闭环并存；自审记录仍以原报告为准，此处不补签 | `feature/d26-gateway-attachments` | [D26-gateway-attachments-report](reports/D26-gateway-attachments-report.md) |
| D24 设置与更新 | **切片交付，任务未完成**（备份保险库见下一行） | 同上 → `0f20970` | [D24-report](reports/D24-report.md) |
| D24 备份/恢复与设置收尾 | **切片交付**：设置分区化（保险库/用量/电脑/更新全部真实可用）、`backups:list` 桌面通道（只读 manifest）、`data.restore` 后 Host 子进程重启、硬件加速偏好真实开关。实机安装版验证与更新链路仍 UNVERIFIED | `feature/settings-vault`（见 PR） | [D24-data-report](reports/D24-data-report.md) |
| D17 技能与模板 | **渲染层已交付**。技能注入与能力强制见下一行。工作流模板与 Host 持久化仍未做 | `feature/skills-templates` → `292c3b8`、PR #48 `2ecb2f9` | [D17-report](reports/D17-report.md) |
| D17 技能注入与能力强制 | **切片交付**：已保存的技能随 `chat.send` 交给 Host 注入本轮；声明的能力 id 由工具网关在授权前限制。技能库仍在渲染层 localStorage。工作流模板未做。自审未填 | `feature/d17-skill-injection` | [D17-skill-injection-report](reports/D17-skill-injection-report.md) |
| D27 本地语音后端 | **已交付（PR #113）**：`voice.status` / `voice.transcribe` / `voice.speak`（协议 0.9），whisper.cpp 本地转写 + Windows SAPI 播报，剪辑不落盘不外发；麦克风采集/断句/播放接线与真实模型分发归后续 | `feature/voice-local-backend-8c21` → PR #113 `6ecd1b3` | [D27-voice-backend-report](reports/D27-voice-backend-report.md) |
| D27 语音配置持久化 | **已交付（PR #118）**：`voice.config.get` / `voice.config.set` 受信方法，whisper 路径写入 settings KV 即时生效、重启恢复（环境变量只是启动种子）；桌面设置页可据此接线 | `feature/voice-config-kv-c4d2` → PR #118 `94bc05d` | [D27-voice-config-report](reports/D27-voice-config-report.md) |
| G2 审批桥激活 | **已交付（PR #123）**：Host 启动时把 harness-bridge 幂等装入钉扎 sdk profile，工作流与聊天全部启动路径可解析插件行，消除 `entry did not activate`；真实 Harness 告警消失归真机复核 | `feature/g2-bridge-staging-e8f4` → PR #123 `968aa0b` | [G2-bridge-activation-report](reports/G2-bridge-activation-report.md) |
| G9' 应用内更新通道文档 | **已交付（PR #129）**：DESKTOP_SHELL「应用内更新（D24）」节 + RELEASE §4.1 发布即触发更新检查单，修正失实描述 | `feature/g9-update-channel-docs` → PR #129 `2eddb1e` | [G9-update-channel-docs-report](reports/G9-update-channel-docs-report.md) |
| G11' 工作流模板库 | **已交付（PR #127）**：本地模板库（冻结 schema 归一化、剥离走私策略字段）+ 落库仍走 `workflow.save` 校验 | `feature/g11-workflow-template-library` → PR #127 `92303eb` | [G11-workflow-template-library-report](reports/G11-workflow-template-library-report.md) |
| D25 后半（浮层接 Host 检索） | **已交付（PR #126）**：Ctrl+K 经 `search.global` 查 Host 全库，四类命中导航、过期丢弃、失败降级本地 | `feature/d25-host-search` → PR #126 `dbfeda0` | [D25-host-search-renderer-report](reports/D25-host-search-renderer-report.md) |
| D20' 聊天自动化通知条（渲染） | **已交付（PR #135）**：折叠摘要 + 错过明细 + 启停 + 待评审「去设置处理」，20 秒轮询、静默降级，契约零改动 | `feature/d20-chat-notice` → PR #135 `687ac1e` | [D20-chat-notice-report](reports/D20-chat-notice-report.md) |
| `ask_user` 防滥用闸 | **已交付（PR #130）**：仅真实分叉回合可 ask_user，每回合 ≤3 次 | `feature/ask-user-card-gating` → PR #130 `e768e2a` | [TASK_CHOICE_CARD](TASK_CHOICE_CARD.md) 注记 |
| 互通：任意 bot 平权派发 + 幂等 | **已交付（PR #136）**：去角色/同组门槛、跨组链放行、`idempotencyKey` 幂等重放、`Bot.role` 退役为遗留标签 | `feature/bot-interop` → PR #136 `3e21112` | [BOT_INTEROP-report](reports/BOT_INTEROP-report.md) |
| 原始人模式 + 作曲器深度思考入口 | **已交付（PR #137）**：`chat.send` 可选 `primitive` 最短提示组装（落库不变）；深度思考入口移至输入框旁 | `feature/primitive-mode` → PR #137 `fde0953` | [PRIMITIVE_MODE-report](reports/PRIMITIVE_MODE-report.md) |
| 上下文圆圈 + 80% 自动压缩（G13） | **已交付（PR #138）**：`chat.contextUsage` + 迁移 `0023-chat-summaries` + 后台压缩回合（无工具面、用量照记、历史行不删）；合并前审查 §2.1 P2（并发断言失实）待归属人处理（GAP_AUDIT §7.9） | `feature/context-meter` → PR #138 `a6c7cb5` | [CONTEXT_METER-report](reports/CONTEXT_METER-report.md) |
| stream-pacer 流式回放节奏 | **已交付（PR #150）**：按行/句自适应回放（纯呈现层，契约零改动），修 finish 即 resolve 与取消定时器泄漏；无入库报告（PR 正文为准，GAP_AUDIT §7.9） | `feature/streaming-reply` → PR #150 `6659d29` | —（PR 正文） |
| D27' 语音桌面接线 | **已交付（PR #151）**：麦克风转写只填输入框（20s 自动停）+ 逐条朗读按钮 + `voice.status` 门控；「按住说话/自动断句」未做；无入库报告 | `feature/voice-ui-wiring` → PR #151 `db64e01` | —（PR 正文） |
| G3 原生聊天 D08 审批（后端） | **已交付（PR #125）**：ChatNativeGate 把桥转来的原生工具审批路由到 D16 检查点（fs/exec 能力 + 聊天网络缝 + mcp.call），ask 落既有 AppApproval 卡面（10 分钟 TTL、一次决定）；桌面渲染复用现链路，真实 Harness 端到端归 G4/真机 | `feature/g3-chat-native-approvals-9d4b` → PR #125 `473ec67` | [G3-chat-native-approvals-report](reports/G3-chat-native-approvals-report.md) |
| D20' 自动化状态聊天通知（后端） | **已交付（PR #134）**：本地事件规则的 started/skipped/review 与启停状态变化以 meta 行（kind automation）写入所属 bot 聊天，文案双语定稿 | `feature/d20-automation-notices-3c7a` → PR #134 `b1dae08` | [D20-automation-notices-report](reports/D20-automation-notices-report.md) |
| D25 host 检索（后端） | **已交付（PR #117）**：`search.global` 受信方法（跨 bot 消息/产物/工作流/bot 名，字面子串、有界摘要）；渲染层接线见下一行 | `feature/d25-host-search-5f3a` → PR #117 `f819dfd` | [D25-host-search-report](reports/D25-host-search-report.md) |
| D18 记忆写入 / 检索 / 删除 | 已交付 | `feature/memory-knowledge` → PR #57 `7de305b` | [D18-memory-report](reports/D18-memory-report.md) |
| D18 知识导入（.txt/.md，16 KiB 上限） | 已交付 | `feature/knowledge-import` → PR #59 `9805b6a` | [D18-knowledge-import-report](reports/D18-knowledge-import-report.md) |
| D18 独立知识表 + 本地向量检索 + 保留策略 | 已交付 | `feature/knowledge-base` → PR #63 `ae0c6be` | [D18-knowledge-search-report](reports/D18-knowledge-search-report.md) |
| D19 连接器登记与启停 | 已交付（自定义 MCP、凭据启用未做） | `feature/connector-registry` → PR #60 `20d3ab2` | [D19-connector-registry-report](reports/D19-connector-registry-report.md) |
| D19 连接器调用与本地 SD 生图 | 已交付（视觉理解未做） | `feature/connector-invoke` → PR #65 `73ae475` | [D19-connector-invoke-report](reports/D19-connector-invoke-report.md) |
| D19 stdio MCP 与凭据注入 | 切片交付（视觉理解未做；负责人自审未填） | `feature/d19-stdio-credentials` | [D19-stdio-credentials-report](reports/D19-stdio-credentials-report.md) |
| D20 事件自动化：触发规则与评审队列 | 已交付 | `feature/automation-triggers` → PR #66 `3afea90` | [D20-triggers-report](reports/D20-triggers-report.md) |
| D20 本地事件规则：保存/列出/启停，命中一次启动一个运行 | 切片交付（评审队列界面、聊天通知条、桌面屏幕未做） | `feature/event-automation-rules-844b` | [D20-event-rules-report](reports/D20-event-rules-report.md) |
| D20 本地事件评审：命中入队，批准启动一次，拒绝记跳过 | 切片交付（无桌面界面、无聊天通知条） | `feature/event-review-queue-0e27` | [D20-event-review-report](reports/D20-event-review-report.md) |
| D20 本地事件规则状态记录：启停与改为评审各记一条，可按 bot 列出 | 切片交付（无桌面界面、无聊天通知条） | `feature/event-rule-state-history-d3c8` | [D20-event-rule-state-report](reports/D20-event-rule-state-report.md) |
| D20 桌面评审与状态 | **切片交付**：设置页为选定的一个 bot 显示规则当前状态（启用、停用、评审）。待评审可批准或拒绝：批准走既有 `eventRule.review.approve` 并启动一次运行，拒绝走既有 `eventRule.review.deny` 并记下一次跳过。状态记录在同一页从新到旧显示。无聊天通知条，不改聊天授权，不移动鼠标、不发送按键。Linux / Node 22 上 lint、typecheck、桌面 472 与 host 事件规则 3 通过。GitHub Actions 未跑 | `feature/event-rule-desktop-review-4519` | [D20-desktop-review-report](reports/D20-desktop-review-report.md) |
| D28 产物画布共编侧车 | 已交付 | `feature/canvas-cowrite` → PR #64 `2d5a5e3` | [D28-report](reports/D28-report.md) |
| D21 本地执行守护 | **截图/OCR 主体已合入**（#70/#74/#77/#81/#83）。真实设备输入见下方功能分支。原桌面报告的 Windows 验收缺口由下一行跟进 | `feature/screen-desktop-settings-48af` → PR #83 | [D21-desktop-report](reports/D21-desktop-report.md) |
| D21 Windows 集成修复与验收 | **已合入 develop（PR #93 `5cd86ca`）**：修复 Host 分发资源、OCR bundle、取消/清单竞态、目录链接、HTTP 端口与关闭进程；本机全量 1374 通过、2 跳过，真实窗口及 Electron 全链路通过。GitHub CI 因账户额度未执行 | `feature/screen-windows-acceptance` | [D21-windows-acceptance-report](reports/D21-windows-acceptance-report.md) |
| D21 设备动作批准闸门 | **已合入 develop（PR #88）**：默认关闭。策略为每次询问时，一次请求需要一次精确的仅本次审批才接受，结果只有 id 和时间。不移动鼠标、不发送按键、不调用 exec daemon。无单独桌面界面，无网络。真实键鼠与 GitHub Actions 未跑 | `feature/device-action-approval-ffd6` | [D21-device-action-report](reports/D21-device-action-report.md) |
| D21 设备动作本地记录 | **切片进行中**：一次精确审批后写入一条本地记录（id、bot id、动作名、时间），按 bot 从新到旧列出。拒绝、未启用、复用或未知动作名不写入。未知动作名在审批前拒绝。不移动鼠标、不发送按键、不调用 exec daemon。无桌面界面，无网络。真实键鼠与 GitHub Actions 未跑 | `feature/device-action-record-07ab` | [D21-device-action-record-report](reports/D21-device-action-record-report.md) |
| D21 真实设备输入 | **切片进行中**：`device.action` 仍默认拒绝。`device.action.request` 仍只记录。`device.action.input` 在一次精确的仅本次审批后，由 exec daemon 执行一次指针移动/点击或一次允许列表内的按键。产物在本机 `device-outputs`，不进元数据备份，响应不含路径。拒绝、未启用、复用、未知键或本机没有输入辅助进程时不执行。无桌面页，无网络。这台 Linux 环境没有执行真实 Windows 键鼠，也没有复核真实窗口截图/OCR。GitHub Actions 未跑 | `feature/d21-device-input` | [D21-device-input-report](reports/D21-device-input-report.md) |
| D22 系统集成与双语 | **已合入 develop（PR #75 `9db1ae9`）**：全量中英双语（20 域 853 条 key + AST 扫描防回归守卫；计数为本次同步在合流后的树上实测）、单托盘随活跃 bot + 逐 bot 图标菜单、系统通知与设置（总开关 / 仅非前台 / 按 bot 静音 / 测试通知）、Chrome **书签**只读导入（预览→导入→导出→删除）。托盘渲染与点击、Windows 通知弹出、真实 Chrome 配置、打包版 AppUserModelId 属实机未验证项；负责人自审记录仍待本人填写 | `feature/system-integration` → PR #75 | [D22-report](reports/D22-report.md) |
| D23 平台验收 | 未开始（依赖 D13、D14–D22 全部完成） | — | — |

补记说明：B 线四项与 D17 模板库切片在合入时**未写交付报告、PR 自审记录未填**（两份 PR 清单各仅勾选 2/5）；相应报告于 2026-10-25 事后补记，**不追认事前完成自审**，自审结论仍留空待负责人签署。B 线四项挤在一条串行分支经单个 PR 合入，偏离"一任务一分支"，lockfile 与 CI 配置改动亦未拆独立小 PR；D17 技能库部分已改从最新 develop 单独切分支。后续任务（含 D24、D26 的剩余部分）同样单独切分支，不再堆叠。各任务的手测截图（`reports/assets/d14|d17|d24|d25|d26/`）仍缺，列为待补。

## 5. 双线并行队列（各自独立推进，互不等待）

两条线各自按依赖排序连续推进：**谁做完自己的一块就自审合入，不等对方**。全计划只有一处跨线依赖（B3 等 A1 的写层），其余完全独立。每晚两人各推自己队列的一块即可，进度不锁定。

**A 线（Etheslay · 平台与执行）**：

| # | 任务 | 交付 |
| --- | --- | --- |
| A1 | D15 工具网关 | 读层 → 写层（创建草案/批量撤销/头像自动分配）→ `ask_user` → 内置 `web_search`（免费源） |
| A2 | D16 权限三层 | 三档策略、聊天内授权、审计（复用 D14 卡片组件） |
| A3 | D18 记忆与知识 | 写入/检索/删除，默认不跨 bot；独立知识表 + 本地向量检索 + 保留策略（`feature/knowledge-base`），见 [知识导入报告](reports/D18-knowledge-import-report.md)、[知识检索报告](reports/D18-knowledge-search-report.md) |
| A4 | D19 连接器与 MCP | 登记与本地 SD 调用已合入（PR #65）；无凭据本机 HTTP MCP 已合入，见 [MCP 报告](reports/D19-mcp-http-report.md)。`feature/d19-stdio-credentials` 增加本机 stdio MCP，并在发现和调用时注入 `cred:` 引用。视觉理解仍等模型可用 |
| A5 | D20 事件自动化 | 评审队列已合入（PR #66）。本地自动启动切片：一个 bot 的规则可保存、列出、启停，默认关闭，命中一次启动一个运行（`feature/event-automation-rules-844b`）。本地评审切片：规则可设为评审，命中只入队，批准启动一次，拒绝记跳过（`feature/event-review-queue-0e27`）。状态记录切片：启用、停用或改为评审且状态变化时追加一条，按 bot 从新到旧列出（`feature/event-rule-state-history-d3c8`）。桌面切片：设置页为选定 bot 显示启用/停用/评审、待评审批准或拒绝，以及从新到旧的状态记录（`feature/event-rule-desktop-review-4519`）。无聊天通知条 |
| A6 | D21 本地执行守护 | 契约、Windows OCR 与 Host 网关已在 develop。桌面设置页提供默认关闭、逐次授权的单窗口截图和本机预览。设备动作在每次询问下接受一次精确审批；通过后写入一条本地记录（id、bot id、动作名、时间），可按 bot 从新到旧列出。`device.action.request` 仍不执行输入。`feature/d21-device-input` 在另一次精确审批后，由 exec daemon 执行一次有界指针或按键，产物只留在本机 `device-outputs`。这台 Linux 环境没有执行真实 Windows 键鼠，也没有复核真实窗口截图/OCR |

**B 线（Destinyian · 桌面与体验）**：

| # | 任务 | 交付 |
| --- | --- | --- |
| B1 | D14 聊天体验 | 渲染片（MD/高亮/KaTeX/mermaid）→ 交互片（提及跳转/交付通知/定向回复/选项卡片/气泡随 bot 色） |
| B2 | D25 全局搜索 | Ctrl+K 跨 bot/会话/产物 |
| B3 | D17 技能与模板 | 技能复用、模板库（依赖 A1 写层合入，其余不等） |
| B4 | D26 聊天附件 | 附件经网关进工作区，bot 可读附件内容（依赖 A1 读层） |
| B5 | D24 设置与更新 | 设置补全持久化 + 左下角更新按钮（不等 A 线） |
| B6 | D28 Canvas 共编 | 产物侧车共编（依赖 B1/B4） |
| B7 | D22 系统集成与双语 | 托盘/导入/通知/双语 —— **已交付**（`feature/system-integration`，实机项待验收） |

**跨线依赖（全部列出）**：

| B 任务 | 等 A 的什么 | 实际等待 |
| --- | --- | --- |
| B3 D17 | A1 写层（draft 契约小 PR 合入 develop） | A1 后半即可开工 |
| B4 D26 | A1 读层网关存在 | A1 前半即可开工 |
| 其余 | 无 | 零等待 |

**收官**：两条队列各自清空后，Destinyian 主责 D23 平台验收 + D13（顺延至此，与发布验收合并）；Etheslay 对平台线提交自审与验证证据。
## 6. 对标交互与创建清单（Grok Bot 实拍摘录）

以下模式来自负责人提供的 Grok Bot 实际使用截图，是对标体验的硬性清单；已映射到任务，落地前不删本节。

| # | 交互模式 | 行为定义 | 落点 |
| --- | --- | --- | --- |
| 1 | 多 bot 交付通知 | "已发消息给 🟠🟣🟡 3 个 Bot"：迷你头像栈 + 计数，点击任一头像直达该 bot 会话 | D14 |
| 2 | 定向回复 | "已只回 🔴 Manager"：bot 回复可定向单 bot，路由在聊天内可见，避免刷屏 | D14 |
| 3 | 内联提及跳转 | 彩色 @name（如橙色的 designer）嵌在句子里，点击直达该 bot | D14 |
| 4 | 选项卡片 | bot 需要人类决策时渲染 A/B/C(/D) 卡片（问题 + 选项 + "其他，我说明"），点击即作为用户回答回写会话并推进流程。**状态语义**：卡片出现时状态条切换为「正在调用 ask_user · 计时 · 可取消」——停止显示思考/搜索等活动文案（等待的是人类，不是模型）；用户作答后活动状态恢复。活动文案只在回合尚未产出回复时出现 | D14 渲染 + D15 `ask_user` 能力（网关暂停回合，事件里带 paused 状态） |
| 5 | 自动化状态通知条 | 例行任务的禁用/删除/错过以系统通知条出现在聊天内（"已禁用 例行任务 ⏰ …（已删除）"），不静默 | D20 × D14 通知条组件 |
| 6 | 交接摘要卡 | bot 间交付用结构化小结：目标 / 完成项 / 缺口 / 下一步负责人 | D14（模板化归 D17） |
| 7 | 头像自动分配 | 批量创建组内 bot 自动配**不重复**的形状×颜色，一眼区分成员；组合用尽才允许重复；用户显式指定时以用户为准 | D15 写层 |
| 8 | 用户气泡随 bot 色 | 用户发送气泡的颜色跟随当前会话 bot 的主题色（选粉色 bot 即粉色系），强化"在和谁说话"的情境感 | D14 |
| 9 | 动态过程状态 | 状态条按 Harness 报告的真实阶段变化（正在读代码/查资料/翻记忆/拟定方案/评审/处理「xx」/深度思考），不显示假进度；**流式期间状态条 sticky 常驻**（停靠在可视区顶部/ composers 上方），不被新回复顶走、不随滚动消失，带**递增计时**（如 140s）与取消；intent→文案映射在 i18n 词典（chat.intent*），新工具（如 D29 搜索）随接入加词条 | 词典已备（D22/D12），sticky 渲染归 D14 聊天体验，接线随 Renderer↔Host 方案；深度思考状态随 reasoner 开关 |

> 复刻优先级：4（选项卡片）> 3（提及跳转）> 1/2（交付与定向）> 8（气泡随 bot 色）> 7（头像分配）> 5/6（随 D20/D17 顺带达成）。

## 7. 界面占位审计（D00–D12 未兑现项）

对当前桌面界面的逐区域审计：凡是 D00–D12 交付后仍是占位/假控件/夹具数据的能力，登记去向。新任务编入 [开发计划](DEVELOPMENT_PLAN.md) §6；用户气泡颜色等交互项并入 D14。

| 区域 | 占位 / 未实现 | 现状 | 去向 |
| --- | --- | --- | --- |
| 聊天 | 用户气泡颜色 | **已实现**：气泡按当前会话 bot 着色（D14 交付时未做，由 `fix/chat-user-bubble-bot-color` 补齐） | ~~D14~~ 已完成，见 [D14-report §5](reports/D14-report.md) |
| 聊天 | 回复仍是"（占位回复）"夹具数据；横幅标注"静态占位" | **已实现**：chat.send/history/cancel 真实链路（D30 + PR #97/#103），夹具仅存于离线演示模式 | ~~Renderer↔Host 映射~~ 聊天部分已落地；剩余界面态见 **GAP_AUDIT G1'** |
| 聊天 | ＋ 菜单"添加附件" | **已实现**（D26）：`attachment.begin/append/commit` 上传进工作区 + 模型工具 `read_workspace_file`（PR #106/#111） | ~~D26~~ 已完成，见 [GAP_AUDIT](GAP_AUDIT.md) §1.1 G8 |
| 聊天 | 麦克风按钮 | **已实现**（PR #151）：录音→WAV→`voice.transcribe` 只填输入框不自动发送（20s 自动停），逐条回复朗读按钮（`voice.speak`），按 `voice.status` 门控禁用；「按住说话/自动断句」未做 | ~~D27'~~ 已完成，真机验收归第三批 |
| 顶栏 | 搜索圆钮 | **已实现**：Ctrl+K 浮层经 `search.global` 检索 Host 全库（bot/工作流/跨 bot 消息/产物，四类命中导航，不可达降级本地；PR #117 + #126） | ~~D25 后半~~ 已完成，见 [D25-host-search-renderer-report](reports/D25-host-search-renderer-report.md) |
| 顶栏 | 最近会话 / 产物 popover | 会话部分已读真实数据（PR #103 stored-session）；产物 popover 本次刷新未逐项复核 | 同 [GAP_AUDIT](GAP_AUDIT.md) G1'/G10 |
| 设置 | 分类"电脑 / 保险库 / 用量与账单 / 更新" | **已实现**（D24）：备份/恢复/保险库（PR #78）、用量统计（PR #119）、应用内更新（`main/updates.ts`） | ~~D24~~ 已完成 |
| 设置 | 强调色 / 语言 / 硬件加速 / 通知 | **已实现**：强调色+持久化（D24）、语言/通知/托盘/Chrome 导入（D22，PR #75）、硬件加速（`b57d46b`） | ~~D24~~/~~D22~~ 已完成 |
| 设置 | API Key 保存 / 测试连接 | 本次刷新未逐项复核；保险库 safeStorage 通道已备（PR #78） | 真实 Key 全链验收挂 [GAP_AUDIT](GAP_AUDIT.md) G4（未验证） |
| 设置 | 全部设置项不持久化 | **已实现**（D24）：`deepseek-bot.settings.v2` 写本地存储 | ~~D24~~ 已完成 |
| 侧栏 | 账户"退出登录" | 占位（无账号体系） | 维持占位（边界：不引入账户体系），D26 改为"本地资料"卡片 |
| 全局 | bot / 分组 / 会话状态持久化 | **部分实现**：bot/分组/会话历史随 Host SQLite 持久化、`chat.history` 回放已接（PR #97/#103）；侧栏排列/选中态等界面态仍重启即失 | **GAP_AUDIT G1'**（拍板 #1 记录 ui.* 清单后开工） |

## 8. 待拍板事项

| # | 事项 | 需要 | 状态 |
| --- | --- | --- | --- |
| 1 | Renderer↔Host 真实数据接线方案（A/B/C/D 或组合） | 两负责人按 [映射提案](RENDERER_HOST_MAPPING.md) §3 达成一致 | 待拍板——D 步与聊天/历史 B 步已事实上线（PR #97/#103）；剩余 **ui.\*** 清单阻塞 G1' 界面态持久化（见 [GAP_AUDIT](GAP_AUDIT.md) §7.1） |
| 2 | mono-shape 头像线与 develop 头像线（PR #18/#19）的分叉合并策略 | Destinyian 定基准 | **已定案（2026-10-27）：develop 头像线为基准，`feature/mono-shape` 作废并删除。** 该分支相对 develop 只有一个提交 `e74e570`（fix(desktop): let the mono avatar use any rounded shape），它改的 `MinimalAvatar` / `shapeIndex` / `{kind:"minimal"}` 已随 B-AVATAR-02 的头像重做全部移除（现网 0 命中），合并只会复活死类型。其意图（mono 换形状）至今仍未实现，但更前置的是：契约 `AvatarSchema` 只有 `shape` + `color`、没有 `kind`，mono 属渲染层 UI-only 值，**无法持久化**，重启后头像按 bot id 派生。若将来要黑白头像可留存，需要的是契约加字段（另立小 PR），不是给 mono 加形状 |

## 9. 对标缺口盘点（Grok Bot · GitHub 分发 · 本地优先）

状态：盘点稿。定位红线先说死：

- **分发与更新**：只走 GitHub Releases 安装包（D11 管线产出 exe + SHA-256 + 发布说明）；**应用内更新** = electron-updater 以 GitHub Releases 为源（免费第三方基础设施，非自有服务）：启动时静默检查 → 左下角更新按钮/徽标 → 点击下载重启安装；不建自有下载站与更新服务；
- **消费**：用户的**唯一持续成本是模型 Token**（DeepSeek API 现状）。零云存储、零订阅、零托管服务、零遥测；
- **一切联网** = 用户本机直连第三方（自带 Key，与调 DeepSeek API 同性质）；**一切数据** = 本地；
- **立项检查问题**："这个能力除了 Token 还要让用户为什么付钱吗？"——答非"否"即出局，或必须同时提供零成本本地路径。

### 9.1 可提前进 v0.2 的快赢

**四项已全部完成（2026-10-28 对 develop `81a0924` 核实，逐项证据见 [GAP_AUDIT](GAP_AUDIT.md) §1.1）**：

| 项 | 说明 | 建议落点 |
| --- | --- | --- |
| 深度思考开关 | DeepSeek reasoner 按会话切换（仅改 modelProfile，不破契约） | ~~并入冲刺三~~ **已完成（PR #73）** |
| 重新生成 / 编辑重发 | 聊天标配 | ~~并入 D14~~ **已完成（PR #97，gap-batch1）** |
| 对话导出 | 导出 Markdown / 图片到本地文件 | ~~并入 D24~~ **已完成（PR #97，Markdown 导出）** |
| 附件理解闭环 | bot 经 read 工具真正读取附件内容并回答（不只上传） | ~~D26 验收扩充~~ **已完成（PR #106/#111，`read_workspace_file`）** |

### 9.2 v0.3 候选池（需方案评审，全部守住消费红线）

第一档四项已升格并入正式任务：**联网搜索 → D15、语音模式 → D27、Canvas 共编 → D28、图像生成 → D19**（见 [开发计划](DEVELOPMENT_PLAN.md) §6，安排在冲刺五/八/九/十）。本表保留尚未立项的候选：

| 项 | Grok 表现 | 零订阅本地方案 | 主要约束 |
| --- | --- | --- | --- |
| 弹出式多窗口 | 多会话并行 | 对话独立成窗，呼应 DSH 多窗工作流 | 桌面线大件 |
| 视觉理解 | 看图对话 | DeepSeek 视觉模型可用后接入（仍是 Token 消费，符合红线） | 模型可用性 |

> 模型供应商锁定 DeepSeek（契约 v0.1 即锁定，见 [CONTRACTS](CONTRACTS.md) §2），不做多供应商/本地多模型；模型侧演进跟随 DeepSeek 官方（如 reasoner、视觉模型），仍只是 Token 消费。

### 9.3 永不做（定位红线）

自有云服务、云存储、账户体系、计费系统、订阅制依赖、遥测上报、远程中继、模型托管。发现任何"必须付 Token 以外的钱才能用"的能力，一律不立项或必须先给出零成本本地等价路径。

## 10. 在途分支台账（2026-10-29 清点）

清点基线：`origin/develop` = `db64e01`（PR #150/#151 合入后）。此前台账所列分支已全部合入或作废删除（含 #138 context-meter，远程分支随合并删除）。冲突结论来自 `git merge-tree --write-tree origin/develop <分支>` 的**试算**，不代表已解决；「落后 N」随 develop 演进持续增长，仅作变基紧迫度参考，不逐次更新。

- **远程在途分支（均归属 Destinyian，AI 只登记不触碰）**：
  - `feature/d14-mermaid`（新增）——补齐 D14 砦除的聊天内 mermaid 流程图渲染（任务书 `TASK_D14_MERMAID.md` 与 D14-mermaid 报告随分支提交，SPRINTS §4 D14 行同步改写随分支）；试算零冲突；**引入 mermaid 依赖（pnpm-lock +837 行）**，属依赖面变更；**合并前需处理审查报告 §2.2 的 P3**（主题切换后新图仍用旧主题）；
  - `feature/d17-skill-host-store`——技能库迁 Host 存储（`skillLibrary.get/save`，协议 v0.11；任务书 `TASK_D17_SKILL_HOST_STORE.md` 与报告随分支提交）；未变基，落后幅度最大，试算冲突 1 文件：`docs/CONTRACTS.md`（含 #140 补记的 chat.* 方法行区域），建议先变基再开 PR；审查 §2.3 备忘不阻塞；
  - 处置：由归属人本人自审（针对最新提交 SHA）后开 PR；
- **已合入**：#151（语音接线 D27'）、#150（stream-pacer）、#138（context-meter/G13）、#149（BOT_WORKSPACE 口径）、#148（许可索引）、#147（契约标题）、#146（D22 断链）、#145/#143（台账）、#144（独立审查报告）、#142/#141/#140/#139（文档系列），均 2026-10-29；#136/#137 于 10-28；
- **本地**：33 个分支中未合入 develop 的只有 `archive/stage-plan-proposal` 与 `archive/stage-plan-push2`（2026-10-23 误署名事件的提案存档，按当时记录待负责人讨论——不合并、不推送、不删除）；
- **工作区**（`git worktree list`）5 个活动项，其分支均已合入：`~/.codex/worktrees/d21-windows-acceptance`（`feature/screen-windows-acceptance`，PR #93）、`~/.codex/worktrees/resolve-pr65-connectors`（`feature/local-exec`）、`deepseek-bot-wt-connectors`（`feature/connector-registry`）、`deepseek-bot-wt-knowledge`（`feature/knowledge-import`）、`deepseek-bot-wt-memory`（`feature/memory-knowledge`，PR #57）——均属可清理死工作区，但可能含未跟踪本机数据，删除前需负责人逐个确认，本台账只登记不动手；
- **主工作区残件**：根目录 `.tmp-d16-*` 日志与临时 electron 目录（`.gitignore` 覆盖、不入库）为 D16 会话遗留，可删；
- **欠账复核**（对照 10-27 清点）：`docs/GAP_AUDIT.md`、`docs/TASK_MANAGER_ORCHESTRATION.md` 已入库（PR #122 起）；根目录 0 字节 `$null` 文件已不存在；手测截图 d14/d17/d25/d26 仍缺；各报告自审签署欠账清单见 [GAP_AUDIT](GAP_AUDIT.md) §7.3；
- **未完成的计划项**：**D21 真实键鼠复核**（截图/OCR 真机证据已由 PR #93 报告覆盖）、**D23 平台验收**（依赖 D13 与 D14–D22 全部完成，未开始）；下一批候选见 [GAP_AUDIT](GAP_AUDIT.md) §8。

下次合并后本节照例更新。




## 11. UI 冻结基线（负责人确认，所有窗口必须保持）

以下 8 项为负责人确认满意的 UI 基线（2026-10-27）。任何窗口的后续改动**不得回退或破坏**这些项；重构/合并时逐项核对：

1. **整体 UI**：Grok 风格界面层（贴底对齐、顶部半模糊渐隐、简洁行通知）；
2. **气泡**：bot 回复无气泡纯文本 + 用户气泡当前样式；
3. **消息往来查看**：交付通知/往来摘要点击打开配对聊天记录视图（关闭聊天返回），不是跳 bot；
4. **居中提示**：交付通知、往来摘要等系统行居中显示；
5. **点击查看聊天记录**：同 3，点击对象是聊天记录而非会话切换；
6. **无闪电按钮**：composer 无独立技能按钮，技能入口在 ＋ 菜单；
7. **卡片配色**：选项卡片当前配色保持；
8. **选项卡配色**：角色/语气选项卡当前配色保持。

改动涉及以上任一项时，PR 描述必须逐项核对并在自审记录里声明“冻结基线未破坏”。
