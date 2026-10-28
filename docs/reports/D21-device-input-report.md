# D21 设备输入：一次精确审批后执行一次指针或按键

日期：2026-10-28（UTC）。负责人：Etheslay。分支：`feature/d21-device-input`。基线：`907b272`（origin/develop，含 PR #93 的 Windows 采集验收与 PR #101）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

这是批准闸门和本地记录之后的真实输入路径。`device.action` 仍默认 `deny`，不能 `allow`，也不接受会话或永久授权。`device.action.request` 与 `device_action` 仍只返回 id 和时间并写一条本地记录，不移动鼠标、不发送按键、不调用 exec daemon。

| 块 | 实现 |
| --- | --- |
| 一次精确审批 | 策略为 `ask` 时，`device.action.input` 或模型工具 `device_input` 等待一张审批。决定必须带同一张审批的 `actionDigest`，scope 为 `once`。摘要覆盖整份输入 |
| 有界输入 | 指针：`move` 或 `click`，按钮 `left` / `right` / `middle`，x 与 y 为 0–8192 的整数。按键：允许列表中的一个名字，动作只能是 `tap`，并带 `shift` / `ctrl` / `alt`。不含 Windows 键、命令、路径或自由文本 |
| 执行 | 审批通过并再次确认策略仍是 `ask` 之后，Host 调用 exec daemon。Windows 上辅助进程是固定的 `win32-input.ps1`，参数是数组，不用 shell 命令字符串。脚本用 `SetCursorPos` 与 `SendInput` |
| 产物 | 成功后响应只有 `{id, at, kind}`，不含坐标和路径。本机 `device-outputs/<botId>/` 写 JSON 和清单。`device.action.input.list` 按该 bot 从新到旧列出，默认 50，最多 100。不进元数据备份 |
| 不执行 | 策略不是 `ask`、人类拒绝、等待中改回 `deny`、同一张审批再用、未知按键、归档 bot，或当前系统没有输入辅助进程，都不调用辅助进程，也不留下成功产物。符号链接的输出目录或产物文件会被拒绝 |
| 不做 | 无设备动作桌面页，不进入聊天应用工具目录，不联网，不开 D23 |

协议版本保持 0.7。新增受信方法 `device.action.input` 与 `device.action.input.list`。旧的 `device.action.request` 形状不变。非 Windows 的生产 Host 使用不可用后端，在审批前拒绝，不启动进程。

## 2. 实际检查

环境：Linux，Node v22.23.4，pnpm 11.28.5。仓库 `engines` 要求 Node ≥ 24；本机没有 Node 24，下列检查在 v22 上运行。`node:sqlite` 在 v22 仍是实验特性。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm --filter @deepseek-bot/contracts typecheck` | 退出 0 |
| `pnpm --filter @deepseek-bot/exec-daemon typecheck` | 退出 0 |
| `pnpm --filter @deepseek-bot/agent-tools typecheck` | 退出 0 |
| `pnpm --filter @deepseek-bot/host typecheck` | 退出 0 |
| `pnpm --filter @deepseek-bot/storage typecheck` | 退出 0 |
| `pnpm --filter @deepseek-bot/desktop typecheck` | 退出 0（node 与 web） |
| contracts `vitest run --coverage` | 退出 0。134 通过。行覆盖 98.77% |
| exec-daemon `vitest run --coverage` | 退出 0。39 通过，1 跳过（既有真实 Windows 窗口采集）。行覆盖 90.64%，分支 79.48% |
| agent-tools `vitest run --coverage` | 退出 0。125 通过。行覆盖 94.48% |
| host：先构建 harness-bridge，再 `vitest run --coverage` | 退出 0。207 通过，1 跳过（既有付费 API 冒烟）。行覆盖 88.43%，分支 79.09%。分发测试确认 `win32-input.ps1` 被复制到 Host 产物 |
| storage `vitest run --coverage` | 退出 1。198 通过，2 失败，都在 `layout.test.ts`：Windows `APPDATA` 与 `C:\` 根路径。本片未改这两条断言。`ensureDataLayout` 创建 `device-outputs` 的用例通过 |
| `git diff --check` | 退出 0 |
| 本片用例 | contracts 1（有界指针/按键，拒绝命令、路径、未知键与超界坐标）、exec-daemon 10（参数数组、允许列表、未知键不启动、失败与超时）、host 5（询问前拒绝、一次审批执行一次、复用失败、记录路径不调用输入后端、失败与链接不留下可列出的成功产物） |

方法白名单长度断言从 104 改为 107。`develop` 上的数组在这次改动前已有 105 个方法，原断言少记 1 个；本片新增 2 个方法。

## 3. 未验证

- 未跑 GitHub Actions。
- 未跑 `pnpm test` 全仓。desktop、runtime、harness-adapter、harness-bridge 的测试包没有单独跑。本片没有改这些包的源码。
- storage 的整包脚本因上述既有 Windows 路径用例退出 1。
- 未在 Node 24 上复跑。
- 未跑真实 Electron。
- 未在 Windows 上执行真实鼠标或键盘。这台机器是 Linux，生产路径不会启动 `powershell.exe`。输入用测试里的假后端验证调用时机和参数。
- 未复核真实窗口截图或 OCR。PR #93 的 Windows 验收不在本环境重跑。
- 未安装包、未签名、未复核 GitHub 保护规则是否在服务端启用。
- 没有设备动作桌面页。D23 未开始。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
