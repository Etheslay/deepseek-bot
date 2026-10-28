# D25 后半（渲染层接 Host 检索）报告

分支：`feature/d25-host-search` · 目标 `develop` · 无契约变更 · 任务书与实现方案：[TASK_D25_HOST_SEARCH](../TASK_D25_HOST_SEARCH.md)

## 1. 做了什么

| 层 | 内容 |
| --- | --- |
| 服务层 | `desktop-service.ts` 新增 `GlobalSearchHitView`（契约同形）与 `search.global(query)` 接口；`host-service.ts` 直调 `search.global`（limit 20）并按冻结契约解析响应；`fixture-service.ts` 返回空集（浏览器预览无 Host，浮层诚实回退本地） |
| 检索核心 | `search-core.ts`：`SearchItem.kind` 扩展 workflow/artifact；本地 bot/message 项与全部 Host 项携带 `botId`（uuid）；`remoteHitsToItems`（message 命中 title=bot 名、摘要作副标题；artifact 命中 title=相对路径并带 `path`）；`dedupeHostItems` 按 uuid 去重本地与 Host 的 bot 重复 |
| 浮层 | `global-search.tsx`：`queryHost` 经 250ms 防抖查询（latest-ref 模式，回调身份变化不重触发）；请求序号守卫丢弃过期响应；本地节 + Host 节共享一套 ↑↓/Enter 键盘序列（Host 行带本地长度偏移）；loading/failed 状态行如实呈现；关闭即重置 |
| 接线 | `App.tsx`：索引补 bot uuid（孤儿会话不入索引）；`onSearchSelect` 扩展——bot/message/artifact 命中按 uuid 选中 bot 并 `openThread`，artifact 另开 D28 共编侧车加载该相对路径；workflow 命中打开工作流编辑器视图 |
| i18n/样式 | `messages/search.ts` 新增 5 组 zh/en 词条（kindWorkflow/kindArtifact/hostSection/searching/hostFailed + localSection）；`styles.css` 新增 `.gs-section`/`.gs-status` 与 workflow/artifact kind 配色 |

## 2. 验证证据

环境：Windows 11 x64 · Node 24.16.0 · pnpm 11.28.5 · 基线 `origin/develop` = `968aa0b`（PR #123）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 浮层新增用例 | `vitest run tests/features/global-search.test.ts` | 8/8：Host 命中渲染+Enter 选中、本地+Host 拼接键盘序列、防抖单次触发、空查询不请求、过期响应丢弃、失败降级本地仍可选、bot 去重、无桥环境纯本地 |
| 检索核心 | `vitest run tests/features/search-core.test.ts` | 10/10（含四种 kind 映射与新标签） |
| desktop 全量 | `pnpm --filter @deepseek-bot/desktop test` | 62 文件 / 564 用例全过（含 i18n 未翻译串扫描与既有 61 文件回归） |
| 全仓测试 | `pnpm -r --no-bail run test` + host 单独 | shared 6、harness-bridge 30、contracts 149、agent-tools 134、storage 219、desktop 564、runtime 137、harness-adapter 65、host 269+1 skip 全过；**唯一失败** exec-daemon `windows.real` 与 host `screen-distribution` 为本机环境既有失败，**在未改动的 develop 基线（81a0924）同样失败**（2026-10-28 对照复跑） |
| 静态 | `pnpm lint`；`pnpm typecheck` | eslint 0 问题；10 包 tsc 全过 |

## 3. 未验证（明确列出，不声称通过）

- **真机 Electron 未跑**：本机无法启动 GUI 会话；Ctrl+K 实际敲击、与真实 Host 的往返（含大数据量下的 250ms 防抖体感）只有 jsdom 组件测试 + 契约测试背书。
- **真实模型/数据下的检索质量**：Host 侧字面子串的召回/排序属 PR #117 既有行为，本任务未改动也未实测。
- Host `screen-distribution` 与 exec-daemon `windows.real` 在本机失败为环境既有（基线复现），与渲染层改动无关，但这两个套件在本机不是绿的。

## 4. 风险与回退

- 孤儿会话（bot 已归档/删除）不再进本地索引——此前以 "Bot" 占位名入索引；导航本来也无法落地，属正确性修正，如需保留可回退 `App.tsx` 一处 continue。
- `queryHost` 每次渲染新引用由 latest-ref 吸收；若未来有人在 effect 依赖里直接放 `queryHost` 会复现重复请求，已用测试钉住防抖语义。
- 回退：`git revert -m 1 <merge-sha>`；无迁移、无契约面变化。

## 5. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
