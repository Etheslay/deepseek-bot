# D11 交付报告：Windows 桌面打包与交付

- 任务：D11（里程碑 M3，FR-10 打包交付）
- 分支：`feature/desktop-packaging`（base `develop`）
- 基线：`origin/develop` = `adf7b8d`（2026-10-25 fetch 时点；D02/D04 早已合并，D05–D09 已随 PR #11–#15 合并）
- 提交：功能提交 + 本报告提交（见 §8）
- 负责人：Destinyian
- 环境：Windows 11 x64 (10.0.26200) · Node v24.16.0 · pnpm v11.28.5 · electron-builder 24.13.3 / electron-vite 4.0.1 / Electron 38.2.1

## 0. 开工门禁记录

| 门禁项 | 结果 |
| --- | --- |
| `origin/develop` 已包含 D02、D04 | ✅ D02（`664f376`）、D04（PR #9 `9cf4ba2`）；基线 `adf7b8d` |
| 从该 develop 创建 `feature/desktop-packaging`，工作区干净 | ✅ 除本地未跟踪材料（handoff/ 等）外干净 |
| 已读 RELEASE / PRD FR-10+§6 / TESTING 安装发布+QA-12/13 / DESKTOP_SHELL / SECURITY_DATA / electron-builder.yml / package.json / ci.yml | ✅ |
| 仅 Windows x64 | ✅ 未承诺 macOS/Linux |
| 签名证书/发布凭据不入仓库 | ✅ 无证书；`signAndEditExecutable: false` 保持 |

## 1. 交付范围

```text
apps/desktop/electron-builder.yml     dir → NSIS x64 按用户安装（oneClick=false、perMachine=false、
                                      可选安装目录、桌面+开始菜单快捷方式、卸载保留用户数据）
apps/desktop/package.json             + "pack:win" 脚本（pack:dir 保留）
.github/workflows/package.yml         产品打包 CI（workflow_dispatch + tag v*，windows-latest，
                                      Node 24 + Corepack，产出 exe/blockmap/SHA256SUMS artifact）
docs/RELEASE.md                       CI 现状描述更新（打包 CI 已建立；release-ready 仍无自动化）
docs/DESKTOP_SHELL.md                 打包章节（NSIS 边界、数据根、CI、限制）
docs/reports/D11-report.md            本报告
```

产物（本地构建，`apps/desktop/release/`，gitignore 不入库）：

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `DeepSeek Bot-0.1.0-x64.exe` | 90,317,868 B（86.1 MiB） | `5943d4935c17d9d641fb5c11a356eacff42458a6e188b6ae4363f5674dfd1d99` |
| `DeepSeek Bot-0.1.0-x64.exe.blockmap` | 95,010 B | — |
| `SHA256SUMS.txt` | 清单 | — |

## 2. 验收清单（D11-1 – D11-16）

