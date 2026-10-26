# D25 全局搜索实现报告

日期：2026-10-25。任务：D25 `feature/global-search`（负责人 Destinyian）。实际提交 `cb4b7c8` 落在 B 线串行分支 `feature/chat-experience` 上，经 `feature/settings-updates`（head `2452c05`）以 merge commit `0f20970` 合入 `develop`。依赖 D05、D14。

> **补记说明**：合入时未写报告、PR 自审记录未填（清单仅勾选 2/5）。本报告为事后补记，数值来自合入前本机对 `2452c05` 的实测，不追认"事前已完成自审"。

## 1. 交付内容

| 文件 | 内容 |
| --- | --- |
| [`features/search/search-core.ts`](../../apps/desktop/src/renderer/src/features/search/search-core.ts) | 纯函数检索核心：`buildSearchIndex({bots, messages, ...})` 产出带稳定 id 的条目；`filterSearch(items, query)` 大小写不敏感匹配标题与副标题、命中消息内容并保留其 bot 跳转链接、长摘录截断、空查询返回空集；`SEARCH_KIND_LABELS` 三类条目标签 |
| [`features/search/global-search.tsx`](../../apps/desktop/src/renderer/src/features/search/global-search.tsx) | Ctrl+K 唤起浮层、Esc 关闭、↑/↓ 移动、Enter 选中；`role="dialog"` + `aria-modal` + `aria-label`，结果列表 `role="listbox"` / `role="option"`，键盘全程可完成检索与跳转 |
| `App.tsx`、`styles.css` | 顶栏搜索圆钮由占位改为唤起浮层；选中项按 kind 分派到既有导航动作 |

对应 [SPRINTS §7 界面占位审计](../SPRINTS.md) 中"顶栏 · 搜索圆钮 · 未实现 → D25"一项。

## 2. 过程决策（补记时整理）

- 检索与 UI 分离：索引与过滤是可测纯函数，React 组件只负责唤起、焦点与渲染，避免把交互逻辑埋在组件里。
- 索引数据源取渲染层现有状态（bot 列表、消息、可执行入口），不新增 Host 调用——与 [开发计划 §6](../DEVELOPMENT_PLAN.md) 对 D25 的"渲染层索引先行，host 检索后接"一致。

## 3. 测试与验证

| 检查 | 提交 / 环境 | 命令 | 结果 |
| --- | --- | --- | --- |
| 桌面自动化 | `2452c05` / Windows 11 x64 + Node v24.16.0 + pnpm 11.28.5 | `pnpm --dir apps/desktop exec vitest run --config vitest.config.ts` | 18 文件 / 172 用例通过，exit 0 |
| 类型与静态检查 | 同上 | `pnpm --dir apps/desktop run typecheck`；`pnpm run lint` | 均通过，exit 0 |
| 检索专项用例 | 同上 | `tests/features/search-core.test.ts` | 6 用例：三类条目稳定 id、大小写不敏感跨标题与副标题、命中消息内容并保留 bot 链接、长摘录截断、空查询返回空、三类标签齐全 |
| CI | — | — | 本机无 `gh` CLI，run 细节未读；GitHub 页面 checks 显示通过（负责人截图确认） |

## 4. 依赖与文档同步

- 无新增依赖；无契约、storage、host 改动；无迁移、无权限变化。
- **文档同步未完成**：[DESKTOP_SHELL.md](../DESKTOP_SHELL.md) 未写入全局搜索的键盘路径与快捷键说明（列为遗留）。

## 5. 未做项与边界

- **host 侧检索未接**：当前索引只覆盖渲染层已有状态，跨会话历史与产物全文检索需 Host 支持，按计划属"后接"部分。
- **顶栏"最近会话 / 产物"popover 仍是夹具数据**：其真实化挂在 Renderer↔Host 方案（SPRINTS §8 待拍板 #1），不由本任务承担。
- **可访问性仅结构达标**：ARIA 角色与键盘路径已就位，但未做读屏实测与键盘全量手测，**未验证**。
- **手测截图未留**：无 `docs/reports/assets/d25/`。
- 流程偏差：本任务未使用 `feature/global-search` 独立分支，而是叠在 D14 分支上随集成 PR 合入。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：`cb4b7c8`（合入 head `2452c05`）　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
