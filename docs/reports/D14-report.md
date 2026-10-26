# D14 聊天体验实现报告

日期：2026-10-25。任务：D14 `feature/chat-experience`（负责人 Destinyian）。实现分两片提交，经 B 线串行集成分支 `feature/settings-updates`（head `2452c05`）以 merge commit `0f20970` 合入 `develop`。依赖 D05（已合入）。

> **补记说明**：本任务合入时未写交付报告、PR 自审记录未填写（清单仅勾选 2/5）。本报告为**事后补记**，其中的检查数值来自合入前在本机对 `2452c05` 的实际运行，不追认"事前已完成自审"。

## 1. 交付内容

| 切片 | 提交 | 内容 |
| --- | --- | --- |
| 渲染片 | `8799004`（依赖先行）、`5df2470` | bot 回复渲染 Markdown（GFM 标题/列表/表格/链接）、代码块高亮、KaTeX 行内与独立公式 |
| 交互片 | `13acf47` | 内联提及跳转、多 bot 交付通知、选项卡片、定向回复可见化、用户气泡颜色跟随当前 bot 主题色 |

### 1.1 渲染片

- [`features/chat/markdown.ts`](../../apps/desktop/src/renderer/src/features/chat/markdown.ts)：`renderChatMarkdown(source)` 纯函数，四步管线——公式先以占位符从原文摘出（避免被 GFM 的强调/删除线规则吃掉）、`Marked` 渲染、`DOMPurify` 净化、占位符回填 KaTeX 产物。净化用严格白名单：`ALLOWED_TAGS` 枚举、`ALLOWED_ATTR` 仅 `class`/`href`/`title`、`ALLOWED_URI_REGEXP` 仅 `https?:` 与 `mailto:`；KaTeX 以 `throwOnError: false` 生成，公式解析失败退化为文本而非抛错。
- 行内公式识别有启发式护栏（`INLINE_MATH_HINT`），避免把 shell 风格的 `$`、普通下划线误判为数学。
- 代码高亮取 `highlight.js/lib/common` 子集而非全量语言包，控制 bundle 体积。
- [`features/chat/chat-markdown.tsx`](../../apps/desktop/src/renderer/src/features/chat/chat-markdown.tsx)：memo 组件，消息列表重渲染不重跑 marked/katex。
- 资源本地化：`import "katex/dist/katex.min.css"`，样式与字体随 npm 包进 bundle；新增特性目录内 `git grep` 无 `http(s)://` 远程引用。

### 1.2 交互片

- [`features/chat/mentions.ts`](../../apps/desktop/src/renderer/src/features/chat/mentions.ts)：`linkMentions(html, MentionTable)` 在净化后的 HTML 上把已知 bot 名替换为可点击提及 chip（对 SPRINTS §6 模式 3）。
- `App.tsx` 内新增三类聊天元信息组件：居中的 bot→bot 交付说明行、多 bot 交付通知（头像栈 + 计数，逐个可点直达该 bot 会话，模式 1）、选项卡片（`choices` 字段，问题 + A/B/C/D 选项，模式 4）。
- 用户气泡颜色：把当前会话 bot 的主题色写入 CSS 变量 `--accent`，用户气泡随色（模式 8）。

## 2. 过程决策（补记时整理）

- **依赖先行**：`8799004` 单独一笔提交 `package.json` 与 lockfile，避免后续功能提交夹带锁文件变更——但同一条 B 线分支随后又因 D24 引入 `electron-updater` 再次改动 lockfile，见 §5 流程偏差。
- **净化顺序**：先净化再回填 KaTeX 产物，而不是把 KaTeX 输出交给 DOMPurify——公式 HTML 由 katex 自身从原始数学文本生成（trust 关闭），回填后不再经浏览器解释任意属性，测试 `sanitizes hostile html from model output` 覆盖注入路径。
- **选项卡片与 `ask_user` 解耦**：本片只做渲染与点击回写会话，未接 `ask_user` 能力；`ask_user` 后端在合入前已由 A 线落到 develop（`0bef218`），接线列为后续。

## 3. 测试与验证

| 检查 | 提交 / 环境 | 命令 | 结果 |
| --- | --- | --- | --- |
| 桌面自动化 | `2452c05` / Windows 11 x64 + Node v24.16.0 + pnpm 11.28.5 | `pnpm --dir apps/desktop exec vitest run --config vitest.config.ts` | 18 文件 / 172 用例通过，exit 0（计数已排除同工作区内未提交的 D17 测试文件） |
| 类型与静态检查 | 同上 | `pnpm --dir apps/desktop run typecheck`；`pnpm run lint` | 均通过，exit 0 |
| 渲染专项用例 | 同上 | `tests/features/markdown.test.ts` | 7 用例：GFM 元素、hljs 类名、display/inline 数学、数学语法不被 GFM 破坏、shell 风格 `$` 不误判、恶意 HTML 净化、纯文本无包装噪音 |
| 与 develop 可合并性 | `0350e40` × `2452c05` | `git merge-tree --write-tree` | 零冲突 |
| CI | — | — | 本机无 `gh` CLI，无法读取 run 日志；GitHub 页面显示 checks 通过（负责人截图确认），细节未核 |

## 4. 依赖与文档同步

- 新增运行时依赖：`marked@^18.1.1`、`dompurify@^3.4.17`、`highlight.js@^11.12.0`、`katex@^0.19.1`；dev 依赖 `jsdom@^30.1.3`。`pnpm-lock.yaml` +469。
- 契约、storage、host、runtime 零改动；无迁移、无权限变化。
- **文档同步未完成**：[BOT_WORKSPACE.md](../BOT_WORKSPACE.md) 的聊天区描述仍停留在 D05 形态，未写入渲染与交互能力；THIRD_PARTY_NOTICES 是否覆盖四个新依赖的许可证未核对（列为遗留）。

## 5. 未做项与边界

- **mermaid 流程图未实现**：SPRINTS §2.3 明确标注的可顺延项，本次主动砍掉。D14 验收第 1 条因此**只部分达成**。
- **运行期零远程请求未抓证**：验收第 2 条要求网络面板或 CSP 日志留证，本次只有静态 `git grep` 结果，**未验证**。
- **真实链路未接**：聊天回复仍是渲染层夹具数据，`chat.*` 未经 Host；选项卡片未接已落 develop 的 `ask_user`；均挂在 SPRINTS §8 待拍板 #1（Renderer↔Host 方案）。
- **手测截图未留**：无 `docs/reports/assets/d14/`。
- 流程偏差：本任务与 D25/D26/D24 挤在同一条串行分支经单个 PR 合入，偏离"一任务一分支"；lockfile 与 CI 配置改动未拆独立小 PR。已在 [SPRINTS §4](../SPRINTS.md) 记录。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：`2452c05b2a63c38e6f49f6846c9d6c7b3f2208f6`　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
