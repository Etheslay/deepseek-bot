# G11' 工作流本地模板库与模板策略不可信

日期：2026-10-28（Asia/Shanghai）。任务来源：[GAP_AUDIT](../GAP_AUDIT.md) §4 G11'——D17 技能注入与能力强制已由 PR #115 交付，[D17 技能注入报告](D17-skill-injection-report.md)原话"工作流模板仍未做"。分支：`feature/g11-workflow-template-library`，从 `origin/develop` 的 `94bc05d`（PR #118 合入后）创建。本文由实现辅助写成，不代表负责人真人自审或合并结论；自审必须针对该分支最新提交 SHA。

## 1. 交付行为

渲染层新增**本地工作流模板库**（与 bot 模板库、技能库同一渲染层暂存层，localStorage；Host 侧持久化等待 Renderer→Host 拍板 #1，不新增 Host 表）：

- `features/workflow-editor/template/workflow-templates.ts`：存/列/删。上限 30 条、同名拒绝；**存入前以冻结的 `WorkflowDraftSchema` 归一化**——契约非法的草稿拒绝入架（校验照走），节点对象里的未知字段（如走私的 `toolPolicyId`、`permissions`、`allowedTools`）在入架时即被剥离；读取时逐条重过 schema，未来 schemaVersion 或手改坏行静默丢弃（fail-closed），corrupt payload 不致命。
- 编辑器工具栏新增「存为模板」「模板库」；模板库对话框（`template-io.tsx` 内 `TemplateLibraryDialog`）：**应用**＝载入画布为未保存草稿（与既有 workflow.import 的"载入为草稿"同一 inert 语义，不继承 id/revision，绝不冒充既有工作流身份）、**删除**、空态提示。
- 落库路径不变：应用模板后仍由用户经编辑器保存走 `workflow.save`（服务端 `validateWorkflowDraft` + `WorkflowSchema.parse` 再次校验/归一化）；JSON 文件导入导出维持既有契约校验（本片未动 `workflow.import`/`workflow.export`）。
- i18n：`messages/workflow.ts` 新增 10 个 zh/en 键（`workflow.saveAsTemplate`、`templateApply`、`templateDelete`、`templateDuplicateName`、`templateLibrary`、`templateLibraryEmpty`、`templateNodeCount`、`templateSaved`、`templateSaveInvalid`、`templateSaveLimit`）；无新增未翻译串。

**安全属性（G11' 验收项）**：工作流节点在契约层没有策略字段——模板/草稿里夹带的策略与授权字段在契约解析（方法入参）与保存解析（`saveWorkflow` 的 `WorkflowSchema.parse`）两处都会被剥离；节点运行期工具授权只取决于所引用 bot 的**现行** `toolPolicyId`（bot.update 换策略后下一轮即生效）。本片新增渲染层与 Host 两层用例把该属性钉住：

- 渲染层：`tests/features/workflow-templates.test.ts` —— "strips policy fields smuggled into node objects"：带 `toolPolicyId`/`permissions`/`allowedTools` 的节点入架后三者皆不存在。
- Host：`packages/host/src/host.test.ts` —— "strips smuggled policy fields from workflow templates (G11' acceptance)"：同一走私节点分别经 `workflow.import` 与 `workflow.save` 落库，`workflow.export`/保存响应中的节点均无三个字段，且 bot 自身 `toolPolicyId` 未被触碰。

## 2. 实际检查

环境：Windows、Node v24、pnpm 11（本机）。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --filter @deepseek-bot/desktop exec vitest run tests/features/workflow-templates.test.ts` | 7 通过 |
| `pnpm --filter @deepseek-bot/host exec vitest run src/host.test.ts` | 9 通过（8 项既有 + 新增 G11' 验收用例） |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0（10 个工作区包全绿） |
| `pnpm --filter @deepseek-bot/desktop test`（全量） | 退出 0，62 个测试文件全过（61 既有 + 新增 workflow-templates，含 i18n-scan 未翻译串扫描） |
| 其余包（contracts/shared/storage/agent-tools/runtime/harness-adapter/harness-bridge/exec-daemon） | 本分支未触及；同基线（`94bc05d`）证据见 [G9' 报告](G9-update-channel-docs-report.md) §3：全绿，仅 exec-daemon 2 项本机环境失败（基线同样失败） |

## 3. 未验证边界

- 未打开 Electron 手测模板库界面（存为模板/应用/删除的真实交互、渲染样式），无截图；UI 行为由 store 单测与 hook 逻辑覆盖，`saveAsTemplate`/`applyTemplate` 未有组件级测试。
- localStorage 键为新增 `deepseek-bot.workflow-templates.v1`，与 bot 模板（`deepseek-bot.bot-templates.v1`）和技能库键不冲突（grep 核实）；跨设备迁移、备份恢复不覆盖 localStorage（与 bot 模板/技能库同边界，等待拍板 #1 的统一持久化）。
- 环境性测试失败（exec-daemon 2、host screen-distribution 1、desktop build 的 esbuild 临时目录 `Access is denied`，windows.real 的真实窗口授权）与本片无关，未改动 develop 基线同样失败，详见 [G9' 报告](G9-update-channel-docs-report.md) §3 的基线对照。
- 模板内 `instructionTemplate` 是提示词文本：恶意指令属内容风险，不属于本项工具策略验收范围（指令执行仍走 bot 的 D08 策略与网关）。

## 4. 负责人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与证据：＿＿＿＿
- [ ] 未验证边界与结论：＿＿＿＿
