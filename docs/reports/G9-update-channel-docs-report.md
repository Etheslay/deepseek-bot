# G9' 应用内更新通道文档欠账

日期：2026-10-28（Asia/Shanghai）。任务来源：[GAP_AUDIT](../GAP_AUDIT.md) §4 G9'（docs/gap-audit-refresh 版本）——备份/恢复/保险库/应用内更新主体已交付（PR #78），但 `docs/DESKTOP_SHELL.md` 与 `docs/RELEASE.md` 无更新通道说明。本片为纯文档 PR，零代码、零契约、零依赖变化；本文记录文档与代码事实的对照，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。

## 1. 交付行为（4 处改动）

`docs/DESKTOP_SHELL.md`：

1. 新增 **「应用内更新（D24）」** 一节（位于「打包（D11）」之后）：更新源（`electron-updater` + `electron-builder.yml` 的 `publish: github, Etheslay/deepseek-bot`）、`--publish never` 不自动发布、五步行为链（启动双层静默检查 → 设置 → 更新 手动检查 → 左下角徽标 → 点击下载并 `quitAndInstall` → 软着陆语义），并交叉引用 RELEASE.md 检查单。
2. 修正「已知限制」中已失实的 **「不提供自动更新（无更新服务器）」**：通道已接入；未签名状态与 SmartScreen 提示保持原描述不变；首个 Release 发布前检查一律软着陆。
3. 修正设置分区描述中已失实的 **「电脑 / 保险库 / 用量与账单 / 更新为占位禁用」**：六项分区（通用 / 电脑 / 权限 / 保险库 / 用量与账单 / 更新）均已可用，与 `features/settings/settings-nav.tsx` 的三组导航一致。

`docs/RELEASE.md`：

4. §4 新增 **「4.1 发布即触发更新的检查单（D24 应用内更新通道）」**：assets 三件套（安装包 / `.blockmap` / `latest.yml`，打包 CI artifact 已内含）、`latest.yml` 与安装包的版本/文件名/SHA-512 一致性、版本严格大于判断、旧版实机验证（首个发布如实记"无旧版可验"）、升级数据保留（`deleteAppDataOnUninstall: false`）、失败样例记录、发布后不替换 assets 与撤回语义。

## 2. 描述与代码事实对照（验收：描述与代码行为一致）

| 文档断言 | 代码证据（对 `origin/develop` = `94bc05d`） |
| --- | --- |
| `autoDownload = false`、`autoInstallOnAppQuit = true` | `apps/desktop/src/main/updates.ts:16-17` |
| 下载完成立即 `quitAndInstall()`（NSIS assisted） | `updates.ts:72-75` |
| 检查失败软着陆为错误字符串，`available=false` | `updates.ts:48-57`（catch 分支） |
| 启动静默检查（主进程一次） | `apps/desktop/src/main/index.ts:423-426` |
| 渲染层就绪后再查一次 | `App.tsx:627-633` |
| 左下角徽标仅在 `available` 时出现，点击下载安装 | `App.tsx:1846-1868`（`.update-badge`，位于 `.sidebar-foot` 之前） |
| 设置 → 更新 手动检查与状态标签 | `App.tsx:2629-2657`；预览壳提示 `shell.updateChannelNeedsMain` |
| 更新源 `github / Etheslay / deepseek-bot`、`--publish never` 默认 | `apps/desktop/electron-builder.yml` publish 段及 D24 注记 |
| IPC `updates:check` / `updates:downloadInstall` | `src/main/index.ts:250-251`；DESKTOP_SHELL.md IPC 白名单表（原有行） |
| 打包 CI artifact 内含 `latest.yml` | `.github/workflows/package.yml` 上传清单（installer / `*.blockmap` / `latest.yml`） |
| 版本严格大于才提示 | `src/shared/versions.ts` + `updates.ts:39-40`（`compareVersions(...) > 0`） |
| 六项设置分区 | `features/settings/settings-nav.tsx:13-20`（SETTINGS_SECTION_KEYS） |

## 3. 实际检查

环境：Windows、Node v24、pnpm 11（本机）。分支 = `origin/develop`（`94bc05d`）+ 仅文档差异。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个工作区包全绿） |
| `pnpm test`（`pnpm -r`） | 递归在首个失败包 exec-daemon 处中止（pnpm 递归遇错即停，非本分支差异所致） |
| exec-daemon 单包复跑 | 32 过 / 7 跳过 / 2 失败：`ocr.test.ts`（esbuild 写临时目录 `Access is denied`）、`windows.real.test.ts`（真实窗口捕获授权失败）——均为本机环境失败 |
| 基线对照：未改动的主工作区（develop `81a0924`）跑 exec-daemon | 同样 2 失败、同错误签名 → 与本分支 diff 无关（GAP_AUDIT §0 已登记过同型 esbuild 临时目录失败） |
| 显式补跑 shared / harness-bridge / contracts / agent-tools / storage / desktop / runtime / harness-adapter | 全绿：6 / 30 / 149 / 134 / 219 / 552 / 137 / 65 |
| host 单包 | 267 过 / 1 跳过 / 1 失败：`screen-distribution.test.ts` 同型 esbuild 临时目录 `Access is denied`（环境性，与 exec-daemon 同根） |
| `pnpm --filter @deepseek-bot/desktop build` | 失败——esbuild 渲染层转译在临时目录 `Access is denied`（`[vite:esbuild-transpile] remove …esbuild-…: Access is denied`），与 GAP_AUDIT §0 已登记的基线环境失败同型；本分支仅改文档，未触及构建路径 |

## 4. 未验证边界

- 纯文档 PR，无代码路径变化；文档断言全部来自对 `94bc05d` 代码的阅读与 grep，未做实机升级演练（当前无已发布 GitHub Release，"旧版发现新版→徽标→下载安装"的端到端只能待首个 Release 后按 RELEASE.md §4.1 检查单执行）。
- SHA-512 完整性校验行为来自 electron-updater 的一般行为描述，未在本仓实测。
- exec-daemon 2 失败与 host 1 失败为本机环境失败（esbuild 临时目录写拒绝 / 真实窗口授权），基线同样失败，本轮不修复、不据此声称全绿。
- DESKTOP_SHELL.md 其他小节存在与本任务无关的历史陈旧表述（如文件头"当前为静态占位壳"、"退出登录"占位状态），本片不越界改写，留待相应任务刷新。

## 5. 负责人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、文档断言与代码一致性：＿＿＿＿
- [ ] 自动化检查与未验证边界：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
