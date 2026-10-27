# D20 本地事件评审：命中入队，批准启动一次

日期：2026-10-27（UTC）。负责人：Etheslay。分支：`feature/event-review-queue-0e27`。基线：`c6e3fcb`（origin/develop，含已合并的 PR #84 与 PR #78）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

这是 D20 事件规则上的本地评审切片。调度器没有改。`trigger.*` 评审队列没有改。没有桌面界面，没有聊天通知条，没有网络，没有远程中继。

| 块 | 实现 |
| --- | --- |
| 设为评审 | 迁移 `0017-event-rule-reviews` 给 `event_rules` 增加 `review`，默认 0。受信方法 `eventRule.review` 只把该列设为真，不改变启停。保存载荷仍然不能带 `enabled` 或 `review`。新建规则两者都是关 |
| 入队 | 规则已启用且 `review` 为真时，游标之后的一条匹配本地事件（`run.failed` / `run.completed`，且运行涉及该 bot）写入一条 `pending` 评审项，不调用 `startRun`。`eventRule.review.list` 按 bot 列出仍待决定的项 |
| 批准 | `eventRule.review.approve` 用规则 id 与事件 id 派生的幂等键启动恰好一个运行，并写入 `started`（reason=`review approved`）。再次批准发现该项已不是 pending，不再启动 |
| 拒绝 | `eventRule.review.deny` 写入 `skipped`（reason=`review denied`），`runId` 为空，不启动。再次拒绝不再写第二条跳过 |
| 重复 | `(rule, event)` 在评审表上唯一。同一事件再次被扫到时写 `duplicate`，不第二次入队，也不启动 |
| 关闭 | 规则关闭时，即使已经设为评审，仍写 `skipped`（reason=`rule disabled`），不入队。已经记过的事件之后再启用也不补跑 |
| 不做 | 不联网，不远程中继，不改调度器，不做桌面界面，不做聊天通知条 |

协议版本保持 0.7。新增的是受信方法，并在既有规则响应上增加 `review` 布尔值。旧请求形状不变，0.1–0.7 的发送方仍被接受。运行触发种类仍是 `manual` / `schedule`。

## 2. 实际检查

环境：Linux，Node v22.23.4，pnpm 11.28.5。仓库 `engines` 要求 Node ≥ 24；本机没有 Node 24，下列检查在 v22 上运行。`node:sqlite` 在 v22 仍是实验特性。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个带 typecheck 脚本的工作区包，含 desktop、host、harness-bridge） |
| contracts `vitest run --coverage` | 退出 0。128 通过。行覆盖 98.67% |
| storage `vitest run --coverage` | 退出 1。`layout.test.ts` 两项失败：Windows `APPDATA` 与 `C:\` 根路径。本片未改 layout。排除该文件后 178 通过，行覆盖 90.57% |
| runtime `vitest run --coverage` | 退出 1。`permissions-policy.test.ts` 两项失败：Windows 路径 `C:\workspaces\...`。本片未改权限策略。排除该文件后 118 通过、6 跳过，行覆盖 86.36% |
| host | 先直接跑 vitest 时失败：工作区没有 `harness-bridge` 的 dist，聊天与任务用例报 application tools plugin unavailable。执行 `pnpm --filter @deepseek-bot/harness-bridge build` 后再跑 `vitest run --coverage`，退出 0。178 通过、1 跳过（既有付费 API 冒烟）。行覆盖 88.16% |
| 本片用例 | storage 4（含一条评审唯一与再次决定）、runtime 9（原有 4 条，加上评审拦住运行、批准只启动一次、拒绝记跳过、同一事件不第二次入队、关闭的评审规则记跳过且不入队）、host 2（原有跳过列表，加上列出待评审、批准一次、拒绝一条）、contracts 的 `eventRule.review*` 形状检查含在 128 里 |

## 3. 未验证

- 未跑 GitHub Actions。免费分钟已用完，本次不触发远程 CI。缺席的 Actions 运行不表示代码失败。
- 未跑 `pnpm test` 全仓。storage 与 runtime 的整包脚本因上述既有 Windows 路径用例退出 1。
- 未在 Node 24 上复跑。
- 未跑桌面测试、真实 Electron、真实 Harness 人工闭环。
- 未做桌面评审界面、聊天通知条、桌面屏幕、设备动作、截图。
- 未安装包、未签名、未复核 GitHub 保护规则是否在服务端启用。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
