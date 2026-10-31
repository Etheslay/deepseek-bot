# G1' 分组实体化渲染层接线——分组跨重启、成员落库、折叠恢复

日期：2026-10-31（Asia/Shanghai）。负责人：Etheslay。分支：`feature/group-entity-wiring`（基于 `feature/group-entity-contract`，**先合方法面 PR**）。基线：`feature/group-entity-contract` @ `2401380`。本文只记本分支的交付与实际跑过的检查，不代表真人自审或合并结论。

范围：[GAP_AUDIT](../GAP_AUDIT.md) §2 G1' 分组实体化的**渲染层接线**——消费 v0.14（`group.archive`、`UiStateSchema.collapsedGroupIds`）与既有 `group.create/list`、`bot.update.groupId`。

## 1. 交付行为

- **服务层**：`DesktopService` 新增 `groups.list/create/archive`（host 转发 v0.14 契约方法；fixture 内存实现，含同样的乐观并发语义）；`bots.update` 的 patch 类型放宽为 `BotUpdatePatch = Partial<BotDraft> & { groupId?: string | null }`（成员移动走既有 bot.update，Host 的 BotPatchSchema 仍是校验权威）。
- **分组加载**：启动拉取 `group.list`（一次性），侧栏会话 key 不变但每组携带实体 UUID + revision（`Group` 扩展 `groupId/revision`；未分组保持合成 key、无 UUID）。
- **创建**：新建分组先 `group.create` 落库再入列；「创建并移入」随后走实体化移动。创建失败 toast（新 i18n 键 `shell.moveFailed`）。
- **成员移动**（bot 菜单移动 / 拖拽入组 / 建组即移入共用 `moveBotToGroup`）：本地 UI 先动、随后 `bot.update {groupId}` 落库；失败回退本地分组并 toast。REVISION_CONFLICT 由 useBots 既有 refresh 处理。
- **删除**：空组规则不变；有 UUID 的组走 `group.archive`（持久删除），失败 toast（新键 `shell.groupDeleteFailed`）；无 UUID 的合成组仍仅本地移除。
- **启动恢复**（一次性，等 bot 列表与分组列表都落地）：① 成员按契约 `bot.groupId` 映射回会话分组（陈旧 groupId——指向已归档组——渲染为未分组、不自动改写存储）；② 分组按快照 `groupOrder` 排序（未分组恒在最前）；③ 折叠态按 `collapsedGroupIds` 恢复；④ bot 顺序与选中 bot 沿用既有恢复。
- **防抖写入**：快照新增 `groupOrder`（当前分组实体序）与 `collapsedGroupIds`；`selectedGroupId` 保持 null（侧栏尚无"选中分组"交互）。

## 2. 实际检查

环境：Windows 11，Node v24.15.0，pnpm 11.28.5。工作树 `D:\deepseek-bot`，分支自方法面切片建出。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm typecheck`（10 包） | 退出 0 |
| `pnpm --filter @deepseek-bot/desktop exec vitest run --config vitest.config.ts tests/services/host-service.test.ts tests/services/fixture-service.test.ts` | 退出 0。2 文件 62 通过（新增：host 转发 group.list/create/archive 载荷 1 例、fixture 建组/归档/并发拒绝 1 例） |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0。78 文件 699 通过 |
| `pnpm --filter @deepseek-bot/desktop build` | 退出 0（electron-vite build，非安装包） |
| `pnpm lint` / `git diff --check` | 均退出 0 |

## 3. 未验证与已知边界

- **真机分组验收未做**（建组→重启→仍在；移动成员→重启→归属正确；删空组→重启→不再出现；折叠→重启→保持）——与工作流 12 步人工验收同属真机清单。
- REVISION_CONFLICT 时 useBots 的 refresh 以服务器为准重建列表，但 UiBot 的 UI 字段（含 group）走会话记忆，可能短暂与服务器不一致；实体化映射是一次性启动行为，不做会话中重映射。
- 删除非空组仍被 UI 拒绝（策略不变）；服务端 archive 本身不限空组（与 bot.archive 同风格）。
- `selectedGroupId` 仍为 null（无选中分组交互）；恢复只发生一次的设计沿用方法面切片。
- 未跑 GitHub Actions（分钟额度已用尽）。

## 4. 恢复与许可

无新增依赖、迁移。回退：`git revert -m 1 <merge-sha>`——`bot_groups` 行与 `ui.state.v1` 快照留存但无人读写，行为回到会话态分组。i18n 新增两键随回退一并消失。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、恢复顺序语义与失败回退路径：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
