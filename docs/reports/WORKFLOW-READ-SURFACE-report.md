# 工作流读面契约 v0.12（workflow.get / run.snapshot / approval.list）

日期：2026-10-30（Asia/Shanghai）。负责人：Etheslay。分支：`feature/workflow-read-surface`，目标 `develop`。基线：`6254d04f214929e2ebea007e337cbcd82623b9da`（`origin/develop`，含 PR #173–#175）。本文只记本分支的改动与实际跑过的检查，不代表真人自审或合并结论；自审必须针对该分支最新提交 SHA。

范围：[GAP_AUDIT](../GAP_AUDIT.md) §7.10 登记「桌面工作流/运行仍是夹具」与 [RENDERER_HOST_MAPPING](../RENDERER_HOST_MAPPING.md) §1「`workflows.*` / `runs.*` 可先行切换」的契约侧前提。本片只补三个纯增量读方法、Host 处理器、测试与文档；**桌面接线不在本片**。

## 1. 交付行为

- 契约版本 `0.11` → `0.12`（`packages/contracts/src/version.ts`）：新增方法属加法扩展，既有方法语义不变，接受列表补 `"0.11"`，与 `0.12` 一起保证 0.1–0.11 发送方继续可解析；工作流文档 `schemaVersion` 仍为 `0.1`（存量数据可读）。
- 新增三个方法（`packages/contracts/src/methods.ts`，METHODS 白名单 122 → 125）：
  - `workflow.get`：请求 `{id: UUID}`（严格字段）→ 完整 `Workflow`。`workflow.list` 只回 `id/name/revision` 摘要，`workflow.export` 必须先给 `expectedRevision`，都不能支撑「按 id 打开编辑器」；不存在的 id 返回 `INVALID_INPUT`。
  - `run.snapshot`：请求 `{runId: UUID}` → `{run, nodeRuns[], approvals[], artifacts[]}`，均按该 run 过滤。运行监控需要一个一致帧；`RunSchema` 不含 node runs，分别调用会在状态漂移时拼出自相矛盾的画面。
  - `approval.list`：请求 `{runId?: UUID, status?: APPROVAL_STATUSES, limit?: 1–100（缺省 50）}` → `{approvals: Approval[]}`，按创建时间正序、Host 侧截断。审批收件箱跨运行；`permission.approval.list` 属能力授权域，schema 不同。
- Host 处理器（`packages/host/src/handlers.ts`）只组合既有存储读：`getWorkflow`、`getRun` + `listNodeRuns` / `listApprovals` / `listArtifacts`。无新表、无迁移、无引擎改动。
- 文档：`docs/CONTRACTS.md` 升 v0.12 并补版本沿革段与 §3 三行；`docs/RENDERER_HOST_MAPPING.md` 增 §6，标注读面已补齐、桌面仍用夹具、接线与验收另片。
- 明确不做：`apps/desktop/src/renderer/src/services/host-service.ts` 的 `workflows`/`runs` 覆盖、渲染层调用、事件推送语义（`events.subscribe` 仍恒 `snapshotRequired: false`）。

## 2. 改动文件

| 文件 | 改动 |
| --- | --- |
| `packages/contracts/src/version.ts` | `CONTRACT_VERSION` 0.12；接受列表补 `"0.11"`；版本沿革注释 |
| `packages/contracts/src/methods.ts` | METHODS 增 3 项；METHOD_CONTRACTS 增 3 块 schema；import `ArtifactSchema`、`APPROVAL_STATUSES` |
| `packages/contracts/src/workflow-read-surface.test.ts` | 新增 4 例：协议加法与旧版本接受、`workflow.get` 严格请求、`run.snapshot` 帧结构、`approval.list` 缺省与过滤 |
| `packages/contracts/src/methods.test.ts` | 方法数 122 → 125（含注释） |
| `packages/contracts/src/chat-skill.test.ts`、`screen.test.ts` | 协议断言 0.11 → 0.12，接受列表补 0.11 |
| `packages/host/src/handlers.ts` | `workflow.get` / `run.snapshot` / `approval.list` 处理器；import `listNodeRuns` / `listApprovals` / `listArtifacts` |
| `packages/host/src/host.test.ts` | 端到端测试追加断言：`workflow.get` 回原文与 revision、`run.snapshot` 一帧、`approval.list` 过滤、未知 workflow id 报 `INVALID_INPUT` |
| `docs/CONTRACTS.md` | 版本升 0.12 段落 + §3 三行 |
| `docs/RENDERER_HOST_MAPPING.md` | 新增 §6 读面对照与剩余缺口 |

## 3. 实际检查

环境：Windows，Node v24.15.0，pnpm 11.28.5。工作树 `C:/Users/wu/.codex/worktrees/workflow-contract-audit/deepseek-bot`，自上述基线建出。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 退出 0（10 个 workspace 包，含 contracts、host、desktop 两个 tsconfig） |
| `pnpm --filter @deepseek-bot/contracts test` | 退出 0。16 文件 157 通过（新增 `workflow-read-surface.test.ts` 4 例） |
| `pnpm --filter @deepseek-bot/host exec vitest run src/host.test.ts` | 退出 0。9 通过（含新增读面断言；日志里 `approval bridge staging failed` 为该测试夹具的既有噪声，不影响结果） |
| `pnpm lint` | 退出 0 |
| `git diff --check` | 退出 0 |

## 4. 未验证与已知边界

- 未跑全量 host 套件：基线存在环境 flake（`mcp-chat.test.ts`、`real-app-tools.test.ts`、`task-dispatch.test.ts` 的 Harness `initialize` 时序，见 [WORKFLOW-USAGE-ACCOUNTING 报告](WORKFLOW-USAGE-ACCOUNTING-report.md)）；本片未触碰这些路径。
- 桌面未接线，真实 Electron 中没有调用方：`workflow.get`/`run.snapshot`/`approval.list` 的界面语义（编辑器打开、运行监控刷新、审批卡 `invalidReason`）仍需接线片与端到端验收确认。
- `approval.list` 只按存储既有 `created_at ASC` 排序并截断 `limit`，未定义游标分页；跨运行大量审批的翻页不在本片。
- 本 build 的工作流节点不产 artifacts，`run.snapshot.artifacts` 在测试中只验证为空数组；有产物的运行未实机验证。
- 未跑 `pnpm --filter @deepseek-bot/desktop build` 与 GitHub Actions：本片不改桌面代码，桌面 `tsconfig` 已由 repo 级 typecheck 覆盖。

## 5. 恢复与许可

无新增依赖、迁移、数据目录或产物格式；契约测试与夹具沿用既有设施。`docs/CONTRACTS.md` §7 的变更流程按既有惯例：协议 minor 升级、变更负责人自审并同步使用方。

## 6. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿
