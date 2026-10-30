# D14 mermaid 主题重初始化（审查发现项收尾）

日期：2026-10-29（Asia/Shanghai）。负责人：Etheslay。分支：`feature/d14-mermaid-theme-reinit`，目标 `develop`。基线：`9d3ac5b0db1c503972441e5632410e94393cd5bc`（`origin/develop`，含 PR #160）。本文只记本分支的修复与实际跑过的检查，不代表真人自审或合并结论；自审必须针对该分支最新提交 SHA。

范围：[GAP_AUDIT](../GAP_AUDIT.md) §7.9 第 9 条登记的 d14 审查发现 P3——主题切换后新图仍用旧主题（[D14-mermaid 报告](D14-mermaid-report.md) §2.2）。只改渲染层主题初始化，不动契约、Host、依赖与 lockfile。

## 1. 交付行为

- 原缺陷：`mermaid.initialize` 只在模块懒加载时执行一次；`setMermaidTheme` 仅更新用于缓存键的 `currentTheme`，`mermaid.render` 读取的仍是首次加载时的全局配置——主题切换后新渲染的图沿用旧主题配色，而缓存键已标成新主题。
- 修复：新增 `initializedTheme` 跟踪。每次渲染取模块时若 `initializedTheme !== currentTheme`，先以当前主题重新 `initialize`（`startOnLoad: false`、`securityLevel: "strict"` 与原配置一致），再进入渲染。`setMermaidTheme` 保持同步、不触碰未加载的模块。
- 切回曾用主题时，同源图命中该主题的既有缓存（dark 缓存本就是 dark 主题的 SVG），不触碰全局配置；出现缓存未命中（新源）时才重新初始化。该语义由新增测试钉住。
- 已挂载图不随主题切换重绘的边界不变（任务书原边界）；缓存键含主题、FIFO 上限 50 的行为不变。

## 2. 实际检查

环境：Windows，Node v24.15.0，pnpm 11.28.5。工作树 `D:\deepseek-bot`，自上述基线建出。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --filter @deepseek-bot/desktop exec vitest run --config vitest.config.ts tests/features/mermaid.test.ts tests/features/chat-mermaid.test.ts tests/features/markdown.test.ts` | 退出 0。3 文件 19 通过（新增：主题切换后重新初始化 1 例，含"切回曾用主题走缓存"断言） |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0。74 文件，655 通过 |
| `pnpm --filter @deepseek-bot/desktop build` | 退出 0。`electron-vite build`（非安装包） |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0 |
| `git diff --check` | 退出 0 |

## 3. 未验证与已知边界

- 未打开 Electron 实测深浅主题切换下的真实出图（沿 [D14-mermaid 报告](D14-mermaid-report.md) 的实机边界）；真实 SVG 配色仍需实机确认，无截图。
- 渲染进行中切换主题的竞态（缓存键在调用时同步计算、SVG 主题在 `mermaid.render` 时读取全局配置）是既有全局配置模型的固有问题，本片未改；jsdom 单测无法覆盖。
- 未跑全仓 `pnpm test` 与 GitHub Actions。

## 4. 恢复与许可

无新增依赖、迁移或产物目录；`node_modules/mermaid` 既有许可记录不变（[THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) 已有 mermaid 行）。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、主题语义与缓存行为：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
