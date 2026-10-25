# D07 交付报告：工作流编辑器

- 任务：D07（里程碑 M2，FR-04 工作流编辑）
- 分支：`feature/workflow-editor`（base `develop`；合并后远端源分支与本地分支均已删除）
- 基线：`origin/develop` = `4cd6e4d`（2026-10-24 fetch 时点；D05 已随 PR #11 合并，D06 已随 PR #10 合并）
- 提交：功能 `68f2bba` `feat(workflow-editor): implement editor canvas, inspector, validation and template io`（16 文件，+3883）；文档 `215f743`（本报告与 WORKFLOW_EDITOR / DESKTOP_SHELL 同步）
- 合并：PR #12 已合并，merge commit `e6a8bcb`（2026-10-24 23:54 -0700，父提交 `4cd6e4d` + `215f743`）；`git diff 215f743 e6a8bcb` 为空，合并树与验收提交一致
- 负责人：Destinyian
- 环境：Windows 11 (10.0.26200) · Node v24.16.0 · pnpm v11.28.5 · Electron 38.2.1 / electron-vite 4.0.1 / vitest 3.2.4 / React 19.1.1 · zod 4.6.7（contracts）

## 0. 开工门禁记录

| 门禁项 | 结果 |
| --- | --- |
| `origin/develop` 已含 D05 | ✅ PR #11（`4cd6e4d`）；开工时 fetch 确认 |
| 从该 develop 拉分支、工作区干净 | ✅ `git switch -c feature/workflow-editor origin/develop`，除本地未跟踪材料外干净 |
| 已读契约/文档 | ✅ CONTRACTS §2/§3/§6/§7、contracts README、entities/workflow/methods、fixtures README、PRD FR-04、D05 报告 |
| D06 状态 | ⚠️ **任务书原文假设 D06 尚未合入，实际已随 PR #10 合并**。按红线执行：编辑器不 import `@deepseek-bot/runtime`、不执行工作流；本报告如实记录该前提变化 |
| 记录 develop SHA | ✅ `4cd6e4d` |

## 1. 交付范围

编辑器前端 + 契约校验 + 夹具服务层 + 模板导入导出：

```text
apps/desktop/src/renderer/src/features/workflow-editor/
  workflow-service.ts      WorkflowServiceApi（list/get/save/copy/validate/exportTemplate/importTemplate）
                           + FixtureWorkflowService（内存态；不冒充持久化）
  workflow-reducer.ts      纯状态变换（无 React，可单测）
  use-workflow-editor.ts   控制器 hook（状态/服务调用/校验定位/导入导出/冲突横幅）
  workflow-editor.tsx      根组件（工具栏/布局/弹窗接线）
  canvas/workflow-canvas.tsx    画布：节点卡片 + SVG 连线 + 端口拖拽 + C 键盘连线 + Delete
  inspector/node-inspector.tsx  检查器：bot / approval / 连线 / 工作流四级表单
  validation/issues.ts          校验装配（WorkflowDraftSchema + validateWorkflowDraft + 编辑器规则）
  validation/validation-panel.tsx  错误分组列表 + 点击定位
  template/template-io.tsx      导入（粘贴/本地文件、预览确认）/导出（复制/下载）弹窗
```

集成：`DesktopService` 接口新增 `workflows` 组（D05 注入模式不变）；App 头部新增「工作流编辑器」入口切换主视图；**IPC 白名单与 preload 未动**（`ipc-registry.test.ts` 原样通过）。

契约红线遵守：未新增/修改 `packages/contracts` 任何字段；节点类型仅 `bot`/`approval`；approval 永不携带 `botId`（reducer 强制剥离，schema 定位报错，UI 不显示选择器）。

## 2. 验收清单（D7-1 – D7-16）

