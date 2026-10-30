# G1' 历史回放行弱化

日期：2026-10-29。基线：`origin/develop` `34764a5`（PR #157 合入后）。分支：`feature/history-replay-visual-a82e`。本文由实现辅助写成，不代表负责人真人自审或合并结论。

## 1. 交付行为

`feature/g1-history-replay-ddf3` 已让 `chat.history` 行带 `history: true`，并恢复已答选项卡的 `choices.answered`。桌面当时只把时间分隔变弱；消息行虽有 `replay` class，但入场动画 `grokFadeUp` 会把透明度填回 1，回放气泡与本会话新消息看起来一样。

本次只补这一层呈现：

- `history: true` 的 `.msg-row.replay` 透明度为 0.7，并用 `grokFadeUpReplay` 把入场终点停在 0.7。减弱动效时取消动画，仍保持 0.7。本会话新消息仍以透明度 1 结束。
- 已答选项卡从历史装入后不能再次提交：既有行为，本次未改。`canAnswerChoice` 对 `history: true` 或已有 `answered` 返回 false；气泡不传 `onChoose`；`ChoiceCard` 在已答时只渲染折叠行，没有可点选项。`handleChoice` 仍先拒绝不可答的卡。

未新增 `ui.state.get/set`。未改语音、设备输入或权限。无契约或协议版本变更。

## 2. 实际检查

环境：Linux，Node v22.23.4（仓库要求 Node ≥24），pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个工作区包）。第一次与依赖安装并行时 `harness-bridge` 缺 `node_modules` 失败；完整 `pnpm install` 后重跑通过 |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0，74 个文件、654 项通过 |

## 3. 未验证

- 未跑 GitHub Actions（分钟已用尽）。
- 未做 Electron 真机，也未用浏览器打开桌面壳核对观感。透明度由样式单测与 jsdom 计算样式覆盖。
- 未跑全仓 `pnpm test`，未跑 Host 全量测试。
- 未用真实模型或网络。未改语音、设备输入、权限。

## 4. 负责人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与证据：＿＿＿＿
- [ ] 未验证边界与结论：＿＿＿＿
