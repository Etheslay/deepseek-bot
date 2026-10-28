# D21 Windows 集成修复与验收计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在最新 develop 上补齐指定窗口截图与本地 OCR 的 Windows、构建资源和真实 Electron 验收证据，修复复现的问题后提交独立 PR。

**Architecture:** 保留已合入的 exec-daemon、Host screen 服务、D16 单次审批和桌面设置实现。固定原生助手与离线 OCR 资源跟随 Host 构建进入同一分发目录；源代码运行与构建后运行显式选择各自资源路径。以自建可见窗口和本机受控模型验证全过程，模型仍只收到结果元数据。

**Tech Stack:** Windows / Node 24 / pnpm 11.28.5 / Electron 38.2.1 / Vitest / PowerShell PrintWindow / Tesseract 7。

## 核实基线与进度

2026-10-28 核实时 `origin/develop=bebf27242b0a77f83e3db96b070945ca42f6eda9`。这是本计划的检查基线，不是已经完成全量验证的声明。

| 范围 | 实际进度与证据 |
| --- | --- |
| D15 / D16 / D18 / D30 | 已有网关、授权、记忆知识与真实聊天基线；后续编排及聊天变更已合入，仍需集成回归 |
| D19 | SD #65、无凭据 HTTP MCP #67/#68 已合入；stdio、凭据注入、视觉理解未交付 |
| D20 | #66 及 #84/#85/#87 已合入：本地规则、一次运行、评审、状态历史；新增 eventRule 链路尚无桌面评审或聊天通知 |
| D21 截图/OCR | #70 契约、#74 Windows/OCR、#77 Host、#81 缺助手错误、#83 设置页已合入；报告未验证真实 Windows 和完整 Electron 链路 |
| D21 设备动作 | #88 精确审批、#89 本地记录已合入；不执行真实键鼠，不调用执行后端 |
| 桌面与发布 | D22 #75、D24 #78、聊天布局 #90、UI 冻结 #92 已合入；安装包、干净机、升级和 D13/D23 仍需验收 |
| 在途协作 | #91 `feature/gap-batch1` 未合入；其标题/描述仍引用聊天布局旧范围，实际文件已含聊天导出、运行记录和编排等改动，不按旧描述重复开发 |

最新 develop 的 GitHub quality 标为 failure，但 jobs.steps 为空，annotation 为账户支付/额度限制而未启动。不能解释为代码测试失败，也不能解释为通过。用户已要求本机完成验证后发 PR，不依赖本轮 GitHub CI，不重跑收费检查，不改变仓库保护规则。

旧 `feature/local-exec` 工作目录有未提交的另一版实现，保留不动。本任务在独立 `feature/screen-windows-acceptance` 上仅迁移经当前代码复现的必要修复。

## Task 1：Windows / Node 24 基线

**Files:** 所有源码只读；本机日志写入忽略的 `.tmp-d21/`。

- [x] 执行 `pnpm install --frozen-lockfile`，确认依赖与锁文件一致，不新增应用依赖。
- [x] 执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`，保留退出码、包计数和跳过原因。失败按当前环境复现定位；不降低覆盖率或把失败改为跳过。

## Task 2：分发目录资源闭环

**Files:** `packages/exec-daemon/scripts/build-resources.mjs`、`packages/exec-daemon/src/ocr.test.ts`、`packages/exec-daemon/src/windows.ts`、`packages/exec-daemon/src/backend.ts`、`packages/host/scripts/build.mjs`、`packages/host/src/host.ts`。

- [x] 先增加并运行失败用例：资源输出位于带 `{"type":"module"}` 的父目录时，真实中英文 OCR 仍能运行。核心断言：

```ts
await writeFile(path.join(parent, "package.json"), JSON.stringify({ type: "module" }));
const text = await createScreenBackend({ resourcesDirectory: built })
  .recognize(fixture, new AbortController().signal);
