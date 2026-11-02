# 桌面壳（D02）

`apps/desktop` 是 Electron + React + TypeScript 桌面壳，为 D05（机器人工作区）、D07（工作流编辑）、D09（运行监控）提供容器。当前为静态占位壳：不接 Harness、不建数据库、不做真实机器人/工作流/运行功能，界面状态仅存于会话内存（不持久化）。

## 应用结构

```text
apps/desktop/
  package.json                 @deepseek-bot/desktop；脚本见下
  tsconfig.json                引用 node / web 两套工程
  electron.vite.config.ts      main / preload（CJS 输出）与 renderer 构建
  electron-builder.yml         NSIS x64 安装包 + unpacked 的 Windows 打包配置
  src/main/index.ts            窗口、单实例、生命周期、权限拒绝
  src/main/tray.ts             托盘控制器（每 bot 图标与菜单）
  src/main/tray-menu.ts        托盘菜单模型（纯函数，可单测）
  src/main/notifications.ts    系统通知（去重、点击回传）
  src/main/chrome-bookmarks.ts Chrome 书签只读导入（扫描/预览/导入/导出/清除）
  src/main/i18n.ts             主进程语言镜像（托盘与通知跟随界面语言）
  src/main/ipc/registry.ts     IPC 白名单注册
  src/main/ipc/guards.ts       sender 校验（主窗口主 frame）
  src/preload/index.ts         contextBridge 暴露 window.deepseekBot
  src/shared/ipc-channels.ts   通道常量、白名单、IpcDeniedError
  src/shared/i18n/             中英字典与纯函数翻译（渲染层与主进程共用）
  src/shared/system-integration.ts 托盘/通知/Chrome 跨边界 payload 与校验
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
pnpm --filter @deepseek-bot/desktop pack:win   # 构建 + electron-builder NSIS x64 安装包
```

根 `pnpm lint` / `pnpm typecheck` / `pnpm test` 会覆盖本包。打包输出在 `apps/desktop/release/`（已 gitignore）：NSIS 安装包 `DeepSeek Bot-<version>-x64.exe`、`win-unpacked/`、blockmap 与 `SHA256SUMS.txt`；`out/` 为中间构建产物（已 gitignore）。

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
- 权限请求与权限检查默认全部拒绝。例外只有两项：用户主动触发的剪贴板写入（`clipboard-sanitized-write`，供消息复制；不开放剪贴板读取），以及按住说话的麦克风（`media` 且检查为 `audio`、请求的 `mediaTypes` 仅为 `audio`）。摄像头、通知及其余权限仍拒绝。
- `will-navigate` 与 `setWindowOpenHandler` 仅放行本应用页面（`file:` 与本地 dev server），其余拒绝。
- 标题栏使用 `titleBarStyle: hidden` + 深色 `titleBarOverlay`，无白色系统标题条。

## IPC 白名单

只注册以下 invoke 通道；未注册通道拒绝（`UNKNOWN_CHANNEL`），sender 不是主窗口主 frame 拒绝（`UNAUTHORIZED_SENDER`），错误码稳定、无副作用：

| 通道 | 语义 |
| --- | --- |
| `app:getInfo` | 应用名、版本、平台、桌面 locale（`system` 语言判定用） |
| `window:show` | 显示并聚焦主窗口 |
| `window:hide` | 隐藏到托盘 |
| `window:minimize` | 最小化 |
| `window:toggleMaximize` | 最大化/还原切换 |
| `window:close` | 关闭窗口（路由到 close 逻辑：默认隐藏到托盘） |
| `window:set-titlebar-overlay` | 主题切换时重涂原生窗口控制条（两枚 `#rrggbb`） |
| `settings:saveKey` | safeStorage 加密保存 API Key，仅回传 `cred:` 引用 |
| `host:call` | 渲染层 → Host 契约调用（方法白名单在主进程与 Host 双重校验） |
| `knowledge:import` | 打开文件对话框读一个 .txt/.md（无路径参数） |
| `updates:check` / `updates:downloadInstall` | D24 应用内更新（GitHub Releases 源） |
| `backups:list` | 只读数据根 `backups/*/manifest.json` 摘要（D24） |
| `app:hardwareAcceleration` | 读取/切换硬件加速偏好（userData 文件，重启生效；D24） |
| `i18n:setLanguage` | D22：把 `system\|zh\|en` 偏好镜像给主进程（托盘、通知跟随） |
| `tray:sync` | D22：渲染层推送托盘状态（Bot 列表、活跃 Bot、未读、状态、32px PNG 头像） |
| `notification:show` | D22：请求弹一条系统通知，回报 `{shown, reason}` |
| `chrome:scan` / `chrome:preview` / `chrome:import` / `chrome:state` / `chrome:clear` / `chrome:export` | D22：Chrome 书签只读扫描、预览、导入到本机数据根、查看、删除、导出 Markdown |

主进程 → 渲染层事件通道（只推送，不被 invoke 调用）：`host:event:missed`（FR-08 错过时刻）、`system:event:tray-action`（托盘点击某 Bot 或"打开设置"）、`system:event:notification-click`（通知点击，带 botId）、`system:event:window-focus`（原生焦点变化，通知门控用）。

