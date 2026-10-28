# D26 附件经工具网关进入工作区

日期：2026-10-28。任务：D26 剩余切片。分支：`feature/d26-gateway-attachments`，从 `origin/develop` 的 `907b272` 创建。负责人：Destinyian。本报告由实现辅助写成，不代表负责人的真人自审或合并决定。

渲染层卡片已在 [D26-report](D26-report.md) 交付。那一截只把文本拼进上下文。本片补上开发计划 §6 的其余验收：文件和图片经工具网关进入 bot 工作区，受 grant 与审批约束，卡片可以打开产物预览，bot 用 `read` 读取工作区文件。

## 1. 行为

- 桌面把选中的文件分块调用受信方法 `chat.attach`。单文件不超过 2 MiB，每块原始字节 192 KiB，最多 16 块，以便放进 1 MiB 的消息信封。本方法不提升协议版本。合入 `origin/develop`（PR #107，stdio MCP）之后，当前协议是 0.8。
- 块齐并且校验和一致之后，Host 以 `ui:<botId>` 调用网关工具 `import_attachment`。能力是 `fs.write`，默认每次询问。审批预览只有名称、媒体类型、体积、校验和和 uploadId，没有文件正文。拒绝、校验失败或写入失败都不留文件。
- 文件写入该 bot 工作区的 `attachments/<安全文件名>`。只保留文件名，去掉目录，拒绝 `..` 和隐藏段。同名文件追加序号。
- 发给模型的文本只含工作区路径，不再附上文件正文。模型工具 `read` 绑定 `fs.read`，参数只有 `file_path`。文本返回内容，超过 32000 字符时截断。光栅图片和其它二进制只返回类型与体积，不返回像素。
- `import_attachment` 不在模型目录里。`read` 走 `/read`，并在聊天会话里盖过 harness 已有的同名工具。`tool.invoke` 没有 bot 身份，不能导入附件。
- 卡片点击打开已有的产物侧车。文本可以预览。HTML 和二进制仍按 QA-14 拦截。图片缩略图留在卡片上。
- 默认 bot 共用工作区 `55555555-5555-4555-8555-555555555555`。读授权通过后，另一个默认 bot 也能读到这个目录里的附件。本片不提供跨 bot 的文件系统隔离。
- 夹具服务把附件放进内存工作区，不模拟审批。真实审批只在 Host 路径上。

与 PR #107 合流后，方法白名单是 109 项：develop 上的 108 项，加上 `chat.attach`。测试钉与之一致。

## 2. 验证

环境：本机 Linux，Node v22.23.4，pnpm 11.28.5。仓库要求 Node ≥ 24。下列命令在未提交的实现树上通过，exit 0。没有调用付费 API。

| 命令 | 结果 |
| --- | --- |
| `pnpm --dir packages/contracts exec vitest run src/methods.test.ts --coverage.enabled=false` | 23 通过 |
| `pnpm --dir packages/agent-tools exec vitest run src/attachments.test.ts --coverage.enabled=false` | 2 通过 |
| `pnpm --dir packages/host exec vitest run src/attachments.test.ts src/app-tool-channel.test.ts --coverage.enabled=false` | 14 通过 |
| `pnpm --dir packages/harness-bridge exec vitest run src/app-tools.test.ts --coverage.enabled=false` | 20 通过 |
| `pnpm --dir apps/desktop exec vitest run tests/features/attachments.test.ts tests/i18n-scan.test.ts --coverage.enabled=false` | 10 通过 |
| `tsc --noEmit`：contracts、agent-tools、host、harness-bridge、desktop | 通过 |
| `eslint` 仅针对本片改动的 ts 文件 | 通过 |

Host 用例覆盖：拒绝审批不写盘，审批参数不含正文；允许后写入 `attachments/`，`artifacts.list` / `artifacts.read` 能看到文本；`/read/call` 返回正文；图片和二进制只回元数据；HTML 源码可被 `read` 读到，产物预览仍拦截；路径名 `../../outside.txt` 落在 `attachments/outside.txt`；校验和不符不写盘；`tool.invoke` 导入被拒绝；应用工具目录不含 `import_attachment` 或 `read`。

## 3. 未验证

- 没有跑完整的 `pnpm test`、`pnpm run lint` 或 GitHub Actions。
- 没有打开 Electron，没有手测文件选择、拖拽、审批卡片或侧车点击。没有截图。
- 没有在 Node ≥ 24 或 Windows 上重跑。
- 没有用真实模型回答附件问题。`read` 的返回值由网关测试确认，模型是否按提示去调用它没有在对话里看过。
- 技能上下文仍拼在用户文本前面。附件指针单独不超过 4000 字，但加上技能块后仍可能超过 `chat.send` 的长度限制。这是原有拼接方式，本片没有改。
- 夹具模式不弹出审批。图片和二进制在侧车里仍是现有的拦截页，不是内联预览。

## 4. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
