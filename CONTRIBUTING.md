# 贡献与协作指南

本项目由 Etheslay、Destinyian 协作。开始前阅读 [Git 工作流](docs/GIT_WORKFLOW.md)、[任务表](docs/DEVELOPMENT_PLAN.md)和[接口契约](docs/CONTRACTS.md)。

## 当前阶段

D00 已建立共享工程基线（workspace、lint/typecheck/test、Windows CI）。仍无应用产品功能与 Electron 壳；不要将文档检查或基线测试结果描述为产品已通过验收。可运行命令见 [开发环境基线](docs/DEVELOPMENT_SETUP.md)。

## 开始一个任务

1. 在任务表中找到编号、负责人、依赖和验收条目；用 feature_task 模板创建 Issue。
2. 确认依赖 PR 已合入 develop 且检查通过。为本任务从 develop 创建 `feature/<task>`。
3. 使用本人 Git 身份及独立工作目录；变更公共契约或依赖时在 Issue 记录并同步影响，信息同步不作为等待他人批准的合并门槛。
4. 每次提交围绕一个意图；不要包含 Key、聊天数据、备份、构建缓存或本机路径配置。

## 提交 PR

使用 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)，关联 Issue，说明可观察行为变化与测试结果。默认 base=develop，作者自行审查；release/hotfix 按 Git 工作流办理。UI 提交附关键状态截图，runtime 提交附可复现步骤和脱敏日志。

检查项必须如实标记；未执行写明原因。自审记录包含最新提交 SHA、日期、检查证据、遗留问题和结论；新增提交后重新检查并更新记录。可以使用自动化或 AI 辅助检查，但负责人对最终自审结论负责。

## 开发环境基线

工程底座（pnpm workspace、TypeScript 严格模式、ESLint/Prettier、Windows CI）已由 D00 落地。安装、日常命令与 Windows 注意事项见 [开发环境基线](docs/DEVELOPMENT_SETUP.md)。

上游 Harness 工具链要求仍见 [Harness 接入](docs/HARNESS_INTEGRATION.md)。应用启动、e2e、打包命令将在 D01/D02 落地后补充到该文档；在对应脚本存在前，不要把计划命令写成可运行说明。


## 评审与集成

先检查需求、权限/数据边界和错误恢复，再检查可维护性与风格。评审意见指向文件、问题、影响和可验证的修正。不能以个人风格替代已接受的团队约定。

完成最新提交的自审并通过[质量门槛](docs/TESTING.md)后，作者可用 merge commit 合并自己的 PR，无需他人批准。交付产物与文档同步更新，删除已完成 feature 分支，保留 Issue/PR 关联。

## 缺陷和设计变更

缺陷使用 bug_report 模板；含敏感数据的问题先提供脱敏重现。改变平台、技术栈、默认权限、数据格式或性能预算时新增/更新 ADR，由变更负责人自审并同步影响。发布流程见 [RELEASE.md](docs/RELEASE.md)。
