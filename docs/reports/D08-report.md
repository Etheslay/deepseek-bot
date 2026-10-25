# D08 工具权限后端实现报告

日期：2026-10-25。任务：D08 `feature/tool-permissions`（负责人 Etheslay）。分支自 develop 63bacf9（D07 合并记录后）创建，目标 develop。依赖 D04、D06 均已合入。

## 1. 交付内容

FR-06 后端（执行前拦截、展示精确参数、拒绝不执行、重启后旧审批不能重放）落实在 [packages/runtime/src/permissions/](../../packages/runtime/README.md) 与 storage/contracts 的附加式扩展。零新增外部依赖；契约变更仅为新增 `ToolPolicy` 实体（CONTRACTS §7 允许的兼容扩展，未动既有字段/状态/事件语义）。

| 领域 | 实现 |
| --- | --- |
| 契约实体（CONTRACTS §2） | `ToolPolicy`：filesystem（enabled + read/write 操作集）、shell（仅 `disabled`/`approval-required`——v0.1 不存在无人值守放行模式，schema 层面不可表达）、network（三态）、mcp（enabled + requireApproval + 显式服务器/工具白名单，无通配符；项目文件或模型输出无法扩大授权） |
| 存储（D04 预留位落定） | migration `0002-tool-policies` 建 `tool_policies` 表（bots.tool_policy_id 仍为普通 id 引用，仓储读写均过契约 schema）；`repos/tool-policies.ts` 增删改查（update 支持 expectedRevision 冲突拒绝）；settings 增 `getBootGeneration`/`incrementBootGeneration`；审批新增 `getApprovalGeneration` 与 `consumeApproval` 的 generation 参数（不匹配即 INVALID_INPUT） |
| 路径约束（QA-08） | `canonicalizeToolPath`：realpath 最深存在祖先（解析 symlink/junction 后再拼接不存在段），`..` 词法解析到真实祖先之下；拒绝设备命名空间 `\\.\`、`\\?\` 与相对路径。`isPathWithinScope`：段边界包含（`C:\work` 不含 `C:\worker`）、Windows 大小写不敏感、混合分隔符、UNC 段级匹配、歧义根（`\`、Windows 上的 `/`）fail-closed |
| 执行前策略检查 | `policy.ts` 纯函数评估：文件动作需 policy 操作白名单 **且** workspace 授权（双保险，测试发现初版漏掉 policy 层后已补）；产物目录在 filesystem 启用时授予读写；file.delete 即使有写授权也转审批；shell 禁用即拒、启用必审批；MCP 服务器/工具不在白名单即拒。拒绝使用稳定错误码 `UNAUTHORIZED_PATH`/`INVALID_INPUT`（错误码表冻结，不新增） |
| 一次性审批（QA-07） | `gate.ts` per-node 门：`tool.requested`（精确参数+资源）→ 评估 → 放行 / `NodeExecutionError` 拒绝 / 审批。审批 digest = SHA-256 over 确定性序列化的 {runId, nodeRunId, kind, toolName, canonical resource, full arguments}（键序无关）；TTL 默认 10 分钟；绑定宿主启动代次；批准后**复检策略与运行状态再消费**（ARCHITECTURE §3），消费严格单次；参数超 1 MiB 消息上限直接拒绝（引导走 artifact 引用） |
| 决定链路 | `engine.decideApproval(approvalId, decision, expectedActionDigest)`：digest 不符 INVALID_INPUT、外来代次 APPROVAL_EXPIRED（不可决定不可消费），工具审批与 D06 审批节点分流（前者由门复检+消费，节点状态由门翻转；后者沿用 D06 语义） |
| 运行状态调和 | 节点在 executor 内等工具审批时翻转 running↔waiting_approval；reconcile 把"等工具审批的在飞节点"从 busy 中排除——独立分支可继续，静默且无 runnable 时 run 显示 `waiting_approval`（CONTRACTS §5）；取消/恢复路径清理等待者、审批与门定时器 |
| 最小权限默认 | `startRun` 逐 bot 解析并**钉扎** policy+workspace（运行中修改不影响进行中运行，ARCHITECTURE §6）；policy 或 workspace 缺失直接拒绝启动；无权限句柄的执行不存在 |

Harness 适配边界：`NodeExecutor` 上下文新增必填 `permissions` 句柄（`evaluate` 预览 / `authorize` 强制闸门）。真实适配层（D12）必须对所有副作用动作调用 `authorize`；本任务用脚本化 executor 驱动全链路测试，无真实 API、无 Harness 进程。

## 2. 过程修复的缺陷（自测发现）

- **策略评估器漏掉 policy 级操作白名单**：初版只查 workspace 授权，policy.filesystem.operations 形同虚设。测试「policy 只读但 grant 可写」暴露后补上双层校验。
- **取消期间迟到结算不释放 cancel drain**：工具审批被取消拒绝后 executor 拒绝，此时节点已被取消扫描终态化，settleAttempt 早退路径不调用 notifyCancelDrain → 取消需等满 grace（5 秒）。已补：cancelRequested 时 inflight 清空即触发 drain。
- **测试脚手架缺策略行**：startRun 现在要求 policy 存在，runtime test-support 补种默认最小权限策略。
- **Windows 8.3 短名导致包含判断静默失效（CI 发现）**：GitHub Actions runner 的 TEMP 为 `C:\Users\RUNNER~1\...`；`fs.realpathSync`（JS 实现）不解析 8.3 短名而 `fs.promises.realpath` 解析，导致"授权范围入库用一种形式、子路径规范化成另一种形式"，越界测试碰巧通过、放行测试被误拒。修复：审批门对钉扎的 grants/产物目录 scope 惰性执行与子路径**同一个** `canonicalizeToolPath`（`canonicalizeScopePath`），测试一律用规范 scope 比对，并加注入 realpath 的回归测试复现 runner 行为（提交记录见 Git 历史）。

## 3. 测试与覆盖率

根目录 `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。用例数：desktop 86、shared 6、contracts 64、storage 112（新增 tool-policies 4 + generation 2）、runtime 89（D06 43 + D08 新增 46）。

