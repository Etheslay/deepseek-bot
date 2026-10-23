# 贡献与协作指南

本项目由 Etheslay、Destinyian 协作。开始前阅读 [Git 工作流](docs/GIT_WORKFLOW.md)、[任务表](docs/DEVELOPMENT_PLAN.md)和[接口契约](docs/CONTRACTS.md)。

## 当前阶段

目前只有规范与设计，没有应用源码、依赖安装或构建脚本。不要尝试执行尚未定义的启动/测试命令，也不要将文档检查结果描述为应用已通过验收。

## 开始一个任务

1. 在任务表中找到编号、负责人、依赖和验收条目；用 feature_task 模板创建 Issue。
2. 确认依赖 PR 已合入 develop 且检查通过。为本任务从 develop 创建 `feature/<task>`。
3. 使用本人 Git 身份及独立工作目录；变更公共契约或依赖前通知另一位开发者并在 Issue 记录。
4. 每次提交围绕一个意图；不要包含 Key、聊天数据、备份、构建缓存或本机路径配置。

## 提交 PR

使用 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)，关联 Issue，说明可观察行为变化与测试结果。默认 base=develop，非作者是审查人；release/hotfix 按 Git 工作流办理。UI 提交附关键状态截图，runtime 提交附可复现步骤和脱敏日志。

检查项必须如实标记；未执行写明原因。审批过期或新增提交后重新审查，不使用机器人审批替代另一位真人。

## 开发环境基线（待 D01/D02 固定）

建议 TypeScript 严格类型检查、pnpm 单一锁文件、Electron/React 桌面。上游工具链要求见 [Harness 接入](docs/HARNESS_INTEGRATION.md)；选定确切版本后记录在项目配置与锁文件，禁止两人各自漂移。

后续在本节补充经干净环境实际验证的安装、启动、lint、typecheck、test、e2e、package 命令和平台依赖。没有对应脚本前，不把计划命令写成可运行说明。

## 评审与集成

先检查需求、权限/数据边界和错误恢复，再检查可维护性与风格。评审意见指向文件、问题、影响和可验证的修正。不能以个人风格替代已接受的团队约定。

通过[质量门槛](docs/TESTING.md)后用 merge commit 合并；作者不能自审放行。交付产物与文档同步更新，删除已完成 feature 分支，保留 Issue/PR 关联。

## 缺陷和设计变更

缺陷使用 bug_report 模板；含敏感数据的问题先提供脱敏重现。改变平台、技术栈、默认权限、数据格式或性能预算时新增/更新 ADR，由双方评审。发布流程见 [RELEASE.md](docs/RELEASE.md)。
