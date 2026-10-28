# 双人开发任务与里程碑

日期：2026-10-22。状态：任务规划基线；实际实现进度与检查证据见各任务报告，不能将本表视为完成清单。开发者：Etheslay、Destinyian。

## 1. 分工

Etheslay 主责 Harness、Host、执行、权限、存储和调度；Destinyian 主责桌面壳、界面、工作流编辑、可访问性和安装体验。每项任务由表中的负责人开发、测试并自行审查，无需另一人批准。负责人可提出调整，但必须更新任务与接口责任，不能两人在同一任务分支各自改动相同文件。

共享契约、依赖清单、锁文件、版本文件和 CI 属于协作区；负责人自审后通过小型独立 PR 先合入 develop，再让依赖任务更新基线。同步接口与影响，不要求交叉批准。自动化或 AI 检查可辅助自审，但不能伪造负责人的结论。

## 2. 任务清单

下表全部开发 feature 从最新通过集成检查的 develop 创建，目标均为 develop。每行是一个可独立审查的任务分支。编号用于 Issue 标题；当前未实际创建或分派 GitHub Issue。发布冻结后的同补丁移植遵循 Git 工作流的 release-fix 规则。

| 任务 / 分支 | 负责人（开发与自审） | 依赖 | 交付与验收 |
| --- | --- | --- | --- |
| D00 `feature/project-standards` | Etheslay | 无 | 需求、规范、架构和分工自审；确认平台、预算与 ADR；本次文档准备属于此项 |
| D01 `feature/harness-adapter` | Etheslay | D00 | 真实 Harness 技术验证；固定版本、审批/取消/日志/Windows 兼容记录 |
| D02 `feature/desktop-shell` | Destinyian | D00 | 桌面窗口/托盘/受限 IPC、界面导航、基础打包；不开放任意 Node 接口 |
| D03 `feature/shared-contracts` | Etheslay | D01、D02 | 将契约落实为 schema、夹具和双方可用测试；确认依赖锁与版本策略 |
| D04 `feature/local-storage` | Etheslay | D03 | SQLite 元数据、专属 Harness home、凭据存储、迁移与恢复；FR-01/09 后端 |
| D05 `feature/bot-workspace` | Destinyian | D03 | 机器人列表/编辑/归档、设置、聊天流与产物界面；FR-01/02/03 前端 |
| D06 `feature/workflow-engine` | Etheslay | D04 | DAG 校验、顺序/并发、失败与取消、运行快照、事件去重；FR-05/07 |
| D07 `feature/workflow-editor` | Destinyian | D03、D05 | 节点/连线/参数编辑、校验定位、模板导入导出；FR-04 |
| D08 `feature/tool-permissions` | Etheslay | D04、D06 | 后端执行前检查、路径约束、一次性审批、MCP 授权；FR-06 后端 |
| D09 `feature/run-monitor` | Destinyian | D05、D07 | 节点状态、日志、取消、审批界面、运行历史；FR-06/07 前端 |
| D10 `feature/local-scheduler` | Etheslay | D06、D08 | 时区、休眠错过任务、重复触发防护、重启中断状态；FR-08 |
| D11 `feature/desktop-packaging` | Destinyian | D02、D04 | Windows 安装/卸载/升级，内置 runtime，独立干净机试验，产品 CI；FR-10 |
| D12 `feature/runtime-integration` | Etheslay | D06、D08、D09、D10 | 三机器人真实全链路、故障注入、权限与迁移回归 |
| D13 `feature/desktop-acceptance` | Destinyian | D07、D09、D11、D12 | 最终安装包端到端、键盘/可访问性、轻量指标报告和用户指南 |

任务规模过大时拆成有新编号的 feature 分支，不将多个无关目标塞入一个 PR。D05 / D07 / D09 可先用契约夹具开发，只有与真实 Host 联调后才能标记集成验收完成。

## 3. 并行顺序

