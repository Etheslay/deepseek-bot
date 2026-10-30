# G1' 已答选项卡回放与历史标记

日期：2026-10-29。任务来源：[GAP_AUDIT](../GAP_AUDIT.md) §2 G1' 中不依赖拍板 #1 的两项。分支：`feature/g1-history-replay-ddf3`，从 `origin/develop` 的 `20d2d87`（PR #155 合入后）创建。本文由实现辅助写成，不代表负责人真人自审或合并结论；自审必须针对该分支最新提交 SHA。

## 1. 交付行为

未新增 `ui.state.get/set`。未改设备输入、语音或视觉。无网络调用。

- **已答卡恢复**：`question.answer` 在助手消息上写入 `meta.kind = "choice"`（问题、展示用选项、`answered`，`allowOther` 时带 `other: true`）。`chat.history` 原样带回该 meta。渲染层 `historyThreadMessages` 把它还原成 `choices.answered`。卡片折叠为已答态；`canAnswerChoice` 对 `history: true` 或已有 `answered` 返回 false，点击不再进入发送。派发、任务通知、自动化通知仍不进消息线程。存量没有该 meta 的提问行仍是纯文本。
- **回放标记**：从 `chat.history` 装入的每条消息带 `history: true`（并保留既有 `origin: "history"`）。回放行的时间分隔使用更弱的样式，气泡带 `data-history="true"`。本会话新消息不带该字段。回放中的选项卡不重复渲染给模型看的提问正文，只显示已答卡片。

`ChatMessageMeta` 增加可选 `kind: "choice"`，不升 `protocolVersion`（CONTRACTS §7：新增可选字段）。选项 2–4 个，id 为 A–D，`answered` 必填。D 的选项文案仍由 Host 强制；`answered` 与落库的用户答案文本相同。

## 2. 实际检查

环境：Linux，Node v22.23.4（仓库要求 Node ≥24，本机为 v22），pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个工作区包） |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0，71 个文件、633 项通过 |
| `pnpm --filter @deepseek-bot/host exec vitest run src/ask-user-chat.test.ts` | 退出 0，3 项通过 |
| `pnpm --filter @deepseek-bot/contracts exec vitest run src/task-orchestration.test.ts` | 退出 0，14 项通过（含 choice meta 校验） |

## 3. 未验证

- 未做 Electron 真机重启，也未发送 10 条消息后重启核对界面。已答态与拒答由 Host 落库测试和渲染层纯函数测试覆盖。
- 未跑 Host 全量 `pnpm --filter @deepseek-bot/host test`（该脚本会先构建 harness-bridge 并带 coverage）。本片 Host 行为由 `ask-user-chat.test.ts` 覆盖。启动日志有既有提示：approval bridge staging failed（本环境未构建桥包），测试仍通过。
- 未跑 GitHub Actions（分钟已用尽）。
- 未用真实模型或网络。种子引导卡仍只在本会话内存里，不写入 `chat_messages`。

## 4. 负责人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与证据：＿＿＿＿
- [ ] 未验证边界与结论：＿＿＿＿
