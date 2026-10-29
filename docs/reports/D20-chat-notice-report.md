# D20' 聊天内自动化状态通知条

日期：2026-10-28（Asia/Shanghai）。任务：[任务书](../TASK_D20_CHAT_NOTICE.md)（本分支首笔提交 `2c49a9c`，先书后实现）。分支：`feature/d20-chat-notice`，从 `origin/develop` 的 `968aa0b` 拉出。本文由实现辅助写成，不代表负责人真人自审或合并结论；自审必须针对该分支最新提交 SHA。

## 1. 交付行为（与任务书逐条对应）

- **通知条组件** `features/automation/chat-automation-notice.tsx`（新增）：挂在聊天页静态占位行与消息列表之间（`App.tsx`）。当前 bot 无规则时不渲染；有规则但无最近活动（错过/状态变更/待评审全为零）时也不渲染。折叠为一行摘要（计数段为零值省略），展开显示详情。
- **错过可见**：详情按时间倒序列出最近 `skipped`/`duplicate` 记录（取 `eventRule.record.list` limit 10 后截 5 条），每条 = 结果（已跳过/重复已去重）· 规则名 · 原因 · 时间；`started` 记录不进通知条（运行本身在运行监控可见）。
- **启停可见**：最近状态变更行（`eventRule.state.list` 截 5 条，新在前），规则名 → 已启用/已停用/评审（复用 `eventrule.state*` 既有词）。
- **待评审可见**：摘要计数 + 详情行"去设置处理"——经 `onOpenAutomation` 回调打开设置并落到通用分区（`EventRuleSettings` 所在分区），不在聊天里批/拒。
- **数据面**：只调 4 个既有受信读方法（`eventRule.list` / `eventRule.record.list` / `eventRule.state.list` / `eventRule.review.list`），响应一律过 `METHOD_CONTRACTS` 响应 schema；挂载 + bot 切换 + 每 20 秒轮询；ticket 守卫丢弃陈旧响应。
- **原因映射**（仅显示层）：Host 稳定英文常量 `rule disabled`/`review denied`/`duplicate event`/`source run was started by an event rule` 映射为界面语言；`event rule trigger failed: {rest}` 映射为"触发失败：{0}"；未知原因原样展示。数据不重写。
- **失败降级**（按任务书修正后的语义）：失败保留最近一次成功数据继续显示，无数据则静默不渲染；不弹错、不打断聊天，20 秒后自动重试。
- **红线遵守**：契约/协议版本零改动（无新方法）；`packages/*` 全部零改动；规则引擎、幂等去重、游标、评审队列未触碰；通知条不写 `chat_messages`，历史回放不受影响；纯本地，无网络请求。
- 样式：`.automation-notice` 一族新增于 `styles.css`，视觉语言沿用聊天弱化行（panel 底 + 细边框 + muted 文字），全部使用既有主题变量，深浅主题自适应；i18n 新域文件 `messages/automation-notice.ts`（14 个键，zh/en）。

与任务书的实现偏差（两处，均为细化）：

1. 摘要计数由单键改为三个键（`noticeSummaryMissed/Pending/States`）拼接，以便零值段省略——语义与任务书"错过 N · 待评审 M · 状态变更 K"一致；
2. 任务书 §3.2 的"连续失败给加载失败行"在成文时已修正为静默降级（保留旧数据/无数据不渲染），实现按修正后语义执行。

## 2. 实际检查

环境：Windows、Node v24、pnpm 11（本机）。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --filter @deepseek-bot/desktop exec vitest run tests/features/chat-automation-notice.test.ts` | 9 通过（首轮曾 5 败：夹具 record/state id 非合法 UUID 被 schema 拒绝——恰证明解析在生效；修正夹具后全过） |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个工作区包全绿；首跑 desktop 两处类型错误已修复：原因映射 Map 值类型收窄为键联合、missed 过滤改 flatMap 使 outcome 收窄） |
| `pnpm --filter @deepseek-bot/desktop test`（全量） | 退出 0，62 个测试文件 / 561 用例全过（552 既有 + 9 新增，含 i18n-scan 未翻译串扫描） |

测试覆盖（9 例）：原因映射（含 trigger-failed 前缀与未知兜底）；无规则不渲染；摘要计数/展开详情/started 过滤/aria-expanded；跳转回调；只调 4 个读方法（写方法零调用断言）；失败且无数据静默；失败保留旧数据；bot 切换丢陈旧响应。

## 3. 未验证边界

- 未打开 Electron 手测（无截图）：通知条在真实聊天页的视觉位置、深浅主题对比度、与滚动容器的交互需实机确认；建议随 PR 附截图后合并。
- 20 秒轮询的频率取舍未做用户接受度验证；如嫌重可后续加可见性感知暂停（`document.visibilityState`），本片未做。
- 通知条与既有"消息 hover 操作条/失败横幅"在同一垂直空间的行为未实机叠加验证。
- 全仓其余包的套件结果沿用同基线证据（`94bc05d`，[G9' 报告](G9-update-channel-docs-report.md) §3）：本分支未触及 `packages/*`。

## 4. 负责人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与证据：＿＿＿＿
- [ ] 未验证边界与结论：＿＿＿＿
