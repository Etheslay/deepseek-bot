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
| D14 渲染片 + 交互片 | 已交付（mermaid 砍除，验收部分达成） | `feature/chat-experience` → `feature/settings-updates` → `0f20970` | [D14-report](reports/D14-report.md) |
| 头像打磨（Grok Ball 视线与节奏） | 已交付 | `feature/gaze-avatar` → PR #61 `cc4a379`、#62 `5533ea6` | [B-AVATAR-02-report](reports/B-AVATAR-02-report.md) |
| D25 全局搜索 | 已交付（host 检索按计划后接） | 同上 → `0f20970` | [D25-report](reports/D25-report.md) |
| D26 聊天附件 | **切片交付，任务未完成** | 同上 → `0f20970` | [D26-report](reports/D26-report.md) |
| D24 设置与更新 | **切片交付，任务未完成**（备份保险库见下一行） | 同上 → `0f20970` | [D24-report](reports/D24-report.md) |
| D24 备份/恢复与设置收尾 | **切片交付**：设置分区化（保险库/用量/电脑/更新全部真实可用）、`backups:list` 桌面通道（只读 manifest）、`data.restore` 后 Host 子进程重启、硬件加速偏好真实开关。实机安装版验证与更新链路仍 UNVERIFIED | `feature/settings-vault`（见 PR） | [D24-data-report](reports/D24-data-report.md) |
| D17 技能与模板 | **已交付（渲染层闭环）**：模板库 + 技能定义/复用/版本化 + 统一文件导入导出（契约校验）。工作流模板、Host 注入与能力强制留后续 | `feature/skills-templates` → `292c3b8`、PR #48 `2ecb2f9` | [D17-report](reports/D17-report.md) |
| D18 记忆写入 / 检索 / 删除 | 已交付 | `feature/memory-knowledge` → PR #57 `7de305b` | [D18-memory-report](reports/D18-memory-report.md) |
| D18 知识导入（.txt/.md，16 KiB 上限） | 已交付 | `feature/knowledge-import` → PR #59 `9805b6a` | [D18-knowledge-import-report](reports/D18-knowledge-import-report.md) |
| D18 独立知识表 + 本地向量检索 + 保留策略 | 已交付 | `feature/knowledge-base` → PR #63 `ae0c6be` | [D18-knowledge-search-report](reports/D18-knowledge-search-report.md) |
| D19 连接器登记与启停 | 已交付（自定义 MCP、凭据启用未做） | `feature/connector-registry` → PR #60 `20d3ab2` | [D19-connector-registry-report](reports/D19-connector-registry-report.md) |
| D19 连接器调用与本地 SD 生图 | 已交付（视觉理解未做） | `feature/connector-invoke` → PR #65 `73ae475` | [D19-connector-invoke-report](reports/D19-connector-invoke-report.md) |
| D20 事件自动化：触发规则与评审队列 | 已交付 | `feature/automation-triggers` → PR #66 `3afea90` | [D20-triggers-report](reports/D20-triggers-report.md) |
| D20 本地事件规则：保存/列出/启停，命中一次启动一个运行 | 切片交付（评审队列界面、聊天通知条、桌面屏幕未做） | `feature/event-automation-rules-844b` | [D20-event-rules-report](reports/D20-event-rules-report.md) |
| D20 本地事件评审：命中入队，批准启动一次，拒绝记跳过 | 切片交付（无桌面界面、无聊天通知条） | `feature/event-review-queue-0e27` | [D20-event-review-report](reports/D20-event-review-report.md) |
| D20 本地事件规则状态记录：启停与改为评审各记一条，可按 bot 列出 | 切片交付（无桌面界面、无聊天通知条） | `feature/event-rule-state-history-d3c8` | [D20-event-rule-state-report](reports/D20-event-rule-state-report.md) |
| D28 产物画布共编侧车 | 已交付 | `feature/canvas-cowrite` → PR #64 `2d5a5e3` | [D28-report](reports/D28-report.md) |
| D21 本地执行守护 | **切片进行中**：契约、Windows 后端与 Host 网关已在 develop；桌面设置页只做单窗口截图/OCR 的启用、选择、仅本次审批和本机预览。真实窗口、打包 Electron、GitHub Actions 未跑 | `feature/screen-desktop-settings-48af` | [D21-desktop-report](reports/D21-desktop-report.md) |
| D21 设备动作批准闸门 | **切片进行中**：默认关闭。策略为每次询问时，一次请求需要一次精确的仅本次审批才接受，结果只有 id 和时间。不移动鼠标、不发送按键、不调用 exec daemon。无单独桌面界面，无网络。真实键鼠与 GitHub Actions 未跑 | `feature/device-action-approval-ffd6` | [D21-device-action-report](reports/D21-device-action-report.md) |
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
| A4 | D19 连接器与 MCP | 登记与本地 SD 调用已合入（PR #65）；本分支交付无凭据本机 HTTP MCP 的按 bot 白名单、聊天单次审批与审计，见 [MCP 报告](reports/D19-mcp-http-report.md)。stdio、凭据注入和视觉接入待后续 |
| A5 | D20 事件自动化 | 评审队列已合入（PR #66）。本地自动启动切片：一个 bot 的规则可保存、列出、启停，默认关闭，命中一次启动一个运行（`feature/event-automation-rules-844b`）。本地评审切片：规则可设为评审，命中只入队，批准启动一次，拒绝记跳过（`feature/event-review-queue-0e27`）。状态记录切片：启用、停用或改为评审且状态变化时追加一条，按 bot 从新到旧列出（`feature/event-rule-state-history-d3c8`） |
| A6 | D21 本地执行守护 | 契约、Windows OCR 与 Host 网关已在 develop。桌面设置页提供默认关闭、逐次授权的单窗口截图和本机预览。设备动作第一片只在策略为每次询问时接受一次精确审批，并返回 id 与时间，不执行输入；真实窗口与真实键鼠未做 |

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
| 4 | 选项卡片 | bot 需要人类决策时渲染 A/B/C(/D) 卡片（问题 + 选项 + "其他，我说明"），点击即作为用户回答回写会话并推进流程 | D14 渲染 + D15 `ask_user` 能力 |
| 5 | 自动化状态通知条 | 例行任务的禁用/删除/错过以系统通知条出现在聊天内（"已禁用 例行任务 ⏰ …（已删除）"），不静默 | D20 × D14 通知条组件 |
| 6 | 交接摘要卡 | bot 间交付用结构化小结：目标 / 完成项 / 缺口 / 下一步负责人 | D14（模板化归 D17） |
| 7 | 头像自动分配 | 批量创建组内 bot 自动配**不重复**的形状×颜色，一眼区分成员；组合用尽才允许重复；用户显式指定时以用户为准 | D15 写层 |
| 8 | 用户气泡随 bot 色 | 用户发送气泡的颜色跟随当前会话 bot 的主题色（选粉色 bot 即粉色系），强化"在和谁说话"的情境感 | D14 |

