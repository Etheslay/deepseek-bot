# 工作流主路径桌面接线报告（WORKFLOW-HOST-WIRING）

- 分支：`feature/workflow-host-wiring`
- 基线：`origin/develop` `776b873`（PR #176 读面 v0.12 合入后）
- 日期：2026-10-30
- 范围：`apps/desktop` 渲染层服务层与运行监控 UI；不改契约、不改 Host 处理器、不迁移数据。

## 1. 问题

契约 v0.12 与 Host 处理器已提供 `workflow.get`、`run.snapshot`、`approval.list`，但桌面 `createHostService()` 仍从 `createFixtureService()` 展开，`workflows`/`runs` 两个面完全沿用夹具：工作流"保存"只写内存、重启即失，运行监控播放的是脚本夹具而不是真实引擎。

## 2. 做了什么

新增两个 host 版服务并接入 `createHostService`：

| 文件 | 内容 |
| --- | --- |
| `apps/desktop/src/renderer/src/services/host-call.ts` | `HostCall` 类型，供两个服务工厂共用 |
| `apps/desktop/src/renderer/src/services/host-workflow-service.ts` | `createHostWorkflowService`：list/get/save/copy/validate/exportTemplate/importTemplate；响应统一过契约 Zod response schema |
| `apps/desktop/src/renderer/src/services/host-run-service.ts` | `createHostRunService`：list/get/listApprovals/snapshot/subscribe/cancel/retryNode/resume/decideApproval；`playback: "host"` |
| `apps/desktop/src/renderer/src/services/host-service.ts` | `artifactCall` 更名 `hostCall` 并共享给两个新服务；返回值加入 `workflows`/`runs`；头注释更新 |
| `apps/desktop/src/renderer/src/services/desktop-service.ts` | `workflows`/`runs` 注释改为 host-backed，说明夹具仍可离线使用 |

语义对齐点：

- **保存**：`workflow.save` 带 `expectedRevision`（仅在调用方给出时携带），`REVISION_CONFLICT` 原样透出给编辑器横幅。
- **复制**：`workflow.get` → 渲染层 `duplicateDraft`（节点 id `-copy` 重映射、名称「副本」）→ `workflow.save` 新建；Host 不提供克隆方法。
- **导入**：编辑器语义要求"先预览校验、确认后才载入画布、模板不落库"，而 Host 的 `workflow.import` 会直接落库。因此编辑器路径改为结构校验（照抄夹具顺序：尺寸上限 → 外层版本 → 内层版本 → `WorkflowDraftSchema` → 图校验）后再调 `workflow.validate` 取服务端图错误，返回 draft，**不调用 `workflow.import`、不落库**。
- **运行监控**：`run.list`/`run.snapshot`/`events.subscribe`/`run.cancel`/`run.resume`/`run.retryNode`/`approval.decide` 直映射；审批 baseline 的 `requestedAt` 用 `expiresAt − APPROVAL_DEFAULT_TTL_MS` 推导，`invalidReason` 仅在 pending 且已过期时置 `"expired"`。
- **夹具回放标记**：`RunServiceApi` 新增 `readonly playback: "fixture" | "host"`。运行监控仅在 `playback === "fixture"` 时显示「夹具回放 · FR-06/07」徽章与 `run-detail` 的夹具控制区；`advanceScenario` 在 host 模式抛 `INVALID_INPUT`（新增文案 `runs.fixtureOnlyControl`）。
- **已决定审批的显示**：真实 Host 只返回 `status`，不返回 resolved 记录，故 `run-view.ts` 新增 `approvalDecisionFromStatus`，把 approved/consumed/denied/expired 映射为与夹具一致「已决定，不可重放」文案；不伪造 `resolvedAt`。

## 3. 改动文件