所有跨边界 payload 在 `src/shared/system-integration.ts` 严格校验后才会被主进程使用：条目上限（托盘 50）、名字长度、状态枚举、图标必须是 `data:image/png;base64,` 且 ≤64 KiB、Chrome profile token 拒绝分隔符与 `..`。

preload 暴露面：`deepseekBot.{getAppInfo, window.*, settings.saveKey, updates.*, knowledge.importFile, backups.list, app.hardwareAcceleration, host.{call,onMissed}, i18n.setLanguage, system.{tray.sync, notifications.show, chrome.*, onTrayAction, onNotificationClick, onWindowFocus}}`。不暴露 `ipcRenderer`、`require`、`process`、`fs` 或任意 channel。

## Host 进程生命周期

- 主进程启动时经 `spawnHostProcess` 拉起 Host 子进程（node ≥24 运行 `packages/host/dist/main.js`，env 注入数据根与凭据解密回调）。
- **恢复数据后重启（D24）**：`data.restore` 成功会把数据库整体替换，原 Host 的句柄随即作废——主进程在把结果返回给渲染层之前对旧 client 优雅停机并重新 spawn，后续调用落在恢复后的数据上；恢复被拒绝时原 Host 保持原样，稳定错误原样透传。
- 硬件加速偏好在 `app.ready` 之前同步应用（Chromium 只在此刻接受该开关）。

## 界面语言（D22）

- 字典在 `src/shared/i18n/messages/`：按 domain 分文件，`{ key: { zh, en } }`，英文可为 `{one, other}` 双形式（按首个数值参数选形）；`{0}` 位置参数。key 是封闭联合类型，`t("…")` 写错编译期即报错。
- 渲染层 `src/renderer/src/i18n.ts` 是模块级 store（`useSyncExternalStore`），任意模块可直接 `t()`；App 根订阅，切换语言整树重渲染。日期/时间/星期一律走 `Intl`。
- 主进程 `src/main/i18n.ts` 持有同一份字典的语言镜像，初始跟随 `app.getLocale()`，渲染层启动与切换时通过 `i18n:setLanguage` 同步；语言变化时托盘菜单原地重建。
- 偏好存 `deepseek-bot.settings.v2` 的 `language`（`system|zh|en`），首帧前决定，不闪语言。
- **不翻译**：发给模型的提示文本与作为数据/比较值的字面量（能力 id、语气指令、分组身份），源码内以 `// i18n-ignore` 标注理由；`tests/i18n-scan.test.ts` 会拒绝任何未标注的新增中文界面文案。

## 窗口与托盘行为

- 单实例锁：第二次启动直接退出，已有窗口恢复/聚焦。
- 托盘：**单图标随活跃 Bot 切换**（图标由渲染层把该 Bot 的 Grok Ball 栅格化为 32px PNG 后推送，无推送时回落 `assets/tray.png`）；菜单为「N 个 Bot」标题 + 逐 Bot 一项（各自头像图标、`名字 · 状态`、未读追加 `N 条未读`），排序为活跃 → 等待审批 → 运行中 → 未读 → 其余；随后 显示窗口 / 隐藏窗口 / 打开设置 / 退出。
- 点击 Bot 项：显示并聚焦主窗口，并通知渲染层切到该会话（同时清该 Bot 未读）。双击托盘图标显示窗口。
- 菜单与 tooltip 文案跟随界面语言（D22）。
- 关闭窗口默认隐藏到托盘，只有托盘 Quit 才真正退出。
- 退出时注销 IPC handler 并销毁托盘。

## 系统通知（D22）

- 策略在渲染层（`features/system/notify.ts`）：总开关、**仅窗口不在前台时提醒**（默认开）、按 Bot 静音、同类通知 5 秒节流；主进程（`main/notifications.ts`）再对相同标题+正文做 4 秒去重，并在系统无通知通道时如实回报 `unsupported`。
- 触发点：Bot 回复完成、出现待审批请求、调度错过（FR-08）。通知正文只含 Bot 名与事件类型，不含消息内容与路径。
- 点击通知：显示并聚焦主窗口，并把对应 `botId` 回传渲染层定位会话。
- 设置 → 通知：三个开关 + 「按 Bot 静音」列表 + 发送测试通知（结果标签如实显示已发送 / 被拦截 / 系统不支持）。

## Chrome 书签导入（D22）

- 只读 `<Chrome User Data>/<Profile>/Bookmarks`（配合 `Local State` 取配置显示名），**不读 Cookie、密码、支付信息与浏览历史**；只保留 `http(s)` 链接、按 URL 去重、上限 5000 条、单文件 >8 MiB 拒绝。
- 流程：扫描 → 选择配置 → 预览条数与样例 → 导入到 `<数据根>/imports/chrome/bookmarks.json` → 可查看 / 导出 `bookmarks.md` / 一键删除。profile token 只接受 `Default`、`Profile N` 形态的简单目录名，解析后仍校验落在 User Data 内。
- 无桌面壳（浏览器预览）时该分区显示"需要桌面壳"，不做假成功。隐私边界见 [本地数据与权限](SECURITY_DATA.md) §5。

