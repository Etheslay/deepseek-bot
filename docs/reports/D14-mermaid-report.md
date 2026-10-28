# D14 补遗：本地 mermaid 流程图

日期：2026-10-28（Asia/Shanghai）。任务：[任务书](../TASK_D14_MERMAID.md)（本分支首笔提交 `d6d1216`，先书后实现）。分支：`feature/d14-mermaid`，从 `origin/develop` 的 `3e21112` 拉出。D14 报告 §5 原话"mermaid 流程图未实现……D14 验收第 1 条因此只部分达成"——本片只补这一条。本文由实现辅助写成，不代表负责人真人自审或合并结论；自审必须针对该分支最新提交 SHA。

## 1. 交付行为（与任务书逐条对应）

- **本地渲染**：新依赖 `mermaid@^12.2.0`（npm，随应用打包，动态 import 独立 chunk、不进首屏包——D14 的体积顾虑以此化解）。运行时零远程引用：无 CDN、无 mermaid.ink、无任何 URL 拼接（`git grep` 核实无远程渲染路径）。
- **增强而非改管线**：`renderChatMarkdown` 管线一字未改——mermaid 围栏照旧产出 `.md-code` + `code.language-mermaid` 纯转义文本（对 marked/DOMPurify 白名单零改动）。`chat-markdown.tsx` 挂载后每次提交扫描未处理的 `language-mermaid` 块并逐块增强；dataset 标记防重。其余渲染（数学/高亮/提及/复制/表格）行为原样，`markdown.test.ts` 既有 7 例全过 + 新增 1 例钉住"mermaid 围栏仍是代码块"。
- **成功路径**：`mermaid.render` → DOMPurify（svg profile + 保留 `<style>`）→ SVG 挂进 **shadow root** 替换原代码块。三层防线：mermaid `securityLevel: "strict"`（标签转义、无 HTML 标签、无事件绑定）→ DOMPurify 剔除 `<script>`/事件属性 → shadow root 使 SVG 内联 `<style>` 树内隔离、无法影响页面样式。
- **失败路径**：语法错误/不支持图型 → 返回 null → 原代码块原样保留（可复制）+ 前置一行 zh/en 错误说明（`chat.mermaidRenderFailed`），不吞原文。
- **缓存与重挂**：React 提交时可能重置同一消息的 innerHTML（实测行为），增强效果设计为每次提交后重扫 + `mermaid.ts` 按 `主题\0源` 缓存渲染结果（上限 50 条 FIFO）——重挂零 mermaid 开销。
- **主题**：App 主题状态经 `setMermaidTheme` 同步（3 行效果）；之后新渲染的图跟随深/浅主题（dark/default），已挂载图不随切换重绘——任务书记录的边界。
- SPRINTS §4 D14 行注记更新为"mermaid 由 feature/d14-mermaid 本地补齐，验收达成"；D14 历史报告不改写。

## 2. 实际检查

环境：Windows、Node v24、pnpm 11（本机）。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个工作区包全绿） |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0，67 文件 / 595 用例全过——新增：`mermaid.test.ts` 6 例（strict 懒初始化、净化剔 script/onload、失败 null、空输出 null、缓存去重、换主题重渲染）、`chat-mermaid.test.ts` 4 例（成功替换为 shadow 图、失败回退保原文、无围栏不处理、innerHTML 重置后重增强）、`markdown.test.ts` 8 例（原 7 + mermaid 围栏钉子）；含 `i18n-scan` |
| `pnpm --filter @deepseek-bot/desktop build` | 失败——`[vite:esbuild-transpile] remove …esbuild-…: Access is denied`，与 GAP_AUDIT 已登记的基线环境失败同签名（渲染层构建在本机沙箱不可用，主/预加载不受影响）；chunk 产物验证留给负责人实机 |

测试覆盖说明：jsdom 无法运行真实 mermaid（需字形测量），模块级用例以 mocked `mermaid` 包驱动——钉住的是初始化参数、净化行为与失败语义；真实出图只能实机验证（见未验证边界）。

## 3. 未验证边界

- **未打开 Electron 实测**：真实 mermaid 出图、chunk 懒加载体积、深浅主题下 SVG 可读性均需实机确认，无截图；建议负责人实机验证后附截图再合并。
- 渲染层 electron-vite 构建在本机因 esbuild 临时目录 `Access is denied` 失败（GAP_AUDIT 已登记的基线环境问题）——独立 chunk 的构建产物本机无法验证，以 typecheck + 单测 + 负责人实机构建为准。
- shadow root 内 SVG 不继承应用字体/CSS 变量（树隔离的代价），图内字体为 mermaid 内建主题默认；如需对齐应用字体需后续注入字体声明，本片未做。
- DOMPurify 对 mermaid 输出的 svg profile 净化基于 DOMPurify 的 SVG 白名单；`<style>` 因 shadow 隔离而保留——若未来把图挂到 shadow 外，必须先撤回该保留项。
- 大图（长流程图）的横向滚动由 `.mermaid-block{overflow-x:auto}` 承接，未做缩放控件。

## 4. 负责人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、安全边界（strict + DOMPurify + shadow DOM 三层）与兼容性：＿＿＿＿
- [ ] 自动化检查、失败回退与证据（含实机截图）：＿＿＿＿
- [ ] 未验证边界与结论：＿＿＿＿
