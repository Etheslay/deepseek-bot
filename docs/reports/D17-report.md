# D17 技能与模板（模板库切片）实现报告

日期：2026-10-25。任务：D17 `feature/skills-templates`（负责人 Destinyian）。提交 `2572758` 以 merge commit `292c3b8` 合入 `develop`（分支由 GitHub 在合入时自动删除）。依赖 D05、D15。

> **补记说明**：合入时未写报告、PR 自审记录未填（清单仅勾选 2/5）。本报告为事后补记。**本任务只交付"bot 模板与本地模板库"切片，按 [开发计划 §6](../DEVELOPMENT_PLAN.md) 的 D17 验收定义不计完成**，缺口见 §5。

## 1. 交付内容

| 文件 | 内容 |
| --- | --- |
| [`features/templates/bot-templates.ts`](../../apps/desktop/src/renderer/src/features/templates/bot-templates.ts) | 纯函数模板库：`BotTemplate`（名称 + bot 指令 + `avatarUi{avatar, shape, color}` 快照）；存储键 `deepseek-bot.bot-templates.v1`；`MAX_TEMPLATES = 30` 上限；`listTemplates` 对损坏负载容错返回空集；`saveTemplate` 返回 `{ok:true, template}` 或 `{ok:false, reason:"limit" \| "duplicate"}`；`deleteTemplate` 按 id 删除并回读列表 |
| `App.tsx` | bot 操作菜单新增"存为模板"（默认名 `<bot 名> 模板`，带上当前头像）；模板列表渲染与逐项删除；点击模板进入"以模板创建 bot"流程（`tplDraft` / `tplSeed` 状态）；保存失败按 `reason` 给出"模板已达上限"或"同名模板已存在"提示 |
| [`features/bots/bot-form.tsx`](../../apps/desktop/src/renderer/src/features/bots/bot-form.tsx) | 接受模板预填草稿 |
| `styles.css` | 模板卡片与列表样式 |

## 2. 过程决策（补记时整理）

- **模板是快照不是引用**：存的是指令与头像选择，不保存 bot id，因此源 bot 之后被编辑或归档都不影响模板可用性，也不会被模板反向改写。
- **失败原因显式化**：`saveTemplate` 返回判别联合而非抛错，UI 能区分"到上限"与"重名"并给出不同提示。
- **持久化沿用 D24 的渲染层 localStorage 通道**：与主题/强调色同侧，未走 Host。这是明知偏离"导入导出走契约校验"的权宜实现，代价记在 §5。
- 跨线依赖已满足但**本切片未使用**：D15 写层（`d4a3f35`，含 `create_group` / `create_bots_batch` / 头像自动分配）在 D17 开工前已合入 develop，模板批量创建 bot 本可直接走它；当前实现只在渲染层预填表单，未调用网关能力。

## 3. 测试与验证

| 检查 | 提交 / 环境 | 命令 | 结果 |
| --- | --- | --- | --- |
| 桌面自动化 | `2572758` / Windows 11 x64 + Node v24.16.0 + pnpm 11.28.5 | `pnpm --dir apps/desktop run test` | **19 文件 / 176 用例通过，exit 0** |
| 类型与静态检查 | 同上 | `pnpm --dir apps/desktop run typecheck`；`pnpm run lint` | 均通过，exit 0 |
| 模板专项用例 | 同上 | `tests/features/bot-templates.test.ts` | 4 用例：保存与回读、同名拒绝、上限拒绝、按 id 删除并在损坏负载下存活 |
| 与 develop 可合并性 | `0350e40` × `2572758` | `git merge-tree --write-tree` | 零冲突 |
| CI | — | — | 本机无 `gh` CLI，run 细节未读；GitHub 页面 checks 显示通过（负责人截图确认） |

## 4. 依赖与文档同步

- 无新增依赖；无契约、storage、host、agent-tools 改动；无迁移、无权限变化。
- 新增 localStorage 键 `deepseek-bot.bot-templates.v1`，与 D24 的 `deepseek-bot.settings.v1` 互不冲突。
- **文档同步未完成**：[BOT_WORKSPACE.md](../BOT_WORKSPACE.md) 未写入模板入口说明。

## 5. 未做项与边界（D17 验收缺口）

| 验收要求（开发计划 §6 D17） | 状态 |
| --- | --- |
| 技能定义与复用 | **未做**：本切片只有 bot 模板，无"技能"实体、无技能绑定与复用路径 |
| bot 模板与本地模板库 | **已做**（存 / 列表 / 删除 / 预填创建） |
| 导入导出走契约校验 | **未做**：无导入导出入口，也没有任何契约 schema 校验 |
| 与 D15 写层打通 | **未做**：未调用 `create_bots_batch` / `create_group`，批量创建仍走渲染层逐个建 |
| 头像接入 `bot.avatar` | **未做**：模板存的是渲染层派生的形状/颜色，契约 v0.2 的 `Avatar` 规范池与 `assignBatchAvatars` 未被使用（[D15-report §5](D15-report.md) 已记录渲染层仍按 bot id 哈希派生） |

另：真实 Host 端到端未执行；键盘与读屏路径未手测；无 `docs/reports/assets/d17/` 截图。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：`257275852fc4db67b1b933bdbc973ce3ca9a15e2`　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
