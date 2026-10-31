# G1' 分组实体化方法面（协议 v0.14）——group.archive 与 collapsedGroupIds

日期：2026-10-31（Asia/Shanghai）。负责人：Etheslay。分支：`feature/group-entity-contract`，目标 `develop`。基线：`c7288e1`（`origin/develop`，PR #181/#182 合入后）。本文只记本分支的交付与实际跑过的检查，不代表真人自审或合并结论。

范围：[GAP_AUDIT](../GAP_AUDIT.md) §2 G1' 的**分组实体化方法面**——契约 + Host。渲染层接线（建组/移动成员/折叠恢复走真实方法、ui.state 分组字段启用）另片（`feature/group-entity-wiring`，基于本分支）。

## 1. 交付行为

- **契约（v0.14）**：
  - 新增 `group.archive`（RevisionRef 请求 → 归档后的 `BotGroup`）：桌面侧栏分组从会话内数字 key 升级为持久实体（`bot_groups` 表与 createGroup/listGroups/archiveGroup 仓库皆已存在，缺的只是方法面）。乐观并发同 `bot.archive`——归档轮换 revision，重试须用首次返回的 revision（见 §3 的语义核对）；`group.list` 不回归档组；成员保留 `groupId`，桌面渲染为未分组、不自动改写存储（"空组才可删"留在 UI 策略层）。
  - `UiStateSchema` 增加可选 `collapsedGroupIds`（去重 UUID 列表，同 orderedIds 规则）：折叠态随快照恢复。可选字段保证 0.13 写方（不带该字段）继续被接受。
  - `protocolVersion` 升 **0.14**，继续接受 0.1–0.13 发送方；工作流 `schemaVersion` 仍 0.1。
- **Host**：`group.archive` handler 接既有 `archiveGroup` 仓库（乐观并发校验在仓库层）。
- **文档**：CONTRACTS.md 标题/段落/§3 两行；RENDERER_HOST_MAPPING §5 更新（实体化的契约与渲染层前提）。

## 2. 实际检查

环境：Windows 11，Node v24.15.0，pnpm 11.28.5。工作树 `D:\deepseek-bot`，自基线建出。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --filter @deepseek-bot/contracts test` | 退出 0。16 文件 161 通过（新增：collapsedGroupIds 可选语义 1 例；三个协议钉子随 0.14 更新） |
| `pnpm --filter @deepseek-bot/host exec vitest run src/groups.test.ts src/ui-state.test.ts` | 退出 0。2 文件 7 通过（新增 groups.test 3 例：create→list→archive→list 空、按返回 revision 重放归档、未知 id/陈旧 revision 拒绝） |
| `pnpm lint` / `pnpm typecheck`（10 包）/ `pnpm --filter @deepseek-bot/host build` / `git diff --check` | 均退出 0 |

## 3. 语义核对（审查中修正的一处）

初版契约注释写了"归档幂等（同 revision 重放返回不变）"——实际仓库是先校验 revision 再走幂等分支，而归档本身轮换 revision，同 revision 重放必然 `REVISION_CONFLICT`。**以仓库行为为准修正表述**：重试必须用首次归档返回的 revision；测试钉住该语义（`groups.test.ts` 的 re-archiving 用例）。

## 4. 未验证与已知边界

- 渲染层接线不在本片（另片交付后才有真实建组/移动/折叠恢复行为可手测）。
- 成员移动经 `bot.update.groupId` patch 的桌面路径由接线片交付；存储层 groupId 写入既有测试覆盖（bots 仓库）。
- 未跑 GitHub Actions（分钟额度已用尽）。

## 5. 恢复与许可

无新增依赖、迁移。回退：`git revert -m 1 <merge-sha>`；已归档的组在回退后仍被 `group.list` 过滤（仓库行为不变），无数据兼容风险。

## 6. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、归档语义与兼容性（0.1–0.13 发送方、0.13 快照写方）：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
