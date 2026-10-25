# D09 交付报告：运行监控与审批界面

- 任务：D09（里程碑 M2，FR-06 审批前端 / FR-07 运行历史前端）
- 分支：`feature/run-monitor`（base `develop`）
- 基线：`origin/develop` = `63bacf9`（2026-10-25 fetch 时点；D05 已随 PR #11 合并，D07 已随 PR #12/#13 合并）
- 提交：功能 `6bd9c40` `feat(run-monitor): implement run list, approvals, history and event consumption`（15 文件，+4058）；文档提交（本报告与 RUN_MONITOR / DESKTOP_SHELL 同步 + 截图）随后，docs-only 不追 tip
- 负责人：Destinyian
- 环境：Windows 11 (10.0.26200) · Node v24.16.0 · pnpm v11.28.5 · Electron 38.2.1 / electron-vite 4.0.1 / vitest 3.2.4 / React 19.1.1 · zod 4.6.7（contracts）

## 0. 开工门禁记录

| 门禁项 | 结果 |
| --- | --- |
| `origin/develop` 已含 D05 | ✅ PR #11（`4cd6e4d`），fetch 确认 |
| `origin/develop` 已含 D07 | ✅ PR #12（`e6a8bcb`）+ PR #13（`63bacf9`） |
| 从该 develop 拉分支、工作区干净 | ✅ 原临时分支 `D09` 无提交，改名为规范分支：`git switch -c feature/run-monitor origin/develop` 后删除 `D09`；除本地未跟踪材料（handoff/ 等）外干净 |
| 已读契约/文档 | ✅ CONTRACTS §2/§3/§4/§5/§6、contracts 的 status/events/entities/methods/primitives、fixtures README、PRD FR-06/07、D05/D07 报告、DESktop_SHELL/WORKFLOW_EDITOR |
| D06/D08 状态 | ⚠️ **任务书原文假设 D06 尚未合入，实际已随 PR #10 合入**（同 D07 报告记录的前提变化）。按红线执行：监控视图不 import `@deepseek-bot/runtime`、不执行工作流；仅**只读参考**了引擎 `run-execution.ts` 的 `retryNode` 规则（活跃运行/最新失败 attempt/下游未推进）并在夹具服务中镜像该语义。D08 未合入，后端审批拦截不存在，本任务不冒充 |
| 记录 develop SHA | ✅ `63bacf9` |

## 1. 交付范围

监控/审批/历史前端 + 事件消费 + 契约夹具驱动：

```text
apps/desktop/src/renderer/src/features/run-monitor/
  run-service.ts            RunServiceApi（list/get/listApprovals/snapshot/subscribe/cancel/
                            retryNode/decideApproval/pullTransient/advanceScenario）
                            + 夹具剧本存储（8 个场景运行，契约事件逐条 schema 校验）
  run-monitor.tsx           壳组件（列表/详情/审批收件箱/播放控制/动作编排）
  events/event-stream.ts    纯逻辑：eventId+sequence 双重去重、单调接收、缺口→snapshotRequired、
                            快照重建、断线续订（无 React，可单测）
  events/run-view.ts        纯逻辑：快照+事件 → 视图模型；run/node 迁移全部经 contracts
                            状态机（canTransitionRun/canTransitionNodeRun），非法迁移记录并拒绝
  run-list/run-list.tsx     运行列表（活跃/历史分组、状态/触发/时间/工作流名，roving tabindex）
  run-detail/run-detail.tsx 监控标签：状态头+取消、节点 attempts、审批卡、事件流+去重计数、
                            snapshotRequired 横幅、瞬态流区、夹具回放控制
  approvals/approval-card.tsx 审批卡片（actionDigest+resource 精确参数、TTL、允许/拒绝、
                            过期/代次/已消费失效原因）+ 收件箱条目
  history/run-history.tsx   历史标签：workflowSnapshot/Bot 快照、产物表（含 sha256）、
                            sessionId 定位、interrupted 原因与 resumedFromRunId 跳转
```

集成：`DesktopService` 接口新增 `runs` 组（D05 注入模式不变）；App 头部新增「运行监控与审批」入口（与工作流编辑器互斥切换）；**IPC 白名单与 preload 未动**（`ipc-registry.test.ts` 原样通过）。

契约红线遵守：未新增/修改 `packages/contracts` 任何字段（UI 层视图类型 `ApprovalBaseline.invalidReason` 等仅存在于 desktop 服务层，文件头注明）；状态/事件/实体全部来自 contracts；夹具剧本仅走状态机允许的迁移。

## 2. 验收清单（D9-1 – D9-17）

