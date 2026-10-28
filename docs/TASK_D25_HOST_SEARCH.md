# 任务书：D25 后半——渲染层全局搜索接入 Host 检索（G10'）

| 项 | 值 |
| --- | --- |
| 性质 | 任务书 + 实现方案（二合一）；实现随本分支提交 |
| 分支 | `feature/d25-host-search` → PR 目标 `develop` |
| 基线 | `origin/develop` = `968aa0b`（PR #123） |
| 上游 | Host 检索后端已合入（PR #117，`search.global` 契约 + `packages/host/src/global-search.ts`）；本任务只做渲染层接线，**无契约变更** |
| 红线 | 搜索请求必须走 Host（`search.global`）；**不得只在渲染层过滤本地列表**；检索本身不授权，命中打开只走既有逐 bot 方法 |
| 负责人 | 待认领；自审由负责人本人签署 |

## 1. 背景与现状（证据，2026-10-28 对 `968aa0b`）

- D25 前半已交付：Ctrl+K 浮层（`features/search/global-search.tsx`）、Esc 关闭、↑↓ 导航、Enter 选中；数据源是 `buildSearchIndex`（`features/search/search-core.ts`）从**渲染层内存**构建的索引：当前已加载的 bot 名、**仅当前已打开会话**的消息、三个快捷动作。
- Host 侧 `search.global` 已冻结进契约（`methods.ts:837`：`{query(≤200), limit(1–50, 默认20)}` → `{results[{kind: bot|workflow|message|artifact, id, botId, title(≤200), snippet(≤400|null), at}]}` ≤200 条），Host 实现（`global-search.ts`）按最近排序对四个语料做字面子串检索：bot 名、工作流名、**全部持久化聊天消息**（只回有界摘要）、**产物相对路径**（不含文件系统绝对路径与内容）。
- **缺口**：全渲染层 grep `search.global` 零调用。浮层的 `filterSearch` 只碰内存索引——跨 bot 历史、未加载会话、产物、工作流在浮层里搜不到。SPRINTS §7"搜索圆钮"行与 GAP_AUDIT G10 因此降级为部分完成，余项立为 G10'。

## 2. 需求（验收）

1. 浮层输入关键词后，**Host 命中出现在现有浮层结果里**（含未在当前会话加载的跨 bot 消息、产物、工作流），与本地结果同列表、可键盘 ↑↓/Enter 连续操作；
2. 命中按 kind 导航：`bot` → 选中该 bot 并打开会话线程；`message` → 打开该 bot 会话线程（定位滚动到具体历史消息不在本任务范围，属 G1'）；`workflow` → 打开工作流编辑器视图（编辑器内自选具体工作流，现有 `WorkflowEditor` 无外部选中态，记为已知边界）；`artifact` → 选中该 bot 并打开 D28 共编侧车加载该相对路径；
3. 防抖查询（250ms），过期响应丢弃（请求序号守卫）；空查询不发请求；
4. Host 不可达/调用失败：如实降级为仅本地结果 + 提示条（`search.hostFailed`），不假成功；加载中有 `search.searching` 状态行；
5. 去重：Host 的 `bot` 命中若与本地结果同一 bot（按 bot uuid）则不重复展示；message/artifact/workflow 命中本地索引本来就没有，不去重；
6. 浏览器预览（fixture 服务无 Host）：返回空结果、无失败提示，浮层回退为纯本地（现状行为）。

## 3. 实现方案

### 3.1 服务层（`services/`）

- `desktop-service.ts`：新增 `GlobalSearchHitView` 类型（与契约同形：kind/id/botId/title/snippet/at）与接口节 `search: { global(query: string): Promise<GlobalSearchHitView[]> }`。
- `host-service.ts`：`search.global` → `METHOD_CONTRACTS["search.global"].response.parse(await bridge.host.call("search.global", { query, limit: 20 }))` 后返回 `response.results`（沿用本文件既有"契约解析后返回"惯例，limit 取契约默认 20×4 命中池）。
- `fixture-service.ts`：`search.global: async () => []`（无 Host 环境，诚实空集）。

### 3.2 检索核心（`features/search/search-core.ts`）

- `SearchItem.kind` 扩展为 `"bot" | "message" | "action" | "workflow" | "artifact"`；新增可选字段 `botId?: string`（uuid，本地 bot 项与全部 Host 项携带）、`path?: string`（artifact 相对路径）、`snippet?: string`（Host message 命中的摘要作副标题显示）。
- 新增 `remoteHitsToItems(hits): SearchItem[]`：Host hit → item（message 的 `title` 是 bot 名、摘要在 `snippet`，映射为 `title = hit.title`、`subtitle = hit.snippet`；artifact 的 `title` 是相对路径，映射 `title = hit.title`、`path = hit.title`）。
- `buildSearchIndex` 的 bots 输入增加 `id`（bot uuid），本地 bot 项与本地 message 项携带 `botId`，供去重与导航。
- `searchKindLabels` 增加 workflow/artifact 标签。