> 复刻优先级：4（选项卡片）> 3（提及跳转）> 1/2（交付与定向）> 8（气泡随 bot 色）> 7（头像分配）> 5/6（随 D20/D17 顺带达成）。

## 7. 界面占位审计（D00–D12 未兑现项）

对当前桌面界面的逐区域审计：凡是 D00–D12 交付后仍是占位/假控件/夹具数据的能力，登记去向。新任务编入 [开发计划](DEVELOPMENT_PLAN.md) §6；用户气泡颜色等交互项并入 D14。

| 区域 | 占位 / 未实现 | 现状 | 去向 |
| --- | --- | --- | --- |
| 聊天 | 用户气泡颜色 | **已实现**：气泡按当前会话 bot 着色（D14 交付时未做，由 `fix/chat-user-bubble-bot-color` 补齐） | ~~D14~~ 已完成，见 [D14-report §5](reports/D14-report.md) |
| 聊天 | 回复仍是"（占位回复）"夹具数据；横幅标注"静态占位" | 真实链路只接了运行监控，chat.* 仍夹具 | [Renderer↔Host 映射](RENDERER_HOST_MAPPING.md) 方案 D→B（待两负责人拍板，挂冲刺队列） |
| 聊天 | ＋ 菜单"添加附件" | 点击仅提示占位 | **D26**：附件经网关进工作区 |
| 聊天 | 麦克风按钮 | 占位 | 候选（STT 方案未定，不入 v0.2 承诺） |
| 顶栏 | 搜索圆钮 | 未实现 | **D25** 全局搜索（Ctrl+K） |
| 顶栏 | 最近会话 / 产物 popover | 夹具数据 | 同上，随 Renderer↔Host 方案真实化 |
| 设置 | 分类"电脑 / 保险库 / 用量与账单 / 更新" | 占位禁用 | **D24**：数据备份恢复（data.* 契约已备）、本地用量统计、应用内更新 |
| 设置 | 强调色 / 语言 / 硬件加速 / 通知 | 强调色、语言、通知已实现 | **D24**（强调色、持久化）+ **D22**（语言切换、通知设置、托盘、Chrome 书签导入）；硬件加速仍为「后续提供」 |
| 设置 | API Key 保存 / 测试连接 | 夹具内存实现 | 同上，随 Renderer↔Host 方案真实化（safeStorage 通道 D12 已备） |
| 设置 | 全部设置项不持久化 | 重启即失 | **D24**：写本地存储 |
| 侧栏 | 账户"退出登录" | 占位（无账号体系） | 维持占位（边界：不引入账户体系），D26 改为"本地资料"卡片 |
| 全局 | bot / 分组 / 会话状态持久化 | 界面态重启即失 | Renderer↔Host 方案 B（ui.* 会话服务）+ D24 |