| # | 步骤 | 命令 / 证据 | 退出码 | 时间 |
| --- | --- | --- | --- | --- |
| D9-1 | 干净安装 | `pnpm install --frozen-lockfile` | 0（Already up to date, 111ms） | 00:33 |
| D9-2a | lint | `pnpm lint`（根，eslint .） | 0 | 00:47 |
| D9-2b | typecheck | `pnpm typecheck`（5 包全过） | 0 | 00:47 |
| D9-2c | test | `pnpm test`（339 例全绿：shared 6 / contracts 64 / desktop 120 / storage 106 / runtime 43；desktop 含 D09 新增 34 例：event-stream 7 + run-view 8 + run-service 19） | 0 | 00:47 |
| D9-3 | 运行列表 | d09-01：8 个运行按 createdAt 倒序、活跃/历史分组、状态徽章/触发方式/时间/工作流名断言；排序与过滤单测 | — | 01:05 |
| D9-4 | 运行详情 | d09-02/08：节点状态（per-attempt）、时间线、事件流（lastSequence 断言）、瞬态流展示断言 | — | 01:05 |
| D9-5 | 状态机 | run-view 单测：RUN/NODE 全表断言（含 cancelling→[cancelled,interrupted]、skipped 终态）；非法迁移（succeeded→running、pending→succeeded）被拒并记录、状态不前进 | — | 00:39 |
| D9-6 | 取消 | d09-09（cancelling）→ d09-10（cancelled、按钮禁用）；单测：重复 cancel 幂等返回终态、事件只 +2 后停止、advance 拒绝 | — | 01:05 |
| D9-7 | 审批-允许 | d09-02（actionDigest/resource/expiresAt/所属 run·node 精确参数断言）→ d09-03（waiting_approval→running）→ d09-04（执行完成、consumed、按钮禁用）；单测含产物生成 | — | 01:05 |
| D9-8 | 审批-拒绝 | 单测：节点 failed（operator denied）、运行 failed + `run.failed(APPROVAL_REQUIRED)`、上游已完成节点保持 succeeded（stop-descendants 语义）；无副作用（纯前端反映） | — | 00:39 |
| D9-9 | 过期/重复/重放 | d09-06（已过期、按钮禁用）；单测三条路径全拒：`APPROVAL_EXPIRED`（过期，无事件追加）/ `INVALID_INPUT`（已消费不可重复决定，事件数不变）/ `APPROVAL_EXPIRED`+代次原因（重放拒绝）；d09-07（「已失效（启动代次绑定）」+按钮禁用）；摘要不匹配拒绝单测 | — | 01:05 |
| D9-10 | 事件去重 | d09-16（成功运行「去重丢弃 1」断言，至少一次投递演示）；crash-reconnect 单测：afterSequence=3 → seq 4-6（eventId 与夹具一致）、afterSequence=0 → events=[] + snapshotRequired=true；event-stream 单测：eventId/旧 sequence 双重去重、缺口不补齐 | — | 01:05 |
| D9-11 | 历史 | d09-05（workflowSnapshot 名称/版本/schemaVersion/节点边数、产物表 reports/review.md）；sessionId 定位单测（sess-success-run）；d09-13 | — | 01:05 |
| D9-12 | 中断恢复 | d09-11（snapshotRequired 横幅：不假装补齐）→ d09-12（按快照重建，interrupted 原因展示）→ d09-13（恢复运行历史页 resumedFromRunId 跳转链接断言 `run dddddddd`）；单测 resumedFromRunId 关联与终态断言 | — | 01:05 |
| D9-13 | 可访问性 | 全部操作为原生 `<button>`（取消/允许/拒绝/重试/切换运行/重建/推进）；运行列表 roving tabindex + ArrowUp/Down（d09 取证 keyboard-nav 断言 `activeElementIsRun=true`）；aria-label/role/status 齐备 | — | 01:05 |
| D9-14 | 契约 | 无重复类型定义；status/event/entity 全部 import 自 `@deepseek-bot/contracts`（见 run-view.ts / run-service.ts imports）；contracts 包零改动（`git diff origin/develop -- packages/contracts` 为空） | — | — |
| D9-15 | 安全 | 无 Key/用户数据/构建产物入库（`git status` 复核；out/、release/ 已 gitignore，取证材料在 handoff/ 本地不入库）；renderer 无 Node（IPC 白名单测试不变；preload 暴露面未动） | — | — |
| D9-16 | 构建 | `pnpm --filter @deepseek-bot/desktop build` | 0（3 段构建，renderer 182 modules，JS 1079.30 kB / CSS 98.50 kB） | 00:52 |
| D9-17 | 文档 | [RUN_MONITOR.md](../RUN_MONITOR.md) 新增、[DESKTOP_SHELL.md](../DESKTOP_SHELL.md) 增 D09 条目、本报告 | — | — |