runtime 权限模块 v8 覆盖率：gate.ts 语句 88.6%/分支 88.2%、paths.ts 97.3%/93.3%、policy.ts 98.9%/86.3%、actions.ts 100%/87.5%；包整体分支 81.5%、行 89.9%（阈值 80%）。TESTING.md §3 对权限模块建议分支 ≥ 90%：paths 达标，gate/policy 余下未覆盖分支为**单写者引擎不可达的防御路径**（审批后复检拒绝——钉扎策略运行中不可变使其不可自然触发；消费失败——需要外部删行/换代次竞态；canonicalize 非 Invalid 异常兜底；TTL 与已决定审批的竞态守卫），未通过排除文件或缩阈值达成，与 D06 报告 §5 同口径如实记录。

QA-07/08 对应：拒绝、过期、重复批准（单次消费）、参数变更（digest 绑定+键序无关序列化）、工作区越界、junction 逃逸、shell 必审批、MCP 白名单外拒绝均有自动化用例。

## 4. 依赖与文档同步

- 无新增运行时依赖；lockfile 无变化（仅 `pnpm install` 恢复 workspace 链接）。
- storage migration 0002 附加式，0001 校验和不变，旧库升级路径有迁移测试兜底。
- 同步：`docs/ARCHITECTURE.md`（§2 落地范围、§3 权限链路）、`docs/SECURITY_DATA.md`（§3 状态头）、`docs/DEVELOPMENT_SETUP.md`（布局）、`packages/runtime/README.md`（模块表/边界/测试）、`progress.md`。

## 5. 未验证项与边界

- **无真实 Harness 联动**：适配层如何把上游工具调用映射为 `ToolActionRequest` 并强制走 `authorize` 属 D12；本任务保证"未过门的动作拿不到授权句柄的放行结果"。
- **shell 的 OS 级约束**：v0.1 策略层只能保证"每条命令显式审批"；可验证的操作系统约束（任务对象/受限令牌）未实现，SECURITY_DATA §3 的该句仍属未完成项。
- **TOCTOU**：JS 层无法完全关闭检查-执行间隙；缓解为 authorize 时点重新 realpath + 策略复检，报告如实记录，不宣称完整沙箱。
- **MCP 子进程生命周期**：授权检查已实现（服务器/工具白名单 + requireApproval），进程托管、来源固定与版本展示在 D12。
- 资源锁（同文件写目标互斥）依赖适配层动作元数据，未实现。
- 本报告数值均为本地 Windows 11 x64 + Node 24.15.0 + pnpm 11.28.5 实测；CI 结果以分支推送后的真实运行为准。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
