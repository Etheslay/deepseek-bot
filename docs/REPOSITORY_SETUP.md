# 仓库规范化设置与状态

更新日期：2026-10-23。仓库：[Etheslay/deepseek-bot](https://github.com/Etheslay/deepseek-bot)。

## 1. 初始核查

本地仓库初始为空、没有提交、分支名 master、未配置 origin。SSH 只读探测成功，远程没有任何分支或标签。GitHub 连接器对本仓库返回 404，因此尚不能用该连接器检查权限、创建 Issue/PR 或启用保护规则；不能据此判断仓库不存在。

## 2. 本次设置范围

| 项目 | 状态 |
| --- | --- |
| 产品、架构、接口、分工、测试、发布文档 | 随本次集成提交进入 develop；用户已在会话中授权合并，文档检查通过 |
| README / CONTRIBUTING / AGENTS | 随本次集成提交进入 develop |
| CODEOWNERS / PR / Issue 模板 | 文件随本次集成提交进入 develop；CODEOWNERS 无活动规则；GitHub 模板展示尚未验证 |
| .editorconfig / .gitattributes / .gitignore | 随本次集成提交进入 develop |
| main / develop / feature/project-standards | main 保持空起点 6240da3；develop 保存集成结果；规范来源提交为 bd2946b |
| origin 与 SSH | 已配置 git@github.com:Etheslay/deepseek-bot.git；SSH 只读访问已验证 |
| 远程分支与首次推送 | main、develop、feature/project-standards 已创建，初始文档提交 c31755f 已核验 |
| Issue 分派、PR 创建与审查 | D00 Issue 已由负责人创建并填写确认与自审（链接待补记）；PR #2（启动清单）与 PR #3（契约冻结）已按"0 必需批准 + 负责人自审记录 + merge commit"合并 |
| GitHub 默认分支 | 已改为 develop（2026-10-23 ls-remote 核验 HEAD 指向 develop 合并提交 018258c） |
| GitHub 合并选项、成员权限、保护规则 | 合并选项仅保留 Create a merge commit（合并界面核验无 Squash/Rebase）；协作者权限由负责人在界面维护；规则集 protected-branches 已建立但因免费私有库套餐不强制执行（见 2.1） |
| 产品 CI、应用测试、安装包和版本 tag | 未建立/未生成 |

规范文件不能代替 GitHub 服务器设置。用户已明确授权将本次规范合并到 develop；GitHub 连接器仍返回 404，本次通过本地 merge commit 与 SSH 普通推送完成集成，没有创建 PR 或伪造真人审批。合并包含来源 bd2946b 及本文件等集成状态记录，具体提交与远程同步以 Git 历史为准。main 不纳入此次合并；后续开发继续遵循 PR、自审、测试和发布规范。GitHub 保护规则当时未实际启用或修改（当前强制状态见 2.1）。

### 2.1 服务端强制状态（2026-10-23）

- 规则集 `protected-branches` 已建立：目标 main、develop、release/**、hotfix/**；必需 PR、必需批准数 0、要求解决讨论、禁强推、禁删除，无 bypass；§3 第 3/5/6 项已在界面执行。
- 仓库为私有且当前为免费方案，GitHub 明示规则集在该私有仓库不强制执行；探针实测（2026-10-23 推送 release/probe-test 被接受）证实未强制。保护要求目前为流程约定，服务端未强制；规则集配置保留，仓库转公开或升级套餐后自动生效，届时重跑探针 A/B。
- 已核验生效项：默认分支 develop；合并选项仅 merge commit（PR #2、#3 以双父 merge commit 合入，Squash/Rebase 在界面不可用）。
- 来源限制（PR head/base 校验）依赖 CI，尚未建立，保持流程约定；在服务端强制生效前，有写权限的账号技术上仍可直推 protected 分支，依靠流程纪律约束。
- 提交身份事件：2026-10-23 发现 feature/project-standards 上两个非本人操作的误署名提交（署名 Destinyian），已从远程回退至已合并基线 bd2946b，内容在本地存档（archive/stage-plan-proposal）待讨论；身份来源待核实，方案内容讨论后如需入库须以真实作者身份重做。

## 3. 仓库管理员设置清单

由 Etheslay 作为预期仓库维护者执行；实际管理员身份需 GitHub 验证。Destinyian 至少需要明确的 Write 权限。不要默认 CODEOWNERS 已赋予协作者权限。

1. 已完成：首次推送 main/develop 的初始化锚点及 feature/project-standards，已核实未覆盖既有远程历史。
2. 邀请/核实 Destinyian 的协作者写权限，设置开发阶段默认分支为 develop。
3. 打开 Create a merge commit；关闭 Squash merging / Rebase merging；不要启用 linear history。
4. 本次规范集成由用户直接授权，文档检查与合并记录保存在会话、progress.md 和 Git 历史中。后续 PR 由负责人自行审查并记录最新 SHA；不需要指定另一位审查人。模板展示受 GitHub 默认/目标分支规则影响，实际展示需单独核验。
5. 为 main、develop、release/*、hotfix/* 建立保护规则；不能只保存处于 disabled/evaluate 状态的 ruleset。
6. 将必需批准数设为 0，关闭 code-owner 审批、最后推送需他人批准及旧批准撤销选项。保留 PR、必要状态检查、讨论解决与禁止强推，不依赖 CODEOWNERS 作为合并门槛。

## 4. 保护要求

| 设置 | main | develop | release/* / hotfix/* |
| --- | --- | --- | --- |
| 修改必须通过 PR | 是 | 是 | 是，创建分支后保护后续更新 |
| 必需批准数 | 0 | 0 | 0 |
| Require review from Code Owners | 关闭 | 关闭 | 关闭 |
| Require approval of most recent reviewable push | 关闭 | 关闭 | 关闭 |
| Dismiss stale approvals | 关闭 | 关闭 | 关闭 |
| 负责人自审记录（流程约定） | 最新候选 SHA、证据与结论 | 最新提交 SHA、证据与结论 | 最新提交 SHA、证据与结论 |
| 解决全部讨论 | 是 | 是 | 是 |
| 必需状态检查 | 完整质量 + release-ready | 当前阶段质量检查 | 相关回归，进入 main 前完整发行检查 |
| 强推/删除 | 禁止 | 禁止 | 禁止；同步完成后由维护者按流程清理 |
| 管理员绕过 | 不允许日常绕过 | 不允许日常绕过 | 不允许日常绕过 |
| 来源限制 | release/* 或 hotfix/* | feature/* 或 main 回合 | release 只接收已在 develop 审查通过的 release-fix 移植及必要 main 回合；hotfix 修复 PR 关联生产缺陷 |

来源限制不是 CODEOWNERS 的功能，需显式 CI 检查 PR head/base 和发行证据。release 修复例外见 RELEASE.md；来源应验证仓库身份，不能仅凭同名分支放行。

每位任务负责人自行审查，不要求交叉批准。GitHub 不允许作者批准自己的 PR，所以自审用 PR 描述/评论记录，不能依赖作者提交 Approve。建议使用分支 ruleset，保留“Require a pull request before merging”，将 Required approvals 设为 0；如已有其他规则叠加要求他人批准，也需同步调整审批项，不能通过关闭 PR 或质量检查要求来替代。其他独立质量门槛继续启用。

当前尚无 CI 自动核验自审记录，记录完整性与真实性属于负责人执行的流程约定；不能声称 GitHub 原生强制验证了自审。新增提交后负责人更新 SHA、证据与结论，旧记录不能覆盖新内容。[GitHub 官方说明](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)。

## 5. CI 分阶段建立（当前未配置）

| 阶段 | 建议检查名 | 建立时机 |
| --- | --- | --- |
| 规范阶段 | governance / docs | 首次规范集成时配置实际运行的文档与 PR 来源检查 |
| 开发阶段 | quality / static、quality / unit、quality / contracts | D01-D03 建立并在 develop 上实际运行成功后设为 required |
| 集成阶段 | quality / integration、quality / desktop-e2e | D06-D12，使用真实 Host 和确定性模型夹具 |
| 发布阶段 | release / package、release / acceptance、release / release-ready | D11-D13，release-ready 汇总打包、验收与候选对应关系 |

检查名只是约定，尚非已有 GitHub Check。不要将不会触发的检查立即设为 required，也不能用恒成功的占位检查满足门槛。允许云 CI 构建，但不使用真实用户数据。

如果 GitHub 套餐/权限不支持私有库分支保护，应明确标为“流程约定，服务端未强制”；评估调整套餐或仓库方案后再声称强制保护。SSH Git 访问不等于管理员 API 权限。

## 6. 设置验收

用临时 feature 和 PR 验证：错误来源到 main 被拒绝；没有他人 Approve 时，已完成负责人自审且所有必需检查通过的 PR 可正常合并；失败/缺失的必要检查仍阻止合并；main/develop 强推被拒绝。人工核对自审记录覆盖最新 SHA；新增提交后重新运行相关检查并更新自审结论。不要通过真实 main 破坏性强推测试规则，应使用规则检查/拒绝结果与受控测试仓库验证。

记录规则截图或导出、检查链接、操作者和日期。在这些证据存在前保持本文件“未设置/未核实”状态。

参考：[GitHub 保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、[CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)。
