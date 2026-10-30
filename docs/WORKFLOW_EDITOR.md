# 工作流编辑器（D07）

`apps/desktop` 的工作流编辑器（FR-04）：新建 / 编辑 / 保存 / 复制工作流，`bot` / `approval` 节点与连线的可视化编辑，保存前用官方契约校验器校验并**定位到节点与字段**，模板导入导出先验 `schemaVersion`。**校验器、schema、错误码全部来自 `@deepseek-bot/contracts`（D03），不自创契约；原始实现保存/复制为夹具内存态。2026-10-30 起桌面 `host-service` 已把 `workflows` 切到真实 Host（`workflow.list/get/validate/save/export`，见 [RENDERER_HOST_MAPPING](RENDERER_HOST_MAPPING.md) §6），夹具实现保留用于离线 UI 开发。执行（D06）、调度（D10）、运行监控与审批执行（D09）不在本任务内。**

入口：桌面壳头部「工作流编辑器」图标（见 [桌面壳](DESKTOP_SHELL.md)），主区切换为编辑器视图。

## 服务层（沿用 D05 注入模式）

```text
src/renderer/src/features/workflow-editor/
  workflow-service.ts      WorkflowServiceApi 接口 + FixtureWorkflowService（内存态，无持久化）
  workflow-reducer.ts      纯状态变换（加/删节点、连线、选中、复制重映射），可单测，无 React
  use-workflow-editor.ts   控制器 hook：状态 + 服务调用 + 校验定位
  workflow-editor.tsx      根组件（工具栏 / 冲突横幅 / 布局 / 弹窗接线）
  canvas/                  画布（节点卡片 + SVG 连线 + 端口拖拽/C 键盘连线 + 删除）
  inspector/               参数检查器（bot / approval / 边 / 工作流四级表单）
  validation/              校验面板 + 问题定位映射（issues.ts）
  template/                模板导入导出弹窗（粘贴/本地文件；不接远程 URL）
```

- `DesktopService` 接口扩展 `workflows: WorkflowServiceApi`：夹具服务由 `createFixtureService()` 组合，`host-service.ts` 用 `createHostWorkflowService()` 覆盖；组件经 `useService()` 使用，接口不变。
- `list / get / save / copy / validate / exportTemplate / importTemplate` 与 `workflow.*` 方法契约一一对应；所有出参经 `WorkflowSchema` 校验，非法输入抛 `ServiceError`（稳定错误码）。
- **不新增 IPC**：编辑器全部运行在 renderer，走 D05 服务注入；preload/IPC 白名单未变。
- 夹具种子：1 个合法工作流 `sample-review-flow`（Bot A → 审批，复用 D03 共享测试 UUID）；图校验场景（环 / 缺失绑定 / 版本拒绝）由 `packages/contracts/fixtures` 的对应夹具驱动测试。

## 编辑能力

- 节点仅 `bot` / `approval`：左侧面板点击或拖入画布；拖动移动；选中高亮；Delete 删除（删节点同时清理其连线；最后一个节点不可删，维持 nodes ≥ 1 的 schema 约束）。
- 连线：输出端口拖到输入端口，或键盘 `C`（源节点按 C → 目标节点按 C，Esc 取消）；弹窗填写 `outputKey` / `inputKey`；连线可选中、可改键、可删除。
- 检查器按选择切换：bot 节点（机器人 / 指令模板 / 输入绑定 / 超时 1–86400 可空 / 重试 0–2）、approval 节点（**不显示也不允许携带 botId**）、连线（两端 + 两个键）、工作流级（名称、`limits.maxConcurrentNodes` 1–8 默认 2，仅编辑不执行期强制）。
- 机器人选择：读取 D05 机器人列表，**归档机器人不可选**；已选机器人被归档后以「（已归档）」显示且保存被阻止。
- 指令模板只做变量提示（`{{inputKey}}` 列表），**不执行模板**。

## 校验与定位（FR-04 / QA 红线）

- 实时校验 = `WorkflowDraftSchema` 解析 + `validateWorkflowDraft`（官方图校验器）+ 编辑器级规则（归档/未知机器人、重复绑定键）；「校验」按钮额外走一次服务端 `validate`。
- 环 → `WORKFLOW_CYCLE`（nodeId 指向环上节点，field=edges）；悬空边/缺失绑定 → `MISSING_BINDING`（定位节点与 `inputBindings.<key>`）；重复节点/边与 schema 违规 → `INVALID_INPUT`（定位节点与字段）。
- 校验面板按节点分组展示 code/message/nodeId/field；点击问题：选中并滚动到对应节点、聚焦到检查器对应字段。
- 有错误时「保存」禁用并显示错误数；不允许清空 errors 假装保存成功（服务层会再次校验拒绝）。

## 保存 / 复制 / 新建 / 冲突

- 保存：先本地校验，再 `workflows.save(draft, expectedRevision)`；新草稿不带 id，编辑带 `expectedRevision`。
- 冲突：`REVISION_CONFLICT` → 横幅提示「已被其他窗口修改」，提供「刷新并重试」（重载最新版本，不覆盖他人修改）。夹具服务为单窗口内存态，双窗口真冲突需 Host/持久化接入后验证（见 D07 报告未验证项）。
- 复制：新 id/revision、名称加「副本」、节点 id 重映射（`-copy` 后缀）避免重复；导入的草稿载入画布时剥离原 id/revision，保存即新建。

## 模板导入 / 导出（安全红线）

- 导出：`workflow.export` → `{ schemaVersion, workflow }` JSON，可复制或下载本地文件；节点/边/limits 完整保留。
- 导入：仅粘贴文本或本地文件（不接远程 URL）；先检查 `template.schemaVersion`，再检查 `workflow.schemaVersion`，未知更高版本 → `DATA_VERSION_UNSUPPORTED`（不进入图校验、不做静默兼容）。
- 导入先预览校验，用户确认才载入画布；**模板始终是惰性数据：不执行脚本、不渲染 HTML、不授予任何工具/目录权限**；JSON 大小上限 1 MiB（契约消息上限）。
- 恶意/非法模板的错误同样定位到节点与字段。

## 命令与测试

- 命令不变：`pnpm --filter @deepseek-bot/desktop dev / build / test`（构建需注意：若 esbuild 对系统临时目录报 Access denied，把 TMP/TEMP 指到可写目录，见 D07 报告）。
- 测试：`tests/features/workflow-reducer.test.ts`（15 例）、`tests/features/workflow-validation.test.ts`（10 例）、`tests/services/workflow-service.test.ts`（21 例），共 46 例新增；仓库惯例为纯函数/服务层测试（无 DOM 测试依赖），交互路径由构建产物取证脚本覆盖（`handoff/d07-evidence.mjs`，12 张截图 + 16 步断言）。

## 契约边界速查

| 能做（D07） | 不能声称 |
| --- | --- |
| 编辑器内校验环/悬空/缺失绑定并定位 | 执行期强制（D06 引擎职责） |
| 夹具内存态的保存/复制/冲突检测 | 持久化已实现（D04 未接线） |
| 模板导入导出 + 版本拒绝 + 惰性数据 | 模板可执行/已授权（永不执行、永不授权） |
| limits 1–8 编辑与展示 | 并发上限已被强制执行 |
| 双窗口冲突的 UI 与服务层语义 | 夹具下的真实双窗口冲突演示（需共享后端） |