## 界面（当前为占位）

- 侧边栏没有固定页面：只包含用户自建的分组与 Bot（初始一个「未分组」，右键组名可删除——组内有 Bot 时需先移出），以及右上 ＋ 创建 Bot、左下角账户按钮进设置。点击窗口 × 即隐藏到托盘。
- 主界面即选中 Bot 的会话：问候语为首条消息，消息流 + 贴底输入条（左 ＋ 菜单 / 右麦克风占位与发送钮）；无选中时显示创建引导空状态。头部胶囊显示当前 Bot 名。
- 设置弹窗：点击左下角账户按钮进入。分区为 通用 / 电脑 / 权限 / 保险库 / 用量与账单 / 更新 六项（三组导航，`features/settings/settings-nav.tsx`），均已可用——含本地用量与检查更新（D24，更新通道见下文「应用内更新」）；账户改名字、退出登录（占位）、主题深色/浅色切换、强调色、**界面语言（D22）**、**通知设置（D22）**、**Chrome 数据导入（D22）**；其余项标「后续提供」。
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

- 界面与设置状态不持久化；Bot/分组/账户名/主题等在应用重启后恢复默认。（D24 起主题/账户名/强调色、D22 起语言与通知偏好已持久化；Bot/分组等界面状态仍为会话内存。）
- 「退出登录」「复制对话 ID」为占位（未接入账号系统）；真实账号体系见待办。
- 不接 Harness、不调用 DeepSeek API、无数据库；真实机器人 CRUD、会话、工作流、运行属于 D03–D09。
- CI 不构建 GUI；桌面打包证据来自本地运行（见 D02 报告）。
- 安装包未签名（`signAndEditExecutable: false`），安装器/应用 exe 资源为默认 Electron 元数据，SmartScreen 会提示。应用内更新通道已接入（D24，见下文「应用内更新」）；首个 GitHub Release 发布前，每次检查都软着陆为失败原因，不误报成功。
- 安装版应用 UI 状态仍是会话内存；卸载保留的 `%APPDATA%\DeepSeekBot` 数据根在 D12 接线 storage 前尚无 UI 数据写入。

## 打包（D11）

- NSIS x64 按用户安装：`pnpm --filter @deepseek-bot/desktop pack:win`，不需管理员、不写 HKLM、不创建系统服务；`pack:dir` 仍可只出 unpacked。
- 卸载默认保留用户数据（`deleteAppDataOnUninstall: false`）；数据根 `%APPDATA%\DeepSeekBot`（`packages/storage/src/layout.ts`，由平台 API 解析），发布说明须写明路径与手动清理方式。
- `THIRD_PARTY_NOTICES.md` 经 `extraResources` 随包，安装后在 `<安装目录>\resources\` 可见。
- 产品打包 CI：`.github/workflows/package.yml`（`workflow_dispatch` + push tag `v*`，windows-latest，Node 24，Corepack），产出安装包 + blockmap + `SHA256SUMS.txt` artifact；CI 只证明可构建，不替代干净机安装试验。
- 打包/安装/升级/卸载的验收边界与证据见 [D11 报告](reports/D11-report.md)。

## 应用内更新（D24）

实现为 `electron-updater` 对 GitHub Releases 的检查（`apps/desktop/src/main/updates.ts`）。更新源在 `electron-builder.yml`：`publish: { provider: github, owner: Etheslay, repo: deepseek-bot }`。打包与 CI 永不自动发布（`--publish never` 为默认）；通道只在首个附带 `latest.yml` 元数据的 GitHub Release 发布后才开始命中。

行为链（各项与代码一一对应）：

1. **启动静默检查**：主进程启动时静默 `checkUpdates()` 一次（`src/main/index.ts`），渲染层就绪后再经 `bridge.updates.check()` 查询一次（`App.tsx`）；两层都吞错软着陆，不弹窗、不打断启动。
2. **手动检查**：设置 → 更新 分区随时可手动检查；状态标签如实显示「发现新版本 / 暂无可用更新 / 失败原因」，预览壳（无 updates 桥）显示"需要桌面壳"类提示。
3. **左下角徽标**：仅当检查结果 `available` 时出现在侧栏底部（账户按钮上方），标题含新版本号；点击徽标即开始下载，期间显示下载中状态。
4. **下载并安装**：`autoDownload = false`——永不后台自动下载，只有用户点击徽标才 `downloadUpdate()`；下载完成立即 `quitAndInstall()`（NSIS assisted：退出应用并运行安装器）。`autoInstallOnAppQuit = true` 兜底：安装器未立即接管时，应用下次退出时安装。
5. **软着陆**：无 Release、离线或 `latest.yml` 404 时，`checkForUpdates()` 返回错误字符串；徽标不出现，设置分区如实显示失败原因，绝不误报"已是最新"。

IPC 通道为白名单中的 `updates:check` / `updates:downloadInstall`（见上文 IPC 白名单表）。发布侧的配套检查单见 [RELEASE.md](RELEASE.md) §4。

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
