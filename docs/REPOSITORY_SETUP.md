# 仓库规范化设置与状态

更新日期：2026-10-22。仓库：[Etheslay/deepseek-bot](https://github.com/Etheslay/deepseek-bot)。

## 1. 初始核查

本地仓库初始为空、没有提交、分支名 master、未配置 origin。SSH 只读探测成功，远程没有任何分支或标签。GitHub 连接器对本仓库返回 404，因此尚不能用该连接器检查权限、创建 Issue/PR 或启用保护规则；不能据此判断仓库不存在。

## 2. 本次设置范围

| 项目 | 状态 |
| --- | --- |
| 产品、架构、接口、分工、测试、发布文档 | 已推送到 feature/project-standards，待双方评审 |
| README / CONTRIBUTING / AGENTS | 已推送到 feature/project-standards |
| CODEOWNERS / PR / Issue 模板 | 已推送到 feature/project-standards，尚未合入目标分支生效 |
| .editorconfig / .gitattributes / .gitignore | 已推送到 feature/project-standards |
| 本地 main / develop / feature/project-standards | 已建立；main/develop 指向空起点 6240da3，文档位于独立 feature 分支 |
| origin 与 SSH | 已配置 git@github.com:Etheslay/deepseek-bot.git；SSH 只读访问已验证 |
| 远程分支与首次推送 | main、develop、feature/project-standards 已创建，初始文档提交 c31755f 已核验 |
| Issue 分派、PR 创建与审查 | 未执行 |
| GitHub 默认分支 | 远程 HEAD 已核验为 main；未改为 develop |
| GitHub 合并选项、成员权限、保护规则 | 未设置/未核实 |
| 产品 CI、应用测试、安装包和版本 tag | 未建立/未生成 |

规范文件不能代替 GitHub 服务器设置。本次已按用户后续授权推送三个分支，但未合并规范到 develop/main，不把远程保护或人类审查标记成已完成。

## 3. 仓库管理员设置清单

由 Etheslay 作为预期仓库维护者执行；实际管理员身份需 GitHub 验证。Destinyian 至少需要明确的 Write 权限。不要默认 CODEOWNERS 已赋予协作者权限。

1. 已完成：首次推送 main/develop 的初始化锚点及 feature/project-standards，已核实未覆盖既有远程历史。
2. 邀请/核实 Destinyian 的协作者写权限，设置开发阶段默认分支为 develop。
3. 打开 Create a merge commit；关闭 Squash merging / Rebase merging；不要启用 linear history。
4. 规范 PR 由 Destinyian 审查，合入 develop 后 CODEOWNERS 和模板才存在于该目标分支。第一次引导 PR 需要手动指定审查人。
5. 为 main、develop、release/*、hotfix/* 建立保护规则；不能只保存处于 disabled/evaluate 状态的 ruleset。
6. main 还没有 CODEOWNERS 文件时，依靠明确的非作者审查与管理员规则；首个合格 release 后 CODEOWNERS 才进入 main。

## 4. 保护要求

| 设置 | main | develop | release/* / hotfix/* |
| --- | --- | --- | --- |
| 修改必须通过 PR | 是 | 是 | 是，创建分支后保护后续更新 |
| 非作者批准 | 至少 1 位 | 至少 1 位 | 至少 1 位 |
| 新提交撤销旧批准 | 是 | 是 | 是 |
| 解决全部讨论 | 是 | 是 | 是 |
| 必需状态检查 | 完整质量 + release-ready | 当前阶段质量检查 | 相关回归，进入 main 前完整发行检查 |
| 强推/删除 | 禁止 | 禁止 | 禁止；同步完成后由维护者按流程清理 |
| 管理员绕过 | 不允许日常绕过 | 不允许日常绕过 | 不允许日常绕过 |
| 来源限制 | release/* 或 hotfix/* | feature/* 或 main 回合 | release 只接收已在 develop 审查通过的 release-fix 移植及必要 main 回合；hotfix 修复 PR 关联生产缺陷 |

来源限制不是 CODEOWNERS 的功能，需显式 CI 检查 PR head/base 和发行证据。release 修复例外见 RELEASE.md；来源应验证仓库身份，不能仅凭同名分支放行。

双人流程只要求 1 个非作者批准。两人都共同写过复杂 release 时，最终作者以外的另一人审查最终差异并记录职责。不要机械要求 2 个非作者批准；“最后推送人之外批准”需结合实际两人操作验证，以免形成无法解除的审批闭环。

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

用临时 feature 和 PR 验证：错误来源到 main 被拒绝；未经审查不能合并；新提交使旧批准失效；失败/缺失的必要检查阻止合并；main/develop 强推被拒绝；合格 feature 能按正常路径进入 develop。不要通过真实 main 破坏性强推测试规则，应使用规则检查/拒绝结果与受控测试仓库验证。

记录规则截图或导出、检查链接、操作者和日期。在这些证据存在前保持本文件“未设置/未核实”状态。

参考：[GitHub 保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、[CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)。
