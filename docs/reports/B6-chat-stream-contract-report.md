# B6 `chat.stream` 通知契约补记（GAP_AUDIT §7.10 漂移收口）

日期：2026-10-30（Asia/Shanghai）。负责人：Etheslay。分支：`feature/chat-stream-notice-contract`，目标 `develop`。基线：`8b9e5bf`（`origin/develop`，PR #178）。本文只记本分支的修复与实际跑过的检查，不代表真人自审或合并结论。

范围：[GAP_AUDIT](../GAP_AUDIT.md) §7.10 登记（#173 审计、#178 勘误均确认）的契约漂移——B6 增量流（#172）新增的服务端→桌面通知 `chat.stream` 消费方已接（`packages/host/src/stdio.ts` 发送、`apps/desktop/src/main/host-client.ts` 消费），但 `packages/contracts` 没有该通知的 schema、CONTRACTS.md 无条目。只补契约面与两端类型源，不改任何运行行为。

## 1. 交付行为

- **contracts**：`events.ts` 瞬态流节新增 `ChatStreamNoticeSchema`（`botId` 为 UUID、`sessionId` ≤100、`text` 非空且 ≤ 新增 `TEXT_LIMITS.streamSegment`（100_000，注释说明为何不用 4k 用户消息上限））及推断类型 `ChatStreamNotice`；`version.ts` 注明该通知随 v0.12 入库、不升 protocolVersion（仅服务端→客户端、可加性，旧客户端忽略未知通知）。
- **host**：`chat.ts` 的本地 `ChatStreamNotice` 接口删除，改为从 contracts 导入并 re-export——发送端与消费端单一类型源；`stdio.ts` 发送路径不变（纯类型流转）。发送点既有 `text.length > 0` 守卫与 schema 的非空约束一致。
- **desktop**：`host-client.ts` 本地接口删除，改为 contracts 类型；`chat.stream` 处理从手写 `typeof` 三连检改为 `ChatStreamNoticeSchema.safeParse`——畸形通知整条忽略，行为与原先完全一致。
- **CONTRACTS.md §4**：新增「服务端→桌面 stdio 通知」段，如实记录 `schedule.missed`（FR-08，形状声明在 `@deepseek-bot/runtime`）与 `chat.stream`（B6）两个通知通道的 params、语义与兼容性。
- 测试 fixture 同步：假 Host 的 `chat.stream` botId 从 `"bot-1"` 改为线内真实的 UUID 形状，并在有效分段前压入一条畸形通知（非 UUID botId）——消费端必须跳过它仍转发有效段，测试钉住该行为。

## 2. 实际检查

环境：Windows 11，Node v24.15.0，pnpm 11.28.5。工作树 `D:\deepseek-bot`，自基线建出。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --filter @deepseek-bot/contracts test` | 退出 0。16 文件 158 通过（新增 `chat.stream` 通知 schema 校验 1 例：合法/非 UUID botId/空文本） |
| `pnpm --filter @deepseek-bot/desktop exec vitest run --config vitest.config.ts tests/main/host-client.test.ts` | 退出 0。6 通过（含畸形通知被跳过、仅转发有效段的断言） |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0。78 文件全过（695 例级） |
| `pnpm --filter @deepseek-bot/host test`（首跑） | 2 失败 / 287 通过 / 1 跳过——失败为 `task-dispatch`（18 例中 1）与 `real-app-tools`（1 例），均在 `HarnessAttempt.start` 的 harness 拉起路径；与本分支改动（纯类型）无关联模块 |
| 同两文件隔离复跑 | `task-dispatch` 18/18、`real-app-tools` 1/1 全绿 |
| `pnpm --filter @deepseek-bot/host test`（develop 基线复跑） | 同样 2 失败 / 287 通过 / 1 跳过——与本机已登记的「断言全过但全量首跑失败」抖动家族（PREMERGE-REVIEW §1、#143 审查记录）同现象，非本分支引入 |
| `pnpm lint` / `pnpm typecheck` / `git diff --check` | 均退出 0 |
| `pnpm --filter @deepseek-bot/desktop build` | 退出 0（electron-vite build，非安装包） |

## 3. 未验证与已知边界

- 未跑 GitHub Actions（分钟额度已用尽，与在库多份报告同口径）。
- 未做真实 Electron 手测：`chat.stream` 的实际转发链路在真实 Host 下由 host 层主路径测试与桌面单测覆盖，实机对话中的流式分段观感未复核（#172 报告同口径）。
- `schedule.missed` 通知仍未进 schema（形状只以 runtime 接口声明，桌面端保持手写透传）——本次按 §7.10 建议只补 `chat.stream`；如需把 `schedule.missed` 也钉进 contracts，另行小 PR。
- preload 的 `HostChatStreamNotice` 结构体类型与 contracts 类型同形但未合一（渲染层不直接依赖 contracts，保持现状，已在报告中登记）。

## 4. 恢复与许可

无新增依赖、迁移或产物目录；无协议版本变化。回退：`git revert` 单提交即可。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、通知语义与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
