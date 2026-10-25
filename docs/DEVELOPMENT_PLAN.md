# 双人开发任务与里程碑

日期：2026-10-22。状态：计划，所有 Dxx 开发任务尚未开始。开发者：Etheslay、Destinyian。

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

## 6. 阶段二任务清单（v0.2，D13 通过后启动）

下表所有任务从 D13 合并后的 `develop` 创建独立 feature 分支，目标均为 `develop`。阶段二只做本地单机能力，云端、计费、遥测与远程中继不在范围内。契约与依赖变更仍先走小型独立 PR（见 [Git 工作流](GIT_WORKFLOW.md)）。

| 任务 / 分支 | 负责人（开发与自审） | 依赖 | 交付与验收 |
| --- | --- | --- | --- |
| D14 `feature/chat-rendering` | Destinyian | D05 | 聊天内 Markdown、代码高亮、KaTeX、流程图与产物预览；资源全部本地打包，不请求远程 CDN |
| D15 `feature/agent-tools` | Etheslay | D08、D12 | 工具网关与读写工具（读现状、建设计稿）；聊天可生成创建草案，暂不落库；审计字段预留 |
| D16 `feature/permissions-grants` | Etheslay | D08、D15 | capability/grant/审批三层模型；设置页三档策略；聊天内授权与撤销；审计可查（见 [权限与授权](PERMISSIONS.md)） |
| D17 `feature/skills-templates` | Destinyian | D05、D15 | 技能定义与复用、bot 模板与本地模板库；导入导出走契约校验 |
| D18 `feature/memory-knowledge` | Etheslay | D04、D15 | 记忆写入与检索、知识导入；用户可查看与删除；默认不跨 bot 共享 |
| D19 `feature/connectors-mcp` | Etheslay | D08、D15 | 连接器注册与生命周期、自定义 MCP、凭据引用托管；调用受 grant 与审批约束 |
| D20 `feature/automation-triggers` | Etheslay | D10、D15 | 事件触发与规则、评审队列；重复触发防护；错过触发可见 |
| D21 `feature/local-exec` | Etheslay | D08、D15 | 本地执行守护、窗口截图与 OCR、设备动作；默认关闭，逐次授权，产物只存本地 |
| D22 `feature/system-integration` | Destinyian | D02、D11 | 每 bot 托盘图标、Chrome 数据导入、通知设置、中英双语；不引入账户体系 |
| D23 `feature/platform-acceptance` | Destinyian 主责，Etheslay 复核 | D13、D14–D22 | 对标矩阵、性能预算、可访问性与发布门槛；无 P0/P1；证据与结论一致 |
| D24 `feature/chat-interactions` | Destinyian | D05、D14、D15 | bot 内联提及（彩色 @name，点击直达该 bot）、多 bot 交付通知（头像栈可点）、定向回复（“已只回某 bot”路由可见）、选项卡片（A/B/C/D 决策卡，点击即回答并回写会话）、自动化状态通知条；卡片组件供 D16 授权弹层复用 |

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

阶段二按**双人并行、一晚一个冲刺**的方式执行：切片、分工、时间线与验收见 [冲刺计划](SPRINTS.md)。冲刺只做排期切片，不改本表的任务编号、负责人与验收语义；契约与依赖变更仍按 §1 协作区规则走小型独立 PR。
