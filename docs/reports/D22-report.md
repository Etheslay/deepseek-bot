# D22 系统集成与双语实现报告

日期：2026-10-26。任务：D22 `feature/system-integration`（负责人 Destinyian，依赖 D02、D11，均已合入）。

- 基线：`origin/develop` = `2ecb2f9`（含 D17 #48、D16 #47、D30 #44）
- 分支：`feature/system-integration`，工作树 `../deepseek-bot-d22`（独立 worktree，未触碰主工作区）
- 提交：`80a663f` 双语内核与全量文案迁移 → `b489225` 托盘 / 通知 / Chrome 导入 → `377a37b` 取证中发现的缺陷修复与证据 → 本 docs 提交 文档同步（分支 head）
- 环境：Windows 11 x64 · Node v24.16.0 · pnpm 11.28.5 · Electron 38.2.1（打包未执行）

> 本报告的每一项检查都有对应命令与退出码；未运行的检查不写"通过"。AI 执行的取证不等于负责人自审，§7 自审记录留空待签。

## 1. 交付内容

| 验收项（FR-19） | 实现 | 落点 |
| --- | --- | --- |
| 中英双语可切换 | 零依赖类型化字典：`shared/i18n`（`locale` 解析、`translate` 位置参数 + 英文单复数、19 个 domain 文件 **827 条 key**（映射生成 18 域 764 条 + 手工维护的 `d22` 域 63 条，零重复 key））；渲染层模块级 store（`useSyncExternalStore`）+ 主进程语言镜像；`system`/`zh`/`en` 三档偏好，`system` 取 `app.getLocale()` | [shared/i18n](../../apps/desktop/src/shared/i18n/)、[renderer/src/i18n.ts](../../apps/desktop/src/renderer/src/i18n.ts)、[main/i18n.ts](../../apps/desktop/src/main/i18n.ts) |
| 每 bot 托盘图标 | 单托盘：图标 = 活跃 bot 的 Grok Ball（渲染层 SVG→canvas 32px PNG，经校验的 `tray:sync` 推送）；菜单逐 bot 一项、带各自图标、活跃标记、按"活跃→等待审批→运行中→未读→其余"排序；菜单/tooltip 随界面语言 | [main/tray.ts](../../apps/desktop/src/main/tray.ts)、[main/tray-menu.ts](../../apps/desktop/src/main/tray-menu.ts)、[features/system/tray-avatar.ts](../../apps/desktop/src/renderer/src/features/system/tray-avatar.ts)、[tray-sync.ts](../../apps/desktop/src/renderer/src/features/system/tray-sync.ts) |
| 通知设置 | 主进程 `Notification`（4 秒同文去重、点击回主窗口并通知渲染层定位 bot）；策略在渲染层：总开关、**仅窗口不在前台时提醒**（默认开）、按 Bot 静音、测试通知按钮（如实回报"系统无通知通道"）；触发点＝回复完成 / 待审批 / 错过定时（FR-08） | [main/notifications.ts](../../apps/desktop/src/main/notifications.ts)、[features/system/notify.ts](../../apps/desktop/src/renderer/src/features/system/notify.ts)、[notifications-panel.tsx](../../apps/desktop/src/renderer/src/features/system/notifications-panel.tsx) |
| Chrome 数据导入 | **只读书签**（口径见 §2）：扫描 `<User Data>/*/Bookmarks` + `Local State` 取显示名 → 预览条数与样例 → 导入到 `<数据根>/imports/chrome/bookmarks.json` → 查看/导出 Markdown/一键删除；仅 `http(s)`、URL 去重、单文件 >8 MiB 拒绝、上限 5000 条、token 拒绝分隔符与 `..` | [main/chrome-bookmarks.ts](../../apps/desktop/src/main/chrome-bookmarks.ts)、[chrome-panel.tsx](../../apps/desktop/src/renderer/src/features/system/chrome-panel.tsx) |
| 不引入账户体系 | 未新增任何登录/同步面；`本地用户` 改为语言化默认名（v1 存量的中文默认值在迁移时归一为"未设置"） | [settings-store.ts](../../apps/desktop/src/renderer/src/features/settings/settings-store.ts) |

