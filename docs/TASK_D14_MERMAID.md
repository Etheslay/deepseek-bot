# 任务书：D14 补遗 — 本地 mermaid 流程图

| 项 | 值 |
| --- | --- |
| 任务 | 补上 D14 被砍掉的聊天内 mermaid 流程图渲染；验收只补这一条 |
| 分支 | `feature/d14-mermaid`（从 `origin/develop` = `3e21112` 拉出） |
| 来源 | D14 报告 §5："mermaid 流程图未实现……D14 验收第 1 条因此只部分达成"；SPRINTS §4 同登记；DEVELOPMENT_PLAN D14 行原文即"mermaid 渲染（资源全本地）" |
| 红线 | 不改聊天渲染管线的其他行为（marked/DOMPurify/KaTeX/高亮/提及/代码复制全部原样）；**禁在线渲染**（不得引入任何远程 URL/CDN/mermaid.ink 之类）；资源全部随包本地 |
| 状态 | 任务书随本分支首笔提交入库；实现按本方案随后提交 |

## 1. 现状（2026-10-28 对 `origin/develop` = `3e21112` 核实）

- 管线（`features/chat/markdown.ts`）：lift math → marked → DOMPurify（严格白名单）→ KaTeX 回填。mermaid 围栏今天走默认 code 渲染器：`.md-code` 工具条 + `<pre><code class="hljs language-mermaid">`（highlight.js 无 mermaid 语言 → 纯转义文本）。也就是说**占位物已经存在**，只是没人渲染它。
- `chat-markdown.tsx`：memo 组件 + `dangerouslySetInnerHTML` + 事件委托（复制/提及）。
- 主题：App 根 `theme: "dark" | "light"`（App.tsx:476），CSS 变量换肤。
- D14 交付时对 bundle 体积的克制（highlight.js 只装 common 子集）是 mermaid 被砍的直接原因。

## 2. 需求（验收清单——只此一条）

- [ ] bot 回复中的 ```mermaid 围栏在聊天里渲染为本地生成的流程图（SVG），无任何网络请求；
- [ ] 渲染失败（语法错误等）时回退为原代码块并附一行可读的错误说明，不吞掉原文；
- [ ] 安全边界：mermaid 以 `securityLevel: "strict"` 渲染（标签转义、无 HTML 标签、无事件绑定），输出 SVG 再经 DOMPurify（svg profile）净化，且插入点使用 **shadow DOM**——SVG 内的 `<style>` 无法逃逸影响页面，`<script>` 经 innerHTML 插入不执行、再经净化剔除，双保险；
- [ ] 非法用途防线全部本地：mermaid 从 npm 打包进应用（动态 import 独立 chunk，不进首屏包——D14 的体积顾虑以此化解），运行时零远程引用（`git grep` 无 http(s) 远程渲染路径）；
- [ ] 现有渲染行为回归不变：`markdown.test.ts` 既有 7 例全过 + 新增 mermaid 围栏仍为代码块用例；
- [ ] 深浅两主题各自可读（渲染时刻的主题决定配色；已挂载的图不随主题切换重绘——记录为边界）。

## 3. 实现方案

### 3.1 文件面

| 文件 | 改动 |
| --- | --- |
| `features/chat/mermaid.ts` | **新增**。懒加载 mermaid（`startOnLoad:false, securityLevel:"strict"`，主题初始化）、`renderMermaidSvg(source): Promise<string|null>`（mermaid.render → DOMPurify svg profile 净化 → 失败返回 null）、`setMermaidTheme`（App 主题变化时同步，影响之后新渲染的图） |
| `features/chat/chat-markdown.tsx` | 增强效果：`useEffect` 扫描容器内未处理的 `code.language-mermaid`，逐块异步渲染：成功 → 以 shadow DOM 承载 SVG 替换原 `.md-code` 块；失败 → 原代码块保留 + 前置一行错误说明。组件 props 与既有渲染路径零改动 |
| `App.tsx` | 一处 3 行效果：主题状态变化时 `setMermaidTheme(theme)`（仅影响新图） |
| `styles.css` | `.mermaid-block`（气泡内边距/圆角/`svg{max-width:100%}`）与失败态样式 |
| `shared/i18n/messages/chat.ts` | `chat.mermaidRenderFailed`（zh/en） |
| `apps/desktop/package.json` + lockfile | 新依赖 `mermaid`（npm，本地打包）——依赖变更由负责人审查 |
| `docs/SPRINTS.md` | D14 行注记更新："mermaid 已由 feature/d14-mermaid 补齐" |
| 测试 | `markdown.test.ts` +1；新增 `mermaid.test.ts`（mock mermaid 模块：strict 初始化、净化剔 script、失败返回 null）与 `chat-mermaid.test.ts`（jsdom 组件级：成功替换为 shadow 图、失败回退保原文） |
| `docs/reports/D14-mermaid-report.md` | **新增**交付报告 |

### 3.2 关键取舍

- **渲染后增强而非改管线**：mermaid 围栏在管线里仍是普通代码块（对 DOMPurify 零新白名单、对 marked 零新渲染器），组件挂载后按 `data-mermaid-state` 逐块增强——满足"不改聊天渲染的其他部分"，失败回退天然保真。
- **shadow DOM**：SVG 内联 `<style>` 被浏览器按树隔离，不可能污染页面样式；配合 mermaid strict + DOMPurify svg profile 构成三层防线（语法层/元素层/样式作用域层）。
- **动态 import**：mermaid 体积大（约 1 MiB+ 依赖树），独立 chunk 保证不加载 mermaid 的会话首屏不变；只有出现 mermaid 围栏的会话才拉起该 chunk——全本地。
- **主题**：`setMermaidTheme` 由 App 效果同步；已挂载图不重绘（memo 与数据流都不感知主题），换主题后的新图用新主题。记录为已知边界，不做重绘联动。
- 已知环境限制：本机渲染层 electron-vite 构建因 esbuild 临时目录 `Access is denied` 失败（GAP_AUDIT 登记的基线问题）——chunk 产物验证受限，以 typecheck + vitest + 代码审查为准，实机截图列为负责人合并前事项。

### 3.3 测试计划

1. 管线：mermaid 围栏产出 `code.language-mermaid` 且内容为纯转义文本（不动其他语言渲染断言）；
2. mermaid 模块（mock `mermaid`）：首次渲染以 `securityLevel:"strict"` 初始化、`startOnLoad:false`；输出经 DOMPurify 后 `<script>`/`onload` 被剔除、`<style>` 保留（交由 shadow 隔离）；`mermaid.render` 抛错 → `null`；
3. 组件（jsdom）：成功路径 `.mermaid-block` 出现且 shadow 内含 SVG；失败路径原代码块保留 + 错误行；同一文本重渲染不重复处理（dataset 标记）。

## 4. 提交计划

1. `docs(d14): add the local mermaid flowchart task book`（本文件）；
2. `feat(desktop): render local mermaid flowcharts in chat (D14 follow-up)`（依赖 + 实现 + 测试 + SPRINTS 注记 + 报告）。

PR：base=`develop`，merge commit；自审栏留空待负责人签署。
