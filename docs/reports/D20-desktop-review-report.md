# D20 桌面评审与状态

日期：2026-10-28（UTC）。负责人：Etheslay。分支：`feature/event-rule-desktop-review-4519`，目标 develop。基线：`0261e58`（origin/develop，含已合并的 PR #93 `5cd86ca`）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

这是 D20 新 eventRule 链路的桌面评审/状态切片。设置页「通用」里、既有触发规则面板之后，为选定的一个 bot 显示本地事件规则。Host 方法没有改语义。`trigger.*` 没有改。没有聊天通知条，没有改聊天授权，没有移动鼠标或发送按键，也没有重做屏幕采集。

| 块 | 行为 |
| --- | --- |
| 规则 | `eventRule.list`。每一条显示名称和事件类型。当前状态来自规则上的两个开关：启用或停用；评审开关为真时再标出评审 |
| 待评审 | `eventRule.review.list` 只含仍待决定的项。批准调用既有 `eventRule.review.approve`，由 Host 启动一次运行。拒绝调用既有 `eventRule.review.deny`，由 Host 记下一次跳过且不启动。一次只送出一条决定 |
| 状态记录 | `eventRule.state.list`。同一页按时间从新到旧显示；时间相同则保持接口原来的先后。另一个 bot 的规则和状态行不显示 |
| 不做 | 不在此页保存、启用、停用或把规则改成评审。不列出跳过记录（仍由既有 `eventRule.record.list` 提供）。不新增聊天通知条。不改聊天权限授予。不移动鼠标、不发送按键 |

界面冻结基线的八项（气泡、往来查看、居中提示、无闪电按钮、卡片与选项卡配色）没有改。

## 2. 实际检查

环境：Linux，Node **v22.23.4**，pnpm **11.28.5**。仓库 `engines` 要求 Node ≥ 24；本机没有 Node 24，下列检查在 v22 上运行。`node:sqlite` 在 v22 仍是实验特性。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个带 typecheck 脚本的工作区包，含 desktop、host） |
| `pnpm --dir apps/desktop test` | 退出 0。51 个文件，472 通过。其中 `event-rule-settings.test.ts` 8 个：状态文案、从新到旧、选定 bot、批准一次、拒绝记下跳过、决定进行中不再发送第二条、失败文案不带出 Host 错误、切换 bot 后丢弃迟到响应 |
| `pnpm --dir packages/host exec vitest run src/event-rules.test.ts` | 退出 0。3 通过（保存/启停/跳过、批准一次与拒绝记跳过、状态记录从新到旧）。未改 Host |

## 3. 未验证

- 未跑 GitHub Actions。免费分钟已用完。缺席的 Actions 运行不表示代码失败。
- 未跑 `pnpm test` 全仓，未跑 Host 整包覆盖率，未跑 runtime 包测试。本片没有改这些包的实现。
- 未在 Node 24 上复跑。
- 未跑真实 Electron、真实窗口或真实 Harness 人工闭环。
- 未做聊天通知条、聊天授权改动、屏幕采集、设备动作、真实键鼠。
- 未安装包、未签名、未复核 GitHub 保护规则是否在服务端启用。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