| # | 步骤 | 命令 / 证据 | 退出码 | 时间 |
| --- | --- | --- | --- | --- |
| D7-1 | 干净安装 | `pnpm install --frozen-lockfile` | 0（Already up to date, 291ms） | 23:07 |
| D7-2a | lint | `pnpm lint`（根，eslint .） | 0 | 23:04 |
| D7-2b | typecheck | `pnpm typecheck`（5 包全过） | 0 | 23:04 |
| D7-2c | test | `pnpm test`（305 例全绿：shared 6 / contracts 64 / desktop 86 / storage 106 / runtime 43；desktop 含 D07 新增 46 例） | 0 | 23:04 |
| D7-3 | 编辑 | 证据 d07-01/04/05/06：加 bot/approval 节点、C 键盘连线、连线删除（Delete）、选中（断言 `selectedNode`/`edges`） | — | 22:55 |
| D7-4 | 参数 | d07-03（bot 选机器人 note-summarizer）、d07-04（approval 无 botId 断言 `hasBotSelect=false`）、绑定/超时/重试可编辑（单测覆盖） | — | 22:55 |
| D7-5 | 校验定位 | d07-07（WORKFLOW_CYCLE→节点选中+聚焦断言）、d07-08（MISSING_BINDING→`inputBindings.input1` 字段聚焦断言）；夹具驱动单测 10 例 | — | 22:55 |
| D7-6 | 保存/复制 | d07-09（保存 toast「已保存（夹具内存态，非持久化）」断言）；复制重映射单测；冲突见 §5 未验证项 | — | 22:55 |
| D7-7 | 模板往返 | d07-10/11：export 977B → import accepted（2 节点 1 连线并发 2 与种子一致）→ 载入画布断言；往返一致单测 | — | 22:55 |
| D7-8 | 版本拒绝 | d07-12：`schemaVersion 9.9` → DATA_VERSION_UNSUPPORTED 提示断言；三层版本路径单测（template 层/workflow 层/均不进图校验 errors=[]） | — | 22:55 |
| D7-9 | 恶意模板 | 模板仅 `JSON.parse` + schema 校验，从不 eval/渲染 HTML/授权（代码审查 + 大小上限单测）；未来自 9.9 的 `futureField` 保持惰性数据（version-mismatch 夹具语义） | — | — |
| D7-10 | 归档机器人 | `activeBotOptions` 排除归档（单测）；选中后被归档 → INVALID_INPUT(botId) 阻止保存（单测 + inspector「（已归档）」显示） | — | 23:04 |
| D7-11 | limits | 工作级检查器 1–8 可选，默认 2；UI 不做执行期强制（提示文案指向 D06） | — | 22:55 |
| D7-12 | 可访问性 | 节点 role=button/tabIndex/aria-label；Tab 聚焦、Enter 确认（弹窗）、Delete 删除、Esc 取消连线模式、**C 键盘连线全程无鼠标**（d07-05 断言 dialogTitle）；校验错误点击定位+聚焦（d07-07/08 断言 focusedIsNode/focusedBinding） | — | 22:55 |
| D7-13 | 契约 | 无重复类型定义；校验真实调用 `validateWorkflowDraft`/`WorkflowDraftSchema`（imports 见 issues.ts / workflow-service.ts）；contracts 包零改动 | — | — |
| D7-14 | 安全 | 无 Key/用户数据/构建产物入库（`git status` 复核；out/、release/ 已 gitignore）；renderer 无 Node（IPC 白名单测试不变；预览用 shim 仅在本地 handoff/，不入库） | — | — |
| D7-15 | 构建 | `pnpm --filter @deepseek-bot/desktop build` | 0（3 段构建，renderer 174 modules，JS 995.95 kB / CSS 88.09 kB） | 23:07 |
| D7-16 | 文档 | [WORKFLOW_EDITOR.md](../WORKFLOW_EDITOR.md) 新增、[DESKTOP_SHELL.md](../DESKTOP_SHELL.md) 增 D07 条目、本报告 | — | — |

> **构建环境注意事项**：本机默认 TMP（`D:\AppCaches\Temp`）会让 esbuild 在清理临时文件时报 `Access is denied`（多次复现，含 `--disable-gpu` 无关）。解决：把 `TMP`/`TEMP` 指到可写目录（本次用 `apps/desktop/node_modules/.tmp`）后构建通过。此为环境问题，非代码问题。

## 3. 手动证据（截图 + 断言）