## 8. 待拍板事项

| # | 事项 | 需要 | 状态 |
| --- | --- | --- | --- |
| 1 | Renderer↔Host 真实数据接线方案（A/B/C/D 或组合） | 两负责人按 [映射提案](RENDERER_HOST_MAPPING.md) §3 达成一致 | 待拍板（提案推荐 D→B 两步） |
| 2 | mono-shape 头像线与 develop 头像线（PR #18/#19）的分叉合并策略 | Destinyian 定基准 | 待拍板（阻塞该分支 PR） |

## 9. 对标缺口盘点（Grok Bot · GitHub 分发 · 本地优先）

状态：盘点稿。定位红线先说死：

- **分发与更新**：只走 GitHub Releases 安装包（D11 管线产出 exe + SHA-256 + 发布说明）；**应用内更新** = electron-updater 以 GitHub Releases 为源（免费第三方基础设施，非自有服务）：启动时静默检查 → 左下角更新按钮/徽标 → 点击下载重启安装；不建自有下载站与更新服务；
- **消费**：用户的**唯一持续成本是模型 Token**（DeepSeek API 现状）。零云存储、零订阅、零托管服务、零遥测；
- **一切联网** = 用户本机直连第三方（自带 Key，与调 DeepSeek API 同性质）；**一切数据** = 本地；
- **立项检查问题**："这个能力除了 Token 还要让用户为什么付钱吗？"——答非"否"即出局，或必须同时提供零成本本地路径。

### 9.1 可提前进 v0.2 的快赢

| 项 | 说明 | 建议落点 |
| --- | --- | --- |
| 深度思考开关 | DeepSeek reasoner 按会话切换（仅改 modelProfile，不破契约） | 并入冲刺三的小任务 |
| 重新生成 / 编辑重发 | 聊天标配 | 并入 D14 聊天体验 |
| 对话导出 | 导出 Markdown / 图片到本地文件 | 并入 D24 设置与更新 |
| 附件理解闭环 | bot 经 read 工具真正读取附件内容并回答（不只上传） | D26 验收扩充 |

### 9.2 v0.3 候选池（需方案评审，全部守住消费红线）

第一档四项已升格并入正式任务：**联网搜索 → D15、语音模式 → D27、Canvas 共编 → D28、图像生成 → D19**（见 [开发计划](DEVELOPMENT_PLAN.md) §6，安排在冲刺五/八/九/十）。本表保留尚未立项的候选：

| 项 | Grok 表现 | 零订阅本地方案 | 主要约束 |
| --- | --- | --- | --- |
| 弹出式多窗口 | 多会话并行 | 对话独立成窗，呼应 DSH 多窗工作流 | 桌面线大件 |
| 视觉理解 | 看图对话 | DeepSeek 视觉模型可用后接入（仍是 Token 消费，符合红线） | 模型可用性 |

> 模型供应商锁定 DeepSeek（契约 v0.1 即锁定，见 [CONTRACTS](CONTRACTS.md) §2），不做多供应商/本地多模型；模型侧演进跟随 DeepSeek 官方（如 reasoner、视觉模型），仍只是 Token 消费。

### 9.3 永不做（定位红线）

自有云服务、云存储、账户体系、计费系统、订阅制依赖、遥测上报、远程中继、模型托管。发现任何"必须付 Token 以外的钱才能用"的能力，一律不立项或必须先给出零成本本地等价路径。

## 10. 在途分支台账（2026-10-27 清点）

清点基线：`origin/develop` = `3afea90`（PR #66 合入后）。冲突结论来自 `git merge-tree --write-tree origin/develop <分支>` 的**试算**，不代表已解决；每次合并后本节需更新。

各任务使用独立工作区（`git worktree list`）：`deepseek-bot-d22` → D22 系统集成、`deepseek-bot-d24` → 备份保险库、`deepseek-bot-d28` → 画布共编（**已合入，工作区待清理**）、`deepseek-bot-g5` → 深度思考开关、`deepseek-bot-manager-orchestration` → v0.5 编排；另有 `deepseek-bot-avatar-ball`、`deepseek-bot-reaction-pill` 两个 10-25 的**死工作区**（分支早已合入，可直接 `git worktree remove`）。

