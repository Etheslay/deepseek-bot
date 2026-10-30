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

## 4. 决策所需

两负责人对以下三项达成一致并记录在本文档：① 采纳方案（A/B/C/D 或分步组合）；② D 方案下聊天示例数据的界面标注与发布说明口径；③ B 方案下 ui.* 命名空间的方法清单与非承诺声明。选择后：D 的 renderer 切片由 Destinyian 开独立分支执行；B 的 host 片由 Etheslay 执行。

## 5. 界面状态契约候选（待负责人确认）

本分支提出 `UiStateSchema`：`botOrder` 与 `groupOrder` 为去重的持久 UUID 列表，各最多 1000 项；`selectedBotId` 与 `selectedGroupId` 为 UUID 或 null。对象严格校验，不接受额外字段或任意文本。本片只定义类型与验证，不开放 Host 方法，不改变 IPC 协议版本。

现有桌面分组使用会话内数字 key，不能作为持久 UUID 使用；接线前须先核实真实分组实体、创建/移动行为与标识映射，明确空分组和不存在的实体的恢复策略。列表、选择态与字段边界为候选设计，需由负责人协调确认；本文不代表双方已确认，也不代表界面或存储已完成。

## 6. 工作流读面已补齐（v0.12，2026-10-30）

契约 v0.12 增加 `workflow.get`、`run.snapshot`、`approval.list`（见 [CONTRACTS](CONTRACTS.md) §3），Host 处理器已实现并有测试。§1 所说「`workflows.*` / `runs.*` 与契约面基本对应，可先行切换」现在只差桌面接线：

| 桌面 `DesktopService` 面 | 真实方法 | 备注 |
| --- | --- | --- |
| 打开/编辑工作流 | `workflow.get` + `workflow.save`（expectedRevision） | 「复制」由 get+save 组合，节点 id 重映射在渲染层完成；`workflow.import` 不回保存后的文档，导入后须重新 `workflow.list` 找 id |
| 工作流选择器 | `workflow.list` | 仅 id/name/revision 摘要 |
| 运行列表/详情 | `run.list` / `run.snapshot` | 快照一帧含 `nodeRuns`/`approvals`/`artifacts` |
| 审批收件箱 | `approval.list` + `approval.decide` | 夹具的 `invalidReason` 是 UI 级结论（过期、旧代次），真实路径需渲染层按 `expiresAt`/`status` 自行计算 |
| 事件推送 | `events.subscribe` | 本 build 恒 `snapshotRequired: false`；运行监控轮询即可 |

本片只补契约与 Host：`apps/desktop/src/renderer/src/services/host-service.ts` 仍在 `createFixtureService()` 上展开，`workflows`/`runs` 未覆盖——桌面接线与端到端验收另片执行（桌面片 Destinyian 负责，Host 支持 Etheslay 负责）。
