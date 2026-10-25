# B-REACTION-01 · 消息表情回应（角标浮层 pill + 仅 bot 可回应）

- 任务：B-REACTION-01（板块 B / Destinyian）
- 分支：`feature/message-reaction-pill`（独立 worktree）
- 基线：`origin/develop` @ `0c4a9dd`
- 状态：DONE（草稿 PR，待 Integrator / 负责人自审）

## 背景

对照参考实现（他人聊天 UI：反应以贴在气泡角上的圆形 pill 呈现，含计数）。Owner 反馈两点：
1. 反应应做成**气泡角标浮层 pill**（不再是塞在气泡内文字下方）。
2. **自己发的消息不应能配表情**（原实现里 user 消息的 😊 只在悬停时出现在气泡左侧、反应又埋在彩色气泡里，既难发现又显得「配不上」）。

## 方案与决策

- **反应 pill 浮层**：`.reaction-chips` 由「气泡内下方」改为**绝对定位、骑跨气泡右上角**（`top:-14px; right:10px`），每枚 pill = `emoji 计数`，圆角、`--raised` 底、`--line` 描边、投影，`mine` 高亮描边。多个反应在该角横排成簇。
- **仅 bot 可回应**：在消息组件里对 `isUser` 关闭表情功能——隐藏操作条的 😊 按钮、不渲染表情选择弹层、不渲染反应 pill；user 消息仅保留「引用 / 复制」。这样「我发的消息」根本不会出现表情入口，符合 Owner 决定。
- **主题**：pill 颜色全部走既有主题变量（`--raised`/`--line`/`--item-hover`/`--settings`/`--text`），浅色=白底 pill、深色=深底 pill，自动反相，无新素材。
- **位置取舍**：参考图为右上角；且 bot 消息左上是头像+发送者名，右上角是「外侧上角」且不遮挡，故统一右上角。若 Owner 要 bot 改左上，一行 CSS 可翻。

## 变更文件

- `apps/desktop/src/renderer/src/App.tsx`：`reaction-chips` 渲染与表情弹层加 `!isUser` 守卫；操作条 😊 按钮 `{!isUser && (...)}` 包裹（user 仅 quote/copy）。
- `apps/desktop/src/renderer/src/styles.css`：新增「Reaction corner pill」块（`.msg-bubble{position:relative}` + `.reaction-chips` 绝对定位右上角 + `.reaction-chip` 浮层样式 + `.mine`）。

## 验证

- `pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm --filter @deepseek-bot/desktop test` **120 passed** · `pnpm --filter @deepseek-bot/desktop build` 0。
- 运行时（CDP 驱动，实测）：
  - bot 消息加 👍 → 角标 pill 显示 `👍 1`（light 白底 / dark 深底，均正确）。
  - user 消息：`userEmojiBtn=false`、`userChips=false`、操作条 `["quote","copy"]` —— 自己发的消息无表情入口。
- 截图：`docs/reports/B-REACTION-01-light.png`、`docs/reports/B-REACTION-01-dark.png`。

## 未做 / 说明

- 未引入「…」更多菜单、未把引用图标换成弯箭头（Owner 本轮只选了「反应改角标 pill」，其余未勾选）。
- 反应仍为 UI 内存态（未持久化），持久化属存储/D12 范围。
- 自审记录为 AI 客观核对，需 Destinyian 本人确认。