### 3.3 浮层（`features/search/global-search.tsx`）

- 新增可选 prop `queryHost?: (query: string) => Promise<SearchItem[]>`（App 传 `(q) => desktop.search.global(q).then(remoteHitsToItems)`；组件内部不 import 服务，保持可测）。
- 内部状态 `host: { phase: "idle" | "loading" | "done" | "failed"; items: SearchItem[] }`；`query` 经 250ms `setTimeout` 防抖后触发 `queryHost`，请求前递增 `requestIdRef`，仅最新序号可写回（过期响应丢弃）；query 为空或 `queryHost` 未提供时不请求并回到 idle。
- 结果 = 本地 `filterSearch(items, query)` + Host items；**bot 去重**：Host bot 项的 `botId` 已出现在本地结果的 bot 项中则跳过。渲染分两节：本地节（现样式）+ Host 节（节标题 `search.hostSection`）；键盘 ↑↓/Enter 作用于**拼接后的单一数组**；Host message 副标题显示摘要，artifact 副标题显示 `path`。
- 状态行：loading 显示 `search.searching`；failed 显示 `search.hostFailed` 且仍列本地结果。
- 关闭（open→false）重置 host 状态与 query。

### 3.4 接线（`App.tsx`）

- `buildSearchIndex` 调用补 `id: b.bot.id`；
- `<GlobalSearch>` 传 `queryHost`；
- `onSearchSelect` 扩展：Host 项经 `item.botId`（uuid）在 `bots` 里找渲染层条目（找不到即忽略该命中，不假成功）；`workflow` → `setMonitorOpen(false); setWorkflowOpen(true)`；`artifact` → 选中 bot、`openThread`、`setCanvas({ botKey, botId, botName, path: item.path })`（复用 D28 侧车状态）。

### 3.5 i18n 与样式

- `messages/search.ts` 新增：`search.kindWorkflow`（工作流/Workflow）、`search.kindArtifact`（产物/Artifact）、`search.hostSection`（来自本机数据库/From the local database）、`search.searching`（正在检索本机数据…/Searching the local database…）、`search.hostFailed`（本机检索不可用，仅显示本地结果/Local search unavailable, showing local results only）。
- `styles.css`：`.gs-section`（节标题小字）与 `.gs-status`（状态行）两条规则，深浅色主题沿用现有变量。

### 3.6 测试（`apps/desktop/tests/features/`）

- 新增 `global-search.test.ts`（jsdom + createRoot/act，沿用仓库惯例，vitest fake timers）：
  1. Host 命中渲染在 Host 节，与本地结果同列表，键盘 Enter 可选中并回调（含跨 bot message 命中）；
  2. 防抖：连续输入只触发一次 `queryHost`（250ms 后）；空查询不触发；
  3. 过期响应：慢的旧请求后到，不覆盖新结果（序号守卫）；
  4. 失败：`queryHost` reject → 显示 `search.hostFailed`、本地结果仍可选；
  5. 去重：Host bot 命中与本地 bot 同 uuid 时不重复出现。
- `search-core.test.ts` 扩展：`remoteHitsToItems` 四种 kind 映射、`searchKindLabels` 新标签。

## 4. 边界与非目标

- 不改契约（`search.global` 已冻结）；不新增受信方法；检索不授权（与 Host 实现一致，命中打开走 `chat.history`/`artifacts.read`/侧车等既有路径）。
- 不做消息定位滚动/高亮（G1'）、不做工作流定点选中（`WorkflowEditor` 无外部选中态）、不做 FTS 分词（Host 为字面子串，契约既定）、不做网络搜索结果混排（SearXNG 面是另一条 `search.results.list` 线）。
- 本地索引的 bots 集来自渲染层当前状态（Host bot 列表本就全量同步），消息仅当前已加载会话——这正是必须接 Host 的原因，不在渲染层造全量索引。

## 5. 风险与回退

- 防抖与序号守卫错误可能导致结果闪烁/串台——以测试 2/3 钉住。
- `queryHost` 抛错路径若未捕获会打断输入——组件内 try/catch 转 failed 态。
- 回退：`git revert -m 1 <merge-sha>`；无迁移、无契约面变化。

## 6. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