| 阶段 | Etheslay | Destinyian | 退出条件 |
| --- | --- | --- | --- |
| M0 规范与验证 | D00 / D01 | D02 | 接入方式、平台、预算与桌面边界可评审 |
| M1 基础闭环 | D03 / D04 | D05 | 单机器人聊天，重启数据保留，真实 API 与取消 |
| M2 多机器人流程 | D06 / D08 | D07 / D09 | 三机器人工作流、审批、失败和产物完整可追踪 |
| M3 可靠性与交付 | D10 / D12 | D11 / D13 | 集成回归、打包/升级/恢复、性能与文档完成 |
| M4 发布准备 | 后端问题与本模块验收自审 | release 负责人及最终候选自审 | release/v0.1.0 满足所有发布门槛 |

本计划按依赖排序，不承诺未经评估的工期。两人在 D00 评审时为任务填写估时、可用时间与里程碑日期。

## 4. 每项任务的开始与完成

开始：确认前置 PR 已合入、验收条目明确、当前 develop 检查通过；Issue 写入负责人（同时承担自审）、分支和依赖；创建独立工作目录或 clone/worktree。

完成：实现与需求一致、相关自动化检查通过、必要手测留证、接口与文档同步、无未解释高风险问题、负责人记录针对最新提交的自审结论。负责人可自行合并 PR，使用保留分支历史的 merge commit。

每次开工检查接口/锁文件变化，每次合并前更新 develop 并完成自审。时间冲突显式更新任务状态，不以“已分配”假装已开始。

## 5. 发布职责

首版由 Destinyian 组织安装包、版本和发布说明，Etheslay 对自己负责的 runtime、数据迁移、测试与回滚提交自审及验证证据。各自负责自己的修改；release 负责人检查最终候选与完整证据，在 PR 记录自审后按发布门槛合并，无需另一人批准。签名和发布凭据不能放进仓库。

## 6. 阶段二任务清单（v0.2，D13 顺延至收官）

下表所有任务从最新 `develop` 创建独立 feature 分支，目标均为 `develop`。阶段二只做本地单机能力，云端、计费、遥测与远程中继不在范围内。契约与依赖变更仍先走小型独立 PR（见 [Git 工作流](GIT_WORKFLOW.md)）。

编号说明：为避免碎片化，原 D24（聊天交互）并入 D14、原 D29（联网搜索）并入 D15、原 D32（生图连接器）与视觉接入并入 D19、原 D26（设置补全）与 D28（应用内更新）合并为新 D24；现行编号连续为 D14–D28。

