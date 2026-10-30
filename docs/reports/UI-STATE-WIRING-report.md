# G1' ui.state 渲染层接线——侧栏顺序与选中态的重启恢复

日期：2026-10-31（Asia/Shanghai）。负责人：Etheslay。分支：`feature/ui-state-wiring`（基于 `feature/ui-state-methods`，**先合方法面 PR**）。基线：`feature/ui-state-methods` @ `557228d`。本文只记本分支的交付与实际跑过的检查，不代表真人自审或合并结论。

范围：[GAP_AUDIT](../GAP_AUDIT.md) §2 G1' 剩余项的**渲染层接线**——消费方法面切片（v0.13 `ui.state.get/set`）。

## 1. 交付行为

- **服务层**：`DesktopService` 新增 `uiState.get/save`——host 实现转发 `ui.state.get/set`（v0.13 契约方法），fixture 实现保持内存会话态（与夹具其余状态同生命周期）。
- **启动恢复**（App.tsx）：首个 bot 列表落地后读取快照一次（ref 防重入）——先按 `botOrder` 恢复侧栏顺序（`useBots.applyPersistedOrder`：快照外的 bot 保持相对顺序排在末尾，过期快照不会弄丢任何 bot），再恢复 `selectedBotId`——仅当该 bot 仍在列表中，过期快照不会选中已归档/已删除的 bot。快照缺失/损坏/Host 不可达一律落回默认视图（静默，best-effort）。
- **防抖写入**（App.tsx）：bot 列表或选中态变化后 500ms 防抖写整快照（`{botOrder: 当前列表 id 序, groupOrder: [], selectedBotId: 活动 bot, selectedGroupId: null}`），末写胜出。**分组字段写空值**：桌面分组是会话内数字 key（不映射存储 `bot_groups`），实体化前不启用（[RENDERER_HOST_MAPPING §5](../RENDERER_HOST_MAPPING.md) 已登记该前提）。
- `useBots` 新增 `applyPersistedOrder(ids)`：稳定排序，key 不变、渲染身份不漂移。

## 2. 实际检查

环境：Windows 11，Node v24.15.0，pnpm 11.28.5。工作树 `D:\deepseek-bot`，分支自方法面切片建出。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm typecheck`（10 包，含 desktop node/web） | 退出 0 |
| `pnpm --filter @deepseek-bot/desktop exec vitest run --config vitest.config.ts tests/services/host-service.test.ts tests/services/fixture-service.test.ts` | 退出 0。2 文件 60 通过（新增：host-backed uiState 经假桥 round-trip 1 例、fixture 内存快照 1 例） |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0。78 文件全过 |
| `pnpm --filter @deepseek-bot/desktop build` | 退出 0（electron-vite build，非安装包） |
| `pnpm lint` / `git diff --check` | 均退出 0 |

## 3. 未验证与已知边界

- **真机重启恢复未做**：保存 → 关闭 Electron → 重开 → 选中态/顺序恢复，需真实应用会话（与工作流 12 步人工验收同属真机清单）；桌面证据是 jsdom + 服务层单测。
- 恢复只发生一次（首个非空列表落地时），其后创建/归档 bot 的新列表不会再次触发恢复——设计如此，避免陈旧快照在会话中途打乱用户操作。
- 防抖窗口内关闭应用会丢最后一次写入（≤500ms）；末写胜出语义可接受，未做 flush-on-unload。
- 分组顺序/选中分组的持久化等分组实体化后启用；届时 `groupOrder` 恢复逻辑需另行接线。
- 未跑 GitHub Actions（分钟额度已用尽）。

## 4. 恢复与许可

无新增依赖、迁移、产物目录。回退：`git revert -m 1 <merge-sha>`——`ui.state.v1` 行留存但无人读写，行为回到重启即失。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、恢复语义（过期快照/静默失败）与防抖边界：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