| 文件 | 说明 |
| --- | --- |
| `apps/desktop/src/renderer/src/services/host-call.ts` | 新增 |
| `apps/desktop/src/renderer/src/services/host-workflow-service.ts` | 新增 |
| `apps/desktop/src/renderer/src/services/host-run-service.ts` | 新增 |
| `apps/desktop/src/renderer/src/services/host-service.ts` | 接线 + 改名 |
| `apps/desktop/src/renderer/src/services/desktop-service.ts` | 注释 |
| `apps/desktop/src/renderer/src/features/run-monitor/run-service.ts` | 接口加 `playback`，夹具实现回 `"fixture"` |
| `apps/desktop/src/renderer/src/features/run-monitor/events/run-view.ts` | 新增 `approvalDecisionFromStatus` |
| `apps/desktop/src/renderer/src/features/run-monitor/approvals/approval-card.tsx` | 终态 approval 的文案回退 |
| `apps/desktop/src/renderer/src/features/run-monitor/run-detail/run-detail.tsx` | 夹具控制区按 `fixturePlayback` 显隐 |
| `apps/desktop/src/renderer/src/features/run-monitor/run-monitor.tsx` | 徽章与控制区随 playback 切换，头注释更新 |
| `apps/desktop/src/shared/i18n/messages/runs.ts` | 新增 `runs.fixtureOnlyControl`（zh/en） |
| `apps/desktop/tests/services/host-service.test.ts` | 新增 workflow/run 两个 describe（11 例） |
| `apps/desktop/tests/features/run-view.test.ts` | 新增状态→决定映射用例 |
| `docs/RENDERER_HOST_MAPPING.md` | §6 补接线结果与剩余差异 |
| `docs/RUN_MONITOR.md`、`docs/WORKFLOW_EDITOR.md` | 状态说明改为「host-service 已接线，夹具保留离线开发」 |

## 4. 实际检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 桌面 typecheck | `pnpm --filter @deepseek-bot/desktop typecheck` | exit 0 |
| 全仓 typecheck | `pnpm typecheck` | exit 0（10 包） |
| 桌面全量测试 | `pnpm --filter @deepseek-bot/desktop test` | exit 0，78 文件 / 695 用例全过 |
| 目标用例 | `vitest run tests/services/host-service.test.ts tests/features/run-view.test.ts` | exit 0，44 用例全过 |
| Lint | `pnpm lint` | exit 0 |

## 5. 未验证与边界

- **未做**：真实 Harness 三机器人流程的端到端 UI 验收（需真模型调用与人工操作）；本次测试用假 bridge/夹具事件验证服务层映射与 UI 显隐逻辑，未启动真实桌面进程。
- **未验证**：`workflow.save` 的 `REVISION_CONFLICT` 在双窗口场景下的界面表现（Host 层已有错误码，UI 横幅为既有实现）；`workflow.export` 模板文件往返（导出到磁盘再导入）未跑。
- **契约差异（已记录，不在本片改契约）**：`Approval` 不暴露 `generation`/`requestedAt`/`resolvedAt`，故旧代次失效无法在真实路径判断（夹具的 `"generation"` 分支在 host 模式不会出现）；`run.list` 的 `nextCursor` 恒为 null（Host 单页）；`events.subscribe` 恒 `snapshotRequired: false`；`pullTransient` 在 host 模式恒返回空数组（真实引擎不产生瞬态增量）。
- **导入语义差异**：Host `workflow.import` 落库、编辑器要求惰性——本片用 `workflow.validate` 组合，未改 Host；若平台线希望统一语义，应另开契约/处理器片。
- **未做**：`docs/SPRINTS.md` §4 台账行与 `docs/GAP_AUDIT.md` §7.10 状态刷新——按计划放在本片合入后的台账刷新片处理。

## 6. 恢复与许可

- 回退：`git revert` 本 PR 即可恢复夹具行为（新文件独立，`host-service.ts` 的覆盖是可逆的两行）。
- 无契约变更、无数据迁移、无凭据读取、无付费调用。

## 7. 负责人自审

（由负责人填写；AI 辅助不得代为签署。）