| 分支 | 归属 | 未合入提交 | 推送状态 | 与 develop 试算 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `feature/reasoner-toggle` | §9.1 快赢「深度思考开关」 | 1（6 文件） | 已推送 | **零冲突** | 可直接开 PR，最小最先 |
| `feature/settings-vault` | D24 备份保险库 + 真实设置分区 | 3（23 文件） | 已推送 | **零冲突** | 可开 PR；合入后 D24 由"切片交付"升级为更接近完成 |
| `feature/choice-card-answer` | 选项卡片回传 + 记忆弹窗移出聊天流 + 主窗口显示修复；**正在合入技能选择器菜单** | 5（17 文件）+ 合并中 | **仅本地**（跟踪 origin/develop） | 主工作区当前处于**未完成的合并**：`App.tsx`、`styles.css` 为 UU，`skill-store.ts` 与其测试已暂存 | 先完成或 `git merge --abort`，再推送开 PR |
| `backup/pre-ui-merge` | 与上一行**完全相同的 5 个提交** | 5 | 仅本地 | — | 纯备份；`feature/choice-card-answer` 合入后删除 |
| `feature/gaze-avatar`（本地多出的 1 个提交 `e7b83f3`） | 技能选择器菜单与版本化提示词复用（D17 后续，**与分支名无关**） | 1（4 文件） | 远端同名分支已合入并删除 | 与 `feature/choice-card-answer` 相撞（`styles.css`） | 正被合进 `feature/choice-card-answer`（见上一行）；若放弃该合并，则摘出另开 `feature/skills-composer-menu` |
| `feature/system-integration` | **D22 系统集成与双语**（zh/en 词典、每 bot 托盘、系统通知、Chrome 导入） | 9（104 文件） | **从未推送** | 冲突 7 文件：`main/index.ts`、`App.tsx`、`avatar-picker.tsx`、`permission-chat.tsx`、`permissions-panel.tsx`、`fixture-service.ts`、`styles.css` | 最高优先：**先推送留痕**（当前只存在于这台机器，磁盘一坏就没了），再 sync develop 解冲突、开 PR |
| `feature/manager-orchestration` | v0.5 协调者编排（契约 + agent-tools + storage + host + desktop + 文档） | 6（63 文件） | 已推送 | 冲突 7 文件，含 `docs/CONTRACTS.md`、`contracts/methods.test.ts`、`host.ts`、`storage/database.ts` | 契约面变更：按 DEVELOPMENT_PLAN §1 先出契约小 PR 与 ADR 对齐 v0.5 范围，再解冲突；排在上述之后 |
| `feature/mono-shape` | 头像支线遗留 | 远端 1 / 本地 2 | 本地 `cf661c0` 未推送 | 冲突 4 文件（头像组件） | 仍等 §8 待拍板 #2；决定后要么推送并解冲突重开 PR，要么丢弃 |

建议合入顺序（每条都要按规范填自审结论再合，不代签）：

1. `feature/reasoner-toggle` —— 最小、零冲突；
2. `feature/settings-vault` —— 零冲突，补 D24 欠账；
3. `feature/choice-card-answer` —— 零冲突，含记忆弹窗移出；合入后删 `backup/pre-ui-merge`；
4. `feature/skills-composer-menu`（从 gaze 分支摘出）—— 解 `styles.css` 冲突；
5. `feature/system-integration` —— **先推送**，再解 7 文件冲突，这是 D22 主体；
6. `feature/manager-orchestration` —— 先定 v0.5 契约范围与 ADR；
7. `feature/mono-shape` —— 等 §8 待拍板 #2。

另记的欠账：

- 未入库文档：`docs/GAP_AUDIT.md`、`docs/TASK_MANAGER_ORCHESTRATION.md` 目前只是主工作区的未跟踪文件，需随相应分支入库；
- 工作区垃圾：主工作区根目录有一个 0 字节的 `$null` 文件（10-26 17:35 由误用的重定向产生），可直接删除；
- 死工作区：`deepseek-bot-avatar-ball`、`deepseek-bot-reaction-pill`、已合入的 `deepseek-bot-d28` 三个工作区可清理（先确认其中没有未跟踪的截图或日志）；
- 手测截图：D14 / D17 / D24 / D25 / D26 的 `reports/assets/…` 仍缺；
- 未完成的计划项：**D21 本地执行守护**（Etheslay：桌面设置页在功能分支；设备动作批准闸门在 `feature/device-action-approval-ffd6`，真实窗口与真实键鼠未做）、**D23 平台验收**（你，依赖 D13 与 D14–D22 全部完成）。