| # | 步骤 | 命令 / 证据 | 退出码 | 结论 |
| --- | --- | --- | --- | --- |
| D11-1 | 干净安装 | `pnpm install --frozen-lockfile` | 0 | ✅ |
| D11-2 | 静态检查/测试 | `pnpm lint` / `pnpm typecheck` / `pnpm test`（shared 6 / contracts 64 / desktop 120 / storage 112 / runtime 90 全绿） | 0 / 0 / 0 | ✅ |
| D11-3 | 构建 | `electron-vite build`（pack:win 第一步，182 modules） | 0 | ✅ |
| D11-4 | 安装包 | `pack:win` → NSIS x64 `DeepSeek Bot-0.1.0-x64.exe`；安装器元数据 ProductName=DeepSeek Bot、Version=0.1.0；⚠️ unpacked 主 exe 资源仍为 Electron 元数据（见 §5 P2-1） | 0 | ✅ |
| D11-5 | 干净机安装 | **受阻**：见 §4 阻塞报告 | — | ⛔ 待 Owner/干净机 |
| D11-6 | 无开发依赖 | 包内容静态验证：asar 内 node_modules 仅 `@deepseek-bot/contracts`/`react`/`react-dom`（运行时依赖），devDependencies 零泄漏；主进程 bundle 无 "5173" 字符串（dev server 仅存在于 electron-vite dev）；asar 内无 .env/.key/secret 文件。运行时行为验证并入干净机试验 | — | ◐ 静态✅ / 运行时待验 |
| D11-7 | 基本功能 | **受阻**：GUI 启动（§4） | — | ⛔ 待干净机 |
| D11-8 | 重启持久化 | **受阻**（GUI）；且当前 UI 状态为会话内存（DESKTOP_SHELL 已知限制），storage 接线属 D12——本项需 D12 后在安装版复核 | — | ⛔ 受阻+依赖 D12 |
| D11-9 | 覆盖升级 | **受阻**（需运行安装器两次） | — | ⛔ 待干净机 |
| D11-10 | 卸载 | **受阻**（同上）；NSIS 配置已固定策略：程序文件/快捷方式移除、`deleteAppDataOnUninstall: false` 保留 `%APPDATA%\DeepSeekBot` | — | ⛔ 待干净机 |
| D11-11 | 版本一致 | package.json `0.1.0` = 安装器元数据 `0.1.0` = UI `getAppInfo()`（读 package.json）；主 exe 资源例外已记录（P2-1） | — | ✅ |
| D11-12 | 哈希/清单 | `SHA256SUMS.txt` 对应当前候选（功能提交树）；CI 每次构建重新生成。**注意**：若候选变更必须重建并更新哈希（RELEASE §3） | — | ✅（随候选） |
| D11-13 | 许可证 | `docs/THIRD_PARTY_NOTICES.md` 经 `extraResources` 随包，构建后实测位于 `win-unpacked/resources/THIRD_PARTY_NOTICES.md`（安装后 `<安装目录>\resources\` 同位置可见） | — | ✅ |
| D11-14 | 产品 CI | `package.yml` 已提交（手动/tag 触发，windows-latest + Node 24 + Corepack，`pnpm --filter @deepseek-bot/desktop pack:win`，SHA-256 生成，artifact 上传 `if-no-files-found: error`）。**run 待触发**：本机无 gh CLI，推送后由 Owner 在 Actions 页手动 dispatch 首跑 | — | ◐ 配置就绪 / run 待 Owner |
| D11-15 | 签名状态 | 未签名；本报告与发布说明草稿均明确标注 unsigned + SmartScreen 提示；`signAndEditExecutable: false` 保持 | — | ✅ |
| D11-16 | 文档 | RELEASE / DESKTOP_SHELL / 本报告一致 | — | ✅ |

## 3. 构建环境注意事项（非代码问题，已复现三次任务）

1. **TMP 目录**：默认 `D:\AppCaches\Temp` 使 esbuild 清理临时副本报 `Access is denied`（D07/D09/D11 三次复现）。解决：`set TMP/TEMP` 指向项目内可写目录后构建通过。
2. **Electron 下载缓存**：默认 `%LOCALAPPDATA%\electron\Cache` 拒绝写入（`open ...\009001399.zip: Access is denied`）。解决：`set ELECTRON_CACHE` 指向已有缓存（handoff/electron-cache，含 electron-v38.2.1-win32-x64.zip）。CI runner 无此问题。

## 4. 阻塞报告：安装/启动/升级/卸载试验无法在本执行环境完成（§10 格式）

**现象**：
1. 运行安装器 `DeepSeek Bot-0.1.0-x64.exe /S` 被本机策略拒绝：`已被组织的 Device Guard 策略阻止`；
2. unpacked 版 `DeepSeek Bot.exe` 能被启动调用但立即退出，`exit code 0x80000003`——与 D07 报告 §3 记录的"本执行环境无法拉起 Electron"完全一致（GUI 进程需要交互桌面会话；本会话为非交互执行环境，无桌面访问权。同机交互会话中 D01 的 Harness Electron 应用正常运行，证明机器本身无碍）。

**证据**：安装器拒绝文案原文；`Start-Process -PassThru` 返回 `HasExited=True, ExitCode=-2147483645`（0x80000003）。

**已尝试**：静默安装（/S）；unpacked exe 直启（Device Guard 之外绕过安装器）；PowerShell Start-Process 带错误捕获；检查数据根与已安装状态（均干净）。

**候选方案（需 Owner 决定）**：
1. **Owner 在本机交互桌面会话执行 §5 试验清单**（最快：包已构建好，按用户安装无需管理员；SmartScreen 提示"仍要运行"即可）；
2. **Owner 提供干净 Windows 11 x64 VM**（满足任务书 §5 原义与 QA-13；无 Node/pnpm/Git 环境）；
3. **降低验收口径**：接受"包内容静态验证 + CI 构建通过"作为 D11 首轮结论，把 D11-5/7/8/9/10 显式列为未验证项随 PR 记录——不推荐单独使用，发布门槛（RELEASE §3）仍要求端到端。

**需要 Owner 决定**：选择哪个方案补齐 §5 试验；以及 D11-8 是否显式标注为"依赖 D12 storage 接线后复核"。

## 5. 已知问题

- **P2-1**：unpacked 主 exe（`DeepSeek Bot.exe`）的版本资源为 Electron 默认元数据——`signAndEditExecutable: false`（未签名状态下的任务书设计）不编辑 exe 资源。安装器 exe 元数据正确。如需主 exe 元数据正确，需 Owner 批准改 `signAndEditExecutable: true`（rcedit 不等于签名）或后续签名时一并处理。
- **P2-2**：`@deepseek-bot/contracts` 整包（含 src、fixtures、test 文件）被打入 asar——它是 package.json 运行时依赖（pnpm workspace），体积小（~0.2 MiB）无功能影响；如需瘦身可改为只引构建产物，属优化项非本任务范围。
- **P2-3**：D11-8"重启持久化"当前 UI 无法满足（会话内存态），需 D12 把 storage 接入桌面应用后复核；本任务交付的是数据目录层面的保留策略（NSIS 配置 + 数据根路径文档化）。

## 6. 未验证项（不冒充完成）

干净机安装/启动（D11-5）、安装版运行时无 dev 依赖行为（D11-6 运行时半）、安装版基本功能（D11-7）、重启持久化（D11-8，且依赖 D12）、覆盖升级（D11-9）、卸载与数据保留实测（D11-10）、CI run 实际运行（D11-14 配置就绪待首跑）、真实 API（D12）、签名、自动更新。

## 7. 发布说明草稿（Release notes draft）

> **DeepSeek Bot 0.1.0（unsigned）**
>
> - Windows x64 按用户安装包；无需管理员权限，不写系统级位置（HKLM/服务）。
> - 安装包与主程序**未签名**：首次运行 SmartScreen 会提示"Windows 已保护你的电脑"，选择"更多信息 → 仍要运行"；SHA-256 见 SHA256SUMS.txt，与下载文件核对。
> - 用户数据（数据库、Harness home、产物、备份、凭据密文）位于 `%APPDATA%\DeepSeekBot`；**卸载默认保留**该目录，手动清理请删除它。降级不保证数据向后兼容，降级前先备份（应用内 data.backup 或复制该目录）。
> - 覆盖安装可升级，不删除用户数据。当前版本 UI 状态为会话内存，桌面持久化接线在后续版本交付。
> - 第三方许可（OpenMoji CC BY-SA 4.0 等）见安装目录 `resources\THIRD_PARTY_NOTICES.md`。
> - 无自动更新；新版本请覆盖安装。

## 8. 提交与 PR

- 功能提交：`feat(desktop): add nsis installer, product packaging ci and shipping notices`
- 文档提交：`docs: record d11 packaging delivery and blocked install trial`
- PR：base=`develop`，head=`feature/desktop-packaging`，**Draft**；不合并、不推 develop/main。
- CI 首跑：PR 推送后由 Owner 在 Actions → Package → Run workflow 手动触发（本机无 gh CLI）。

## 9. 负责人自审记录

（由负责人 Destinyian 在合并前填写：自审人、提交 SHA、日期、差异检查结果、测试证据、遗留问题、结论。§4 阻塞报告的处置决定一并记录。）
