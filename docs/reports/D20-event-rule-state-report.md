# D20 本地事件规则：启停与评审的状态记录

日期：2026-10-27（UTC）。负责人：Etheslay。分支：`feature/event-rule-state-history-d3c8`。基线：`bcc3258`（origin/develop，含已合并的 PR #85）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

这是 D20 事件规则上的本地状态记录切片。保存、列出、启停、评审、待评审、批准、拒绝和跳过记录的既有方法没有改语义。调度器没有改。`trigger.*` 没有改。没有桌面界面，没有聊天通知条，没有网络，没有远程中继。

| 块 | 实现 |
| --- | --- |
| 记录 | 迁移 `0018-event-rule-states`。启用、停用，或把规则改为评审，且该开关真的变化时，追加一条：规则 id、bot id、新状态（`enabled` / `disabled` / `review`）、时间 |
| 不追加 | 新建规则不写记录。对已经关闭的规则再调用停用、对已经启用的规则再调用启用、对已经处于评审的规则再调用 `eventRule.review`，都不追加 |
| 列出 | 受信方法 `eventRule.state.list` 按 bot 列出，最新在前。默认 50，最多 100。另一个 bot 看不到 |
| 不做 | 不联网，不远程中继，不改调度器，不做桌面界面，不做聊天通知条 |

协议版本保持 0.7。新增的是受信方法。旧请求形状不变，0.1–0.7 的发送方仍被接受。

## 2. 实际检查

环境：Linux，Node v22.23.4，pnpm 11.28.5。仓库 `engines` 要求 Node ≥ 24；本机没有 Node 24，下列检查在 v22 上运行。`node:sqlite` 在 v22 仍是实验特性。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个带 typecheck 脚本的工作区包，含 desktop、host、harness-bridge） |
| contracts `vitest run --coverage` | 退出 0。129 通过。行覆盖 98.68% |
| storage `vitest run --coverage` | 退出 1。`layout.test.ts` 两项失败：Windows `APPDATA` 与 `C:\` 根路径。本片未改 layout。排除该文件后 181 通过，行覆盖 90.67% |
| host | 先执行 `pnpm --filter @deepseek-bot/harness-bridge build`，再跑 `vitest run --coverage`，退出 0。179 通过、1 跳过（既有付费 API 冒烟）。行覆盖 88.2% |
| 本片用例 | storage 3（真实状态变化、重复调用不记、按时间从新到旧）、host 1（同一三件事走受信方法）、contracts 的 `eventRule.state.list` 形状检查含在 129 里 |

## 3. 未验证

- 未跑 GitHub Actions。免费分钟已用完，本次不触发远程 CI。缺席的 Actions 运行不表示代码失败。
- 未跑 `pnpm test` 全仓。storage 的整包脚本因上述既有 Windows 路径用例退出 1。
- 未跑 runtime 包测试。本片没有改 runtime。
- 未在 Node 24 上复跑。
- 未跑桌面测试、真实 Electron、真实 Harness 人工闭环。
- 未做桌面界面、聊天通知条、桌面屏幕、设备动作、截图。
- 未安装包、未签名、未复核 GitHub 保护规则是否在服务端启用。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
