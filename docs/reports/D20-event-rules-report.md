# D20 本地事件规则：命中一次启动一个运行

日期：2026-10-27（UTC）。负责人：Etheslay。分支：`feature/event-automation-rules-844b`。基线：`e7bc074`（origin/develop，含已合并的 PR #83）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

这是 D20 的本地自动启动切片，与已合入的评审队列（PR #66，`trigger.*`）分开。评审队列仍然不会自动启动运行。调度器类没有改。

| 块 | 实现 |
| --- | --- |
| 规则 | 迁移 `0016-event-rules`。一条规则属于一个 bot，目标工作流必须包含该 bot，事件类型只允许本地的 `run.failed` / `run.completed`。受信方法 `eventRule.save` / `eventRule.list` / `eventRule.enable` / `eventRule.disable`。新建固定关闭，保存载荷不能带 `enabled`。不是模型工具 |
| 启动一次 | 启用后，游标之后的一条匹配本地事件经既有 `WorkflowEngine.startRun` 启动一个运行。幂等键由规则 id 与事件 id 派生，同一事件不会变成第二个运行。规则保存之前的事件留在游标后面，不回放 |
| 重复 | 同一事件再次被扫到时写入 `duplicate` 记录，不启动第二个运行 |
| 关闭 | 关闭的规则不启动运行，写入 `skipped`（reason=`rule disabled`）。`eventRule.record.list` 可以按 bot 列出。之后再启用也不补跑已经记过的事件 |
| 循环 | 本规则自己启动的运行再发出同类事件时记跳过，不再启动 |
| 不做 | 不联网，不远程中继，不改评审队列界面、聊天通知条、桌面屏幕、设备动作或截图 |

协议版本保持 0.7。新增的是受信方法，旧方法语义不变，0.1–0.7 的发送方仍被接受。运行触发种类仍是 `manual` / `schedule`；事件规则用派生幂等键和记录表去重，没有改 `runs.trigger_kind` 的检查约束，也没有改调度器。

## 2. 实际检查

环境：Linux，Node v22.23.4，pnpm 11.28.5。仓库 `engines` 要求 Node ≥ 24；本机没有 Node 24，下列检查在 v22 上运行。`node:sqlite` 在 v22 仍是实验特性。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm exec eslint`（本片改动的 ts 文件） | 退出 0 |
| `pnpm --filter` contracts、storage、runtime、host `typecheck` | 退出 0 |
| contracts `vitest run --coverage` | 退出 0。127 通过。行覆盖 98.63% |
| storage `vitest run --coverage` | 退出 1。`layout.test.ts` 两项失败：Windows `APPDATA` 与 `C:\` 根路径。本片未改 layout。排除该文件后 177 通过，行覆盖 90.41% |
| runtime `vitest run --coverage` | 退出 1。`permissions-policy.test.ts` 两项失败：Windows 路径 `C:\workspaces\...`。本片未改权限策略。排除该文件后 113 通过、6 跳过，行覆盖 86.24% |
| host `vitest run --coverage`（沿用已有 harness-bridge dist，未重建） | 退出 0。177 通过、1 跳过（既有付费 API 冒烟）。行覆盖 88.13% |
| 本片用例 | storage 3、runtime 4（一次启动、重复、关闭跳过、自启动循环）、host 1（保存默认关闭、按 bot 列出、启停、列出跳过）、contracts 的 `eventRule` 形状检查含在 127 里 |

## 3. 未验证

- 未跑 GitHub Actions。免费分钟已用完，本次不触发远程 CI。
- 未跑 `pnpm test` 全仓。`pnpm typecheck` 全仓在 `packages/harness-bridge` 失败：该包没有 `node_modules`，缺 `@types/node`。host 的 `pnpm test` 脚本会先重建 harness-bridge，因此同样失败。host 套件是直接跑 vitest，使用快照里已有的 dist。
- 未在 Node 24 上复跑。
- 未跑桌面测试、真实 Electron、真实 Harness 人工闭环。
- 未做评审队列界面、聊天通知条、桌面屏幕、设备动作、截图。
- 未安装包、未签名、未复核 GitHub 保护规则是否在服务端启用。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
