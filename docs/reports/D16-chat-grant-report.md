# D16 聊天授予一项能力

日期：2026-10-28（UTC）。负责人：Etheslay。分支：`feature/chat-permission-grant-a60d`，目标 develop。基线：`ebbc463`（origin/develop，含已合并的 PR #94）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

已合入的聊天审批卡仍然决定一次待执行的工具调用。这一片补的是：不必先等工具调用，当前聊天就可以给这个 bot 授予或撤销一项能力。授予写入既有 `permission_grants`，由现有 D16 网关在执行前检查。没有新的设备输入，也没有网络。

| 块 | 实现 |
| --- | --- |
| 授予 | 受信方法 `permission.grant.issue`。请求只有 `botId`、`capability`、`scope`（`session` 或 `permanent`）。一次一项。Host 把会话写成 `chat:<botId>`，与该 bot 聊天工具的受信调用方一致，并绑上当前 Host 代次。默认 5 次、120 分钟。调用方不能自带会话、次数或期限 |
| 重复授予 | 同一 bot、能力、作用域和会话上仍有效的授权再发一次，返回原来那一条。不延长到期时间，也不把已用次数清零 |
| 撤销 | 聊天列出这个 bot 尚未撤销的授权，撤销仍走已有 `permission.grant.revoke`。另一个 bot 的授权不出现在这张卡上 |
| 网关 | 会话授权匹配后，`create_group` 会执行并扣一次。撤销后下一次调用停在审批前，取消后不会创建。策略改为拒绝时，即使授权还在，调用也以 `UNAUTHORIZED_PATH` 失败，不产生副作用 |
| 不能授予 | `app.start_run`、`exec.shell`、`screen.capture`、`device.action`、`mcp.call` 在契约层拒绝会话和永久授权。策略不是「每次询问」时也不发放。模型目录没有这个方法 |
| 会话失效 | 沿用既有契约：会话必须一致，2 小时或 5 次用尽后不再放行；Host 重启撤销 once/session，永久授权保留。关闭聊天窗口本身不另做一次撤销 |
| 不做 | 不移动鼠标，不发送按键，不调用 exec daemon，不联网。不新增 `grantedVia`，不移除角色选择器，也不把一句聊天话术自动变成授权 |

协议版本保持 0.7。新增的是受信方法。旧请求形状不变，0.1–0.7 的发送方仍被接受。

设置页策略和已有审批卡没有改语义。`screen.*` 与事件规则桌面没有改。

## 2. 实际检查

环境：Linux，Node v22.23.4，pnpm 11.28.5。仓库 `engines` 要求 Node ≥ 24；本机没有 Node 24，下列检查在 v22 上运行。`node:sqlite` 在 v22 仍是实验特性。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个带 typecheck 脚本的工作区包，含 desktop、host、contracts、storage） |
| contracts `vitest run --coverage` | 退出 0。133 通过。行覆盖 98.71% |
| storage `vitest run --coverage` | 退出 1。`layout.test.ts` 两项失败：Windows `APPDATA` 与 `C:\` 根路径。本片未改 layout。198 通过、2 失败 |
| storage 排除 `src/layout.test.ts` 后的 `vitest run --coverage` | 退出 0。187 通过。行覆盖 90.86%，覆盖率门槛通过 |
| host `vitest run --coverage` | 退出 0。199 通过、1 跳过（既有付费 API 冒烟）。行覆盖 88.5% |
| desktop `vitest run` | 退出 0。51 个文件，474 通过 |
| `git diff --check` | 退出 0 |
| 本片用例 | contracts 1（一项会话/永久授予，逐次能力与多余字段拒绝）、storage 3（网关消费与撤销、TTL 与代次、策略/逐次/归档拒绝）、host 5（授予后执行、撤销后不执行、策略拒绝不执行、逐次能力与模型自授拒绝、会话隔离与重启失效、永久授权跨重启保留）、desktop 2（授予一项且不列出逐次能力、只撤销当前 bot） |

## 3. 未验证

- 未跑 GitHub Actions。免费分钟已用完，本次不触发远程 CI。缺席的 Actions 运行不表示代码失败。
- 未跑 `pnpm test` 全仓。runtime、agent-tools、exec-daemon、harness-adapter、harness-bridge 的测试包没有单独跑。本片没有改这些包的源码。
- 未在 Node 24 上复跑。
- 未跑真实 Electron，也没有在浏览器里点这张聊天卡。桌面覆盖是 jsdom。
- 未跑真实鼠标、键盘、截图或网络请求。
- 未安装包、未签名、未复核 GitHub 保护规则是否在服务端启用。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