新增桌面进程内 IPC 通道（**契约零变更**，`PROTOCOL_VERSION` 仍 0.2；无新增依赖，lockfile 未动）：
`i18n:setLanguage`、`tray:sync`、`notification:show`、`chrome:{scan,preview,import,state,clear,export}`；主→渲染事件 `system:event:tray-action`、`system:event:notification-click`、`system:event:window-focus`。payload 一律在 [shared/system-integration.ts](../../apps/desktop/src/shared/system-integration.ts) 校验（条目上限、名字长度、PNG data URL 白名单、图标字节上限、token 形态），校验通过才进主进程逻辑。

## 2. 范围决策（开工前与负责人确认）

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| Chrome 导入内容 | 只读书签（+ 预览/导入/导出/删除） | 对标产品的"Cookie 导入"是给**云端浏览器**带登录态；本产品无浏览器自动化、无云端，导入 Cookie 没有消费方且要解密 Chromium 存储，风险不对称。书签是 JSON、可解释、可删除，且能立刻以 Markdown 形式进 bot 工作区 |
| 托盘形态 | 单托盘，图标随活跃 bot，菜单逐 bot 图标 | Windows 托盘会折叠多图标；"每 bot 托盘图标"以"每个 bot 有自己的图标出现在托盘里"落地 |
| 双语范围 | 全量 UI + 防回归测试 | FR-19 要求"可切换"，半套界面在英文下不可用 |

**明确不翻译的部分**：发给模型的提示文本（技能上下文头、附件代码块包装、语气拼接后缀 `（语气：…）`）与作为数据/比较值的字面量（能力 id、语气值、分组身份）。这些位置用 `// i18n-ignore` 标注，防回归测试放行它们但要求写明理由。理由：静默改写发给模型的中文会改变 bot 行为，属于未经确认的行为变更。

## 3. 文案迁移的做法与规模

一次性机械迁移 + 人工兜底，避免手改 300 处漏掉：

| 指标 | 数值 |
| --- | --- |
| 扫描到的界面文案节点 | 757 |
| 去重后唯一文案 | 608 |
| 自动替换 | 644 处 / 31 个文件 |
| 需人工改造（模块级常量表 / 数据比较值） | 114 处 / 8 个文件 |
| 迁移后字典 | **827 key / 19 domain**（其中映射生成 18 域 764 条，`d22` 域 63 条手写保留）。首轮 662/14；合入 develop 后随对方新增界面继续补：#52 待执行参数 +2、`3afea90` 批（记忆/知识库、事件自动化、连接器、搜索、提问卡、D28 画布侧车、知识导入）+141、`e6a54b1` 批（MCP 工具授权）+26。计数脚本 `count-keys.cjs` 同时断言跨域无重复 key |
| 残留未翻译界面文案 | **0**（`i18n` 扫描器：字符串字面量、模板串、`+` 拼接链、JSX 文本段） |

两轮补漏的规模（对 develop 新增界面重跑同一流程）：第二轮 140 处 / 11 文件 + 手工 22 处，第三轮 24 处 / 1 文件 + 手工 3 处；扫描器对新文案零漏判（守卫测试 `tests/i18n-scan.test.ts` 会在 CI 直接失败）。develop 的六个新面板（memory / automation / connectors / search-settings / search-results / questions）与 MCP 白名单组件同样把已渲染字符串存进 notice state，已统一改为 `{ key, params }` + `noticeText()`，切语言即时重译（见 §6 顺带修复）。`src/shared/knowledge-import.ts` 因主进程也会 import，不能读渲染层语言 store，兜底文档标题改由调用方注入（develop 的测试同步更新并断言注入）。

人工改造的关键点（模块级常量在 import 期求值，会冻结启动语言）：`RUN_STATUS_LABELS`、`NODE_STATUS_LABELS`、`DECISION_LABELS`、`CAPABILITY_LABELS`（两份重复表合并为 [capability-labels.ts](../../apps/desktop/src/renderer/src/features/permissions/capability-labels.ts)）、`TONE_PRESETS`、`WORKSPACE_OPTIONS`/`TOOL_POLICY_OPTIONS`、`SEARCH_KIND_LABELS`、`EVENT_LABEL`（automation）、夹具会话标题——全部改成"key 表 + 取值函数"；`automation-panel` 的 `名称（事件）` 与画布 `版本历史（3）` 原本是把全角括号写在 JSX 里拼接，已合并为单条消息（英文得到 `Name · On run failure` / `Version history (3)`）。`APPROVAL_TTL_COPY` 由常量改为 `approvalTtlCopy()`。

