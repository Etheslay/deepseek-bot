# D21' 真实 Windows 指针与允许列表按键

日期：2026-10-29（Asia/Shanghai）。负责人：Etheslay。分支：`feature/d21-pointer-key-fc7a`，目标 `develop`。基线：`2735c115e736195566d8206dbdc7399c73c093a4`（`origin/develop`，含 PR #159）。本文记录这一次本机真实路径，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

范围只做 [GAP_AUDIT](../GAP_AUDIT.md) 的 D21'：PR #104 已合入的 `device.action.input`。不重复 PR #93 的窗口截图与 OCR。

## 1. 跑过的路径

独立临时数据根上的 Host，没有注入假的输入后端。`createHost` 因此走 Windows 生产分支：`packages/exec-daemon/assets/win32-input.ps1`，参数是数组，`shell: false`。策略只在这个临时库里设为 `ask`。每次输入各有一张精确审批：`permission.approval.decide` 使用该张审批自己的 `actionDigest`，`scope` 为 `once`。通过后 exec daemon 才调用辅助进程。`resolveApiKey` 若被调用会直接抛错；这次没有被调用。调度器没有 `start()`。没有模型请求。

临时数据根：`C:\Users\wu\AppData\Local\Temp\dsb-d21-pointer-key-9qUfkC`。产物留在该根下的 `device-outputs\974433b6-e2a0-409e-b319-a3a6537a38a7\`，没有提交。

| 次序 | 输入 | 结果 |
| --- | --- | --- |
| 1 | 指针 `move`，按钮字段 `left`（移动不点击），坐标 `(1227, 370)` | `{id: ec841c3e-5d18-4832-8707-86f5f8d523c7, at: 2026-10-29T09:41:31.204Z, kind: pointer}` |
| 2 | 按键 `right`，`tap`，`shift/ctrl/alt` 全为 false | `{id: f733956c-0e05-4954-a831-fc1d6542abe4, at: 2026-10-29T09:41:33.233Z, kind: key}` |

指针目标取自动作前瞬间的光标 `(1219, 370)` 再向右 8 像素，仍在虚拟屏幕内。动作后 `GetCursorPos` 为 `(1227, 370)`，与请求坐标一致。响应和 `device.action.input.list` 都不含 `device-outputs` 路径。清单两条，新的在前，与上面两份 JSON 一致。

按键发出前重新读取了前台窗口，没有沿用更早的观察。当时前台是 `explorer`，类名 `Progman`，焦点类名 `SysListView32`，插入符不可见，没有菜单。这是桌面图标列表，不是编辑器。`right` 在允许列表里，修饰键都关闭。实现本身不把导航键单独标成安全，它和字母、Enter、Delete 一样会 `SendInput` 到当前焦点。这次只在焦点已经是桌面时才批准这一下，效果是桌面图标选择移动一格，不改文档。

更早一次只读观察里前台曾是 `msedge`（`Chrome_WidgetWin_1`）。那一次没有发键。真正发键用的是上一节那次重新读取，不是那次 Edge 观察。

## 2. 延迟

时刻是 Host 写入产物的 UTC 时间。毫秒是本机 `performance.now()`：从 `device.action.input` 到看见待审批，以及从带上正确摘要的 `once` 决定到调用返回。后者包含审批落账、启动 `powershell.exe`、`Add-Type` 和 `SetCursorPos` 或 `SendInput`。

| 动作 | 请求到待审批 | 决定到返回 | 请求到返回 | 产物时间 (UTC) |
| --- | --- | --- | --- | --- |
| 指针移动 | 7 ms | 622 ms | 629 ms | 2026-10-29T09:41:31.204Z |
| Right | 3 ms | 594 ms | 596 ms | 2026-10-29T09:41:33.233Z |

整段从 `2026-10-29T09:41:29.739Z` 到 `2026-10-29T09:41:33.241Z`。没有超时，没有 `UNCONFIRMED`。

## 3. 没有按的键

没有点击。没有按 Win、Alt+F4、Delete、Enter、字母、数字、Tab、Space、Backspace、Escape、功能键，也没有带 Shift、Ctrl 或 Alt 的组合。这些要么不在允许列表（Win），要么会输入、提交、删除或触发命令。Edge 仍在前台时也不会发导航键，因为那会滚动页面，而且页面内部的文本焦点 `GetGUIThreadInfo` 不一定能看见。

焦点检查在调用 Host 之前。辅助进程冷启动大约 0.6 秒，这段里如果焦点被切走，这次不会再看一次。记录到的发送前焦点是桌面。

## 4. 失败

这两次调用没有失败。没有重试，没有第二下指针，没有第二下按键。

## 5. 本机命令

环境：Windows，Node v24.22.1，pnpm 11.28.5。工作树 `D:\deepseek-bot-wt-d21-pointer-key`，从上述 `origin/develop` 建出。原目录 `D:\deepseek-bot` 仍在 `feature/final-ledger-8e3d`，工作区干净，没有被这次改动碰到。

| 命令 | 结果 |
| --- | --- |
| `git fetch origin develop` | 退出 0。`develop` 更新到 `2735c11` |
| `pnpm install --frozen-lockfile` | 退出 0。锁文件未改 |
| `pnpm --filter @deepseek-bot/harness-bridge build` | 退出 0 |
| `pnpm exec vitest run src/d21-live-accept.test.ts --coverage=false --testTimeout=120000`（在 `packages/host`） | 退出 0。1 个文件，1 条通过，耗时 3.52 s。该文件只用于这次真机调用，提交前已删除 |
| `git diff --check` | 退出 0 |

没有跑 `pnpm lint`、`pnpm typecheck`、全仓 `pnpm test`，也没有跑 GitHub Actions。Actions 分钟已用尽，不能把缺席的远程检查写成通过。

## 6. 未验证

- 没有点击，没有把键送进 Edge、Cursor 或任何编辑器。
- 没有重做 PR #93 的截图或 OCR。
- 没有签名、安装包或干净机。
- 没有改用户平时使用的数据根；只写了上面的临时目录。
- 桌面图标选择可能因此移动了一格。光标停在 `(1227, 370)`，没有移回去，因为移回去会是第二次指针动作。

## 7. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与这两次真实输入：＿＿＿＿
- [ ] 本机命令、延迟、未按的键与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
