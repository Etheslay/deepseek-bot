# D21 设备动作：一次精确审批后留下一条本地记录

日期：2026-10-27（UTC）。负责人：Etheslay。分支：`feature/device-action-record-07ab`。基线：`f25318b`（origin/develop，含已合并的 PR #88 `54c1728`）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

这是 D21 设备动作批准闸门之后的本地记录切片。权限策略没有改：`device.action` 仍默认 `deny`，只能 `ask` 或 `deny`，仍只接受一次精确的仅本次审批。屏幕采集、OCR、窗口选择和 exec daemon 没有改。没有单独的设备动作页面，没有网络，没有远程中继。

| 块 | 实现 |
| --- | --- |
| 记录 | 迁移 `0019-device-action-records`。一次精确审批通过后追加一条：id、bot id、动作名（`pointer` 或 `key`）、时间。`device.action.request` 的响应仍只有 `{id, at}`，且与这条记录相同 |
| 列出 | 受信方法 `device.action.list` 按 bot 列出，最新在前。默认 50，最多 100。另一个 bot 看不到 |
| 不写入 | 人类拒绝、等待中把策略改回 `deny`、同一张审批再用，都不追加。未知动作名在创建审批前拒绝，也不写入 |
| 不做 | 不移动鼠标，不发送按键，不调用 exec daemon，不做桌面界面，不联网 |

协议版本保持 0.7。新增受信方法 `device.action.list`。旧请求形状不变，0.1–0.7 的发送方仍被接受。记录在本机数据库里，随元数据备份。

## 2. 实际检查

环境：Linux，Node v22.23.4，pnpm 11.28.5。仓库 `engines` 要求 Node ≥ 24；本机没有 Node 24，下列检查在 v22 上运行。`node:sqlite` 在 v22 仍是实验特性。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个带 typecheck 脚本的工作区包，含 desktop、host、harness-bridge） |
| contracts `vitest run --coverage` | 退出 0。132 通过。行覆盖 98.7% |
| storage `vitest run --coverage` | 退出 1。195 通过，2 失败，都在 `layout.test.ts`：Windows `APPDATA` 与 `C:\` 根路径。本片未改 layout |
| storage 排除 `src/layout.test.ts` 后再跑 `--coverage` | 退出 0。184 通过。行覆盖 90.75%，分支 86.37%。`device-actions.ts` 行覆盖 100% |
| host：先 `pnpm --filter @deepseek-bot/harness-bridge build`，再 `vitest run --coverage` | 退出 0。185 通过、1 跳过（既有付费 API 冒烟）。行覆盖 88.25%，分支 80.64% |
| `git diff --check` | 退出 0 |
| 本片用例 | storage 3（一条记录的字段、未知动作名与缺失 bot 不落库、按时间从新到旧）、host 3（一次审批落一条、拒绝/停用/复用/未知名字不新增、按 bot 从新到旧）、contracts 1（`device.action.list` 形状；未知 kind 仍由既有请求 schema 拒绝） |

第一次 `pnpm typecheck` 与 host 测试脚本曾因 `packages/harness-bridge` 没有 `node_modules` 退出 2。根目录 `pnpm install` 之后复跑，上表是复跑结果。安装没有改 lockfile。

## 3. 未验证

- 未跑 GitHub Actions。免费分钟已用完，本次不触发远程 CI。缺席的 Actions 运行不表示代码失败。
- 未跑 `pnpm test` 全仓。agent-tools、runtime、exec-daemon、harness-adapter、harness-bridge、desktop、shared 的测试包没有单独跑。本片没有改这些包的源码。
- storage 的整包脚本因上述既有 Windows 路径用例退出 1。
- 未在 Node 24 上复跑。
- 未跑真实 Electron、真实窗口、真实鼠标或键盘。
- 未调用 exec daemon，也没有在 Windows 上执行输入。
- 未安装包、未签名、未复核 GitHub 保护规则是否在服务端启用。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