数据与显示分离的两处：默认分组不再用中文名做身份比较（`group.name` 为空即默认组，标签走 `t("shell.ungrouped")`）；语气 chip 的 `id`/`labelKey`/`instruction` 三分，展示翻译、发给模型的指令保持原值。

日期时间不再手写 `今天`/`周一`：统一走 `Intl`（`formatTime/formatDate/formatFullDateTime`，含秒，避免回放时间标签塌缩）。

## 4. 测试与验证

| 检查 | 提交 / 环境 | 命令 | 结果 |
| --- | --- | --- | --- |
| 全仓测试 | `bd7ba12`（已合 develop 至 `e6a54b1`）/ Win11 x64 + Node 24.16.0 | `pnpm test` | exit 0：desktop 41 文件 / **385** 用例（基线 `2ecb2f9` 为 23/206）、contracts 97、storage 175、runtime 128、agent-tools 80、host 24 文件 / 152(+1 skip)、harness-adapter 58、shared 6、harness-bridge 29 |
| 静态检查 | 同上 | `pnpm run lint`；`pnpm run typecheck` | 均 exit 0（10 包） |
| 未翻译文案扫描 | 同上 | `node d22-tools/i18n.mjs check` | `no untranslated UI copy left in apps/desktop/src` |
| 双语内核专项 | 同上 | `tests/features/i18n.test.ts`（14 例） | locale 解析、位置参数、英文单复数、未知 key 回退、字典 zh/en 占位符一致、英文不含中文、key 命名空间 |
| 防回归守卫 | 同上 | `tests/i18n-scan.test.ts`（3 例） | 扫描 `apps/desktop/src` 拒绝新增中文界面文案；`t()/tr()` 引用的 key 必须存在于字典 |
| 托盘菜单模型 | 同上 | `tests/main/tray-menu.test.ts`（6 例） | 排序（活跃→审批→运行→未读）、活跃标记、无 bot 占位、tooltip、图标回落 |
| 跨边界 payload 校验 | 同上 | `tests/shared/system-integration.test.ts`（34 例） | 50 条上限、名字长度、状态枚举、非 PNG/超大图标、`..`/绝对路径 token、通知字段上限、语言三值 |
| 托盘同步与头像 | 同上 | `tests/features/tray-sync.test.ts`（13 例） | SVG 自包含且无 CSS 变量、mono 随主题取实色、注入色被转义、payload 组装/上限/活跃 id 失效回落、桥接拒绝与无桥接降级、栅格化超时返回 null |
| 通知策略 | 同上 | `tests/features/notify.test.ts`（10 例） | 总开关、前台静默默认、可关、按 Bot 静音、5 秒节流、测试通知豁免、中英标题 |
| 系统通知实现 | 同上 | `tests/main/notifications.test.ts`（6 例，Electron `Notification` 用记录型替身） | 不支持时回报原因、4 秒同文去重、不同 bot/标题视为不同、点击回传 botId、坏图标不传 `icon` |
| Chrome 书签 | 同上 | `tests/main/chrome-bookmarks.test.ts`（17 例，临时目录构造真实文件树） | 只留 http(s)、URL 去重、目录路径、垃圾输入不抛、Local State 取名、token 遍历拒绝、导入/读回/导出/清除/损坏文件回落 |
| 设置 v2 | 同上 | `tests/features/settings-updates.test.ts`（10 例） | v1→v2 迁移、v1 中文默认账户名归一、非法语言/通知字段回落、静音列表去重 |
| 存量通知重翻译 | 同上 | `tests/features/permissions-panel.test.ts`（5 例） | 失败提示以 key 存储，切换语言后重新渲染为对应语言（取证中发现的缺陷） |
| 构建 | 同上 | `pnpm --dir apps/desktop exec electron-vite build` | exit 0 |
| 界面取证 | 同上 / 无头 Chrome 1440×900 | 驱动**生产 bundle**（`out/renderer` 拷入 `handoff/d22-preview` + 记录型 preload 替身） | 16 张截图 + `d22-evidence-log.json`（16 步断言），见 §5 |

