# D26 聊天附件实现报告

日期：2026-10-25。任务：D26 `feature/chat-attachments`（负责人 Destinyian）。提交 `4895e68` 落在 B 线串行分支上，经 `feature/settings-updates`（head `2452c05`）以 merge commit `0f20970` 合入 `develop`。依赖 D08、D15。

> **补记说明**：合入时未写报告、PR 自审记录未填（清单仅勾选 2/5）。本报告为事后补记。**本任务只交付了渲染层切片，按 [开发计划 §6](../DEVELOPMENT_PLAN.md) 的 D26 验收定义不计完成**，缺口见 §5。

## 1. 交付内容

| 文件 | 内容 |
| --- | --- |
| [`features/chat/attachments.ts`](../../apps/desktop/src/renderer/src/features/chat/attachments.ts) | `classifyAttachment(mime, name)` 按 MIME 与扩展名归为 `text` / `image` / `binary`；`MAX_ATTACHMENT_BYTES = 2 MiB` 上限；`MAX_TEXT_CONTEXT_CHARS = 4000` 文本上下文上限；`buildAttachmentContext(draft)` 生成**有界且 fence 安全**的上下文块，把文件内容作为数据（而非指令）呈现给模型；`formatAttachmentSize` 人类可读体积；`attachmentAccept` 生成输入框 accept 列表 |
| `App.tsx`、`styles.css` | ＋ 菜单与拖拽两条入口选文件、附件卡片呈现（类型图标 + 名称 + 体积）、文本附件内容回读进对话上下文 |

对应 [SPRINTS §7 界面占位审计](../SPRINTS.md) 中"聊天 · ＋ 菜单添加附件 · 点击仅提示占位 → D26"一项。

## 2. 过程决策（补记时整理）

- 上下文块用围栏包裹并做长度截断，避免附件内容里的三反引号提前闭合围栏、或超长文件挤爆会话。
- 未引入任何上传通道：文件只在渲染层读取，不写盘、不进工作区。这是本任务**未达验收**的直接原因，而非设计选择——见 §5。

## 3. 测试与验证

| 检查 | 提交 / 环境 | 命令 | 结果 |
| --- | --- | --- | --- |
| 桌面自动化 | `2452c05` / Windows 11 x64 + Node v24.16.0 + pnpm 11.28.5 | `pnpm --dir apps/desktop exec vitest run --config vitest.config.ts` | 18 文件 / 172 用例通过，exit 0 |
| 类型与静态检查 | 同上 | `pnpm --dir apps/desktop run typecheck`；`pnpm run lint` | 均通过，exit 0 |
| 附件专项用例 | 同上 | `tests/features/attachments.test.ts` | 5 用例：MIME 与扩展名分类、体积格式化、有界且 fence 安全的上下文块、超长文本截断、accept 列表覆盖文本与图片 |
| CI | — | — | 本机无 `gh` CLI，run 细节未读；GitHub 页面 checks 显示通过（负责人截图确认） |

## 4. 依赖与文档同步

- 无新增依赖；无契约、storage、host、agent-tools 改动；无迁移、无权限变化。
- **文档同步未完成**：[BOT_WORKSPACE.md](../BOT_WORKSPACE.md) 未写入附件入口与限制说明。

## 5. 未做项与边界（D26 验收缺口）

| 验收要求（开发计划 §6 D26） | 状态 |
| --- | --- |
| 文件/图片**经工具网关**进入 bot 工作区 | **未做**：未触碰 `packages/agent-tools`、`packages/host`、`packages/storage`，附件内容仅在渲染层拼进消息上下文 |
| 受 grant 与审批约束 | **未做**：无 grant 检查点接入；且 D15 写层当前仍是 default-allow 桩（见 [D15-report §5](D15-report.md)），需 D16 三层模型落地 |
| 附件卡片与产物预览打通 | **未做**：卡片已交付，产物侧打通未实现 |
| bot 经 read 工具真正读取附件内容并回答 | **部分**：文本内容会作为上下文交给模型，但未经网关的 read 工具路径，图片与二进制未接 |

另：真实 Host 端到端未执行；手测截图未留（无 `docs/reports/assets/d26/`）；2 MiB 上限与 accept 列表未在真实文件选择器下手工验证。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：`4895e68`（合入 head `2452c05`）　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
