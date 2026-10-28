# D17 技能注入与能力强制

日期：2026-10-28。任务：D17 剩余切片。分支：`feature/d17-skill-injection`，从 `origin/develop` 的 `4097f17` 创建。技能定义由 Destinyian 负责，Host 注入由 Etheslay 负责。本报告由实现辅助写成，不代表负责人的真人自审或合并决定。

渲染层技能库已在 [D17-report](D17-report.md) 交付。那一截把技能正文拼进出站用户文本，`capabilities` 只是声明。本片把已保存的技能交给 Host 注入本轮，并由工具网关执行声明的能力。技能库仍在渲染层 localStorage，不等待 Renderer 与 Host 的持久化拍板。工作流模板、历史版本回退、D23、D27 语音和 Windows 真实窗口验收都不在本片。

## 1. 行为

- 绑定到当前 bot 的技能在发送时经 `chat.send` 的可选 `skills` 交给 Host。协议仍是 0.8。没有技能时不传该字段，旧发送方行为不变。
- 每项技能含名称、版本、最多 4000 字指令，以及最多 16 个不重复的能力 id。一轮最多 30 个。未知字符串（例如旧数据里的 `read`）会拦住这一轮，不静默丢掉。
- Host 把技能指令写成有界、围栏安全的提示块，放在 bot 指令之后、历史和用户消息之前。合计超过 4000 字时截断并标明。用户聊天记录只保存用户原文，气泡也不带技能正文。
- 所有已声明能力 id 的并集是本轮网关允许集。工具消耗的能力必须全部落在其中，否则在授权检查之前以 `UNAUTHORIZED_PATH` 拒绝，并且不创建审批。已声明的能力仍走既有策略、grant 与审批；声明不会授予能力。没有声明任何能力的技能只注入指令，不收窄工具。
- `chat.attach` 与 `tool.invoke` 不带这份额外允许集。附件导入仍只受 `fs.write` 的既有授权约束。
- 作曲栏里另一套 `skill-store` 仍是把提示词贴进草稿。它和技能库共用 localStorage 键，这是原有冲突，本片没有改存储。

## 2. 验证

环境：本机 Linux，Node v22.23.4，pnpm 11.28.5。仓库要求 Node ≥ 24。下列命令在本片实现上通过，exit 0。没有调用付费 API。

| 命令 | 结果 |
| --- | --- |
| `pnpm --dir packages/contracts exec vitest run src/chat-skill.test.ts --coverage.enabled=false` | 3 通过 |
| `pnpm --dir packages/agent-tools exec vitest run src/gateway.test.ts --coverage.enabled=false` | 18 通过 |
| `pnpm --dir packages/host exec vitest run src/skill-injection.test.ts src/chat.test.ts --coverage.enabled=false` | 17 通过 |
| `pnpm --dir packages/host exec vitest run src/agent-permissions.test.ts src/app-tool-channel.test.ts --coverage.enabled=false` | 33 通过 |
| `pnpm --dir apps/desktop exec vitest run tests/features/skills.test.ts tests/services/host-service.test.ts tests/features/stream-runner.test.ts tests/i18n-scan.test.ts --coverage.enabled=false` | 48 通过 |
| `tsc --noEmit`：contracts、agent-tools、host、desktop（node 与 web） | 通过 |
| `pnpm lint` | 通过 |

Host 用例覆盖：技能正文出现在给模型的提示里，用户历史行仍是原文；`read` 这种非能力 id 拒绝且不写聊天记录；只声明 `app.read` 时 `create_group` 在审批前被拒绝；声明 `app.create_group` 后仍要一次审批才会建组。

## 3. 未验证

- 没有跑完整的 `pnpm test` 或 GitHub Actions。CI 在 `windows-latest` 与 Node 24 上跑 lint、typecheck 和全量测试，本机没有复现那一环境。
- 没有打开 Electron，没有手测设置页、技能勾选或发送。没有截图。
- 没有用真实模型确认它会遵守注入的指令。
- 夹具聊天不把技能交给 Host，也不执行能力限制。
- 工作流运行没有这条注入路径。定时或无人值守的运行看不到渲染层 localStorage。
- Harness 自带、不经过应用工具通道的工具仍走原有的失败关闭路径，不由技能允许集打开。

## 4. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
