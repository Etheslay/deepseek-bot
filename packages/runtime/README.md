# @deepseek-bot/runtime

工作流执行引擎（D06）与后端工具权限层（D08 `feature/tool-permissions` 交付）：DAG 校验、顺序/独立分支并发、失败与取消、运行快照、持久事件、路径规范化与包含校验、工具策略执行前检查、一次性审批与 MCP 授权。对应 [docs/CONTRACTS.md](../../docs/CONTRACTS.md) §2/§3/§4/§5 与 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §3/§5/§6（FR-05/FR-06/FR-07 后端）。

## 运行环境约束

- 与 `@deepseek-bot/storage` 同进程运行（独立 Node ≥ 24 的 Host 进程），经同一 `OpenedDatabase` 单写者访问元数据；**不要在 Electron 主进程中 import 本包**。
- 引擎不触碰真实 Harness 进程：通过 `NodeExecutor` 端口与适配层解耦，真实适配层在 D08/D12 接入；测试与 UI 开发使用假 executor 即可驱动全部行为。
- Host 生命周期内一个数据库对应一个 `WorkflowEngine` 实例；多运行并发上限按各工作流快照的 `limits.maxConcurrentNodes` 独立生效。

## 模块速览

| 模块 | 职责 |
| --- | --- |
| `engine.ts` | 门面：`startRun`（先校验图与机器人可用性，再写快照与运行记录；idempotencyKey 幂等）、`cancelRun`、`decideApproval`、`retryNode`、`recoverInterruptedRuns`（宿主重启把遗留活跃运行标记 interrupted） |
| `run-execution.ts` | 单次运行编排：就绪节点调度、并发上限、stop-descendants 失败传播（后继在终态化时标 skipped，独立分支可完成）、有界重试（指数退避 + Retry-After）、两阶段取消（`cancelling` → 在飞工作停止后 `cancelled`）、审批节点暂停/TTL、终态化必须给原因 |
| `graph.ts` | 快照图：依赖去重、入边映射、传递后代闭包（stop-descendants 与 retryNode 校验用） |
| `executor.ts` | `NodeExecutor` 端口（上下文含 per-attempt `NodePermissionHandle`）与 `NodeExecutionError` 分类；未分类异常按可重试的 `RUNTIME_UNAVAILABLE` 处理 |
| `permissions/actions.ts` | 工具动作描述、权限决定类型、确定性参数序列化与 `actionDigest`（动作摘要 + 完整参数哈希） |
| `permissions/paths.ts` | 路径规范化：realpath 最深存在祖先（解析 symlink/junction）、段边界包含校验（Windows 大小写不敏感）、拒绝设备命名空间；`startsWith` 前缀检查不可用 |
| `permissions/policy.ts` | 纯策略评估：文件（policy 操作 × workspace 授权 × 产物目录）、shell（v0.1 仅 disabled/approval-required）、网络、MCP 服务器+工具白名单 |
| `permissions/gate.ts` | per-node 审批门：`tool.requested`（精确参数）→ 策略检查 → 放行 / 拒绝（稳定错误码）/ 一次性审批（digest 绑定动作、TTL、启动代次、批准后复检再消费） |
| `backoff.ts` | `base·2^(n-1)` 封顶指数退避，尊重 Retry-After 下限 |
| `run-events.ts` | per-run 持久事件：sequence 从上次持久值续号（跨重启不复用），payload/连续性/eventId 去重由 storage 层强制 |
| `errors.ts` | `EngineError`（CONTRACTS §6 稳定错误码） |

## 关键语义（与契约的对应）

- **快照不可变**：`startRun` 把 workflow 与被引用 bots 复制进 Run 记录，执行期间修改工作流/机器人不影响进行中的运行；执行前再次校验快照图。
- **失败策略 stop-descendants**：节点失败 → 后继在运行终态化时标 `skipped`（原因"upstream node failed"），独立分支继续完成；任一节点失败最终 Run 为 `failed`（携带 `run.failed` 事件 + 稳定错误码）。
- **状态机**：Run/NodeRun 迁移全部经 contracts `assert*Transition`；`waiting_approval → succeeded/cancelled` 经 `running`/`cancelling` 中转（契约状态机要求）。
- **审批节点**：暂停创建 pending Approval（默认 TTL 10 分钟，`approvalTtlMs` 可调），digest 覆盖 `{runId, nodeId, nodeRunId, instructionTemplate}`；批准即消费一次并放行，拒绝/过期使节点失败（`APPROVAL_REQUIRED`/`APPROVAL_EXPIRED`）；重试审批节点创建新 Approval，不复用旧审批。v0.1 审批节点为纯闸门（无数据输出）。
- **取消**：停止新派发 → abort 在飞 executor → pending/waiting 节点标 cancelled → pending 审批过期 → 在飞停止后（`cancelGraceMs` 兜底强制）才进入 `cancelled`；重复 cancel 返回既有终态。
- **retryNode**：仅活跃运行、仅最新失败 attempt、下游未进展；终态运行的恢复走新 Run（`resumedFromRunId`，D10）。
- **超时**：`timeoutSeconds` 到期先 abort 协作信号，再以 `TOOL_TIMEOUT` 强制结算，迟到的 executor 结果被 settled 守卫丢弃（上游 SDK 无请求级超时/取消，D01 §8.2）。

## 边界（本包不做）

- 资源锁（依赖工具动作元数据，随适配层推进）；产物文件登记（D09）；调度触发与 misfire（D10）；Harness 进程生命周期、MCP 子进程托管与 `session/resume`（适配层，D12 接入）；shell 的操作系统级约束（v0.1 以"仅审批放行 + 策略禁无人值守"为边界，见 SECURITY_DATA §3）。
- 节点输出保存在运行内存中（崩溃后随中断运行丢弃；恢复即新运行重算）；v0.1 不持久化节点输出内容。

## 测试

```powershell
pnpm --filter @deepseek-bot/runtime test     # vitest + v8 覆盖率门槛（行/语句/函数/分支 ≥ 80）
pnpm --filter @deepseek-bot/runtime typecheck
```

89 个用例：D06 原有 43 个（生命周期/失败策略/取消/审批节点/恢复），D08 新增 46 个——路径（段边界包含/symlink 逃逸/设备路径/大小写）、策略矩阵（policy×grant 双层操作、shell/网络/MCP 模式、digest 参数绑定）、审批门（QA-07：批准一次消费/拒绝不执行/digest 不符/TTL/取消/启动代次；QA-08：越界拒绝/junction 逃逸拒绝）、guard 单测与运行状态调和（工具等待时 run 显示 waiting_approval）。