| 任务 / 分支 | 负责人（开发与自审） | 依赖 | 交付与验收 |
| --- | --- | --- | --- |
| D14 `feature/chat-experience` | Destinyian | D05 | 聊天体验一次到位：Markdown/代码高亮/KaTeX/mermaid 渲染（资源全本地）；内联提及跳转、多 bot 交付通知、定向回复、选项卡片（A/B/C/D，供 D16 复用）、自动化状态通知条；用户气泡颜色跟随 bot 主题色（原 D24 并入） |
| D15 `feature/agent-tools` | Etheslay | D08、D12 | 工具网关：读层（list_bots/list_groups/get_run/get_run_events，默认允许）→ 写层（创建草案不落库、批量创建组内自动分配不重复头像、批量撤销）→ `ask_user` 选项卡 → 内置 `web_search`（免费源，走权限与审计）（原 D29 并入） |
| D16 `feature/permissions-grants` | Etheslay | D08、D15 | capability/grant/审批三层模型；设置页三档策略；聊天内授权与撤销；审计可查（见 [权限与授权](PERMISSIONS.md)） |
| D17 `feature/skills-templates` | Destinyian | D05、D15 | 技能定义与复用、bot 模板与本地模板库；导入导出走契约校验 |
| D18 `feature/memory-knowledge` | Etheslay | D04、D15 | 记忆写入与检索、知识导入；用户可查看与删除；默认不跨 bot 共享 |
| D19 `feature/connectors-mcp` | Etheslay | D08、D15 | 连接器注册与生命周期、自定义 MCP、凭据引用托管；首个官方连接器：本地 Stable Diffusion 生图（免费、吃 GPU）；视觉理解随模型可用接入（原 D32 并入） |
| D20 `feature/automation-triggers` | Etheslay | D10、D15 | 事件触发与规则、评审队列；重复触发防护；错过触发可见；启停状态在聊天内可见 |
| D21 `feature/local-exec` | Etheslay | D08、D15 | 本地执行守护、窗口截图与 OCR、设备动作；默认关闭，逐次授权，产物只存本地 |
| D22 `feature/system-integration` | Destinyian | D02、D11 | 每 bot 托盘图标、Chrome 数据导入、通知设置、中英双语；不引入账户体系 |
| D23 `feature/platform-acceptance` | Destinyian 主责，Etheslay 复核 | D13、D14–D22 | 对标矩阵、性能预算、可访问性与发布门槛；无 P0/P1；证据与结论一致 |
| D24 `feature/settings-updates` | Destinyian | D04、D11、D22 | 设置补全与持久化：外观强调色、语言切换、数据备份/恢复入口（data.* 契约）、本地用量统计、硬件加速与通知开关，清理全部占位假控件；**应用内更新**：electron-updater 以 GitHub Releases 为源，有新版时左下角弹出更新按钮，点击下载重启安装，SmartScreen 流程写明（原 D26/D28 并入） |
| D25 `feature/global-search` | Destinyian | D05、D14 | 顶栏搜索落地：跨 bot / 会话 / 产物 / 设置项的本地搜索（渲染层索引先行，host 检索后接）；键盘唤起（Ctrl+K） |
| D26 `feature/chat-attachments` | Destinyian | D08、D15 | 聊天附件：文件/图片经工具网关进入 bot 工作区（受 grant 与审批约束），附件卡片与产物预览打通；bot 经 read 工具真正读取附件内容并回答 |
| D27 `feature/voice-mode` | Etheslay 主责，Destinyian 语音 UI 联调 | D12 | 本地语音：whisper.cpp 转写 + Windows TTS 播报（全免费、全本地）；按住说话/自动断句；不引入云端转写（原 D30 并入，编号前移） |
| D28 `feature/canvas-cowrite` | Destinyian | D14、D26 | 产物画布从只读预览升级为可共编侧车：bot 写、用户改、bot 续写；版本留痕可回退（原 D31 并入，编号前移） |
| D30 `feature/chat-runtime` | Etheslay | D12、D15 | 聊天运行时：契约 `chat.send/history/cancel`；Host 每 bot 一个逻辑会话，每轮新建 Harness 进程并回放近期历史；`chat_messages` 持久化；渲染层聊天走 Host |