expect(text.toUpperCase()).toContain("HELLO");
expect(text).toContain("测试");
```

- [x] 对复现的模块边界问题，在 OCR 资源目录明确 CommonJS 范围，不增加网络回退：

```js
await writeFile(path.join(outDir, "package.json"), JSON.stringify({ type: "commonjs" }));
```

- [x] Host build 调用已有 `buildOcrResources`，复制固定 win32-capture.ps1；运行时明确使用同目录内资源，不依赖安装机器上的 exec-daemon 源码包。源代码测试保留默认源码助手，构建路径使用可信配置：

```ts
createScreenBackend({
  resourcesDirectory: join(hostDirectory, "screen-assets", "ocr"),
  helperScriptPath: join(hostDirectory, "screen-assets", "win32-capture.ps1"),
});
```

- [x] 增加构建产物测试：独立临时分发目录包含 Host、审批桥、固定脚本、OCR worker/core/WASM/语言包与 notices；用该目录启动 Host，不从仓库 node_modules 解析 screen backend。运行相关 exec-daemon / Host 测试与构建，确认拒绝缺失资源而非静默降级。

## Task 3：真实 Windows 与 Electron 闭环

**Files:** `packages/exec-daemon/src/windows.real.test.ts`、`packages/exec-daemon/src/testing/self-window.ps1`、`apps/desktop/scripts/accept-screen.cjs`、`docs/reports/assets/d21/`。

- [x] 自建窗口必须实际可见；测试只选择随机标题且 PID 匹配的自有窗口。交互桌面的必需验收不能因列不到窗口而算作通过。
- [x] 真实设置页验证默认 deny → ask → 手动刷新和选择 → 请求 → 精确审批卡；批准前与拒绝/取消后无截图结果；批准后可预览 JPEG / OCR 文本并确认删除。
- [x] 真实 Harness + 本机受控模型调用 `screen_capture`，批准前无读取；续轮收到严格 `{id,mode,at,width,height,hasOcr}`，不含标题、路径、图像或 OCR 正文。
- [x] 检查取消/停用、失效窗口、全局单操作锁、输出上限、审计摘要和产物隔离。发现问题先补失败回归，再修复，不扩展任意 shell 或设备输入。
- [x] 逐张查看自有窗口/应用的验收截图；本机运行数据和 dummy key 不入库，提交合成证据图与可重复执行脚本。

## Task 4：本机门禁与交付

**Files:** `docs/reports/D21-windows-acceptance-report.md`、`docs/SPRINTS.md`、`docs/DEVELOPMENT_PLAN.md`、必要的资源许可说明。

- [x] 修改完成后执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`，相关包覆盖率门槛保持不变；Host、desktop build 退出 0；真实 Electron 验收退出 0；`git diff --check` 退出 0。
- [x] 更新实际结果和未验证项，不将开发构建称为安装包验收；不宣称真实键鼠、付费 DeepSeek、签名、干净机或更新链路已验证。
- [x] 重新 fetch develop，处理必要集成冲突并重新执行受影响检查；保持 `SPRINTS.md` §11 八项 UI 冻结基线。
- [ ] 提交后 PR 指向 develop，记录精确最新 SHA、本机检查和 GitHub CI 余额阻碍；使用 ready PR。Etheslay 自审结论留空待本人填写，AI 不代签，不自行合并。

## 后续排期

1. 本 PR 合入后，D20 新 eventRule 链路补桌面评审/状态历史和聊天通知；先对齐既有 trigger.*，避免双套规则入口。
2. 单独处理 `PERMISSIONS.md` §9 与已实现编排角色的差异：明确用户触发的应用能力 grant、撤销与审计，再拆契约 PR；操控电脑能力仍逐次审批。避开 #91 的在途实现。
3. D19 stdio / 凭据注入 / 视觉、D21 真实设备输入、D27 语音各自另立设计和 feature，不在本次集成修复中扩展。
4. 平台证据完善后进入 D13 / D23 发布验收；Etheslay 交付执行、权限、数据和回滚证据，Destinyian 主责桌面与发行。