## 5. 证据（`docs/reports/assets/d22/`）

| 文件 | 内容 |
| --- | --- |
| `d22-01-app-zh.png` | 干净启动跟随系统语言（`zh-CN`）：侧栏、空状态、账户名全中文 |
| `d22-02-tray-avatar.png` | `tray:sync` 实际推送的 32px PNG 头像（由 bundle 现场栅格化，非手工素材） |
| `d22-03-chat-gated.png` | 前台聚焦时回复完成 → 通知计数仍为 0（默认"仅非前台提醒"生效） |
| `d22-04-settings-zh.png` / `d22-05-settings-en.png` | 设置弹窗中英对照：语言选择器、通知分区、Chrome 导入分区 |
| `d22-06-notify-en.png` / `d22-07-notify-muted.png` | 通知面板开关、测试通知结果标签、按 Bot 静音并写入 v2 存储 |
| `d22-07b-reply-notice.png` | 取消"仅非前台"并解除静音后，回复触发 `note-summarizer replied` 通知请求 |
| `d22-08-chrome-preview.png` / `d22-09-chrome-imported.png` | 扫描到两个配置（128 / 7 条）→ 预览样例 → 导入 toast「Imported 128 bookmarks」 |
| `d22-10-reload-en.png` / `d22-11-settings-zh-again.png` | 重载后语言保持；切回中文对称生效 |
| `d22-12-settings-en-clean.png` / `d22-13-settings-zh-clean.png` | 无脚本副作用的干净设置面板对照（修复 `.ghost-btn` 绝对定位后） |
| `d22-14-connectors-en.png` / `d22-15-connectors-zh.png` | develop 新增的连接器 / MCP 工具授权 / 事件自动化 / 技能分区在中英两种语言下的设置面板（英文截图正文零中文；notice 亦随语言） |
| `d22-evidence-log.json` | 16 步断言的机器可读日志（托盘 payload、通知请求、Chrome 调用序列、localStorage 值、`developSections` 与 `developChineseLeak`） |

取证脚本与 preload 替身放在 `handoff/`（已 gitignore，不入库）：`d22-preview.mjs`、`d22-serve.mjs`、`d22-evidence.mjs`、`d22-clean-shot.mjs`、`d22-connector-shot.mjs`（另有若干 `d22-probe-*.mjs` 排障脚本）。

语言切换在合并 develop 后一度静默失效：`CustomSelect` 的触发器文本变成「跟随系统▾」，脚本按精确文本匹配点不到，导致后续英文步骤空跑。改为按 `aria-label` 定位触发器、在 `.custom-select-menu` 内取选项后恢复；步骤 5 同时新增 `developSections` / `developChineseLeak` 两项断言，专门盯住 develop 带来的新界面是否跟随语言。

## 6. 未验证项与边界（不冒充完成）

1. **Electron GUI 无法在本执行环境启动**（与 D07/D09/D11 记录一致，GUI 进程 `0x80000003` 立即退出）。因此以下均为**未验证**，需负责人实机确认：
   - 托盘图标的系统级渲染（16/32px 缩放、深浅色任务栏下的观感）、菜单点击切换会话、双击显示窗口；
   - Windows 通知中心真实弹出、toast 图标、点击跳转、专注助手期间的行为；
   - 读取**真实** Chrome 配置（本机 Chrome 数据根存在与否、被 Chrome 占用时的读取表现）；
   - 打包版（NSIS）下的托盘 AppUserModelId 与通知归属（D11 的 `com.deepseekbot.desktop` 已设置，未在安装版验证）。
