# 工作记录

## 2026-10-22：项目规范化

- 完成本地初始状态检查，未发现现有应用或项目指令文件。
- 阅读需求设计、文件规划技能，检查上游和 Grok Bot 官方资料。
- 收到用户范围修正：仅规范化设置与开发文档，不实现应用。
- 已记录 API 模式、本地数据与双人 Git 流程约束。
- 正在核查 SSH 远程和上游架构，尚未创建应用代码或执行构建。

### 文档与本地设置

- 完成 11 份 docs 文档、README / CONTRIBUTING / AGENTS、PR 和三类 Issue 模板、CODEOWNERS 与基础文件规范。
- 写明 10 项功能验收、15 项 QA 场景、D00-D13 双人任务、发布/热修复/数据恢复规则。
- 明确产品需求中的用户确认项与技术方案建议，不把上游能力记作本项目实现。
- SSH 探测确认远程为空；创建空提交 6240da3，main / develop 保持空基线，当前为 feature/project-standards。
- 初稿阶段没有应用源码、依赖安装、API 请求、安装包、发布 tag 或远程推送。
- 一致性复核修正了 release 修复规则：先审查进入 develop，再选择性移植到 release。

### 验证

- 文档检查：25 个文件，其中 21 个 Markdown；31 条本地文档链接全部存在。
- 初稿任务检查：D00-D13 共 14 项，分支名无重复，当时采用交叉审查；该旧机制已由后续用户要求的负责人自审替代。
- 三类 Issue 模板头部检查通过；Markdown 代码围栏、末尾换行与编码检查通过。
- 文件类型清单只有文档和协作配置，没有应用源码或依赖清单。
- Git status 的一次检查因 NUL 排除文件参数失败，后续移除该临时参数重新核验。
- 应用构建、应用测试、真实 API 冒烟、远程保护验证均未执行；不在本次实现范围内。

## 2026-10-22：按用户授权推送远程

- 推送前再次确认远程为空，本地工作区干净。
- 原子推送 main、develop、feature/project-standards 成功，三条本地分支均设置对应 origin 上游。
- 远程核验：main / develop 为 6240da3，初始文档分支为 c31755f；HEAD 为 main。
- 没有强推、分支合并、版本发布或代替真人审查。
- 同步更新仓库设置清单与规划记录；该记录的后续提交仅更新 feature/project-standards。

## 2026-10-22：改为负责人自行审查

- 用户明确要求每个人独立审查；保留独立 feature、PR、测试和发布门槛。
- 已调整 D00-D13 为开发与自审同一负责人，更新贡献指南、Git/发布流程、接口/ADR 及全部任务模板。
- PR 模板新增自审 SHA、日期、检查证据、遗留问题与结论；新提交后更新记录。
- CODEOWNERS 改为纯说明，不配置自动请求他人审查的规则；服务器配置规范改为 0 个必需批准并关闭 code-owner/最后推送审批要求。
- GitHub 保护规则尚未启用/修改，本次不会把文档修改描述为远程规则已生效。
- 应用内工具审批不受此次开发审查机制调整影响。
- 验证通过：21 个 Markdown、31 条本地链接、14 项任务；原任务负责人和分支名保持一致；CODEOWNERS 活动规则为 0；三个 Issue 模板结构正确。
- 旧规则检查首次发生否定句误报，修正检查范围后通过；Git 差异空白检查通过，产品需求与数据权限文件无改动。

## 2026-10-23：规范集成到 develop

- 用户在会话中明确授权本次合并；未冒充开发者提交 GitHub 审批。
- 合并来源 bd2946bbbb3552b9bafbdb3dd48df38644a47d8d，目标基线 6240da3ac557dce65c7f98adbc900bc7bc142cdd；已 fetch 并核对两端一致。
- 来源检查通过：25 个文件、21 个 Markdown、31 条本地链接、14 项任务；CODEOWNERS 无活动规则，无应用源码。
- GitHub 连接器仍无法访问仓库，本次采用本地 no-ff 合并并通过 SSH 普通推送，不创建虚假 PR。
- 合并无冲突，保留两个父提交；仅补充集成状态记录，main 不变。具体合并 SHA 与推送结果以 Git 历史及本次会话最终核验为准。
- 本次是文档集成，不代表已执行应用构建、产品测试或发布验收。

## 2026-10-23：仓库设置、PR 流程验证与提交身份事件