方法：本执行环境无法拉起 Electron（子进程静默退出，exit 0x80000003，日志为空；含 GPU 开关多方案尝试）。改为**驱动真实生产构建产物**：`electron-vite build` 的 renderer 输出（`out/renderer`，与 Electron 加载同一 bundle）拷贝到 `handoff/d07-preview`（本地，不入库），注入 preload shim（仅补 `getAppInfo`/`setTitleBarOverlay` 两个 Electron 桥调用），无头 Chrome 1440×900 + CDP 驱动（`handoff/d07-evidence.mjs`，16 步断言全过 + 12 张截图；断言日志 `handoff/d07-evidence-log.json`）。Electron 专属部分（窗口控制条、托盘）未覆盖，见 §5。

| 截图 | 内容 |
| --- | --- |
| [d07-01-editor.png](assets/d07/d07-01-editor.png) | 编辑器整体：工具栏/节点面板/画布(n1 未选机器人→2 错误徽标)/检查器(工作流级)/校验面板 |
| [d07-02-inspector-bot-error.png](assets/d07/d07-02-inspector-bot-error.png) | bot 节点未选机器人：检查器内联错误（INVALID_INPUT · botId 定位） |
| [d07-03-inspector-bot-selected.png](assets/d07/d07-03-inspector-bot-selected.png) | 选定 note-summarizer 后：错误清零、校验通过、保存可用 |
| [d07-04-inspector-approval.png](assets/d07/d07-04-inspector-approval.png) | approval 节点：无机器人选择器 + 「不能携带 botId」契约提示 |
| [d07-05-edge-dialog.png](assets/d07/d07-05-edge-dialog.png) | **键盘 C 连线**弹出的 outputKey/inputKey 弹窗 |
| [d07-06-edge-created.png](assets/d07/d07-06-edge-created.png) | 连线创建（out → in 箭头与标签） |
| [d07-07-cycle-located.png](assets/d07/d07-07-cycle-located.png) | 反向连线成环：WORKFLOW_CYCLE 分组显示，点击后 n2 选中+聚焦、保存禁用 |
| [d07-08-binding-located.png](assets/d07/d07-08-binding-located.png) | required 输入无供值：MISSING_BINDING 定位 `inputBindings.input1` |
| [d07-09-saved.png](assets/d07/d07-09-saved.png) | 修复后保存成功 toast（明确标注夹具内存态） |
| [d07-10-export.png](assets/d07/d07-10-export.png) | workflow.export 输出的 `{schemaVersion, workflow}` JSON |
| [d07-11-import-accepted.png](assets/d07/d07-11-import-accepted.png) | 导出模板导入：预览确认（2 节点 1 连线并发 2）→ 载入画布 |
| [d07-12-version-rejected.png](assets/d07/d07-12-version-rejected.png) | schemaVersion 9.9 → DATA_VERSION_UNSUPPORTED 拒绝提示 |

视觉核验：截图另经视觉模型复核布局（工具栏按钮水平排列无重叠、面板/画布/检查器正常），并对检查器做过 DOM 几何重叠检测（`overlaps: []`）。过程中发现并修复一处真实缺陷：D02 基类 `.ghost-btn` 自带 `position:absolute` 导致编辑器按钮叠放，已按 D05 的 `.modal-foot` 重置模式在 `.wf-editor` 作用域内回归文档流并重拍全部截图。

## 4. 服务层与夹具说明

- `FixtureWorkflowService`（`workflow-service.ts`）：内存 store 种子 1 个合法工作流 `sample-review-flow`（Bot A `1111…111` → `human-approve` 审批，复用 D03 共享测试 UUID 表）；`save` 拒绝带病草稿（先 schema 后图校验，错误码取首个 issue 的 code）；更新必须 `expectedRevision` 匹配否则 `REVISION_CONFLICT` 且不覆盖；`copy` 用 `duplicateDraft`（`-copy` 后缀重映射节点 id、边跟随、名称「副本」、截断到契约上限）；`importTemplate` 顺序 = 1 MiB 消息上限 → template.schemaVersion → workflow.schemaVersion（未知版本 DATA_VERSION_UNSUPPORTED，errors=[]，不进图校验）→ WorkflowDraftSchema → 图校验。
- 图校验场景夹具：测试直接消费 `packages/contracts/fixtures/workflow-cycle.json`、`workflow-missing-binding.json`、`version-mismatch.json` 的 payload（与 vitest 的 fixtures 别名机制一致）；会话/产物夹具沿用 D05。
- schema 解析错误 → `WorkflowIssue` 的定位映射（`schemaIssuesToWorkflowIssues`）：`nodes.<i>.<field>` → nodeId + field；节点级 refine（botId 规则）按消息推断 field=botId。