> **构建环境注意事项**（同 D07 报告）：本机默认 TMP（`D:\AppCaches\Temp`）会让 esbuild 在清理临时副本时报 `Access is denied`（本次又复现，残留文件含 2026-10-24 的两枚）。解决：`set TMP/TEMP` 指到可写目录（本次用 `D:\PersonProgram\deepseek-bot\.tmp-esbuild`，构建后删除）后构建通过。环境问题，非代码问题。

## 3. 手动证据（截图 + 断言）

方法同 D07：本执行环境无法拉起 Electron，改为**驱动真实生产构建产物**——`electron-vite build` 的 renderer 输出（`out/renderer`，与 Electron 加载同一 bundle）拷贝到 `handoff/d09-preview`（本地，不入库），注入 preload shim（仅补 `getAppInfo`/`setTitleBarOverlay`），无头 Chrome 1440×900 + CDP 驱动（`handoff/d09-evidence.mjs`，20 步断言全过 + 16 张截图，断言日志 `handoff/d09-evidence-log.json`）。Electron 专属部分（窗口控制条、托盘）未覆盖。

| 截图（docs/reports/assets/d09/） | 内容 |
| --- | --- |
| d09-01-run-list.png | 运行列表：8 个运行、活跃/历史分组、状态徽章 |
| d09-02-approval-card.png | 审批卡片特写（元素级裁剪，内容与 d09-01 不再重复）：等待审批、倒计时、resource `D:\workspaces\demo\report.md`、digest、允许/拒绝可用 |
| d09-03-approval-allowed.png | 允许后：运行中、卡片提示「一次消费，等待执行」 |
| d09-04-approval-consumed.png | 执行完成：已成功、卡片「已允许（一次消费，不可重放）」、按钮禁用 |
| d09-05-history.png | 历史标签：版本快照、产物表 reports/review.md |
| d09-06-approval-expired.png | 过期审批：已过期、按钮禁用 |
| d09-07-approval-generation.png | 代次失效：已失效（启动代次绑定）、按钮禁用、中断横幅 |
| d09-08-active-run-tool.png | 活跃运行：tool.requested 时间线 + 瞬态流文本 |
| d09-09-cancel-cancelling.png | 取消中 |
| d09-10-cancel-cancelled.png | 已取消、取消按钮禁用 |
| d09-11-snapshot-required.png | snapshotRequired 横幅（不假装补齐） |
| d09-12-snapshot-rebuilt.png | 按快照重建后：interrupted 原因展示 |
| d09-13-resumed-run.png | 恢复运行历史页：resumedFromRunId 跳转链接 |
| d09-14-retry-new-attempt.png | run.retryNode：新 attempt（运行中） |
| d09-15-retry-completed.png | 重试后整图完成：已成功 |
| d09-16-success-dedupe.png | 成功运行：「去重丢弃 1 · lastSequence 6」、产物时间线 |

关键断言摘录（完整见 d09-evidence-log.json）：

- approval-card：`resource=D:\workspaces\demo\report.md`、digest `9f86d081884c…b0f00a08`、TTL 剩 9:59、允许/拒绝可用；
- approval-consumed：状态已成功、`ttl=已允许（一次消费，不可重放）`、双按钮禁用；
- approval-generation-stale：`ttl=已失效（启动代次绑定）`、双按钮禁用、中断横幅含原因；
- cancel-done：已取消、取消按钮禁用（幂等重复点击不会追加事件——单测覆盖）；
- snapshot-required：横幅文案「按契约返回 snapshotRequired——不假装补齐」；
- success-run-dedupe：`去重丢弃 1 · lastSequence 6`；
- keyboard-nav：ArrowDown 后焦点仍在运行列表项上。

## 4. 服务层与夹具说明