2. **Host 侧错误文案仍为中文**：`packages/host`/`runtime` 抛出的消息串不属桌面渲染层，本轮未翻译；渲染层按 errorCode 映射本地化文案，未知细节原样附带。彻底消除需要契约级错误码约定，列为后续项。
3. **取证运行在夹具模式**（无 Host 子进程），因此截图中会出现"Failed to load approval requests / permission data"提示——这是替身环境缺 Host 通道的预期结果，不是新缺陷；权限/审批链路由 D16 的 jsdom 测试覆盖。
3b. **替身环境的已知脆弱点（非本 PR 引入，建议单列）**：develop 的聊天侧面板（memory / knowledge / questions / search-results / connectors / automation）直接调 `window.deepseekBot.host.call(...)`，且渲染树没有 error boundary——`host` 缺失时该 throw 会把整个应用打成白屏（本分支取证时实测复现）。生产里 preload 总会注入 `host`，因此用户看不到；但任何无桥接环境（预览、组件测试、以后若把面板嵌到别处）都会踩到。取证侧已用 `__d22.enableHost()`（服务层选定夹具实现之后再注入拒绝型桥）绕过，产品侧建议改为走 `desktop-service` 或加 error boundary。
4. **托盘"运行中"状态未在截图中捕获**：夹具回复在毫秒内完成，状态翻转快于取证采样；`onBotStatus` 调用路径与 payload 的 `running` 分支由单测覆盖（`tray-menu`/`tray-sync`）。
5. **通知未接入工作流运行事件**（运行完成/失败目前只有聊天内与运行监控内提示），本轮触发点为回复完成、待审批、错过定时三类。
6. **未做**：Chrome 历史/Cookie 导入（口径已定）、macOS/Linux 托盘与通知适配、界面语言对 bot 回复内容的影响（不涉及）、`data.*` 备份是否包含 `imports/chrome/`（当前备份清单未涵盖该目录，见 §8）。

流程偏差与说明：

- 全量文案迁移天然横跨 D05/D07/D09/D16/D17/D24/D25/D26 的渲染层文件（均为 Destinyian 负责的桌面线），因此本 PR 的 diff 面很大但仅限 `apps/desktop`；未触碰 `packages/**`、契约、lockfile、CI。
- 迁移工具（AST 扫描/替换/字典生成/审计）刻意放在仓库外 `D:\PersonProgram\d22-tools`，避免把一次性脚本当工程资产提交；**代价**是后续新增文案需手工往对应 `messages/<domain>.ts` 追加，或由负责人决定是否把工具收进 `scripts/`。
- 顺带修复的非本任务问题：D16 权限面板把已翻译字符串存进 state（切语言不重译）、D02 `.ghost-btn` 基类绝对定位导致 D17 技能工具栏与 D22 Chrome 面板按钮叠到弹窗外；合入 develop 后又在同一缺陷类下扩到七个新面板（memory / automation / connectors ×2 / search-settings / search-results / questions）与 MCP 工具授权组件。
- 观察到的 flake：一次全仓 `pnpm test` 里 `packages/host` 报 2 例失败，单跑该包 24 文件全绿、重跑全仓亦 exit 0；疑为并发下的端口/计时争用，非本分支引入，未深究，如实记录。

## 7. 负责人实机验收清单

- [ ] 启动打包/开发版，切英文：托盘菜单、tooltip、通知文案是否英文；切回中文是否立即跟随
- [ ] 建 3 个 Bot，切换会话：托盘图标是否换成当前 Bot 头像；菜单是否逐 Bot 有各自图标、活跃项在最上
- [ ] 让某 Bot 回复长任务，窗口最小化到托盘：是否收到"已回复"通知；点通知是否唤起并定位到该会话
- [ ] 触发一次审批请求（非前台）：是否收到"等待审批"通知；按 Bot 静音后是否不再打扰
- [ ] 睡眠/唤醒或关闭应用错过定时：错过通知是否出现且不重复刷屏
- [ ] 设置 → Chrome 数据导入：扫描是否列出真实配置与书签数；预览样例是否合理；导入后 `imports/chrome/bookmarks.json` 是否可读；导出 Markdown 是否可被 bot 工作区引用；删除是否清干净
- [ ] 未装 Chrome 的机器：是否显示"未找到 Chrome 书签数据"而不是报错
- [ ] 重载/重启应用：语言、通知偏好、静音列表是否保持

## 8. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：`bd7ba12`（代码 head；本报告的 docs 提交在其后）　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint / typecheck / pnpm test / 实机清单 §7）：＿＿＿＿
- [ ] 遗留问题（§6 第 1–6 项处置、`imports/chrome/` 是否纳入备份清单）：＿＿＿＿
- [ ] 结论：＿＿＿＿