D16 后端、设置页与聊天审批卡已合入。`feature/harness-tool-gateway` 在此基础上实现八个应用工具的真实 Harness 调用、精确审批与继续执行，并通过真实 Electron + Host + 钉扎 Harness + 本地受控模型验证；会话授权跨轮复用、重启失效，永久授权保留。`feature/ask-user-chat` 把 `ask_user` 接入同一聊天回合：桌面卡片的选项或自由文本经 `question.answer` 回到等待中的工具，并写入该 bot 的用户聊天记录；八个应用工具的目录与结果不变。`feature/web-search-chat` 把 `web_search` 接进同一聊天回合：Host 用该 bot 的 D08 网络策略作为受信句柄，桌面保存 SearXNG 地址，结果以卡片和助手聊天记录展示；聊天里要求审批的网络策略直接拒绝，不另开工作流运行。其他工具的原生聊天 D08 审批仍为后续范围。`feature/memory-knowledge` 交付记忆的写入、检索和删除，默认不跨 bot。`feature/knowledge-import` 让桌面为当前 bot 选择一个 .txt 或 .md 文件，不超过 16 KiB 且正文能放进一条 4000 字记忆时，用既有 `memory.write` 写入；超过格式或大小上限则拒绝。`feature/connector-registry` 在本机登记连接器，可列出、启用和停用，新建时默认关闭；凭据列只保存 `cred:<uuid>` 引用，不读取密文，也不发起调用。本地 Stable Diffusion 调用与 D20 事件规则/评审队列已分别由 PR #65、#66 合入。D20 另有本地自动启动切片：一个 bot 的事件规则可保存、列出、启用和停用，默认关闭；一条匹配的本地事件启动一个运行，同一事件不第二次启动，关闭的规则记下可列出的跳过。该切片不联网、不远程中继，也不改 `trigger.*` 评审队列。其后的本地评审切片让一条事件规则改为先评审：命中的本地事件只生成一条待评审项，不启动运行；批准启动恰好一个运行，拒绝记下跳过且不启动；同一事件不会再次入队或再次启动；关闭的规则仍记跳过且不入队。待评审项可列出。其后的本地状态记录切片：启用、停用或改为评审且该开关真的变化时，追加一条记录（规则 id、bot id、新状态、时间），可按 bot 从新到旧列出；状态未变的重复调用不追加。这三个切片都没有桌面界面、聊天通知条、网络或远程中继。其后的桌面切片在设置页为选定的一个 bot 显示规则当前状态（启用、停用、评审），待评审项可以批准或拒绝：批准走既有 `eventRule.review.approve` 并启动一次运行，拒绝走既有 `eventRule.review.deny` 并记下一次跳过；同一页按从新到旧显示状态记录。不新增聊天通知条，不改聊天授权，不移动鼠标、不发送按键。见 [D20 桌面评审报告](reports/D20-desktop-review-report.md)。桌面屏幕、设备动作和截图不在这些切片。无凭据本机 HTTP MCP 已合入：按 bot 精确工具白名单、设置页发现与授权、聊天单次审批、取消及审计，见 [MCP 报告](reports/D19-mcp-http-report.md)。`feature/d19-stdio-credentials` 在此之后增加本机 stdio MCP，并在发现与调用时通过既有凭据通道注入 `cred:` 引用；视觉理解仍等模型可用。见 [stdio 与凭据报告](reports/D19-stdio-credentials-report.md)。随后推进的 D21 已另有切片合入。D21 的契约、Windows 采集/离线 OCR 与 Host 网关已在 develop（PR #70、#74、#77）。桌面设置页在此基础上选择 bot、把 `screen.capture` 从默认拒绝改为每次询问、刷新并选定一个窗口、发起单次截图或 OCR、只做仅本次审批，并在本机查看缩略图和识别文本、确认后删除。真实窗口、打包 Electron 和 GitHub Actions 未在该设置页分支运行。见 [D21 桌面报告](reports/D21-desktop-report.md)。后续 `feature/screen-windows-acceptance` 在最新 develop 上补齐 Windows/Node24、本地分发资源与真实 Electron/Harness/OCR 验收，修复取消与结果一致性、链接隔离和关闭资源；本机全量 1374 通过、2 跳过，GitHub CI 因账户额度未执行。已合入 develop（PR #93），见 [D21 Windows 报告](reports/D21-windows-acceptance-report.md)。设备动作的第一片只做批准闸门：`device.action` 默认拒绝，改为每次询问后，一次请求必须有一次精确的仅本次审批才会被接受；拒绝、策略不是询问，或再次使用同一张审批，都不产生接受结果。结果只有 id 和时间。这一片不移动鼠标、不发送按键、不调用 exec daemon，也没有桌面界面和网络。见 [D21 设备动作报告](reports/D21-device-action-report.md)。下一片在同一次精确审批通过后写入一条本地记录（id、bot id、动作名、时间），并按 bot 从新到旧列出。拒绝、策略不是询问、同一张审批再用，以及审批前就被拒绝的未知动作名，都不写入。动作名只接受闸门已有的 `pointer` 与 `key`。仍不移动鼠标、不发送按键、不调用 exec daemon，也没有桌面界面和网络。见 [D21 设备动作记录报告](reports/D21-device-action-record-report.md)。其后的真实输入切片（`feature/d21-device-input`）保持 `device.action` 默认拒绝，并保持 `device.action.request` 只记录、不输入。`device.action.input` 在一次精确的仅本次审批通过后，由 exec daemon 执行一次指针移动或点击，或一次允许列表内的按键。坐标限制在 0–8192，按键不含 Windows 键，也不接受命令或路径。产物只写在本机 `device-outputs`，不进入元数据备份。拒绝、策略不是询问、同一张审批再用、未知按键，以及当前系统没有输入辅助进程时，都不执行。这一片没有设备动作桌面页，也没有在这台 Linux 环境上执行真实 Windows 键鼠或复核真实窗口截图/OCR。见 [D21 设备输入报告](reports/D21-device-input-report.md)。聊天授予切片：当前聊天可为这个 bot 授予或撤销一项能力（本会话默认 5 次、2 小时，或永久）。授予写入既有 grant 表，由现有网关在执行前检查；策略拒绝、撤销、过期或用尽后该能力不会执行。`app.start_run` / `exec.shell` / `screen.capture` / `device.action` / `mcp.call` 不能经这条路径取得会话或永久授权。不移动鼠标、不发送按键、不联网。见 [聊天授予报告](reports/D16-chat-grant-report.md)。付费模型与完整发布验收未执行。证据见 [D16 报告](reports/D16-report.md)、[Harness 工具报告](reports/D16-harness-tools-report.md)、[ask_user 回传报告](reports/D16-ask-user-chat-report.md)、[web_search 聊天报告](reports/D16-web-search-chat-report.md) 、[记忆报告](reports/D18-memory-report.md) 、[知识导入报告](reports/D18-knowledge-import-report.md) 和 [连接器登记报告](reports/D19-connector-registry-report.md)。`feature/d17-skill-injection` 把渲染层已保存的技能随 `chat.send` 交给 Host 注入本轮提示词，用户聊天记录仍只有原文。技能声明的能力 id 成为该轮工具网关的允许集：未声明的工具在授权检查之前拒绝，已声明的工具仍走既有策略、grant 与审批。未声明任何能力的技能只注入指令。技能库仍在渲染层 localStorage，不新增 Host 表。工作流模板仍未做。见 [D17 技能注入报告](reports/D17-skill-injection-report.md)。

