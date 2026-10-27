# D21 桌面设置页：指定窗口截图与本机预览

日期：2026-10-27（Asia/Shanghai）。负责人：Etheslay。分支：`feature/screen-desktop-settings-48af`。基线：`a0d5f482e7a2174f4a5870c1cefd75eb831b0125`（`origin/develop`，已含 PR #77 Host 网关、PR #74 Windows 采集/离线 OCR、PR #70 契约）。本文记录本分支的桌面实现和这次实际跑过的检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。

## 1. 交付行为

设置里「电脑与权限」下面增加「屏幕与窗口感知」。它调用 develop 上已经存在的受信方法，没有改 Host 网关或 exec-daemon。

- 选择一个未归档的 bot。换 bot 会卸掉上一块面板，上一块里还没回来的读取或采集不能写进新 bot。
- 开关只调用 `permission.policy.set`，把 `screen.capture` 写成 `ask` 或 `deny`。不提供始终允许，也不提供本会话或永久授权。
- 刷新调用 `screen.windows.list`。选定或清除调用 `screen.target.set`。窗口标题按文本显示。
- 「截图」调用 `screen.request`，`mode` 为 `image`；「截图并识别」为 `ocr`。进行中可以 `screen.cancel`。
- 等待时列出该 bot 里 `screen.capture` 的 pending 审批。按钮只有「仅本次」和「拒绝」，决定走 `permission.approval.decide`，scope 固定 `once`。
- 结果来自 `screen.results.list`。查看调用 `screen.result.read`。预览只接受以 `/9j/` 开头、长度不超过 360000 的 JPEG base64，用 data URL 显示。OCR 文本放在文本节点里，不写入聊天。删除要再点一次确认，然后调用 `screen.result.delete`。
- 换目标窗口会作废这次面板里尚未回来的采集和预览。`supported: false` 时仍可改策略和查看已有结果，刷新、选择和采集按钮不可用。

## 2. 实际检查

环境：Linux，Node **v22.23.4**（仓库 `engines` 要求 Node ≥ 24，本机没有 24），pnpm **11.28.5**。`node:sqlite` 在这台机器上打出 ExperimentalWarning。没有 Windows，没有打包后的 Electron，没有点开真实窗口。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0。含 desktop 的 node/web 与 host |
| `pnpm --filter @deepseek-bot/desktop exec vitest run --config vitest.config.ts tests/features/screen-settings.test.ts` | 退出 0。13 通过 |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0。49 个文件，453 通过 |
| `pnpm --filter @deepseek-bot/host test` | 退出 0。176 通过，1 跳过 |
| `pnpm --filter @deepseek-bot/host build` | 退出 0 |
| `pnpm --filter @deepseek-bot/desktop build` | 退出 0。`electron-vite build`，不是安装包 |
| `git diff --check` | 退出 0 |
| `pnpm test` | 退出 1。shared 6、contracts 125、harness-bridge 30、exec-daemon 27 通过（另 1 个真实 Windows 窗口测试跳过）后，storage 有 2 个失败，递归运行随之停下 |

递归运行停下之后，又单独跑了尚未出完整结果的包：

| 包 | 结果 |
| --- | --- |
| agent-tools | 123 通过 |
| runtime | 120 通过，6 跳过，2 失败 |
| harness-adapter | 57 通过，1 失败 |
| storage | 185 通过，2 失败 |
| desktop / host | 见上表，通过 |

这 5 个失败都发生在本分支没有改过的 Windows 路径或 `pnpm.cmd` 断言上，本机是 Linux：

- `packages/storage/src/layout.test.ts`：`APPDATA` 产品目录、拒绝 `C:\` 根目录。
- `packages/runtime/src/permissions-policy.test.ts`：`C:\workspaces\...` 读写授权。
- `packages/harness-adapter/src/profile-assets.test.ts`：期望命令是 `pnpm.cmd`，实际是 `pnpm`。

它们不能算作本设置页通过，也不能算作本设置页引入的失败。exec-daemon 的离线 OCR 用例在这次 Linux 运行里通过；真实 Windows 窗口用例仍是跳过。

## 3. 未验证

- 没有在 Windows 上刷新真实窗口、截图或跑 OCR。
- 没有启动打包后的 Electron，也没有在真实窗口里点击这份设置页。桌面证据是 jsdom。
- 没有跑 GitHub Actions。
- 没有做计划第 4 节里的独立 Electron 验收脚本、自建测试窗口或本地受控模型回传。
- 设备动作不在本片。
- Node 不是仓库要求的 ≥ 24。

## 4. 恢复与许可

`screen-outputs/` 仍不在元数据备份和可选 artifacts 树里。恢复备份不会带回截图、OCR 文本或窗口选择。设置页不新增第三方库；预览用的 JPEG 仍由 Host 侧既有的 jpeg-js / pngjs 生成。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
