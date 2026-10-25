# 运行监控与审批（D09）

`features/run-monitor/` 交付 FR-06（审批前端）与 FR-07（运行历史前端）：运行列表/详情、契约状态机驱动的节点状态与时间线、事件流消费（去重/补齐/快照重建）、取消、审批卡片与运行历史。**全部数据来自契约夹具剧本（夹具回放）**：不执行工作流（D06）、不做后端审批拦截（D08）、不落库（D04）、不调度（D10）。

## 目录

```text
features/run-monitor/
  run-service.ts        RunServiceApi + 夹具剧本存储（8 个场景运行）
  run-monitor.tsx       壳：列表 + 详情（监控/历史）+ 审批收件箱 + 播放控制
  events/event-stream.ts  纯逻辑：事件去重、sequence 单调、缺口、snapshotRequired
  events/run-view.ts      纯逻辑：快照 + 事件 → 视图模型（contracts 状态机校验）
  run-list/run-list.tsx   运行列表（活跃/历史，roving tabindex 键盘可达）
  run-detail/run-detail.tsx 监控标签：状态头、取消、节点 attempts、事件流、瞬态流
  approvals/approval-card.tsx 审批卡片（精确参数、允许/拒绝、失效原因）
  history/run-history.tsx  历史标签：版本快照、产物、sessionId、中断/恢复关联
```

服务层沿用 D05/D07 注入模式：`DesktopService.runs`，UI 只依赖 `RunServiceApi` 接口；夹具实现可被未来 IPC/Host 实现替换。

## 场景剧本（夹具回放）

| 运行 | 演示 | 契约夹具 |
| --- | --- | --- |
| 成功 | 全链路事件回放（seq 0-6，含 artifact.created）+ 至少一次投递重复 | success-run.json（逐事件复用） |
| 进行中 | tool.requested + 瞬态流；取消 cancelling → cancelled 后事件停止 | cancel-run.json 语义 |
| 等待审批（有效） | 审批卡片、允许（→执行→consumed）/ 拒绝（→APPROVAL_REQUIRED） | approval-denied.json 语义 |
| 等待审批（过期） | 决定被拒（APPROVAL_EXPIRED）、卡片显示已过期 | approval-expired.json |
| 中断 + 旧审批 | interrupted 展示、代次绑定失效原因 | crash-reconnect.json 事件（重映射） |
| 中断（保留窗口） | afterSequence=3 补齐 seq 4-6；afterSequence=0 → snapshotRequired | crash-reconnect.json 交互 1/2 |
| 恢复运行 | resumedFromRunId 关联与跳转 | crash-reconnect.json events |
| 失败可重试 | run.retryNode 新 attempt；非失败/重复/终态运行拒绝 | 引擎规则（runtime/run-execution.ts 镜像） |

夹具事件按场景切片播种到不同示例 Run：runId/nodeRunId 重映射为共享 ID 池形态的合成 ID；每个 envelope 都过 `EventEnvelopeSchema` + 对应 payload schema；剧本只走 contracts 状态机允许的迁移（`assertRunTransition` / `assertNodeRunTransition`）。

## 事件消费（CONTRACTS §4）

- 订阅：`subscribe(runId, afterSequence)`；持久事件可重放，`sequence` 同 Run 内严格递增；
- 去重：按 `eventId` 与 `sequence` 双重去重（至少一次投递安全；成功场景响应中故意重复一个 envelope 供 UI 演示计数）；
- 补齐：断线重连按 `afterSequence` 增量补齐（crash-reconnect 交互 1）；
- 缺口：检测到 sequence 缺口不假装补齐——置 `snapshotRequired`，UI 提示并按 `run.get` 快照重建（crash-reconnect 交互 2：保留窗口外返回空事件 + snapshotRequired=true）；
- 瞬态流：`assistant.delta`（streamId/chunkIndex）单独区域展示，不占持久 sequence、不重放。

## 审批语义（FR-06）

- 卡片展示**精确参数**：`actionDigest`、目标 `resource`（将执行的写操作）、`expiresAt`（默认 10 分钟）、所属 run/nodeRun；
- 允许 → `approval.resolved(approved)` + 节点/运行恢复 running，执行完成后审批 **consumed**（一次消费）；
- 拒绝 → 节点 failed（reason: operator denied）、运行 failed（errorCode APPROVAL_REQUIRED，stop-descendants）；
- 过期 → `APPROVAL_EXPIRED`（retryable=false），无事件追加；
- 重复决定 → `INVALID_INPUT`「已解决（一次消费）」，不重复执行；
- 重启重放 → 审批绑定启动代次（CONTRACTS §2「启动代次绑定」）：旧代次审批显示「已失效（启动代次绑定）」，决定返回 `APPROVAL_EXPIRED` 并说明代次原因；
- `expectedActionDigest` 不匹配在状态改变前拒绝。

## run.retryNode（引擎规则镜像）

仅活跃运行、仅最新失败 attempt、无已推进的下游节点；终态运行拒绝（恢复走新 Run）。重试生成新 attempt（pending → running 事件），夹具剧本随后可完成整图。

## 契约边界

| 能做（UI/夹具） | 不做（后续任务） |
| --- | --- |
| 状态机展示（全部来自 contracts `status.ts`） | 引擎真实执行（D06，已合入但本视图不依赖） |
| 取消 UI + cancelling → cancelled 展示 | 真实取消传播 |
| 审批展示/决定/失效反馈 | 副作用前拦截的强制（D08 后端） |
| 事件订阅/去重/补齐/快照重建 | 真实 Host 事件（D12 集成） |
| 历史/快照/产物/sessionId 定位入口 | 重启后恢复查看（D04 持久化）、会话跳转（D12） |

不新增契约字段、不修改 `packages/contracts`；所有状态/事件类型来自 contracts。

## 测试

```powershell
pnpm --filter @deepseek-bot/desktop test   # tests/features/event-stream|run-view + tests/services/run-service
```

覆盖：状态机全表断言与非法迁移拒绝、事件去重/单调/缺口/snapshotRequired、取消幂等与事件停止、审批允许/拒绝/过期/重复/代次/摘要不匹配、重试三拒绝路径与完成、列表排序与快照/产物/sessionId、resumedFromRunId 关联。键盘可达为结构保证（原生 button + roving tabindex + aria），证据见 D09 报告手动项。
