# Git Flow 与审查规范

本规范落实用户要求：每部分独立分支，经测试审查进入 develop，只有可构建、可发行版本进入 main。

## 1. 分支与来源

```text
main                         生产版本
├── develop                  开发集成
│   ├── feature/<task>        一个任务一个分支
│   └── feature/<task>
├── release/vX.Y.Z            从 develop 建立的发布候选
└── hotfix/vX.Y.Z             从 main 建立的线上修复
```

上图表示分支用途；release 实际从 develop 分出。`feature/login`、`feature/payment`、`feature/dashboard` 只是用户给出的命名示例，不为本项目创建空功能。

| 类型 | 基线 | PR 目标 | 约束 |
| --- | --- | --- | --- |
| feature/* | 最新已通过检查的 develop | develop | 一个任务；负责人完成自审记录；相关测试通过 |
| release/vX.Y.Z | 已达到发布范围的 develop | main；合入后回合 develop | 冻结新需求，仅修复/版本/文档；完整发布验收 |
| hotfix/vX.Y.Z | main 或对应生产 tag | main；合入后回合 develop/活跃 release | 同样审查与打包验证，不能以紧急为由绕过 |
| develop | 初始化基线 | 仅通过 release 进入 main | 不直接推送日常开发代码 |
| main | 初始化基线 | 无 | 不接受 feature/develop 的直接 PR；仅接受 release/hotfix |

发布冻结后的修复先从 develop 建普通 feature，经测试和审查合入 develop；如 release 需要该修复，再从 release 建 `feature/release-fix-<issue>`，仅移植已审查提交并通过 PR 回到该 release。这是同一修复的选择性回合，不能在该分支新增未进入 develop 的功能。hotfix 则按生产紧急修复路径先进入 main 再回合。

## 2. 空仓库初始化

空仓库允许建立**不含文件的初始空提交**，作为 main、develop 的共同分支锚点。这是 Git 初始化元数据，不是已发布生产版本，不打版本 tag。规范文档和协作模板放在 `feature/project-standards`，经负责人自行审查及相关检查后通过 PR 合入 develop。

main 在首次 release 验收前保持空锚点；禁止为了让首页显示 README 把开发文档/功能先行合到 main。GitHub 默认分支建议在开发阶段设为 develop，并在发起 PR 时始终检查目标分支。缺少合并权限时保留 feature 并记录阻碍，不伪造自审记录或绕过保护。

## 3. 开发操作示例

以下命令供开发开始后执行，不代表本次已经执行了每一步。

```sh
git fetch origin --prune
git switch develop
git pull --ff-only origin develop
git switch -c feature/workflow-engine
# 完成该任务、相关测试与文档后提交
git push -u origin feature/workflow-engine
```

创建 PR：base=`develop`，head=`feature/workflow-engine`；填写任务、行为变化、验证证据和风险，由作者自行审查。不同开发者分别使用真实个人 Git 身份，不能互相冒用 author 或伪造审查记录。

同一台电脑并行开发时，每个任务使用独立 worktree/clone，不在同一工作目录来回切分支。临时 `.worktrees/` 不进仓库。独占本人的尚未共享分支可 rebase；共享分支优先 merge develop，不能强推覆盖对方历史。

## 4. 合并与审查

- 长期分支和 release/hotfix 使用 `--no-ff` / GitHub Create a merge commit，保留来源；关闭 Squash / Rebase merge 以统一策略。
- 不启用 Require linear history，因为它与保留 merge commit 冲突。
- 每项任务由负责人自行审查，PR 不要求他人批准；作者完成最新提交的自审记录后，可在全部门槛通过时合并自己的 PR。
- 新提交后更新自审 SHA、检查证据和结论；必须解决讨论、通过必需检查、同步基线后才合并。
- 不允许强推/删除 main、develop；禁止普通直推；管理员也适用规则，正式应急操作留记录。
- feature 合并后删除；release/hotfix 在 main 合并及开发线回合完成后删除。tag 和发布记录保留。

GitHub 不允许作者批准自己的 PR，因此自审采用 PR 描述/评论中的记录，不要求自己提交 Approve。记录至少包含自审人、提交 SHA、日期、差异检查结果、测试证据、遗留问题和结论；新增提交后旧记录不代表最新内容已检查。[GitHub 官方说明](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)。

CODEOWNERS 保留说明但不配置活动匹配规则，避免自动请求另一人审查。保护规范设置必需批准数为 0，关闭 code-owner 审批和最后推送需他人批准；保留 PR、状态检查、讨论解决和禁止强推。自审记录的真实性由负责人负责，当前没有 CI 强制验证该记录；来源限制还需要 CI / ruleset，详见[仓库设置](REPOSITORY_SETUP.md)。

## 5. 提交信息

采用 Conventional Commits：`feat`、`fix`、`docs`、`test`、`refactor`、`perf`、`build`、`ci`、`chore`、`revert`。标题建议不超过 72 字符，描述单一意图；破坏性变更用 `!` 和正文 `BREAKING CHANGE`。涉及迁移、权限或回滚必须说明影响和原因。

示例：`feat(runtime): add workflow cancellation`、`docs: define two-developer workflow`。提交只使用实际操作者已配置身份；记录任务负责人及其自审结论，协作者按实际贡献记录，不伪造 Co-authored-by。

## 6. 发布与热修复

release 从 develop 冻结，最终候选通过[发布标准](RELEASE.md)后 PR 到 main，合并后打对应 tag。将合并后的 main 通过回合 PR 合入 develop（以及需要修复的活跃 release）；回合是同一补丁的同步，不是新功能。每次回合仍需回归和该 PR 负责人的自审。

hotfix 从生产 main/tag 开始；修复、回归、打包和审批后进入 main 并发布补丁版本，再同样回合。禁止只修 main 而遗漏开发线。
