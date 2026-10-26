# 调研记录

## 2026-10-26：D15 `web_search`

- 用户选择 SearXNG JSON；官方 API 支持 POST 表单，JSON 输出需实例启用，公共实例可能返回 403：https://docs.searxng.org/dev/search_api.html 。未选择或测试任意公共实例。
- `ToolCaller.id` 是不透明标识，现无真实聊天调用方；由受信调用选项传递结构兼容 D08 NodePermissionHandle 的网络权限句柄，不从 caller 字符串解析身份、不接受模型参数传权限。
- Host main 通过环境变量 DEEPSEEK_BOT_SEARXNG_URL 配置，桌面 Host 子进程继承父环境；缺少端点/权限均拒绝联网。
- D08 tool.requested 按既有规范记录精确 query，JSONL 网关审计则只保存摘要；文档区分两者。
- 真实权限联调发现 D12 默认种子 network='allow'/shell='approval' 不符合契约；仅修复默认 policy 的旧值，不改合法用户配置或自定义 policy。

## 2026-10-26：D15 `ask_user` 实现事实

- 远程 develop 已含读层 PR #37 与写层 PR #38（`d4a3f35`）；本分支由 `12d163f` 快进到该基线。
- Host 目前仅进程内暴露 `agentTools`，真实聊天仍为夹具；用户明确选择本轮只实现网关与 Host 后端。
- 复用既有 `CANCELLED` / `TOOL_TIMEOUT` / `RUNTIME_UNAVAILABLE` 错误码，扩展网关错误联合，无需更改契约。
- 待回答协调器按 Host 生命周期保存在内存，答案必须匹配原 callerId；受信回答/取消入口不进模型能力注册表。

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
- 用户后续明确调整开发审查机制：每个人独立完成自己任务的自审，无需交叉批准；测试、分支和发布门槛继续执行。

## 后续核查结果

- 使用用户已有 SSH 配置，在获得沙箱外读访问后访问成功；`git ls-remote` 返回成功且没有 refs，远程为空仓库。
- 上游源码 SHA：687f282e8625c6b8d11ff58211a90524be2e4317；根与桌面包声明 0.2.1-rc.2，Node ^22.19.0 || >=24.0.0，pnpm 11.28.5。
- 上游采用 Electron 桌面、本地 Host、profile 与 Cordis 插件；Agent Teams 为实验功能。具体 SDK 与发行包可用性没有执行验证。
- 已核查 GitHub 官方分支保护与 CODEOWNERS 说明：CODEOWNERS 不赋予仓库写权限，私有库保护能力受套餐影响。用户调整后采用负责人自审，配置规范取消必需他人批准。
- 本地 main / develop 空起点 6240da3 已建立；当前 feature/project-standards，origin 为用户提供的 SSH 地址。
- 用户后续授权后，远程 main / develop / feature/project-standards 均推送成功；首次推送 refs 已核验分别为 6240da3 / 6240da3 / c31755f，远程 HEAD 为 main。
- 已核查 GitHub 官方自审限制：PR 作者不能对自己的 PR 提交 Approve；项目采用 PR 自审记录，配置要求为 0 个必需批准，不使用 self-Approve 作为门槛。远程保护配置尚未启用/修改。

新增参考：

- https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/architecture.zh.md
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews

## D16 权限后端（2026-10-26）

- 已同步 develop b693c5b：PR #42 搜索、#41 bot 模板与 #40 桌面改动在基线。独立 feature/permissions-grants 工作，不修改 main/develop。
- D15 网关原先缺少授权检查器时允许执行；D16 改为 schema 校验后授权、缺少检查器拒绝、执行前重验。真实聊天调用方还未接入，可信 bot/session 身份由未来 Host 接线负责绑定。
- 复用 D08 网络授权，D16 network.search 仅为前置能力授权，不替代精确网络动作检查。
- 审查发现并修复方向：撤销必须检查原执行票据引用的 grant，即使当前策略改 allow；撤销审计须携带 botId；Zod 多余键与 handler 异常文本不能复制到 JSONL。
- AppApproval 保存精确参数供受信人类预览；permission_audit / JSONL 只保存摘要与元数据。备份包含审批表，因此包含预览原文。
