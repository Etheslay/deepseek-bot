# D16 ask_user 桌面回答回传

日期：2026-10-26（Asia/Shanghai）。负责人：Etheslay。分支：`feature/ask-user-chat`。基线：`426310b82c0f04dbe66d02bdfd7b507c5a36ef21`（`origin/develop`，已含 PR #52 与 PR #53）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。

## 1. 交付行为

聊天里的 `ask_user` 可以在当前回合等待桌面回答。Harness 插件在八个应用工具之外单独登记 `ask_user`，调用走 `/ask-user`，不进入 `/app-tools` 目录，也不改变那八个工具的就绪名单或调用结果。

桌面打开的 bot 轮询 `question.list`，用既有选项卡片展示问题。选择选项或填写其他文本后，`question.answer` 只接受该 bot 的逻辑会话 `chat:<botId>`：

- 答案交给正在等待的工具，模型在同一回合继续；
- 答案文本写入该 bot 的用户聊天记录，供之后的回合回放；
- 不调用 `chat.send`，因此不会在 bot 仍忙时再开一轮；
- 其他 bot 看不到、也不能消费这次等待；
- 不允许其他文本时，自由文本被拒绝且不写入聊天记录；
- 回答不授予权限。`question.list` / `question.answer` 不是模型工具。

问题仍只活在 Host 内存里。重启、取消回合或等待超时沿用既有 `ask_user` 后端，不在本片恢复。

## 2. 实际检查

环境：Windows、Node v24.22.1、pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0 |
| `pnpm test` | 退出 0。shared 6、harness-bridge 15、contracts 86、agent-tools 69、storage 147、desktop 211、runtime 128、harness-adapter 58、host 79 通过，另有 1 项跳过 |
| `git diff --check` | 退出 0 |

跳过的是既有付费 API 冒烟测试，未显式启用，不计为通过。host 覆盖率语句 88.65%，达到该包既有门槛。既有真实 Harness 验收仍只断言八个应用工具，本轮该测试通过。

## 3. 未验证

- 未用真实 Electron 点击 `ask_user` 卡片，未让真实 Harness 进程发起 `ask_user`。插件测试使用假 Host；桌面测试使用 jsdom。
- 未调用付费 DeepSeek API。
- 未执行远程 CI、安装包、签名或 GitHub 保护规则复核。
- `web_search` 聊天接线、SearXNG 与原生聊天 D08 工具审批不在本片。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