- 数据源为 `createFixtureRunService()` 的**剧本回放**（advanceScenario），挂在 `DesktopService.runs`；UI 只依赖 `RunServiceApi` 接口，未来可替换为 IPC/Host 实现（D12）。
- 场景与夹具映射（8 个运行）：成功（success-run.json 逐事件复用 + artifact.created 合成）、取消（cancel-run.json 语义：两次 cancel 幂等）、审批允许/拒绝（approval-denied.json 事件形态）、过期（approval-expired.json：decide → APPROVAL_EXPIRED，过期扫尾事件补齐 §5 终态）、代次失效（CONTRACTS §2「启动代次绑定」：旧代次审批 decide → APPROVAL_EXPIRED + 代次原因）、中断保留窗口（crash-reconnect.json 交互 1/2 逐字复现：seq 4-6 / snapshotRequired）、恢复运行（crash-reconnect.json events[0]，resumedFromRunId 关联）、失败重试（引擎 retryNode 规则镜像）。
- 夹具切片共享一个递增 sequence 空间的原始设计改为「每个场景独立 Run」：runId/nodeRunId 重映射为共享 ID 池形态的合成 ID（见 run-service.ts 文件头与 `FIXTURE_RUNS` 常量），每个 envelope 过 `EventEnvelopeSchema` + `parseEventPayload`，迁移经 `assertRunTransition`/`assertNodeRunTransition`。
- 事件消费三件套位置：去重/缺口/快照重建在 `events/event-stream.ts`；视图折叠与非法迁移拒绝在 `events/run-view.ts`；保留窗口语义在 `subscribe()`（afterSequence+1 < floor → 空 events + snapshotRequired=true，镜像 crash-reconnect 交互 2）。
- `assistant.delta` 瞬态流：pullTransient 拉取、单独区域渲染，不进时间线、不占 sequence、不重放。

## 5. 未验证项（不冒充完成）

1. **真实引擎事件**：不执行工作流（D06 已合入但本视图未依赖）；所有事件为夹具剧本。
2. **后端审批拦截**：副作用前的强制拦截属 D08；本任务仅请求展示、决定调用与失效反馈。
3. **持久化**：重启后运行/审批状态丢失（D04）；历史数据来自服务层夹具。
4. **调度触发**：run.trigger.schedule 展示路径存在但无调度器（D10）。
5. **真实 Host 事件流**：events.subscribe 的真实传输层与保留窗口策略属 D12 集成。
6. **Electron 内运行**：窗口控制条、托盘等 Electron 专属行为未覆盖（取证驱动的是同一 renderer bundle 的浏览器渲染，同 D07）。

## 6. 已知问题与回退

- 构建依赖 TMP workaround（见 §2 注意事项；环境问题，已两任务复现，建议本机调整默认 TMP ACL）。
- 审批「拒绝」路径未单独截图（允许路径已覆盖卡片全生命周期；拒绝的 UI 状态与失败横幅由单测断言，拒绝后运行 failed 展示同 d09 系列样式）。可在复核时补拍。
- 快照重建后运行列表内的 `sessionId` 显示依赖快照 nodeRuns（单测覆盖）；审批节点无 session（符合契约，Harness 会话仅存在于 bot 节点 attempt）。
- 回退方式：本分支仅新增 features/run-monitor/ + 3 处接入点（DesktopService/fixture-service/App.tsx）+ 样式段 + 文档；回滚 revert 功能提交即可，无迁移、无契约变更、无 IPC 改动。

## 7. PR 描述草稿

> **分支已推送**：`feature/run-monitor` → `origin`（功能 `6bd9c40` + 文档 `8b2f6d2` + 本记录 `docs` 提交）。
> **草稿 PR 创建受阻（如实记录）**：本机未安装 GitHub CLI（`gh` 不在 PATH，常见安装位置亦未找到），无法从命令行创建草稿 PR。由负责人经 https://github.com/Etheslay/deepseek-bot/pull/new/feature/run-monitor 创建（base=`develop`，勾选 Draft），描述可用下文草稿。

> **feat(run-monitor): implement run monitoring, approvals and history UI (D09)**
>
> - 运行列表/详情：契约状态机驱动的节点状态与时间线、事件流（去重计数、snapshotRequired 重建、瞬态流）、取消 cancelling→cancelled、失败节点 run.retryNode 入口
> - 审批（FR-06 前端）：精确参数卡片（actionDigest/resource/TTL）、允许/拒绝、过期/重复决定/启动代次重放三类拒绝反馈
> - 历史（FR-07 前端）：版本快照、产物、sessionId 定位、interrupted 与 resumedFromRunId 关联
> - 服务层：RunServiceApi 夹具剧本（D03 契约夹具驱动，事件逐条 schema 校验）；DesktopService.runs 注入
> - 测试：desktop +34（event-stream/run-view/run-service）；工作区 339 全绿
> - 文档：RUN_MONITOR.md、DESKTOP_SHELL.md、D09-report.md
>
> 验证：lint/typecheck/test/build 全过（exit 0）；16 张 CDP 取证截图 + 20 步断言（报告 §3）。
> 未验证：真实引擎/后端拦截/持久化/调度（报告 §5）。

## 8. 负责人自审记录

（由负责人 Destinyian 在合并前填写：自审人、提交 SHA、日期、差异检查结果、测试证据、遗留问题、结论。）
