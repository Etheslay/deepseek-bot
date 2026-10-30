# G1' ui.state 方法面（协议 v0.13）——契约、Host 与拍板 #1 记录

日期：2026-10-31（Asia/Shanghai）。负责人：Etheslay。分支：`feature/ui-state-methods`，目标 `develop`。基线：`8c1cf2d`（`origin/develop`，PR #179/#180 合入后）。本文只记本分支的交付与实际跑过的检查，不代表真人自审或合并结论；自审必须针对该分支最新提交 SHA。

范围：[GAP_AUDIT](../GAP_AUDIT.md) §2 G1' 剩余项（ui.*）的**方法面切片**——契约 + Host 持久化 + 拍板 #1 记录。渲染层接线另片（`feature/ui-state-wiring`，基于本分支）。不含桌面分组实体化（现会话内数字 key，见下）。

## 1. 交付行为

- **契约（v0.13）**：新增受信桌面方法 `ui.state.get` / `ui.state.set`。快照形状沿用 #175 的候选 `UiStateSchema`（`botOrder`/`groupOrder` 去重 UUID 列表各 ≤1000、`selectedBotId`/`selectedGroupId` 可空，`.strict()`）；get 无参返回整快照，set 请求整体校验后整快照写入并回显，末写胜出。缺失或 schema 无效行在读取时降级为空态（`EMPTY_UI_STATE`），不失败——与 `skills.library.v1`（#152）同一模式。`protocolVersion` 升至 **0.13**，继续接受 0.1–0.12 发送方；工作流 `schemaVersion` 仍为 0.1。
- **Host**：新增 `packages/host/src/ui-state.ts`（settings KV 行 `ui.state.v1` 的读/写封装）+ 两个 handler（既有存储薄封装）；schema 只收稳定实体 UUID——**不存任意 UI 载荷、不可能落 Key**。
- **拍板 #1（如实记录，非双方会签）**：[RENDERER_HOST_MAPPING §4](../RENDERER_HOST_MAPPING.md) 记录——D 步聊天/历史事实接线已先行落地（#97/#103/#176/#177）；B 步 ui.* 清单（`ui.state.get/set` + `UiStateSchema` 四字段）由 **Etheslay 于 2026-10-31 指示按 G1' 既定草案推进**；**Destinyian 对清单的会签待补**。分组实体映射（渲染层分组目前是会话内数字 key，不映射存储 `bot_groups`）另行核实；实体化前渲染层对 `groupOrder`/`selectedGroupId` 写空值。
- **文档**：CONTRACTS.md 标题与 intro 升 v0.13、§3 方法表补一行；RENDERER_HOST_MAPPING §4/§5 更新；GAP_AUDIT §7.10 把 `chat.stream` 契约漂移标记为已由 #179 收口（顺带账目更新，非本片范围外扩）。

## 2. 实际检查

环境：Windows 11，Node v24.15.0，pnpm 11.28.5。工作树 `D:\deepseek-bot`，自基线建出。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --filter @deepseek-bot/contracts test` | 退出 0。16 文件 160 通过（新增：ui.state 方法契约 round-trip/严格拒绝 2 例；三个既有协议钉子测试随 0.13 更新） |
| `pnpm --filter @deepseek-bot/host exec vitest run src/ui-state.test.ts` | 退出 0。4 通过（空态缺省、save/get round-trip + 替换、schema 拒绝 + 存量不动、损坏行降级） |
| `pnpm lint` / `pnpm typecheck`（10 包） | 均退出 0 |
| `pnpm --filter @deepseek-bot/host build` | 退出 0 |
| `git diff --check` | 退出 0 |

## 3. 未验证与已知边界

- 渲染层接线（启动恢复选中 bot、防抖写入）不在本片——另片交付后才有真实行为可手测；本片无 UI 变化。
- `groupOrder`/`selectedGroupId` 在分组实体化前无真实数据（渲染层写空值）；分组实体化（桌面分组 → 存储 `bot_groups` 的映射）是后续切片，#175 报告与 MAPPING §5 均已登记该前提。
- 未跑 GitHub Actions（分钟额度已用尽，与在库多份报告同口径）；未做真实 Electron 手测（本片无 UI 面）。

## 4. 恢复与许可

无新增依赖、迁移（settings KV 表既有）、产物目录。回退：`git revert -m 1 <merge-sha>`；`ui.state.v1` 行只增不删，回退后旧行留存但无人读取（schema 前向兼容，可安全升级回来）。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、快照形状与兼容性（0.1–0.12 发送方）：＿＿＿＿
- [ ] 自动化检查、错误路径（损坏行/超限/严格字段）与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
