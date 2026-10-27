# D24 收尾切片报告：备份/恢复入口与设置分区

日期：2026-10-26。任务：D24 剩余切片（负责人 Destinyian；执行 Bot 按任务书 `handoff/D24_TASK_BRIEF.md` 实施，该目录不入库）。基线 `origin/develop` @ `2d5a5e3`（PR #64 已含 D28 画布侧车），分支 `feature/settings-vault`，独立 git worktree（`D:\PersonProgram\deepseek-bot-d24`）。并行窗口正在实施选项卡片任务（App.tsx 聊天区/发送链路），本切片未触碰其功能区。

## 0. 结论

**实现完成，typecheck / lint / 全仓 9 包测试全部通过；备份列表、恢复拒绝路径、硬件加速偏好有单元与集成测试，恢复后的 Host 重启有实现与代码审查但未在打包版实机演练（见 §6），待 Owner 自审与实机验收。**

## 1. 交付内容

| 层 | 实现 |
| --- | --- |
| 桌面主进程 | 新增 `backups.ts`：只读 `<数据根>/backups/*/manifest.json` 摘要（kind/createdAt/schemaVersion/sizeBytes），损坏或外来条目跳过不炸；新增 `hardware-acceleration.ts`：偏好存 Electron userData（`hardware-acceleration.json`），`app.ready` 前同步应用 `disableHardwareAcceleration` |
| IPC 白名单 | 新通道 `backups:list`（只读 manifest）与 `app:hardwareAcceleration`（读/切换，布尔校验），走既有 `assertAllowedChannel` + sender 守卫；**零契约变更**（列表走桌面通道先例：knowledge-import、updates） |
| Host 重启 | `main/index.ts` 提取可重入 `startHost()`；`hostCall` 对 `data.restore` 成功后在返回结果前 `shutdown` 旧 client 并重新 spawn，返回 `{ restored: true, hostRestarted: true }`；恢复被拒绝时原 Host 原样保留、稳定错误透传 |
| preload | `deepseekBot.backups.list`、`deepseekBot.app.hardwareAcceleration` |
| 渲染层服务 | `DesktopService` 新增 `vault`（listBackups/createBackup/restore/describe）与 `hardwareAcceleration`；fixture 内存实现（种子备份、未知 id 拒绝）；host 实现走桥（无 backups 桥的预览环境回退空列表/内存开关，不抛错） |
| 设置界面 | 导航分区化：通用 / 电脑 / 保险库 / 用量 / 更新全部真实可用；**保险库** = Key 状态（只写不读语义）+ 备份创建/列表/恢复（确认对话框、敏感与边界提醒固定文案、失败原因原文）+ 恢复成功后 600ms 重载页面（新 Host 数据）；**用量** = `data.describe` 真实计数（数据库版本/Bot/工作流/运行记录/定时任务）+ 本次启动会话统计；**电脑** = 麦克风策略 + 硬件加速真实开关（重启生效提示）+ 通知占位（标注随 D22）；"用量与账单"更名"用量"，账单字样移除 |
| 附带修复 | `App.tsx` 主题 effect 里 `window.deepseekBot.window.setTitleBarOverlay` 未判空，无 preload 桥的环境（组件级取证页）挂载即崩；加最小守卫 |
| 文档 | `SECURITY_DATA.md` §5 增界面接线段；`DESKTOP_SHELL.md` IPC 白名单表补全（此前缺 settings/host/knowledge/updates 四行）+ 新增"Host 进程生命周期"节；`SPRINTS.md` §4 补 D28 与本切片两行 |

## 2. 设计决策

1. **备份列表不加契约方法**：`data.*` 契约只有 backup/restore/describe；列表改由桌面主进程直接读 manifest（主进程本就持有数据根路径），沿用 knowledge-import/updates 的桌面通道先例。代价是 manifest 解析逻辑在主进程复制一份最小实现（`backups.ts`），换回零契约变更。
2. **恢复重启放在 main 的 hostCall 拦截层**：渲染层拿到结果时新 Host 已就绪，调用方无需感知两段式时序；拒绝路径不重启（Handler 在替换数据库前抛错，原 Host 仍然有效）。
3. **恢复成功后 `window.location.reload()`**：等同冷启动的状态重载，localStorage 偏好（主题/账户名/强调色）保留；比逐项刷新状态诚实且无遗漏。
4. **`missingCredentialRefs` 不进契约响应**（避免扩契约）：恢复完成 toast 明确提示"可能需要重新输入 Key"，与"凭据密文不在备份内"的固定说明呼应。
5. **硬件加速偏好存 userData 而非数据根**：这是 shell 级偏好（Chromium 启动参数），不属于 storage 的数据布局；文件损坏按默认（开启）处理。

## 3. 验收清单证据

环境：Windows 11（NT 10.0.26200）x64 · Node v24.16.0 · pnpm 11.28.5 · 分支 `feature/settings-vault`（实现提交见 §7）

