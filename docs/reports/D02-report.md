# D02 桌面壳报告（desktop-shell）

- 任务：D02 桌面壳、托盘与受限 IPC（里程碑 M0）
- 分支：`feature/desktop-shell`（跟踪基线 `origin/develop`）
- 基线：开工时 `origin/develop` = `0545ee62d522f90617c5f73e836a6156ef914178`（短 SHA `0545ee6`，PR#6 + PR#7 已合入；任务书所写 `71464e2` 已过期，以最新为准）
- executor profile：`zcode-desktop`（ZCode Desktop；临时；产品运行时仍为 DeepSeek Harness）
- 负责人：Destinyian；真实 API 预算：0（未发起任何模型/网络请求）
- 交付：本分支 + 报告；按当前指令**未推送、未开 PR**（任务书中的推送/PR 步骤待负责人指示后执行）
- 执行时间：2026-10-24，时区 America/Los_Angeles（下同）

## 结论

D2-1～D2-8、D2-10、D2-11 已完成并有本地证据；D2-9（CI）因按指示未推送而 `UNVERIFIED`。桌面壳可启动、可打包、IPC 仅走白名单、renderer 无 Node 能力、安全设置未降级。负责人会话中追加了界面范围（Grok 风格 UI、自定义标题栏、创建 Bot、分组、右键菜单、问候语、跨分组交流限制），全部为 renderer 会话内占位实现，涉及后端/持久化的部分按指示列为待完成任务（见第 11 节），未实现、不声称完成。

## 1. 开工门禁

| 项 | 结果 |
| --- | --- |
| `origin/develop` 含 package.json / pnpm-workspace.yaml / CI / packages/shared | 通过 |
| `apps/` 下是否已有桌面应用 | 有未提交的脚手架（非已提交基线）；按用户指令**在现有基础上补齐**，未重置。证据：`git status` 显示 `apps/` 未跟踪 + 4 个配置文件修改 |
| 工作区干净 | 不满足（同上）；已按用户指令继续并全程保持 `handoff/`、`.dsh-tmp/` 不提交 |
| 从最新 `origin/develop` 创建分支 | 通过（`feature/desktop-shell` 跟踪 `0545ee6`，无本地提交起点） |
| 必读文档 | 已读任务书、AGENTS、README、CONTRIBUTING、DEVELOPMENT_PLAN、GIT_WORKFLOW、ARCHITECTURE、ADR-0001、SECURITY_DATA、TESTING、DEVELOPMENT_SETUP、CONTRACTS |

## 2. 环境与依赖

