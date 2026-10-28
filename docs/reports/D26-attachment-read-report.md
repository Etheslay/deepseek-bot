# D26 附件理解闭环实现报告（GAP_AUDIT G8）

日期：2026-10-28。分支：`feature/attachment-read-closure`（基线 `origin/develop` = `907b272`）。负责人：Destinyian（桌面）/ Etheslay（Host）；AI 辅助实现，**自审栏留空待负责人本人签署**。

## 1. 任务与范围

闭合 [D26 报告](D26-report.md) §5 的验收缺口与 [GAP_AUDIT](../GAP_AUDIT.md) G8：附件字节此前只存在于渲染层（D30 重写后甚至只剩展示卡片，内容从未进入对话）。本轮交付：

| 层 | 内容 |
| --- | --- |
| 契约 | 新增受信桌面方法 `attachment.begin` / `attachment.append` / `attachment.commit`（`packages/contracts/src/methods.ts`，协议仍为 0.7，遵循 eventRule.* 增方法的先例）；导出 `MAX_ATTACHMENT_BYTES`（2 MiB）与 `MAX_ATTACHMENT_CHUNK_BYTES`（512 KiB）。方法白名单 105 → 108 |
| Host | `packages/host/src/attachments.ts`：分片暂存（数据根 `cache/attachments-staging/<uploadId>.part`，启动清扫、失败即删、shutdown 清空）→ commit 校验 size+sha256 后原子移入 bot 工作区 `attachments/`（重名 `-1`/`-2` 后缀）；同模块提供 `readWorkspaceFileText` 读取器（realpath 夹紧、拒绝隐藏项/目录/二进制/NUL/非法 UTF-8/超 768 KiB，不截断）。`handlers.ts` 注册三个方法；`host.ts` 装配 store 与工具；shutdown 清扫 |
| 工具网关 | `packages/agent-tools/src/workspace-file.ts`：`read_workspace_file`（严格 `{path}` 相对路径 schema）；Host 侧 `agent-permissions.ts` 能力映射 `read_workspace_file → fs.read`（默认 ask，D08/D16 三档策略与审计照常）；`app-tool-channel.ts` 与 `harness-bridge/src/app-tools.ts` 的 APPLICATION 清单同步 +1（每轮就绪握手两侧一致） |
| 桌面 | `host-service.attachments.upload`：渲染层一次读入字节 → begin → 512 KiB base64 分片 append → commit，Host 校验后返回 `{path, size, checksum}`；`App.tsx` 发送路径改为先上传后开会话轮：文本 ≤ 16 KiB 内联注入（fence 安全 + 工作区路径标注），超限文本/图片/二进制按路径与说明写入消息；附件卡片显示“已存工作区 <路径>”；上传失败中止发送并保留草稿与附件 chips。i18n 新增 3 条 zh/en 文案（`attachmentUploadFailed` / `attachmentStoredPath`） |
| 文档 | [CONTRACTS](../CONTRACTS.md) §3 attachment 行 + 引言注记、[BOT_WORKSPACE](../BOT_WORKSPACE.md) 附件节、[SPRINTS](../SPRINTS.md) §4 D26 行、contracts README 计数修正（80 → 108，旧值早已过时） |

安全不变量：模型不选择路径（上传路径由 Host 生成、读取路径夹紧工作区）；上传是用户动作不经模型；bot 读取走 fs.read 授权与审计；1 MiB envelope 不被单个分片突破。

## 2. 测试与验证（本机实测，Node v24 / pnpm 11）

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | exit 0（附件名控制字符正则按既有惯例加 no-control-regex 豁免注释） |
| `pnpm -r typecheck` | 全部 11 包通过 |
| contracts 全量 | 135 通过（新增 attachment.* 解析用例 2 例；顺带修复 develop 上 `toHaveLength` 未随 PR #101 的 `chat.status` 更新的既有失败：104 → 105 → 现 108） |
| agent-tools 全量 | 127 通过（含新 workspace-file 3 例） |
| host 全量 | 209 通过 + 1 跳过（新 attachments 8 例：上传闭环、重名去重、分片超限清理、sha256 不符拒绝、路径段/未知/归档 bot 拒绝、fs.read 放行后的网关读取、越界/隐藏/二进制/超限拒绝、无 bot 身份拒绝） |
| desktop 全量 | 493 通过（新增 compose/bytesToBase64 6 例 + host-service 分片上传 2 例） |
| storage 全量 | layout.test 的 “Windows APPDATA” 1 例失败——**stash 对照在基线同样失败**，本机环境差异，非本次引入 |
| exec-daemon / host screen-distribution | OCR 资源构建套件因 esbuild 写 `D:\AppCaches\Temp` “Access is denied” 失败——**stash 对照基线同样失败**，与 [GAP_AUDIT](../GAP_AUDIT.md) 已记录的本机沙箱环境问题同类，非本次引入 |

## 3. 未验证项

- 真实 Harness 聊天回合中的 `read_workspace_file` 调用（需真实模型 Key，G4 全链验收范围）；fs.read 默认 ask 时聊天内审批卡的端到端体验未实测。
- 真实文件选择器/拖拽的大文件手测截图未留（`docs/reports/assets/` 无 d26 新增）。
- CI（GitHub Actions）未在本分支运行。

## 4. 遗留与建议

- GAP_AUDIT 拍板 #1（RENDERER_HOST_MAPPING §4 记录）仍待负责人正式签署；本片未触碰 `ui.*`。
- 大文本附件 > 768 KiB 时工具读取拒绝（工件预算），如需更大需走 artifacts 引用方案，另行立项。
- `shell.previewUnsupported` 文案键因二进制附件可附着而不再被引用，保留未删（如需清理随下个 UI 切片）。

## 5. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