## 5. 未验证项（不冒充完成）

| 项 | 原因 | 归属 |
| --- | --- | --- |
| 持久化 | 夹具为内存态，重启即失 | D04 接线（storage 已在 develop，未接入 desktop） |
| 工作流执行 | 编辑器不依赖引擎，未执行任何工作流 | D06（已合并，未接 UI） |
| 调度 | 未实现 | D10 |
| 运行监控 / 审批执行 | 未实现 | D09（基线为含本任务的 `develop` `e6a8bcb`） |
| 真实双窗口 REVISION_CONFLICT 演示 | 夹具 store 每窗口/每进程独立，单窗口内无法制造真冲突；冲突语义（stale revision 拒绝、不覆盖、横幅+刷新重试 UI）由 21 例服务层测试 + 代码路径覆盖，真实场景需共享后端（D04/Host）接入后人工复验 | 后续 |
| Electron 壳内人工点检 | 本环境 Electron 无法启动（见 §3）；证据来自同一 renderer 生产 bundle 的浏览器驱动 | Owner 本机 `pnpm --filter @deepseek-bot/desktop dev` 复验 |
| CI（GitHub Actions） | 本机无 GitHub API / 网页访问，PR #12 的 Actions 结论未取证；PR #12 已合并 | Owner 从 PR #12 页面补记 |

> 合并后本地复跑（AI 辅助，供自审引用，不代替负责人结论）：`pnpm lint`、`pnpm typecheck` 均 exit 0；`pnpm test` 305 例全过（shared 6 / contracts 64 / desktop 86 / storage 106 / runtime 43，desktop 含 D07 46 例）。复跑环境为 `develop` = `e6a8bcb`（与验收提交 `215f743` 同树）。

## 6. 已知问题与回退

- 画布无平移/缩放（任务书标注可选，非验收门槛）。
- 连线键修改可能与既有连线重复，保存前由图校验 `INVALID_INPUT` 拦截（设计取舍：编辑器不做静默去重）。
- 删除最后一个节点被拒绝（维持 nodes≥1 的 schema 下限），提示依赖校验面板。
- 回退方式：本任务仅新增 renderer 特性目录 + App 入口 + 服务接口扩展，revert `68f2bba` 即可完整回退；无数据迁移、无 IPC 变更、无 contracts 变更。

## 7. PR 描述草稿

> ## D07 工作流编辑器（FR-04）
>
> - 编辑器前端：bot/approval 节点画布（拖拽/端口连线/C 键盘连线/Delete）、参数检查器（机器人/指令模板/输入绑定/超时/重试；approval 禁 botId）、工作流级名称与 limits(1–8)。
> - 校验定位：WorkflowDraftSchema + 官方 validateWorkflowDraft + 编辑器规则（归档/未知机器人、重复绑定键）；错误按节点分组，点击定位节点并聚焦字段；有错保存禁用。
> - 服务层：DesktopService 扩展 workflows 组，FixtureWorkflowService 内存实现（save/copy/validate/export/import，REVISION_CONFLICT 冲突语义，拒绝带病保存）；不新增 IPC。
> - 模板：导出 `{schemaVersion, workflow}`（复制/下载）；导入粘贴或本地文件、先验双层 schemaVersion（未知版本 DATA_VERSION_UNSUPPORTED 不进图校验）、预览确认后载入、≤1 MiB、模板永不执行/授权。
> - 测试：+46 例（reducer 15 / 校验映射 10 / 服务 21），全仓 305 例绿；lint/typecheck/build 绿（构建需 TMP 指向可写目录，报告有说明）。
> - 证据：12 张截图 + 16 步断言（docs/reports/D07-report.md §3）；执行/持久化/调度/审批执行明确未做。
>
> Base: develop。已作为 PR #12 以 merge commit `e6a8bcb` 合入 develop（2026-10-24）；负责人自审记录见 §8。

## 8. 负责人自审记录

（留空，由 Destinyian 自行填写：提交 SHA、检查结果、结论。）