| # | 项 | 证据 | 结果 |
| --- | --- | --- | --- |
| D24B-1 | 分支与基线 | 自 `2d5a5e3` 新切；无并行窗口改动混入（git status 仅本任务文件） | ✅ |
| D24B-2 | 静态检查 | `pnpm run typecheck` / `pnpm run lint` exit 0；`pnpm -r --if-present run test` 9 包全过（desktop **33 文件 / 269 用例**） | ✅ |
| D24B-3 | IPC 通道 | `ipc-registry.test.ts` 新增断言：`backups:list`、`app:hardwareAcceleration` 注册且守卫通过 | ✅ |
| D24B-4 | 备份创建 | `host-service.test.ts`：路由 `data.backup` → 真实方法名与载荷 | ✅ |
| D24B-5 | 备份列表 | `tests/main/backups.test.ts` 3 例：真实临时目录、最新优先、损坏/外来/散文件跳过、目录缺失空列表 | ✅ |
| D24B-6 | 恢复确认 | App.tsx 恢复前 `window.confirm`（含暂存/重载/Key 提示文案） | ✅（代码级） |
| D24B-7 | 恢复拒绝 | `host-service.test.ts`：稳定错误码（INVALID_INPUT 等）透传为 ServiceError | ✅ |
| D24B-8 | Host 重启 | `startHost/restartHost` 实现于 main（§1）；**未在打包版实机演练**（Electron 本会话无法启动），标 UNVERIFIED | ⚠️ 代码级 |
| D24B-9 | 凭据重输 | 恢复完成 toast + 保险库固定说明（契约不返回 missingCredentialRefs，见 §2.4） | ✅（提示级） |
| D24B-10 | 保险库分区 | 截图 `docs/reports/assets/d24-data/d24-vault-dark.png` / `-light.png`：Key 状态、敏感提醒、备份行（schema/体积）、恢复按钮 | ✅ |
| D24B-11 | 用量分区 | 截图 `d24-usage-dark.png`：describe 真实计数（数据库版本 11 / Bot 2 / …）；无"账单"残留 | ✅ |
| D24B-12 | 电脑/更新分区 | 截图 `d24-computer-dark.png`：硬件加速真实开关（切换→重启生效 toast）+ 通知标注 D22；更新导航已启用 | ✅ |
| D24B-13 | 文档同步 | §1 文档行 | ✅ |
| D24B-14 | 手测截图 | `docs/reports/assets/d24-data/` 4 张（组件级取证，挂载完整 App + 夹具服务；非打包版实机） | ✅* |
| D24B-15 | 报告 | 本文件 | ✅ |

## 4. 检查命令与关键输出

| 命令 | 结果 |
| --- | --- |
| `pnpm run typecheck` | exit 0（9 包） |
| `pnpm run lint` | exit 0 |
| `pnpm -r --if-present run test` | exit 0；desktop 33 文件 / 269 用例（新增：backups.test 3 例、fixture vault 3 例、host-service vault 4 例、ipc 白名单 1 例）；storage/host/contracts 等全部通过（本任务未改其源码） |
| 无头截图 | Edge headless 挂载完整 App（ServiceProvider + 夹具）× 4 张 |

## 5. 未验证 / 已知限制

- **恢复 → Host 重启 → 页面重载的实机闭环未演练**：本会话 Electron 无法启动（`STATUS_INVALID_IMAGE_HASH`，机器限制已在 B-AVATAR-02 §9 记录）。实现有单测覆盖的只有错误透传与载荷形状；时序行为（旧 client 停机期间并发调用快速失败）依赖代码审查。
- **`keyConfigured()` 在重载后显示"未配置"**：host-service 的该标志是会话内存态（既有行为，非本切片引入）；真实配置状态以「通用 → 接入」的输入框占位与测试连接为准。列为已知限制。
- **打包版安装/更新链路**：仍依赖首个 GitHub Release，D24 原报告的该项缺口未收口（不在本切片范围）。
- CI 结果本机无 `gh` 未读，push 后在 GitHub 页面确认。

## 6. 回退

单分支提交组，无迁移、无依赖变化、零契约变更：`git revert` 本分支提交即可；新增的 userData 偏好文件即使残留也无害（读取失败按默认开启处理）。

## 7. 提交与 PR 摘要

**提交**：`feat(desktop): ...`（主进程 backups/hardware-acceleration/Host 重启 + preload + 白名单）；`feat(desktop): ...`（渲染层 vault 服务与设置分区）；`test(desktop): ...`；`docs: ...`（SECURITY_DATA/DESKTOP_SHELL/SPRINTS）；`docs: add the D24-data report`。最终 SHA 见 git log。

**PR 描述**：

- **Title**：feat(desktop): backup/restore vault entry and settings sections (D24 leftover)
- **Summary**：设置页导航分区化并全部真实可用——保险库（备份创建/列表/恢复 + 敏感提醒，恢复后主进程重启 Host 并重载）、用量（data.describe 真实计数）、电脑（硬件加速真实开关，userData 偏好、重启生效）、更新（导航启用）。备份列表走桌面只读通道 `backups:list`，零契约变更。
- **Test plan**：typecheck / lint / 全仓测试全绿；backups.test（真实临时目录）+ ipc 白名单 + fixture/host-service vault 用例；无头截图 4 张入 `docs/reports/assets/d24-data/`。
- **Risk**：Host 重启时序未实机演练（UNVERIFIED）；`keyConfigured()` 会话内存态限制既有。
- **Rollback**：revert 提交组，无迁移。

## 8. 自审记录（模板 · 须由负责人本人填写）

- 提交 SHA：
- 自审覆盖范围（代码 / 测试 / 错误路径 / 兼容性）：
- 检查命令与关键输出：
- 新增 IPC 通道（backups:list / app:hardwareAcceleration）审查确认：
- 结论（PASS / PASS-WITH-FIXES / FAIL）：
- 负责人签字与日期：

> AI 不填写本节，也不代表负责人结论。
