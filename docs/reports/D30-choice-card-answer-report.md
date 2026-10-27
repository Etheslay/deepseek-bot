# D30 补充片：聊天选项卡片补全与 `ask_user` 澄清接线

日期：2026-10-26（Asia/Shanghai）。分支：`feature/choice-card-answer`。基线：`ae0c6be`（`origin/develop` 最新，PR #63 合并点）。任务书：`docs/TASK_CHOICE_CARD.md`。最终编号与分支名由负责人定，本报告编号暂挂 D30 补充片。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。

## 0. 对任务书前提的修正（开工时重新定位）

任务书 P5 写「Host 聊天流不渲染、答案不回流」，但 PR #54（`44ad801`，已在 develop）已交付：`question.list` / `question.answer` 受信方法、`QuestionChatCards` 轮询渲染、答案回流等待中的工具并落库为用户消息。因此本片实际剩余缺口为：

- P1 卡片发送文本带 `我选择：` 前缀，且 P3 点击只追加本地气泡、从不发起模型请求；
- P2 已答卡片 `已选择：` 前缀（种子卡与 ask_user 卡两处）；
- P4 `send()` / `retryStream()` 流式逻辑重复，卡片无法复用；
- ask_user 卡缺：D 兜底语义（强制文案 + 转自由输入）、一卡一答锁定、过期/取消态、答案不产生用户气泡、提问文本不落库。

## 1. 交付行为（逐条 FR 对照）

| FR | 实现 | 主要位置 |
| --- | --- | --- |
| FR-1 发送文本=选项原文 | `handleChoice` 直接发送 `option.label`，无任何前缀；发给模型的内容与气泡一致（同一字符串） | `App.tsx` `handleChoice` |
| FR-2 已答态 `✓ {原文}` | 抽出共享 `ChoiceCard`；已答行只含答案文本（`✓` 由 `.choice-answered::before` 渲染），删除 `已选择：`；自由文本超长省略、`title` 悬浮完整；ask_user 卡同样生效 | `features/questions/choice-card.tsx`、`styles.css` |
| FR-3 点击得到真实回复 | 提取共享 `runChatStream`（`features/chat/stream-runner.ts`，依赖注入、可单测）；`startChatStream` 被**输入框、重试、卡片**三条路径共用，未复制第三份。卡片点击走 `service.chat.stream` → `chat.send` → Harness，流式/失败/取消/重试气泡与输入框一致 | `stream-runner.ts`、`App.tsx` |
| FR-4 模型澄清卡 | D 显示文案由 Host 强制为 `以上都不是`（`question.list` 与落库文本两处，不信任模型标签）；选 D 且 `allowOther` 时聚焦输入框、placeholder 提示「请用一句话说明真实意图」，说明文本经 `question.answer` 回传模型继续当前回合；`allowOther=false` 时 D 直接按选项作答；卡片显示过期/取消态（禁用置灰 + 一行提示），消失的请求不再停留可点击；`bindAskUserTool` 描述写入选项质量要求（具体、互斥、A–C 尽量命中、D 兜底、allowOther=true） | `handlers.ts`、`question-chat.tsx`、`App.tsx`、`ask-user.ts` |
| FR-5 一卡一答 | 点击即锁定：回答进行中/等待输入说明时全部行禁用（含 D 与兜底）；已答折叠；多卡按 `requestId` / `msgId` 键控互不影响；澄清态提供 × 取消入口 | `choice-card.tsx`、`App.tsx` |
| FR-6 持久化 | 答案以用户消息落库（既有）；成功回答时提问文本以**助手消息**落库（`【向用户提问】…\nA. …`），重启后模型上下文含完整问答。渲染层已答态仍为会话内存态；`chat.history` 回放恢复卡片不在本片 | `handlers.ts` `question.answer` |
| FR-7 来源标记 | 按任务书建议默认不做，纯文本足够 | — |
| FR-8 可访问性与主题 | 行为真实 `button`，`focus-visible` 焦点环（既有）；禁用行 `disabled` + `aria-disabled`；已答行 `role="status"`；澄清条 `role="status"`；颜色全部走既有主题变量，新增样式不写死主题色 | `choice-card.tsx`、`styles.css` |

行为说明：种子卡「其他，我说明」与模型卡 D 均进入输入框自由输入（澄清态），种子卡答案按普通用户消息发送并开新回合（任务书 Q3 决策）；模型卡答案不调用 `chat.send`（模型回合仍在等待），由 `question.answer` 回流。流式进行时点击卡片沿用与输入框一致的行为（取消当前回合再开新回合）。

## 2. 实际检查

环境：Windows、Node v24、pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0 |
| `pnpm test` | 退出 0。shared 6、harness-bridge 16、contracts 88、agent-tools 75、storage 159、desktop 268、runtime 128、harness-adapter 58、host 89 通过，另有 1 项既有付费冒烟跳过 |
| `git diff --check` | 退出 0 |

新增/更新的单测对应任务书验收项：U1/U2/U3（`tests/features/choice-card.test.ts`）、U4/U6 渲染侧（`tests/features/question-chat.test.ts`，含 D 兜底、锁定、过期两态）、U5（`tests/features/stream-runner.test.ts`，成功/失败/取消/跨会话隔离）、U6/U7 与落库（`packages/host/src/ask-user-chat.test.ts`，含 D 文案强制 + 助手提问行落库断言）。

## 3. 未验证

- **E1–E6 真机验收未执行**：本环境未启动 Electron 真机、未配置真实模型 Key、未让真实 Harness 进程发起 `ask_user`。渲染层测试使用 jsdom，Host 测试使用真实存储与假 HTTP 调用方。
- **E2/E3 的模型行为**（澄清卡选项质量、后续轮次引用该选择）依赖真实模型对更新后工具描述的遵循程度，仅落了描述文案，未做模型验收。
- `chat.history` 渲染层回放恢复卡片已答态：按任务书边界**不在本片**，如实标注为未验证项，与 `chat.history` 回放接线同批处理。
- FR-8 的键盘全流程与深浅主题截图（E5）、审批卡样式回归截图（E6）未截图归档到 `docs/reports/assets/choice-card/`。
- 未执行远程 CI、安装包、签名或 GitHub 保护规则复核。
- 渲染层多 Bot 并发作答时的极端竞态（如回答瞬间切换 Bot）仅靠状态键控约定，未做专项测试。

## 4. 契约与共享包影响

- `packages/contracts` 未改动（`question.list`/`question.answer` 请求响应形状不变）。
- `packages/agent-tools` 仅 `bindAskUserTool` 描述文案与 README 对应段落更新；协调器逻辑未改。
- `packages/host` `question.list` 增加 D 文案强制映射、`question.answer` 增加提问落库（仅 `chat_messages` 既有表）。

## 5. 负责人本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