## 7. 阶段二里程碑

| 阶段 | 任务 | 退出条件 |
| --- | --- | --- |
| M5 聊天工作台 | D14 / D15 | 聊天可渲染富文本与流程图；聊天可生成创建草案，编辑器可见但未落库 |
| M6 授权与复用 | D16 / D17 | 三档策略与会话授权生效；“从不允许”在网关层被拒；技能与模板可复用 |
| M7 平台能力 | D18 / D19 / D20 | 记忆与知识、连接器、事件自动化可用且全部有审计 |
| M8 执行与交付 | D21 / D22 / D23 | 本地执行与屏幕感知受控可用；系统集成与双语完成；平台验收通过 |

## 8. 阶段二边界与完成标准

- 对标 Grok Bot 的**能力形态**，不做它的云端基础设施：无云电脑、无账户/计费、无遥测上报、无远程中继；
- 聊天驱动的创建必须“可预览、可撤销、有审计”，不允许模型绕过网关直接写库；
- 每项任务沿用 §4 的完成定义：实现一致、自动化检查通过、手测留证、文档同步、负责人自审记录；
- 阶段二不包含插件市场与云端共享；如要做，单独立项，不能计入 v0.2 完成度。

## 9. 冲刺执行（D13 顺延说明）

应用负责人要求，D13 顺延至阶段二收官后与发布验收合并执行；§6 的“D13 通过后启动”相应调整为“D12 合并后即可启动”，阶段二各任务依赖（D05/D08/D12）当前均已满足。

阶段二按**双线并行**方式执行：Etheslay 沿 A 线（平台与执行）、Destinyian 沿 B 线（桌面与体验）各自独立推进，互不等待；切片与跨线依赖见 [冲刺计划](SPRINTS.md) §5。冲刺只做排期切片，不改本表的任务编号、负责人与验收语义；契约与依赖变更仍按 §1 协作区规则走小型独立 PR。
