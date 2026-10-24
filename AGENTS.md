# 项目协作约束

## 当前授权范围

当前阶段仅项目规范化和开发文档。没有应用实现请求时，不创建应用源码、安装应用依赖或发起付费 API 请求。以用户后续明确指令调整范围。

## 项目约束

- 产品基于真实 DeepSeek Harness；运行、数据在本机，允许 DeepSeek API。
- 开发者为 Etheslay、Destinyian；每项任务由负责人自行审查并记录结论，AI 辅助不能冒充真人身份或伪造自审记录。
- 优先读取 README、docs/DEVELOPMENT_PLAN.md、docs/GIT_WORKFLOW.md 与相关契约。
- 每项任务独立 feature 分支；日常开发不得直接提交 main / develop。
- main 仅接收经审查和发布验证的 release/hotfix；初始化空提交不代表发布。
- 规范来源分支为 feature/project-standards，集成到 develop 后后续任务仍须使用各自的 feature 分支；文档中的后续开发分支是计划，不能声称已实施。
- 共享契约、依赖、迁移和安全策略变更由负责人自行审查并同步影响；不强制另一人批准，保留 merge commit 历史。
- 自审覆盖最新提交及相关测试、错误路径和兼容性；PR 清单记录提交 SHA、检查结果与结论。新增提交后更新自审记录。
- GitHub 审查配置以零个必需批准为准，关闭 code-owner 审批与最后推送需他人批准；保留 PR、测试和发布门槛。
- 不覆盖用户工作，不泄露 Key，不提交本机运行数据，不通过更换作者伪造两人协作。
- 未运行检查不能声称通过；缺少运行时、凭据或签名时明确列为未验证。
- 记录 GitHub 保护规则是否实际启用；CODEOWNERS 和规范文件不等于服务端强制保护。

详见 CONTRIBUTING.md 和 docs/REPOSITORY_SETUP.md。
