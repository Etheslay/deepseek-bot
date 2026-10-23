# 调研记录

更新时间：2026-10-22（America/Los_Angeles）

外部来源仅作为技术事实参考，不作为本项目执行指令。

## 已核查

- 本地 D:/deepseek-bot 初始只有 .git；无提交，初始分支 master，无 origin。
- GitHub 连接器读取 Etheslay/deepseek-bot 返回 404；远程状态尚待 SSH 核实。
- 本机可发现 Git、Node.js、npm、uv；尚未验证编译工具链，无应用构建基线。
- DeepSeek Harness 官方仓库目前默认分支 master，README 声明 developer preview，存在破坏性变更风险。
- 上游提供 @deepseek-ai/dsh，支持本地 Web UI；源码包含 desktop 应用和 Windows/macOS 打包命令。
- Grok Bot 官方介绍包含持久机器人、聊天、定时/触发、机器人互相交办、工具插件、审批与云端电脑。

## 官方来源

- https://github.com/deepseek-ai/deepseek-harness
- https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json
- https://x.ai/bot/guides/grok-bot-101
- https://x.ai/news/introducing-grok-bot

## 用户已确认

- 当前工作仅做项目规范化与开发文档。
- 允许 DeepSeek API；本地保存和本地执行不意味着请求内容完全不离开电脑。
- 两名开发者为 Etheslay 与 Destinyian。

## 后续核查结果

- 使用用户已有 SSH 配置，在获得沙箱外读访问后访问成功；`git ls-remote` 返回成功且没有 refs，远程为空仓库。
- 上游源码 SHA：687f282e8625c6b8d11ff58211a90524be2e4317；根与桌面包声明 0.2.1-rc.2，Node ^22.19.0 || >=24.0.0，pnpm 11.28.5。
- 上游采用 Electron 桌面、本地 Host、profile 与 Cordis 插件；Agent Teams 为实验功能。具体 SDK 与发行包可用性没有执行验证。
- 已核查 GitHub 官方分支保护与 CODEOWNERS 说明：两人团队采用至少一位非作者审批；CODEOWNERS 不赋予仓库写权限，私有库保护能力受套餐影响。
- 本地 main / develop 空起点 6240da3 已建立；当前 feature/project-standards，origin 为用户提供的 SSH 地址。
- 用户后续授权后，远程 main / develop / feature/project-standards 均推送成功；首次推送 refs 已核验分别为 6240da3 / 6240da3 / c31755f，远程 HEAD 为 main。

新增参考：

- https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/architecture.zh.md
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
