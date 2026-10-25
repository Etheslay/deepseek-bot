# D06 工作流引擎实现报告

日期：2026-10-24。任务：D06 `feature/workflow-engine`（负责人 Etheslay）。分支自 develop 9cf4ba2（D04 合并后）创建，目标 develop。依赖 D04 已合入。

## 1. 交付内容

FR-05/FR-07 后端落实为 workspace 包 [packages/runtime](../../packages/runtime/README.md)（`@deepseek-bot/runtime` 0.1.0，private，TypeScript 源码直出，与 contracts/storage 同模式）。零新增外部运行时依赖：仅依赖 `@deepseek-bot/contracts`（状态机/schema/校验器）与 `@deepseek-bot/storage`（SQLite 仓储）；UUID/哈希用 `node:crypto`，定时器用全局 `setTimeout`，未引入 better-schedule 类库。`pnpm-workspace.yaml` 与 `allowBuilds` 无需变更。

| 领域 | 实现 |
| --- | --- |
| DAG 校验（CONTRACTS §3 workflow.validate） | `startRun` 在写任何记录前先 `validateWorkflowDraft`（复用 D03 校验器）：环 → `WORKFLOW_CYCLE`、悬空边/缺绑定 → `MISSING_BINDING`、其余 → `INVALID_INPUT`，错误定位到节点/字段；执行中快照再次构图校验 |
| 运行快照（FR-07） | `startRun` 校验通过后把 workflow 与全部被引用 bot 复制进 Run（`workflowSnapshot`/`botSnapshots`），引擎只读快照执行；归档机器人拒绝新执行；idempotencyKey 重复提交返回既有运行且不触发第二次执行（storage 唯一索引兜底竞态） |
| 顺序/并发（FR-05） | 就绪节点按快照声明顺序派发，`limits.maxConcurrentNodes`（默认 2，契约上限 8）限制在飞 executor 数；输入经边映射从上游输出解析（只映射声明的 required 缺失才判 `MISSING_BINDING`，其余边作为纯依赖闸门），节点间输出按边隔离 |
| 失败与取消（FR-05，QA-05/06） | stop-descendants：失败节点后继在终态化时标 `skipped`（原因"upstream node failed"），独立分支可完成；任一失败 → Run `failed`（`run.failed` 事件带稳定错误码 + 原因）。自动重试仅按节点 `retryPolicy`（≤2 次）且错误可重试时进行，指数退避并尊重 Retry-After；认证失败/schema 错误不重试。取消 = 停止新派发 → abort 在飞 → pending/waiting 节点与 pending 审批清理 → 在飞停止后（grace 兜底）才 `cancelled`；重复 cancel 幂等返回终态 |
| 运行快照与重试 | 每次尝试独立 NodeRun 行（(run, node, attempt) 唯一）；`run.retryNode` 仅活跃运行、仅最新失败 attempt、下游未进展时放行，终态运行报"经新 Run（resumedFromRunId）恢复"；审批节点重试生成新 Approval |
| 审批节点（FR-06 铺垫） | 到达即暂停：创建 pending Approval（TTL 默认 10 分钟，digest=SHA-256 of {runId,nodeId,nodeRunId,instructionTemplate}），`approval.requested` 事件；批准消费一次后放行，拒绝/过期使节点失败（`APPROVAL_REQUIRED`/`APPROVAL_EXPIRED`）；`waiting_approval → succeeded/cancelled` 按状态机经 running/cancelling 中转；陈旧审批（节点已重试/已离开等待态）的决定被拒绝 |
| 事件去重（CONTRACTS §4，QA-09） | 引擎只通过 `RunEventEmitter` 发持久事件：sequence 从上次持久值续号（宿主重启后不重用），先提交状态后发事件（`run.completed` 在终态事务成功后）；eventId/event payload/sequence 连续性由 storage `appendEvent` 强制，至少一次投递下重放安全 |
| 崩溃恢复 | `recoverInterruptedRuns()`（Host 启动调用）：遗留 queued/running/waiting_approval/cancelling 运行 → 未完 NodeRun 标 `interrupted`、pending 审批过期、发 `run.interrupted`；新引擎实例不接管旧运行，恢复走新 Run（D10） |
| 超时 | `timeoutSeconds` 到期先 abort 协作信号再以 `TOOL_TIMEOUT` 结算（可重试）；迟到 executor 结果被 settled 守卫丢弃——对应上游 SDK 无请求级超时/取消的实测结论（D01 §8.2） |

