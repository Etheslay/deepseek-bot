# D21 设备动作：一次精确审批后只返回 id 和时间

日期：2026-10-27（UTC）。负责人：Etheslay。分支：`feature/device-action-approval-ffd6`。基线：`f52b993`（origin/develop，含已合并的 PR #87）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

这是 D21 设备动作的批准闸门。屏幕采集、OCR、窗口选择和 exec daemon 没有改。没有单独的设备动作页面，没有网络，没有远程中继。

| 块 | 实现 |
| --- | --- |
| 默认关闭 | 能力 `device.action` 默认 `deny`。`allow` 不能写入。策略不是 `ask` 时，`device.action.request` 直接拒绝，不产生接受结果 |
| 一次精确审批 | 策略改为 `ask` 后，一次请求等待一张审批。决定必须带上同一张审批的 `actionDigest`，scope 为 `once`。摘要不符或 session/permanent 都拒绝，请求仍未接受 |
| 拒绝或不启用 | 人类拒绝，或等待中把策略改回 `deny`，请求失败，没有接受结果。之后在 `deny` 下再请求也不进入待审批 |
| 不能复用 | 同一张审批决定第二次，或拿它去批准下一次请求，都失败。下一次请求仍待自己的审批；拒绝它也不会接受 |
| 结果 | 接受后只返回 `{id, at}`。请求只带 `botId` 和 `kind: pointer\|key`，不接受坐标、按键名、命令或路径 |
| 不做 | 不移动鼠标，不发送按键，不调用 exec daemon。模型工具 `device_action` 走同一闸门，不进入聊天应用工具目录 |

协议版本保持 0.7。新增受信方法 `device.action.request`。旧请求形状不变，0.1–0.7 的发送方仍被接受。

设置页会多出「设备动作」一行，因为现有权限列表渲染全部能力。这一行只有「每次询问」和「从不允许」。没有设备动作设置页、预览或输入控件。

## 2. 实际检查

环境：Linux，Node v22.23.4，pnpm 11.28.5。仓库 `engines` 要求 Node ≥ 24；本机没有 Node 24，下列检查在 v22 上运行。`node:sqlite` 在 v22 仍是实验特性。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个带 typecheck 脚本的工作区包，含 desktop、host、harness-bridge） |
| contracts `vitest run --coverage` | 退出 0。131 通过。行覆盖 98.69% |
| agent-tools `vitest run --coverage` | 退出 0。124 通过。行覆盖 94.4% |
| host `vitest run --coverage` | 退出 0。182 通过、1 跳过（既有付费 API 冒烟）。行覆盖 88.24% |
| desktop `vitest run` | 退出 0。50 个文件，464 通过 |
| `git diff --check` | 退出 0 |
| 本片用例 | contracts 2（默认拒绝、请求不能带坐标/按键/命令，响应只有 id 与时间）、agent-tools 1（工具只转发 kind）、host 3（询问前拒绝、一次精确审批、同一张审批再用失败） |

## 3. 未验证

- 未跑 GitHub Actions。免费分钟已用完，本次不触发远程 CI。缺席的 Actions 运行不表示代码失败。
- 未跑 `pnpm test` 全仓。storage、runtime、exec-daemon、harness-adapter、harness-bridge 的测试包没有单独跑。
- 未在 Node 24 上复跑。
- 未跑真实 Electron、真实窗口、真实鼠标或键盘。
- 未调用 exec daemon，也没有在 Windows 上执行输入。
- 未安装包、未签名、未复核 GitHub 保护规则是否在服务端启用。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