- GitHub 默认分支已核验切换为 develop；合并选项仅保留 merge commit，PR #2（启动清单）与 PR #3（契约冻结）均以双父 merge commit 合入，Squash/Rebase 在合并界面不可用。
- 规则集 protected-branches 已建立（main、develop、release/**、hotfix/**，0 必需批准、禁强推、禁删除、无 bypass）；因私有免费套餐 GitHub 明示不强制执行，探针 B 推送被接受证实。保护要求标注为"流程约定，服务端未强制"，规则集保留待套餐/可见性变化后自动生效。
- 探针 C 通过：契约冻结 PR 以 0 必需批准 + 负责人自审记录 + merge commit 合并；探针 A/B（预期拒绝）暂缓至强制生效后重跑。
- 发现 feature/project-standards 两个误署名提交（署名 Destinyian，非本人操作），违反身份约束；已从远程回退至已合并基线 bd2946b，内容本地存档 archive/stage-plan-proposal 待讨论，身份来源待内部核实。
- 提交 950a8d4（启动清单）与 c4d8eca（契约冻结）由 Etheslay 授权会话内 AI 辅助准备、以其配置身份提交、本人经 PR 确认合并。

## 2026-10-23：并行开发决策与第二次身份事件

- 用户决策：维持双人并行开发（D00-D13、M0-M4），不采纳 STAGE_PLAN 的 S1–S14 串行 Bot 执行方案。
- 同日第二次发现 feature/project-standards 被同一误署名身份（Destinyian）追加三笔提交，内容为对齐已合并状态的阶段化方案修订；已再次从远程回退至 bd2946b，两版提案分别本地存档为 archive/stage-plan-proposal（ec85db7）与 archive/stage-plan-push2（5caafd7）。
- 推送来源尚未定位；在该环境停止或改用真实身份前，远程可能再次被推送，需负责人在源头处理（检查各机器/会话的 git 身份配置或访问权限）。
- npm registry 独立核验：@deepseek-ai/dsh latest=0.2.1-rc.2、next=0.2.1-rc.3、alpha=0.2.1-alpha.5，已合入 HARNESS_INTEGRATION §1。

## 2026-10-24：D06 工作流引擎（feature/workflow-engine）

- 用户明确授权开始 D-06 应用实现；分支自 develop 9cf4ba2 创建，目标 develop，未触碰 main / develop。
- 交付 `packages/runtime`（`@deepseek-bot/runtime` 0.1.0）：DAG 校验、顺序/并发调度、stop-descendants 失败传播、有界重试、两阶段取消、审批节点（TTL/批准/拒绝/过期）、运行快照、持久事件（sequence 续号）、宿主重启 interrupted 恢复；Harness 适配经 `NodeExecutor` 端口解耦。
- storage 附加两个审批辅助函数（markApprovalExpired / expireApprovalsForRun）及测试；无 schema 变更。
- 自测发现并修复三个引擎缺陷：前置失败被 settled 守卫吞掉、reconcile 对 running 无 inflight 节点错误终态化、waiting_approval 直达 succeeded 的非法迁移。
- 根目录 lint / typecheck / test 全绿：desktop 4、shared 6、contracts 64、storage 106、runtime 43 用例；runtime 覆盖率行 88.56%、分支 81.25%（TESTING.md 要求行 ≥ 80%）。
- 未做：真实 Harness 进程联动、真实 API 请求、权限检查（D08）、调度（D10）、适配层接入（D12）；文档同步 ARCHITECTURE / DEVELOPMENT_SETUP / packages/runtime README / D06 报告。
- 自审记录按规范留空待负责人 Etheslay 填写；PR 合并由本人确认。

## 2026-10-25：D08 工具权限后端（feature/tool-permissions）

- 用户确认 Destinyian 的 D07 已合并后开始；分支自 develop 63bacf9（D07 合并记录后）创建，目标 develop。
- 契约附加式扩展 `ToolPolicy` 实体（filesystem/shell/network/mcp；shell 无无人值守放行模式，MCP 显式服务器+工具白名单，无通配符）。
- storage：migration 0002 新增 `tool_policies` 表与仓储；settings 增加宿主启动代次（get/incrementBootGeneration）；审批支持 generation 绑定读取与消费校验。
- runtime：`permissions/`（actions/paths/policy/gate）+ `NodeExecutor` 上下文注入 `NodePermissionHandle`；引擎 startRun 钉扎每 bot 的 policy 与 workspace（缺失即拒绝启动，最小权限）；`decideApproval` 增加 expectedActionDigest 校验与启动代次校验；工具审批等待与运行状态调和（等待工具审批时 run 显示 waiting_approval）。
- 自测发现并修复两个缺陷：策略评估器漏掉 policy 级文件操作白名单；取消期间迟到结算不触发 cancel drain（靠 grace 兜底 5 秒）。
- 根目录 lint / typecheck / test 全绿：desktop 86、shared 6、contracts 64、storage 112、runtime 89 用例；权限模块分支覆盖 gate 88.2%、paths 93.3%、policy 86.3%（余下为不可达防御分支）。
- 未做：真实 Harness 进程联动与 MCP 子进程托管（D12）、资源锁、产物文件登记（D09）、shell 操作系统级约束（v0.1 以审批放行为边界）。
- 自审记录按规范留空待负责人 Etheslay 填写；PR 合并由本人确认。

- CI 补充（同日）：首次 CI 运行 3 个用例失败（runner TEMP 为 8.3 短名 RUNNER~1，fs.realpathSync 与 fs.promises.realpath 行为不一致，范围与子路径规范化形式分裂）。修复：gate 以同一 canonicalizeToolPath 规范化 grants/产物目录 scope，测试改用规范 scope，新增注入 realpath 的回归测试；本地全绿（358 用例）后推送复验。
