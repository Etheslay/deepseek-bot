# stream-pacer 流式回放节奏（PR #151 事后补录）

> **补录说明**：本报告于 2026-10-30 依合并代码（`348493f`）、提交信息与合并记录（PR #151 `6659d29`，分支 `feature/streaming-reply`）整理入库，补 GAP_AUDIT §7.9 第 9 条登记的「无入库报告」欠账。**这是事后整理，不是 2026-10-29 交付当时的验证记录**；无编号 UX 切片，自审栏照例留空待负责人签署。
>
> 台账勘误：本切片的编号此前在 SPRINTS/GAP_AUDIT 多处被误写作 #150（语音接线的编号）——合并提交为准：**#151 = `feature/streaming-reply`**，#150 = `feature/voice-ui-wiring`。

## 1. 交付行为（PR #151，合入 `6659d29`）

Host 的 `chat.send` 以整包回复返回，渲染层原先用一个同步循环一次性放出全部文本——回复瞬间出现而非流式呈现。本 PR 引入 `features/chat/stream-pacer.ts`（纯呈现层，契约零改动）：

- **行感知切片**：长文本按行切块、短文本按句切块后逐块放出。
- **自适应节奏**：间隔由回复长度决定——短回答保持 40–120ms 的节拍；长回答加速到 12ms 下限并按 tick 归组多行，1200 行的回复也在 7 秒窗口内放完（提交信息记载的设计边界）。
- **取消干净**：取消时释放挂起的定时 tick，气泡不会停留在 busy 状态；并修复了 finish 即 resolve 与取消不释放定时器的问题（PR 正文记载）。
- 文件面：`stream-pacer.ts`（165 行）+ `host-service.ts` 回放路径接线（约 40 行）+ `stream-pacer.test.ts`（10 例）。

## 2. 与后续 B6 增量流的关系（如实区分）

- `feature/b6-incremental-streaming`（PR #172）为**运行中回合**增加了服务端实时分段推送（`chat.stream` 通知，见 [B6 契约补记](B6-chat-stream-contract-report.md)）。
- 本切片的 pacer 仍承担整包回复的回放节奏（`host-service.ts` 的 `planPacing` 接线保持），两者分别覆盖"运行中实时分段"与"整包回放/历史"两条路径，未互相替换。

## 3. 验证证据（补录时复跑）

| 检查 | 命令 | 结果（2026-10-30，develop = `8b9e5bf` 树上复跑） |
| --- | --- | --- |
| 本切片引入的测试 | `pnpm --filter @deepseek-bot/desktop exec vitest run --config vitest.config.ts tests/features/stream-pacer.test.ts` | 1 文件 10 通过 |
| 交付当时 | 无入库报告（PR 正文为准）；desktop 套件当时全绿 | 本文件即补录 |

## 4. 未验证（沿交付当时口径，补录不追认）

- 真机观感（不同长度回复的节奏体感）、1200 行回复的 7 秒窗口实测——纯计时/观感类验证，无截图。
- GitHub Actions 未跑（交付当时与本补录时均未执行）。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　针对提交：`348493f`（PR #151 合入内容）　日期：＿＿＿＿

- [ ] 差异、需求和错误路径检查结果：＿＿＿＿
- [ ] 测试证据 / 兼容性与权限影响（纯呈现层，契约零改动）：＿＿＿＿
- [ ] 遗留问题与处理方式：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
