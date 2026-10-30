# Renderer → Host 数据映射提案（D12）

状态：**提案，待双方负责人选择**（2026-10-25，Etheslay 整理）。读者：Etheslay、Destinyian。选择结果记录到本文档后，由对应负责人按选择执行并自审。

## 1. 背景

渲染层目前跑在夹具数据上（D05/D07/D09 的既定策略：界面只依赖 `DesktopService` 接口，实现可替换）。Host 侧（D12 五片已合并/在途）已提供完整的 CONTRACTS §3 契约面，但 `DesktopService` 有三块**在契约中不存在**：

| UI 面 | 现状 | 差距 |
| --- | --- | --- |
| `chat.*`（会话列表/回放/流式对话/取消） | 夹具回放 | CONTRACTS v0.1 冻结时无 Session 实体（`desktop-service.ts` 内有注释锚定）；真实会话数据在 Harness 会话日志 |
| `artifacts.listBySession(sessionId)` | 夹具 | 契约产物挂在 run/nodeRun 下，无「按聊天会话」维度 |
| `settings.saveKey` | 夹具内存 | 涉及 safeStorage + 凭据 blob 流程（D12 桌面片已实现解密通道） |

`workflows.*` / `runs.*`（运行监控）与契约面基本对应，可先行切换。

## 2. 方案

### A. 扩契约（v0.2）

把 Session/聊天方法正式加入 CONTRACTS（升 protocolVersion，按契约 §7 走变更流程）。
- 改动：contracts schema/方法/测试 + Host 处理器 + 适配层会话日志映射 + UI 接线；两人都有份。
- 优点：唯一长期干净解；UI 语义全部契约化。
- 代价/风险：触碰冻结契约与全部已合并使用方；工作量最大（人日级 × 2）；v0.1 发布时间受影响。

### B. Host 加 UI 专用会话服务（不动契约）

Host 内实现 `ui.*` 命名空间的会话服务（读写 Harness 会话日志 + 应用侧会话注册表），经同一 stdio 通道暴露，桌面白名单加组；定位与 D05 `ChatSessionView` 的「UI-only 类型不进契约」先例一致。
- 改动：主要在 host + preload（Etheslay）；UI 接线（Destinyian）。
- 优点：契约零改动；聊天可真实化；工作量中等。
- 代价/风险：接口面出现「契约 + UI-only」两层，须在文档中明确 ui.* 的非承诺地位（升级不保证兼容）。

### C. 聊天直连 Harness 会话

单机器人聊天绕过工作流引擎，Host 直通 Harness 会话（`session/prompt`/resume 模型，D01 §8 已验证），流式经 stdio 推送；工作流运行仍走引擎。
- 改动：同 B 的通道 + 流式推送帧 + UI 流式桥。
- 代价/风险：工作量中等偏大；与 B 相比多一套流式语义，取消/恢复语义要单独对齐（D01 §8.2：无取消方法=杀进程）。

### D. v0.1 只上「运行监控」真实数据

`runs/workflows/approvals/schedules` 系列方法接到运行监控与机器人工作区视图（契约面已全通）；`chat.*` 留夹具并在界面明确标注「示例数据」。
- 改动：几乎全在 renderer（Destinyian 执行，Etheslay 支持）；后端已就绪。
- 优点：最小工作量立即消除大部分假数据；QA-05/07 相关 UI 立即可用。
- 代价/风险：聊天对用户仍是示例数据——发布说明必须如实标注；QA-03「真实任务完成」的验收口径需在 D13 明确。

## 3. 推荐

**分两步：先 D 后 B。** 第一步（D）renderer 为主、立即可做，让运行监控/审批/调度全部真起来；第二步（B）在同一版本内落地聊天会话服务，不动冻结契约。A 的长期契约化收益待 B 稳定后按 §7 正常升级（v0.2）。C 不单独推荐（B 已覆盖其通道需求，流式可在 B 之上增量）。

## 4. 拍板 #1 记录（2026-10-30 更新）

