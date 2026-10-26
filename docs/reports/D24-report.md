# D24 设置补全与应用内更新实现报告

日期：2026-10-25。任务：D24 `feature/settings-updates`（负责人 Destinyian）。提交 `2452c05`（分支 head）以 merge commit `0f20970` 合入 `develop`。依赖 D04、D11、D22（D22 未开始，本任务不依赖其交付项）。

> **补记说明**：合入时未写报告、PR 自审记录未填（清单仅勾选 2/5）。本报告为事后补记，数值来自合入前本机对 `2452c05` 的实测。**本任务只交付部分验收项**，缺口见 §5。

## 1. 交付内容

| 领域 | 实现 |
| --- | --- |
| 偏好持久化 | [`features/settings/settings-store.ts`](../../apps/desktop/src/renderer/src/features/settings/settings-store.ts)：`PersistedSettings`（主题 / 账户名 / 强调色）+ `DEFAULT_SETTINGS`；存储键 `deepseek-bot.settings.v1`；`loadSettings` 对损坏负载与非法字段逐项回退默认值，`saveSettings` 包 try/catch（隐私模式或配额失败时偏好退化为会话内有效）；`ACCENT_PRESETS` 全部经 hex 校验 |
| 设置界面 | 强调色预设（`role="radiogroup"` + 逐项 `aria-label`）、主题切换、账户名、本地用量、硬件加速开关；强调色写入 CSS 变量 `--accent` 生效 |
| 应用内更新 | [`main/updates.ts`](../../apps/desktop/src/main/updates.ts)：electron-updater `autoUpdater`，`autoDownload = false`、`autoInstallOnAppQuit = true`；`setAppVersion` 由 `main/index.ts` 注入 `app.getVersion()` 以保持模块可测；`checkUpdates()` 返回 `UpdateStatus{available, version, downloading, readyToInstall, error}`；**无 Release 或网络失败时失败软着陆并带回原因串**，UI 显示"暂无可用更新（尚未发布 Release）"而非假装成功 |
| 版本比较 | [`shared/versions.ts`](../../apps/desktop/src/shared/versions.ts) 的 `compareVersions` 纯函数（semver-ish，容忍段数不齐） |
| IPC | 新增两条**桌面进程内**通道 `updates:check`、`updates:downloadInstall`，按既有 registry 白名单注册；`preload` 暴露 `bridge.updates` |
| 更新 UI | 左下角更新按钮：`有新版本，点击更新` / `更新下载中…` / 就绪后提示重启安装；设置页"关于与更新"分区含"检查更新" |
| 打包与发布源 | `electron-builder.yml` 增加 `publish: provider github / owner Etheslay / repo deepseek-bot`；`.github/workflows/package.yml` 一行：默认 `--publish never`，**CI 不自动发布**，首个 GitHub Release 按 RELEASE.md 由收官任务手工出 |
| 附带修复 | `6604a0d`：设置页"测试连接"按钮失败后不可重试 |

对应 [SPRINTS §7 界面占位审计](../SPRINTS.md) 中"设置 · 强调色 / 全部设置项不持久化 / 应用内更新"三项。

## 2. 过程决策（补记时整理）

- **更新源只用 GitHub Releases**：不建自有下载站与更新服务，守住 SPRINTS §9 的消费红线（唯一持续成本仍是模型 Token）。
- **发布动作与检查动作分离**：`autoDownload = false` + `--publish never`，确保装上这个版本的应用不会自行向 GitHub 发布任何东西。
- **偏好留在渲染层**：主题/账户名/强调色属界面偏好，未走 Host；这与"API Key、bot 等 Host 数据"明确分界（`settings-store.ts` 注释写明）。代价是备份/恢复与跨窗口一致性尚未打通，见 §5。

## 3. 测试与验证

| 检查 | 提交 / 环境 | 命令 | 结果 |
| --- | --- | --- | --- |
| 桌面自动化 | `2452c05` / Windows 11 x64 + Node v24.16.0 + pnpm 11.28.5 | `pnpm --dir apps/desktop exec vitest run --config vitest.config.ts` | 18 文件 / 172 用例通过，exit 0 |
| 类型与静态检查 | 同上 | `pnpm --dir apps/desktop run typecheck`；`pnpm run lint` | 均通过，exit 0 |
| 设置与更新专项 | 同上 | `tests/features/settings-updates.test.ts` | 6 用例：localStorage 往返、损坏负载回退默认、非法主题/名称/强调色拒绝、预设均为合法 hex、patch/minor/major 排序、段数不齐容错 |
| IPC 白名单 | 同上 | `tests/ipc-registry.test.ts` | 新增 7 断言覆盖两条 updates 通道 |
| 与 develop 可合并性 | `0350e40` × `2452c05` | `git merge-tree --write-tree` | 零冲突 |
| CI | — | — | 本机无 `gh` CLI，run 细节未读；GitHub 页面 checks 显示通过（负责人截图确认） |

## 4. 依赖与文档同步

- 新增运行时依赖 `electron-updater@^6.8.11`；`pnpm-lock.yaml` 随之变化（与本任务功能提交混在同一 PR，属流程偏差，见 §5）。
- 无契约方法变更、无 storage 迁移、无权限变化；`PROTOCOL_VERSION` 仍 0.2。
- **文档同步未完成**：[DESKTOP_SHELL.md](../DESKTOP_SHELL.md)、[RELEASE.md](../RELEASE.md) 均未写入应用内更新通道与"首个 Release 手工发布"的说明。

## 5. 未做项与边界（D24 验收缺口）

- **数据备份 / 恢复入口未接**：`data.*` 契约已备但渲染层未调用，Host 侧亦无对应处理器接线。
- **设置分类"电脑 / 保险库 / 用量与账单 / 更新"仍部分占位**：本任务只完成强调色、主题、账户名、本地用量、硬件加速与更新分区。
- **语言切换与通知开关**：归 D22 双语与系统集成，未在本任务范围。
- **更新链路未做打包版实测**：首个 GitHub Release 未发布，无更新源可拉；当前只有失败软着陆路径被单测覆盖，"下载 → 重启安装 → SmartScreen 提示"整条路径**未验证**。
- 手测截图未留（无 `docs/reports/assets/d24/`）。
- 流程偏差：lockfile 与 `.github/workflows/package.yml` 属协作区文件，按 [开发计划 §1](../DEVELOPMENT_PLAN.md) 应先走小型独立 PR；本任务与 D14/D25/D26 挤在同一串行分支合入。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：`2452c05b2a63c38e6f49f6846c9d6c7b3f2208f6`　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