Harness 适配边界：引擎经 `NodeExecutor` 端口执行 bot 节点（上下文含 bot 快照、映射输入、AbortSignal）；真实适配层（SDK stdio 进程、`session/resume`、审批桥）在 D08/D12 接入，本任务全部行为用假 executor 驱动测试，无真实 API 调用、无 Harness 进程启动。

## 2. 过程修复的引擎缺陷（自测发现）

- **前置失败卡死**：缺 bot 快照/必需绑定无值时，失败结算发生在 inflight 注册之前，被 settled 守卫吞掉 → 节点永久 `running`。已改为独立的 `failBeforeExecution` 路径并加测试（缺绑定时下游收到明确 `MISSING_BINDING` 失败）。
- **对 running 节点错误终态化**：reconcile 只看 inflight/重试定时器/就绪节点，"running 但无 inflight"的节点会被跳过导致 Run 在节点仍在执行时被判 failed。已加 orphan-running 守卫：任何 running 无 inflight 的节点都视为忙。
- **waiting_approval 直接终态**：审批节点批准后运行需 succeeded，但契约状态机禁止 `waiting_approval → succeeded`。已加 `finalizeThroughWaiting`：经 `running`/`cancelling` 中转，迁移全部合规。

## 3. 测试与覆盖率

根目录 `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。runtime 包 43 个用例（backoff 4、graph 3、生命周期 11、失败策略 6、显式重试 2、执行器异常 3、取消 5、审批 7、恢复 4），临时 SQLite + 假 executor（脚本化/挂起/可中止），真实定时器验证超时（1s）、审批 TTL（30ms）、退避（10ms）与取消 grace。

覆盖率（v8）：语句 88.56%、分支 81.25%、函数 92.85%、行 88.56%，高于 [TESTING.md](../TESTING.md) §3 行 ≥ 80% 的要求（状态机迁移本体在 contracts，分支 100%）。storage 包新增审批过期辅助函数后 106 用例全绿（行 92.1%、分支 85.1%）。

## 4. 依赖与文档同步

- `@deepseek-bot/runtime` 依赖 `@deepseek-bot/contracts`、`@deepseek-bot/storage`（workspace 精确版本）；devDeps 沿用 ts/vitest/@types/node 精确版本组合；锁文件随分支更新。
- storage 新增 `markApprovalExpired`、`expireApprovalsForRun`（审批仓储，附加式，无 schema 变更），配套 2 个用例。
- 同步：`docs/ARCHITECTURE.md`（§2 落地范围、§6 状态机细节指针）、`docs/DEVELOPMENT_SETUP.md`（布局/测试命令/包版本）、`progress.md` 工作记录。

## 5. 未验证项与边界

- **无真实 Harness 联动**：`NodeExecutor` 端口由假实现覆盖；真实 SDK 进程、`session/resume`、取消→进程回收映射（QA-03/09 的集成部分）在 D12 验收。
- **审批 ≠ 权限**：本任务只实现审批节点闸门；工具调用的执行前权限检查、digest 校验、一次性消费与 `启动代次绑定` 属 D08（`generation` 列已由 D04 预留）。
- **输出不持久化**：节点输出保存在运行内存；崩溃即随中断丢弃，恢复以新 Run 重算（契约允许：仅承诺状态记录与调度去重，不承诺外部副作用 exactly-once）。产物文件登记在 D08/D09。
- **资源锁未实现**："同一文件写目标与桌面交互工具使用资源锁"（ARCHITECTURE §6）依赖工具动作元数据，归 D08。
- 未覆盖分支（约 19%，已如实记录）：单写者引擎不可达的防御性守卫（reconcile 的 cancelled/不一致终态兜底、retryNode 的下游已进展守卫、settle 的迟到双结算守卫、currentRun 的记录消失守卫）与 best-effort 分支（storage APPROVAL_EXPIRED 抢在引擎 TTL 定时器之前的竞态兜底），未通过排除文件或跳过测试达成。
- 本报告数值均为本地 Windows 11 x64 + Node 24.15.0 + pnpm 11.28.5 实测；CI 结果以分支推送后的真实运行为准。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