两负责人对以下三项达成一致并记录在本文档：① 采纳方案（A/B/C/D 或分步组合）；② D 方案下聊天示例数据的界面标注与发布说明口径；③ B 方案下 ui.* 命名空间的方法清单与非承诺声明。选择后：D 的 renderer 切片由 Destinyian 开独立分支执行；B 的 host 片由 Etheslay 执行。

**当前记录**（如实，非双方会签）：

- **D 步**：聊天/历史事实接线已先行落地（运行监控真实化、`chat.history` 接线、存储会话列表——PR #97/#103；工作流读面 #176/#177）；界面标注口径仍待 Destinyian。
- **B 步 ui.***：**Etheslay 于 2026-10-31 指示按 G1' 既定草案推进**（GAP_AUDIT §2 G1' 的实现方式），采纳方案 B 的 ui.* 清单为：`ui.state.get` / `ui.state.set`（v0.13）+ 固定 `UiStateSchema` 快照（botOrder/groupOrder/selectedBotId/selectedGroupId，仅稳定实体 UUID，不收任意载荷）。Destinyian 对本清单的会签**待补**；分组实体（现会话内数字 key）映射另行核实，`groupOrder`/`selectedGroupId` 在实体化前由渲染层写空值。

## 5. 界面状态契约（候选已采纳，方法面见 v0.13）

`UiStateSchema`（#175 契约候选，本片随 v0.13 采纳）：`botOrder` 与 `groupOrder` 为去重的持久 UUID 列表，各最多 1000 项；`selectedBotId` 与 `selectedGroupId` 为 UUID 或 null。对象严格校验，不接受额外字段或任意文本。Host 方法面为 `ui.state.get` / `ui.state.set`（settings KV 行 `ui.state.v1`，缺失/损坏行降级空态，见 [CONTRACTS](CONTRACTS.md) §3 与 `packages/host/src/ui-state.ts`）。

现有桌面分组使用会话内数字 key，不能作为持久 UUID 使用；`groupOrder`/`selectedGroupId` 的启用以分组实体化（核实真实分组实体、创建/移动行为与标识映射）为前提，渲染层在实体化前写空值。快照不含任何密钥/敏感数据（schema 只收 UUID）。

## 6. 工作流读面与桌面接线（v0.12，2026-10-30）

契约 v0.12 增加 `workflow.get`、`run.snapshot`、`approval.list`（见 [CONTRACTS](CONTRACTS.md) §3），Host 处理器已实现并有测试（PR #176）。桌面接线随后落在 `feature/workflow-host-wiring`：

- `host-service.ts` 已用 `createHostWorkflowService` / `createHostRunService` 覆盖 `workflows`/`runs`，不再落到夹具；夹具实现保留用于离线 UI 开发。
- 编辑器导入按"预览校验、确认才载入、模板不落库"的契约实现：调用 `workflow.validate`，**不调用会落库的 `workflow.import`**。
- 运行监控用 `runs.playback` 区分来源：仅 fixture 模式显示「夹具回放」徽章与推进/模拟重连控制；host 模式隐藏，`advanceScenario` 直接拒绝。

| 桌面 `DesktopService` 面 | 真实方法 | 备注 |
| --- | --- | --- |
| 打开/编辑工作流 | `workflow.get` + `workflow.save`（expectedRevision） | 「复制」由 get+save 组合，节点 id 重映射在渲染层完成 |
| 工作流选择器 | `workflow.list` | 仅 id/name/revision 摘要 |
| 运行列表/详情 | `run.list` / `run.snapshot` | 快照一帧含 `nodeRuns`/`approvals`/`artifacts` |
| 审批收件箱 | `approval.list` + `approval.decide` | `requestedAt = expiresAt − APPROVAL_DEFAULT_TTL_MS` 推导；`invalidReason` 只能判过期（契约不透出 generation/resolvedAt） |
| 事件推送 | `events.subscribe` | 本 build 恒 `snapshotRequired: false`；运行监控轮询即可 |

剩余差异（未改契约，记为后续缺口）：`Approval` 不暴露代次与解决时间；`run.list` 只有单页；host 模式无瞬态增量。端到端 UI 验收（真实三机器人运行、重启恢复、历史）仍未执行，见 [WORKFLOW-HOST-WIRING 报告](reports/WORKFLOW-HOST-WIRING-report.md)。
