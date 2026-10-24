# 桌面壳（D02）

`apps/desktop` 是 Electron + React + TypeScript 桌面壳，为 D05（机器人工作区）、D07（工作流编辑）、D09（运行监控）提供容器。当前为静态占位壳：不接 Harness、不建数据库、不做真实机器人/工作流/运行功能，界面状态仅存于会话内存（不持久化）。

## 应用结构

```text
apps/desktop/
  package.json                 @deepseek-bot/desktop；脚本见下
  tsconfig.json                引用 node / web 两套工程
  electron.vite.config.ts      main / preload（CJS 输出）与 renderer 构建
  electron-builder.yml         仅 --dir 的 Windows x64 unpacked 打包
  src/main/index.ts            窗口、托盘、单实例、生命周期、权限拒绝
  src/main/ipc/registry.ts     IPC 白名单注册
  src/main/ipc/guards.ts       sender 校验（主窗口主 frame）
  src/preload/index.ts         contextBridge 暴露 window.deepseekBot
  src/shared/ipc-channels.ts   通道常量、白名单、IpcDeniedError
  src/renderer/                React 导航壳（Bots/Workflows/Runs/Settings 占位页）
  tests/ipc-registry.test.ts   白名单与 sender 校验单元测试
  assets/tray.png              托盘图标（自有素材）
```

## 命令

均在仓库根目录执行：

```powershell
pnpm --filter @deepseek-bot/desktop dev        # 开发模式（electron-vite dev）
pnpm --filter @deepseek-bot/desktop build      # 仅构建 main/preload/renderer 到 out/
pnpm --filter @deepseek-bot/desktop test       # vitest 单元测试
pnpm --filter @deepseek-bot/desktop pack:dir   # 构建 + electron-builder --dir 出 unpacked
```

根 `pnpm lint` / `pnpm typecheck` / `pnpm test` 会覆盖本包。打包输出在 `apps/desktop/release/win-unpacked/`（已 gitignore）；`out/` 为中间构建产物（已 gitignore）。

打包需要下载/缓存 Electron 发行包；若默认缓存目录不可写，可设置 `ELECTRON_CACHE` / `ELECTRON_BUILDER_CACHE` 指向可写目录。

## 窗口与安全设置

`BrowserWindow.webPreferences` 固定为：

| 项 | 值 |
| --- | --- |
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `sandbox` | `true` |
| `webSecurity` | `true` |

- preload 以 CJS（`.cjs`）输出并在沙箱中运行，仅通过 `contextBridge` 暴露 `window.deepseekBot`。
- renderer 无 `require` / `process` / `ipcRenderer` 等 Node 能力（D2-7 探测验证）。
- 所有权限请求与权限检查（摄像头、麦克风、通知、剪贴板等）一律拒绝。
- `will-navigate` 与 `setWindowOpenHandler` 仅放行本应用页面（`file:` 与本地 dev server），其余拒绝。
- 标题栏使用 `titleBarStyle: hidden` + 深色 `titleBarOverlay`，无白色系统标题条。

## IPC 白名单

只注册以下 invoke 通道；未注册通道拒绝（`UNKNOWN_CHANNEL`），sender 不是主窗口主 frame 拒绝（`UNAUTHORIZED_SENDER`），错误码稳定、无副作用：

| 通道 | 语义 |
| --- | --- |
| `app:getInfo` | 应用名、版本、平台 |
| `window:show` | 显示并聚焦主窗口 |
| `window:hide` | 隐藏到托盘 |
| `window:minimize` | 最小化 |
| `window:toggleMaximize` | 最大化/还原切换 |
| `window:close` | 关闭窗口（路由到 close 逻辑：默认隐藏到托盘） |

preload 暴露面：`deepseekBot.getAppInfo()` 与 `deepseekBot.window.{show,hide,minimize,toggleMaximize,close}`。不暴露 `ipcRenderer`、`require`、`process`、`fs` 或任意 channel。

## 窗口与托盘行为

- 单实例锁：第二次启动直接退出，已有窗口恢复/聚焦。
- 托盘菜单：Show / Hide / Quit；双击托盘图标显示窗口。
- 关闭窗口默认隐藏到托盘，只有托盘 Quit 才真正退出。
- 退出时注销 IPC handler 并销毁托盘。

## 界面（当前为占位）

- 左侧导航：机器人 / 工作流 / 运行 / 设置四个占位页，静态内容，无网络请求，不读取本地数据。
- 会话内占位交互（全部仅存内存，重启即清空，不涉及后端）：
  - 创建 Bot 弹窗：名称、形状、颜色、所属分组。
  - Bot 分组：创建分组、移至分组；侧边栏按分组展示。
  - Bot 右键菜单：置顶、移至、标为未读/已读、重命名、复制对话 ID（占位 ID）、从侧边栏隐藏、删除。
  - 选中 Bot 显示问候语：“hello，我是 {名字}，有什么可以为你服务的吗”。
  - 交流规则（UI 层演示）：不同分组的 Bot 无法主动交流；同分组允许（占位会话）。
- 键盘可达：Tab 焦点、`aria-*` 语义、Esc 关闭弹窗/菜单；未引入 UI 组件库。

## 已知限制

- 界面状态不持久化；Bot/分组/未读等在应用重启后清空。
- 不接 Harness、不调用 DeepSeek API、无数据库；真实机器人 CRUD、会话、工作流、运行属于 D03–D09。
- 打包仅 `--dir` unpacked，不签名、不做安装器与自动更新（D11）。
- CI 不构建 GUI；桌面打包证据来自本地运行（见 D02 报告）。

## 待完成（后端 / 持久化，后续任务实现）

以下内容当前仅是会话内占位，真实实现留给后续里程碑：

1. Bot 与分组的持久化（D04 本地存储 + D05 机器人工作区）。
2. 分组管理能力（重命名/删除分组、分组内排序）。
3. Bot 真实 CRUD 与会话（D05，含 Harness 接入后的人格/指令）。
4. “不同分组 Bot 不能主动交流”从 UI 规则升级为后端执行策略（D05/D06 编排层强制）。
5. 未读、置顶、隐藏等列表状态的持久化。
6. 对话 ID 的真实语义与复制（当前为 `bot-<key>` 占位）。
