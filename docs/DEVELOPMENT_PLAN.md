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