> 按 [开发计划 §4](../DEVELOPMENT_PLAN.md) 与 [Git 工作流 §4](../GIT_WORKFLOW.md)：本分支未自行合入 `develop`，自审结论由负责人签署后再以 merge commit 合并。

## 9. 提交范围与 PR

代码 head：`377a37b`；随后 `d9f4a38`/`84b0f1d` 为文档提交，`56d07fc`/`49ebf35`/`b6108c7`/`00d7a19→bd7ba12` 四次合入 `origin/develop`（#52 工具网关起，冲突与解法见下），`8f5bcda` 与 `bd7ba12` 内分别接入 develop 带来的新文案。自审需覆盖 `2ecb2f9..HEAD` 的全部提交（`git log --oneline 2ecb2f9..HEAD`）。

第二次合并 `origin/develop` = `426310b`（#53 用户气泡随 bot 配色）：唯一冲突是 `App.tsx` 的 react import 行（本分支加了 `useCallback`，#53 加了 `CSSProperties`），两侧都保留。

第三次合并 `origin/develop` = `3afea90`（#62 技能 composer、#63 知识库、#64 画布共编、#65 连接器调用、#66 事件自动化，共 43 个提交）：7 个文件冲突，统一按"取 develop 的新界面 + 重新挂 message key"处理——`App.tsx` 8 处（保留内联改名、右键快建、D28 画布侧车与新设置分区；旧的产物文本预览按钮随 develop 删除 `desktop.artifacts.preview` 一并移除）；`permission-chat.tsx` / `permissions-panel.tsx` 的能力表统一由 `capability-labels.ts` 提供（develop 在两文件里各抄了一份，且新增 `memory.read/write`）；`avatar-picker.tsx` 保留 develop 的主题色 tone 渲染；`fixture-service.ts` 取 develop 的共编工作区；`main/index.ts` 两侧 import 合并；`styles.css` 保留 develop 并重新追加 D22 段；`tray-avatar.ts` 因 develop 移除 `projectEye` 改为内联中性眼位。随后 `8f5bcda` 把这一批带来的 141 条新文案接入字典。

第四次合并 `origin/develop` = `e6a54b1`（#67 MCP 契约、#68 本地 HTTP MCP 工具、#69 分支台账）：4 个文件冲突，连接器面板保留 develop 的按类型字段（凭据引用只对 sd-webui 显示、端点占位符按类型区分）并改走 key；权限两侧保留 develop 的 `preview` 变量与新增 `mcp.call` 能力；`SPRINTS.md` 保留 develop 新增的 D18×3 / D19×2 / D20 / D28 / D21 行，并把过时的「D22 已实现但未合入 / 从未推送」行改为当前状态。同一提交内接入 MCP 工具授权 UI 的 26 条新文案，并把该组件的 notice state 纳入同一约定。

§5 证据在最新构建（`bd7ba12`）上重新采集；前三次合并后的检查记录见各 merge commit 的正文。

与 develop 的冲突处理：`App.tsx` 取 develop 侧（#52 把聊天内联授权卡移进审批网关路径）；`permission-chat.tsx` 保留 #52 的按 bot 生命周期守卫、`botId` 过滤与新增的「待执行参数」块，并重新套用 D22 文案层（能力表改由 `capability-labels.ts` 提供、选项与提示存 message key、新增 2 条 key）；`docs/SPRINTS.md` 保留 develop 的 D17 行并追加 D22 行。合并后 `pnpm test` / `pnpm run lint` / `pnpm --dir apps/desktop run typecheck` 与未翻译扫描全部通过，§5 证据在合并后的构建上重新采集。

分支已推送 `origin/feature/system-integration`。本机无 `gh` CLI，PR 需由负责人在浏览器创建：<https://github.com/Etheslay/deepseek-bot/pull/new/feature/system-integration>（base = `develop`）。按 [Git 工作流 §4](../GIT_WORKFLOW.md)（必需批准数 0、负责人自审后自行合并），填写 §8 后以 merge commit 合入；本次未执行任何合并动作。
