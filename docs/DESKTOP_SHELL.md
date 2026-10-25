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
- 权限请求与权限检查默认全部拒绝；唯一例外是用户主动触发的剪贴板写入（`clipboard-sanitized-write`，供消息复制；不开放剪贴板读取）。
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

- 侧边栏没有固定页面：只包含用户自建的分组与 Bot（初始一个「未分组」，右键组名可删除——组内有 Bot 时需先移出），以及右上 ＋ 创建 Bot、左下角账户按钮进设置。点击窗口 × 即隐藏到托盘。
- 主界面即选中 Bot 的会话：问候语为首条消息，消息流 + 贴底输入条（左 ＋ 菜单 / 右麦克风占位与发送钮）；无选中时显示创建引导空状态。头部胶囊显示当前 Bot 名。
- 设置弹窗：点击左下角账户按钮进入。分类「通用」可用（电脑 / 保险库 / 用量与账单 / 更新为占位禁用）；实现账户改名字、退出登录（占位）、主题深色/浅色切换；其余项标「后续提供」。
- 会话内占位交互（全部仅存内存，重启即清空，不涉及后端）：
  - 创建 Bot 弹窗：名称、形状、颜色；新 Bot 默认归入「未分组」。
  - Bot 分组：创建分组（Bot 右键 → 移至 → 创建分组）、移至分组、**拖拽换组**（头像拖拽影像 + 目标分组虚线高亮 + 空组放置提示）、**分组折叠/展开**（点组名收起，箭头指示）。
  - Bot 右键菜单：置顶、移至、标为未读/已读、编辑、复制、从侧边栏隐藏、删除（归档 UI 已按 Owner 指示移除）；菜单与子菜单浮动智能定位。
  - 消息 hover 操作条：悬停消息行时在句尾浮现描边线条图标（笑脸=回应、引用箭头、复制文字），不凑近不出现；复制图标将该条文字写入剪贴板；笑脸打开浮动表情选择器（👍 👎 ❤️ 😂 🎉，portal 挂载、自动避让边缘）计入反应（气泡下计数 chip，可再点取消）；引用箭头 → 引用 chip + 发送的消息嵌套展示引用。
  - Bot 间交流状态行：发起方会话记「已发消息给 {对方}」、接收方会话记「消息来自 {发起方}」（带对方小头像+占位请求气泡）；用户与 Bot 对话不显示状态行。时间标签 5 分钟规则（距上一标签 ≥5 分钟才插入新 HH:mm）。
  - 交流规则（UI 层演示）：不同分组的 Bot 无法主动交流；同分组允许（占位会话）。
  - 聊天输入条 ＋ 菜单：添加附件（占位）、教它做一项任务（占位）、发起交流（子菜单选 Bot）。
  - 消息往来聚合：同对 Bot 的交流记录折叠为「N 条消息往来： {对方}」摘要；点开在右侧内容区显示配对聊天视图（侧边栏保留；双方头像胶囊头部 + 按时间轮次 + 底部关闭聊天）。
  - 时间线视觉：Bot 消息为纯气泡（无头像/名字标签），状态行与往来摘要居中灰色小字并内嵌对方小头像，通知中 Bot 名可点击打开详情。
- 键盘可达：Tab 焦点、aria-* 语义、Esc 关闭弹窗/菜单；未引入 UI 组件库。
- D05 起：机器人工作区（契约服务层、流式聊天、历史回放、产物预览、设置接入）见 [机器人工作区](BOT_WORKSPACE.md)；最近会话/产物为聊天头部 popover；创建表单含语气 chips（UI-only）。
- D07 起：头部新增「工作流编辑器」图标按钮，主区切换为工作流编辑器视图（工具栏 / 节点面板 / 画布 / 参数检查器 / 校验面板），IPC 白名单不变，见 [工作流编辑器](WORKFLOW_EDITOR.md)。
- D09 起：头部新增「运行监控与审批」图标按钮（与编辑器互斥），主区切换为运行监控视图（运行列表 / 详情监控·历史双标签 / 审批收件箱），IPC 白名单不变，见 [运行监控](RUN_MONITOR.md)。

## 已知限制

- 界面与设置状态不持久化；Bot/分组/账户名/主题等在应用重启后恢复默认。
- 「退出登录」「复制对话 ID」为占位（未接入账号系统）；真实账号体系见待办。
- 不接 Harness、不调用 DeepSeek API、无数据库；真实机器人 CRUD、会话、工作流、运行属于 D03–D09。
- 打包仅 `--dir` unpacked，不签名、不做安装器与自动更新（D11）。
- CI 不构建 GUI；桌面打包证据来自本地运行（见 D02 报告）。

## 待完成（后端 / 持久化，后续任务实现）

以下内容当前仅是会话内占位，真实实现留给后续里程碑：

1. Bot 与分组的持久化（D04 本地存储 + D05 机器人工作区）。
2. 分组管理能力完善：重命名分组、分组内排序、拖拽与移动的持久化。
3. Bot 真实 CRUD 与会话（D05，含 Harness 接入后的人格/指令）。
4. “不同分组 Bot 不能主动交流”从 UI 规则升级为后端执行策略（D05/D06 编排层强制）。
5. 未读、置顶、隐藏等列表状态的持久化。
6. 对话 ID 的真实语义与复制（当前为 `bot-<key>` 占位）。
7. 账号系统与多账户（真实登录/退出/添加账户）。
8. 设置持久化（主题、账户名等）与设置其余分类（电脑/保险库/用量与账单/更新）。
9. 会话消息、表情反应、引用与拖拽分组的持久化；真实模型回复接入后这些交互需映射到契约层（D03/D05）。