| 项 | 值 |
| --- | --- |
| OS | Windows 11 x64（内部版本 26200） |
| Node | 24.16.0 |
| pnpm | 11.28.5（corepack） |
| Electron | 38.2.1（MIT） |
| React / react-dom | 19.1.1 / 19.1.1（MIT） |
| 构建 | electron-vite 4.0.1、vite 7.1.7、electron-builder 24.13.3（均 MIT） |
| 测试 | vitest 3.2.4（MIT） |
| TypeScript | 5.9.3（Apache-2.0）；@types/* 均 MIT |

直接依赖全部为 MIT / Apache-2.0，来源为 npm registry 固定确切版本，锁文件已提交（根 `pnpm-lock.yaml`）。无来源不明安装脚本；`pnpm-workspace.yaml` 仅批准 `esbuild`、`electron` 两个官方 postinstall。传递依赖许可证以 `pnpm licenses list` 输出为准，主要为 MIT / Apache-2.0 / ISC / BSD 系，未发现与当前私有仓库开发阶段冲突的分发问题。

## 3. 验收证据（D2-1～D2-11）

### D2-1 干净安装（frozen-lockfile）

- 命令：`pnpm install --frozen-lockfile`
- 退出码：0；输出：`Scope: all 3 workspace projects / Already up to date / Done in 135ms using pnpm v11.28.5`
- 锁文件与提交一致（多次重跑无 diff）。

### D2-2 lint / typecheck / test

最终一轮（含全部 UI 改动后）：

- `pnpm lint`：exit 0（`$ eslint .` 无输出）
- `pnpm typecheck`：exit 0（apps/desktop 两套 tsconfig + packages/shared）
- `pnpm test`：exit 0
  - apps/desktop：`tests/ipc-registry.test.ts`（4 tests）：白名单只接受注册通道；未注册通道（`shell:exec`）抛 `UNKNOWN_CHANNEL`；非法 sender 抛 `UNAUTHORIZED_SENDER`；合法 sender 放行
  - packages/shared：redact 6 tests，覆盖率 100%（基线未改动）
- 时间：2026-10-24 02:44 America/Los_Angeles（本次为最后一轮；中间每轮改动后均重跑，全部 exit 0）

### D2-3 启动（打包产物）

- `pnpm --filter @deepseek-bot/desktop pack:dir` 后启动 `release/win-unpacked/DeepSeek Bot.exe`，主窗口打开。
- 重要说明：在本执行器环境中，**从工作区路径内直接启动该 exe 会以 STATUS_BREAKPOINT (0x80000003) 崩溃**；经对照实验定位为路径相关环境问题而非产物缺陷（见第 7 节已知问题 #1）。最终验证方式：将 `win-unpacked` 复制到 `D:\AppCaches\Temp\d02-unpacked` 后启动，一切正常。
- 截图：`docs/reports/assets/d02/d02-03-window-initial.png`

### D2-4 托盘

- 通过 IPC 桥执行 `window.hide()`：窗口 `document.visibilityState` = `hidden`，进程存活（4 个 Electron 进程树）→ 关闭到托盘行为正确。
- `window.show()`：窗口恢复显示，截图 `d02-04-restored-from-tray.png`。
- 托盘菜单 Show/Hide/Quit 与图标可视确认：**UNVERIFIED（人工）**——菜单点击无法脚本化，代码路径已实现（`createTray`），请负责人实机确认。
- 单实例锁：第二个实例启动后立即退出（exit 0），首实例进程树不变。

### D2-5 导航

- 机器人 / 工作流 / 运行 / 设置四页可切换；脚本逐页点击并读取面板标题：`机器人`、`工作流`、`运行`、`设置`（顺序与期望一致）。
- 截图：`d02-05-nav-bots.png`、`d02-05-nav-workflows.png`、`d02-05-nav-runs.png`、`d02-05-nav-settings.png`

### D2-6 未授权 IPC

- 单元测试证明未注册 channel 与非法 sender 被拒（见 D2-2 测试输出，`IpcDeniedError` code 分别为 `UNKNOWN_CHANNEL` / `UNAUTHORIZED_SENDER`）。
- 主进程只 `ipcMain.handle` 白名单 6 通道；preload 仅暴露 6 个方法。

### D2-7 安全设置

- 源码固定：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`（`src/main/index.ts` createMainWindow）。
- 运行时探测（CDP 在打包产物 renderer 内执行）：`require`/`process`/`window.ipcRenderer` 均为 `undefined`；`Object.getOwnPropertyNames(globalThis)` 无 `require/module/exports/Buffer/__dirname/process`；`window.deepseekBot` 仅有 `getAppInfo`、`window.{close,hide,minimize,show,toggleMaximize}`。
- 权限请求/检查处理器全部拒绝（`setPermissionRequestHandler` / `setPermissionCheckHandler`）。

### D2-8 打包

- 命令：`pnpm --filter @deepseek-bot/desktop pack:dir`（= `electron-vite build` + `electron-builder --dir --win --x64 --config electron-builder.yml`），exit 0。
- 产物：`apps/desktop/release/win-unpacked/`（`DeepSeek Bot.exe` + resources/app.asar，未签名，无安装器）。
- 产物完整性：exe 与官方 electron v38.2.1 zip 内二进制 SHA256 一致；asar 内容用干净二进制加载验证通过；app 目录与 locales 逐文件哈希与官方 zip 一致。
- 启动验证：中性路径启动成功并完成全部 GUI 取证（见 D2-3 说明）。

### D2-9 CI

- **UNVERIFIED**：按当前指令分支未推送，无 Actions 运行。现有 `.github/workflows/ci.yml` 覆盖 lint/typecheck/test（含桌面包），推送后即生效；合并前以分支 Actions 真实结果为准。

### D2-10 安全与卫生

- 提交内容不含 Key、`.env`、用户数据、node_modules、构建产物；`out/`、`release/` 已加入 `.gitignore`。
- 未跟踪目录 `handoff/`（执行器交接材料与取证脚本）、`.dsh-tmp/`（UI 参考图，外部产物）均不提交。
- 桌面截图证据仅含应用窗口内容；拍摄过桌面的截图已删除。

### D2-11 文档

- `docs/DESKTOP_SHELL.md`（新建）、`docs/DEVELOPMENT_SETUP.md`（补桌面命令与注意事项）、本报告，均与实现一致。

## 4. 负责人会话内追加的界面范围（超出任务书 2.1 的部分）

以下均为负责人在会话中的明确指示，全部实现为 **renderer 会话内状态**（不持久化、不新增 IPC 通道、不接后端）：

1. 界面视觉对齐参考风格（近黑主题、左侧边栏、圆角胶囊、blob 头像）。
2. 去除白色系统标题条：`titleBarStyle: hidden` + 深色 `titleBarOverlay`，内容区顶部为拖拽区。
3. 「创建新 Bot」弹窗：名称、8 种形状、11 色调色板、分组选择；创建后出现在侧边栏。
4. 分组体系：创建分组、移至分组，侧边栏按分组展示并显示计数。
5. Bot 右键菜单：置顶 / 移至（含子菜单）/ 标为未读-已读 / 重命名 Bot / 复制对话 ID / 从侧边栏隐藏 / 删除；置顶、未读、隐藏、删除、移动在会话内生效，其余为占位。
6. 选中 Bot 显示问候语气泡：「hello，我是 {名字}，有什么可以为你服务的吗」。
7. 交流规则（UI 层演示）：不同分组的 Bot 发起交流被拒绝并提示分组名；同分组允许（占位会话）。脚本验证：跨分组输出 `无法发起：不同分组的 Bot 无法主动交流（未分组 ↔ 测试组）`；移入同组后输出 `同分组，允许交流（占位会话，无后端）`。
8. 相关截图：`d02-07-modal.png`（弹窗）、`d02-08-modal-picked.png`（已选形状颜色）、`d02-09-created.png`（创建结果）、`d02-10-context-menu.png`（右键菜单）、`d02-11-submenu.png`（移至子菜单）、`d02-12-group-created.png`（创建分组）、`d02-13-blocked.png`（跨分组拒绝）、`d02-14-allowed.png`（同分组放行）、`d02-15-greeting.png`（问候语）。
9. 去掉头部「隐藏到托盘」按钮：关闭窗口（×）即隐藏到托盘（原有行为，与常规应用一致）；脚本以 IPC 桥验证 hide/show 路径不受影响。
10. 设置弹窗（点击左下角账户按钮进入）：左侧分类 通用（可用）/ 电脑 / 保险库 / 用量与账单 / 更新（占位禁用，后续提供）；「通用」页实现：账户改名字（会话内生效）、退出登录（占位：重置名称与主题并提示）、主题深色/浅色（CSS 变量切换，`data-theme` 实测生效）；强调色、语言、麦克风、硬件加速按「较难完成不做」原则标为后续提供，其中麦克风如实显示「已全部拒绝（安全策略）」。截图：`d02-16-settings.png`、`d02-17-renamed.png`、`d02-18-settings-light.png`、`d02-19-logout.png`。
11. Bot 面板升级为会话视图：问候语成为首条消息；底部输入框「给 {名字} 发消息（占位，无真实模型）」，发送后出现用户气泡（右侧、品牌绿）与 Bot 占位回复。
12. 消息 hover 操作条：悬停气泡右下浮现 👍 👎 ❤️ 😂 🎉 与 ↩（引用）；点击表情即在消息上计入反应（再次点击取消，气泡下方显示计数 chip，自己的反应高亮）；点击 ↩ 后输入框上方出现引用 chip，发送的消息携带嵌套引用展示。实测：发送「你好呀」得到占位回复、👍 计数 `👍 1`、引用发送后消息显示 `引用 我：你好呀`。截图：`d02-20-chat-reply.png`、`d02-21-hover-actions.png`、`d02-22-reactions.png`、`d02-23-quoted.png`。
13. 侧边栏 Bot 拖拽换组：Bot 条目可拖动（拖起时头像 blob 作为拖拽影像跟随光标），分组区域为放置目标（拖拽经过时虚线高亮，空分组显示「拖到这里移入」提示）；放下即换组并弹 toast。实测：将「第二号」从测试组拖回未分组，toast `已将「第二号」拖至「未分组」`，计数随之变化；同组放置提示「已在该分组」。截图：`d02-24-drag-over.png`、`d02-25-dropped.png`。

范围判断：任务书红线「不做机器人 CRUD」针对真实功能与数据；以上为纯视觉/会话内占位，无持久化、无后端、无 Harness 触达。涉及真实实现的部分已列入第 11 节待办，不由本任务声称完成。

## 5. IPC 白名单与 sender 校验说明

- 白名单定义于 `src/shared/ipc-channels.ts`：`app:getInfo`、`window:show`、`window:hide`、`window:minimize`、`window:toggleMaximize`、`window:close`。
- 每个 handler 执行前先 `assertAllowedChannel`（通道必须在白名单），再 `assertAuthorizedSender`（sender 必须是主窗口 `webContents` 且 `senderFrame === mainFrame`）；任一失败抛 `IpcDeniedError`（code：`UNKNOWN_CHANNEL` / `UNAUTHORIZED_SENDER`），不执行副作用。
- preload 仅暴露 `deepseekBot.getAppInfo()` 与 `deepseekBot.window.{show,hide,minimize,toggleMaximize,close}`。
- 说明：`window:minimize/toggleMaximize/close` 三个通道来自并行写入方对 registry 的扩展，本会话整合并补齐了 handler、preload 暴露与类型声明；当前 UI 使用原生窗口控件，这三个通道已暴露但界面未绑定按钮，留给 D05 的自定义标题栏。

## 6. 打包与启动问题定位记录

现象：`release/win-unpacked/DeepSeek Bot.exe` 在本执行器环境从工作区路径启动时 STATUS_BREAKPOINT 崩溃（无 WER 记录、无 crashpad 转储、`--version` 正常）。

排查结论（证据链）：
1. 打包 exe 与官方 zip 二进制逐字节一致（SHA256 `dba8ecfc…`）；`win-unpacked` 全部文件与官方 zip 解压逐哈希一致（locales 55/55、顶层与递归对比通过）。
2. 同一 app.asar 用干净二进制以命令行方式加载完全正常；同内容克隆（含 exe 改名）在 `D:\AppCaches\Temp` 启动正常。
3. 同一克隆复制回 `D:\PersonProgram\deepseek-bot\apps\desktop\release\` 即崩（exe 改名与否、带不带命令行参数均崩）→ **崩溃仅取决于 exe 所在路径**。
4. CJS 修复前后的应用代码形态（ESM/CJS、asar/目录）与崩溃无关；Windows 事件日志无 Defender 拦截、无重解析点、无 MotW。
5. 判定：与执行器沙箱对工作区路径的进程策略相关，**不是交付物缺陷**。负责人在真实桌面双击 `release/win-unpacked/DeepSeek Bot.exe` 的验证结果待人工确认（见未验证项）。

另外：node_modules 内 `electron/dist` 曾处于不完整解压状态（仅 2 个文件），不影响打包（electron-builder 使用自缓存），但会使 `electron .` 开发命令失败；重新 `pnpm install` 可修复。

## 7. 已知问题与风险

1. **工作区内启动崩溃（环境）**：如第 6 节，实机待确认；若负责人实机也复现，需在 D02 修复合入前升级处理。
2. 并行写入：本会话期间 registry.ts / ipc-channels.ts 被并行执行器扩展（窗口控制通道）、`handoff/` 外出现 `.dsh-tmp/` UI 参考图；已整合对方改动，未覆盖。违反「同一分支单执行器」约定的事实已如实记录，请 Manager 关注。
3. `eslint@9.37.0` 上游标记 deprecated（基线已知问题，按任务要求固定版本未升级）。
4. renderer JS 产物 ~560 KB（React 单包，未做代码分割）——占位阶段可接受，D05 接入真实功能时再优化。
5. 托盘菜单交互、双击托盘无法脚本验证（人工项）。

## 8. 未验证项

| 项 | 原因 | 最高可能判定 |
| --- | --- | --- |
| D2-9 CI（lint/typecheck/test @ windows-latest） | 按指示未推送，无 Actions 运行 | PASS-WITH-FIXES（推送后确认；本地全绿） |
| 托盘图标可视与菜单 Show/Hide/Quit 实点 | 无法脚本化 UI 交互 | PASS（代码路径已实现，待人工） |
| `release/win-unpacked` 在真实桌面（非沙箱）双击启动 | 本执行器环境路径相关崩溃干扰，无法代表真实桌面 | PASS（中性路径验证通过，产物完整） |

## 9. 回退方式

```powershell
git checkout develop
git branch -D feature/desktop-shell
# 若已推送：关闭 PR 并删除远程 feature/desktop-shell（由负责人/Push 执行）
```

删除 `apps/desktop` 整目录与相关配置行（.gitignore/eslint.config.js/pnpm-workspace.yaml/pnpm-lock.yaml 对应段）即可；无数据迁移、无用户数据。

## 10. PR 描述草稿（推送后由 Push 创建，base=`develop`）

> 由 Push 创建草稿 PR 时使用。负责人自审记录保持空模板。

### 任务与目标

- 关联 Issue / Dxx：D02 桌面壳（M0）
- 作者 / 自审人（负责人本人）：（负责人本人）
- 来源分支 → 目标分支：`feature/desktop-shell` → `develop`
- 解决的问题与变更后的行为：仓库具备可启动、可打包、权限受限的 Electron 桌面壳（窗口/托盘/单实例/导航占位/受限 IPC/Windows unpacked 打包）；renderer 无 Node 能力；新增 `apps/desktop` 与桌面包命令。

### 范围与接口

- 涉及模块：`apps/desktop/**`、根 `.gitignore`、`eslint.config.js`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`docs/DESKTOP_SHELL.md`、`docs/DEVELOPMENT_SETUP.md`
- 契约 / 数据格式 / 权限变化：无（IPC 白名单为应用内部边界，`packages/shared` 未改动）
- 依赖和后续任务：依赖 D00 基线；为 D05/D07/D09 提供容器；打包/签名归 D11

### 验证证据

| 检查 | 提交 / 环境 | 命令或步骤 | 结果与证据 |
| --- | --- | --- | --- |
| 静态检查与测试 | 见第 12 节验收代码提交 / Windows 11 x64, Node 24.16.0, pnpm 11.28.5 | `pnpm lint` / `pnpm typecheck` / `pnpm test` | 全部 exit 0；desktop 4 tests + shared 6 tests（coverage 100%）；2026-10-24 02:44 PDT |
| 打包 | 同上 | `pnpm --filter @deepseek-bot/desktop pack:dir` | exit 0；`release/win-unpacked` 产出；中性路径启动与 GUI 取证通过 |
| 手测 | 同上 | 启动 exe、四页切换、托盘 hide/show、单实例、创建 Bot/分组/右键菜单/交流规则 | 截图 `docs/reports/assets/d02/`（15 张） |

未执行或不适用的检查及原因：CI（未推送，UNVERIFIED）；托盘菜单实点与实机双击启动（人工项）。

### 负责人自审记录

- 已审提交 SHA / 日期：
- 差异、需求和错误路径检查结果：
- 测试证据 / 兼容性与权限影响：
- 遗留问题与处理方式：
- 自审结论：

（新增提交后更新本节；无需另一人批准，不以 GitHub 的作者 Approve 操作作为自审方式。）

### 风险、迁移与恢复

无数据/契约迁移。回退见报告第 9 节。已知问题见第 7 节（重点是工作区内启动崩溃的环境问题与并行写入记录）。

### 合并前

- [ ] 分支目标符合 Git 工作流，提交不含凭据和用户数据。
- [ ] 需求、实现、测试和文档一致，依赖 PR 已合入。
- [ ] 最新提交的必要检查通过（含推送后 CI），讨论已解决。
- [ ] 负责人已完成最新提交的自审，并记录 SHA、日期、验证证据与结论。
- [ ] 若目标 main：不适用（本 PR 目标为 develop）。

## 11. 待完成任务（后端 / 持久化，负责人指示列为后续）

以下在本次只做了会话内占位，真实实现按里程碑推进：

1. Bot / 分组 / 列表状态（置顶、未读、隐藏）的**持久化**（D04 SQLite + D05）。
2. 分组管理完善：重命名、删除分组、跨组移动的约束校验、分组内排序（D05）。
3. Bot 真实 CRUD 与会话（D05；依赖 D01/D03 Harness 接入与契约）。
4. 「不同分组 Bot 不能主动交流」升级为后端强制策略，并在事件/日志中可审计（D05/D06）。
5. 对话 ID 真实语义、复制通道与剪贴板权限策略（D05）。
6. 自定义标题栏（无框窗口）与 `window:minimize/toggleMaximize/close` IPC 的 UI 绑定（D05，通道已就绪）。
7. 安装包、签名、自动更新（D11）。
8. 账号系统与多账户：真实登录/退出登录/添加账户语义（依赖产品账号决策；当前退出登录仅为占位重置）。
9. 设置持久化（主题、账户名、语言等；当前均为会话内状态）。
10. 设置其余分类（电脑 / 保险库 / 用量与账单 / 更新）与强调色、语言、硬件加速实现。
11. 会话消息与反应/引用的持久化（当前全部会话内）；真实模型回复接入后，表情回应与引用需映射到契约层（D03/D05）。
12. 拖拽换组的持久化与跨分组拖拽时的交流边界确认（当前拖拽仅改会话内分组归属）。

## 12. 提交记录

按意图拆分的本地提交（未推送）：

- 验收代码提交（B2/B7/B8 验收对应）：
  - `build(desktop): add electron toolchain and workspace config`
  - `feat(desktop): add desktop shell with tray, navigation and restricted ipc`
  - `feat(desktop): add settings modal and remove redundant hide button`
  - `feat(desktop): add bot drag-drop between groups and message reactions with quoting`
- 报告-only 提交：`docs: record desktop shell` 及后续 docs 提交（不改变代码；最终 PR head 的 CI 由 Approver 在合并前确认）

各提交的完整 SHA 以 `git log feature/desktop-shell` 为准；本报告不自我引用 tip SHA。

## 13. 对 D05 / D07 / D09 的接口与容器说明

- 容器：`apps/desktop` 已具备窗口、托盘、单实例与安全基座；后续任务从合并后的 `develop` 拉分支，直接在 `src/renderer` 扩展页面、在 `src/main/ipc/registry.ts` 按白名单模式新增通道（必须同时更新 `src/shared/ipc-channels.ts` 与 preload 暴露面，并保持 sender 校验）。
- IPC 约定：所有新通道沿用「白名单 + `IpcDeniedError` 稳定错误码 + 主窗口主 frame 校验」模式；不要绕过 preload 暴露任意 channel。
- 状态：renderer 当前全部为会话内状态；D04/D05 落地后以真实数据源替换 `App.tsx` 中的本地 state（bots/groups），占位交互（置顶/未读/分组/交流规则）届时迁移到真实数据层并在后端强制交流边界。
- 测试：桌面单元测试入口为 `apps/desktop/tests/`；IPC 相关改动必须补充白名单/校验用例。

## 14. 完成定义对照

- D2-1–D2-11：除 D2-9 UNVERIFIED、两个人工项外全部有证据，结论与证据一致。
- 应用可启动、托盘行为可验证、导航可用、IPC 仅白名单、renderer 无 Node/fs/ipcRenderer、安全设置未降级、unpacked 产物可启动（中性路径）。
- 报告对应分支验收代码提交；分支可作为 D05/D07/D09 容器基线。

## 15. 负责人收尾清单（合并前需人工完成）

1. **实机验收**：双击 `apps/desktop/release/win-unpacked/DeepSeek Bot.exe`，确认启动、四页导航、托盘（图标/菜单 Show-Hide-Quit/双击）、关闭进托盘。若在工作区路径下复现 STATUS_BREAKPOINT 崩溃，先停并升级（见第 7 节 #1）；任何实机结果（含截图）补进本报告。
2. **自审**：以负责人身份对验收代码提交（`7f7cdac` / `db00475` / `39dac09` / `f96c573`，docs 提交不改变代码）完成差异检查，把 SHA、日期、检查证据与结论填入第 10 节「负责人自审记录」。
3. **推送**：`git push -u origin feature/desktop-shell`（或交 Push 角色执行；不改写历史、不 force push）。
4. **草稿 PR**：目标 `develop`，描述直接采用第 10 节草稿；`gh` 可用则 `gh pr create --draft --base develop`，否则在 GitHub 网页创建并粘贴。
5. **CI**：等分支 `windows-latest` 的 lint/typecheck/test 跑绿，把 run 链接补进第 3 节 D2-9（消除 UNVERIFIED）与 PR 描述。
6. **合并**：核对第 10 节「合并前」清单全部勾选后，由负责人自行用 merge commit 合并（禁 squash/rebase），合并后删除 feature 分支。
7. **交接**：合并后的 `develop` 即 D05/D07/D09 的容器基线；第 11 节待办（持久化、账号系统、设置扩展等）交规划侧排期。
