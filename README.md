# DeepSeek Bot

基于 DeepSeek Harness 的本地桌面机器人与工作流应用。目标是提供接近 Grok Bot 的机器人协作体验，让用户在自己的电脑上创建机器人、交办任务并组织可重复执行的工作流。

**当前阶段：运行时、存储、桌面与工作流基础已落地；D15 工具后端、D16 权限后端与界面、D17 渲染层技能库已集成。本功能分支打通真实聊天应用工具的授权闭环，证据见 [D16 Harness 工具报告](docs/reports/D16-harness-tools-report.md)。发布与完整产品验收尚未完成。**

## 已确定的产品边界

- 桌面应用、工具执行、机器人配置、会话及工作流数据位于用户本机。
- 允许调用 DeepSeek API；模型请求中的提示词、上下文和工具结果可能发送给模型服务。
- 不依赖云电脑、产品云端数据库或产品账号系统。
- 开发者为 **Etheslay** 与 **Destinyian**；各任务独立分支、负责人自行审查、先集成后发布。
- 当前处于功能开发与集成验证阶段；各项完成范围以提交记录和任务报告为准。

## 文档入口

| 文档 | 解决的问题 |
| --- | --- |
| [产品需求](docs/PRODUCT_REQUIREMENTS.md) | 目标用户、功能边界、竞品对应关系、验收场景 |
| [技术架构](docs/ARCHITECTURE.md) | 桌面、运行时、存储和工作流的职责与数据流 |
| [技术选型记录](docs/adr/0001-desktop-and-runtime.md) | Electron、Tauri 与复用上游桌面的权衡 |
| [智能体平台](docs/AGENT_PLATFORM.md) | v0.2 的聊天驱动创建、技能、连接器与执行边界 |
| [权限与授权](docs/PERMISSIONS.md) | 能力/授权/审批三层模型与设置页 |
| [Harness 接入](docs/HARNESS_INTEGRATION.md) | 已核实能力、接入验证、版本固定与升级 |
| [接口与数据契约](docs/CONTRACTS.md) | 两人并行开发的边界、实体、事件和错误语义 |
| [双人开发计划](docs/DEVELOPMENT_PLAN.md) | 每项任务的负责人、分支、依赖及完成标准 |
| [Git 工作流](docs/GIT_WORKFLOW.md) | main、develop、feature、release、hotfix 的规则 |
| [测试策略](docs/TESTING.md) | 单元、集成、端到端、性能与打包验收 |
| [发布与回滚](docs/RELEASE.md) | 可发行定义、发布门槛、版本号和热修复 |
| [本地数据与权限](docs/SECURITY_DATA.md) | 数据目录、密钥、工具权限、备份与删除 |
| [仓库设置清单](docs/REPOSITORY_SETUP.md) | GitHub 权限、保护规则和当前配置状态 |
| [开发启动清单](docs/KICKOFF_CHECKLIST.md) | 阶段 0 清障、D01 接入验证与后续任务链的执行顺序 |
| [开发环境基线](docs/DEVELOPMENT_SETUP.md) | 实测的 Node/pnpm 安装与 lint/typecheck/test/CI 命令 |
| [开放缺陷收口](docs/TASK_OPEN_DEFECTS.md) | `develop` `030c54d` 上已坐实的行为缺口、已知取舍，以及不得当成缺陷的未验收项 |
| [桌面壳](docs/DESKTOP_SHELL.md) | Electron 壳结构、启动/打包命令、IPC 白名单与安全设置 |
| [贡献指南](CONTRIBUTING.md) | 每次开发开始和结束时的操作步骤 |

## 合作约定

Etheslay 负责运行时与本地数据，Destinyian 负责桌面产品与交互；每位负责人自行开发、测试和审查，在 PR 中记录自审结论后按门槛合并，无需等待另一人批准。详细任务分支见[开发计划](docs/DEVELOPMENT_PLAN.md)。GitHub Issue 的实际认领和自审记录需由对应账号完成，本文档不代表这些活动已经发生。

`main` 表示生产基线，`develop` 表示开发集成。功能通过 `feature/* → develop`；可发行版本通过 `release/* → main`，并回合 `develop`；紧急修复通过 `hotfix/*`。空仓库的初始空提交只是分支锚点，不是产品发布。

## 阅读与开始开发

先读产品需求、开发计划和 Git 工作流。技术选型与首发 Windows x64 是当前建议基线，在 D00 任务中由负责人自审并同步结论。应用命令与桌面壳见[开发环境基线](docs/DEVELOPMENT_SETUP.md)与[桌面壳](docs/DESKTOP_SHELL.md)；安装包与发布流水线将在 D11 建立。

本仓库未为自有代码选定开源许可证。采用上游代码时需保留其许可及第三方声明；项目自身许可证由维护者在首次对外发布前决定。

## 参考资料

- [项目远程仓库](https://github.com/Etheslay/deepseek-bot)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Grok Bot 官方指南](https://x.ai/bot/guides/grok-bot-101)

调研基线与来源见 [Harness 接入](docs/HARNESS_INTEGRATION.md)；上游能力不自动等于本项目已实现能力。

