# 用量与账单（token 统计）报告

分支：`feat/usage-stats` · 目标 `develop` · 迁移 `0021` · 契约 `v0.9 → v0.10`

## 1. 目标与背景

「用量与账单」分区此前只有一个数据计数卡（schema 版本、bot/workflow/run 数量、本次会话数），
**没有任何 token 统计**。仓库里也不存在用量数据：契约无方法、存储无表、Host 丢弃了 harness 上报的
用量；只有测试夹具里出现过 `usage: {input_tokens, output_tokens}`。

上游 DeepSeek Harness 本身统计 token（asar 内可见 `event.usage.input_tokens`、
`rawUsage.prompt_tokens_details?.cached_tokens` 与 `turn-usage.js` 模块），所以真实数据是拿得到的，
只是本项目一直没接。

## 2. 做了什么

| 层 | 内容 |
| --- | --- |
| 存储 | 迁移 `0021-usage-events`：`usage_events(id, bot_id, model, session_id, occurred_at, input_tokens, output_tokens, cached_input_tokens, source)` + 两个索引；`recordUsage` 校验计数/来源/UTC 时间戳；`summarizeUsage` 按模型、按本地日（调用方给 day 函数）、按 bot（join bot 名）聚合；`earliestUsageAt` |
| 契约 | `v0.10` 新增 `usage.summary`：`{botId?, days?}` → `{windowDays, totals{…, estimated}, byModel[], byDay[], byBot[]}`。纯追加，0.1–0.9 发送方继续接受 |
| 采集 | `TurnUsageAccumulator` 容错读取用量（snake_case / camelCase / 嵌套 `usage` / 缓存命中）；**同一回合累计帧取最大值而非相加**；无用量帧时按字符数/4 估算并标 `estimated` |
| 接线 | `ChatManager` 可选 `onTurnUsage` 钩子；`host.ts` 用 try/catch 写入，记账失败不影响回复 |
| 渲染 | `features/usage/usage-panel.tsx`：4 张数字卡、每日折线（内联 SVG，双线）、按模型表格 + 并排环形占比、7d/30d 与「当前 bot / 全部 bot」切换、估算声明、空态与失败态 |
| 设置 | `features/settings/settings-nav.tsx`：6 个分区收成 3 组（基础 / 权限与数据 / 用量与系统），分区键为闭合联合类型 |

## 3. 验证证据

环境：Windows 11 x64 · Node 24 · pnpm 11.28.5 · `7d8bf69`（develop）合入后的 `feat/usage-stats`

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm run typecheck` | 0（全仓） |
| 静态检查 | `pnpm run lint` | 0 |
| 未翻译文案 | AST 扫描 `apps/desktop/src` | `no untranslated UI copy left` |
| 契约 | `vitest run`（packages/contracts） | 14 文件 / 148 用例 |
| 存储 | `vitest run`（packages/storage） | 26 文件 / 219 用例（含 usage 仓储 11 例） |
| 桌面 | `vitest run`（apps/desktop） | 60 文件 / 548 用例（含 usage 面板 9 例、设置导航 5 例） |
| Host 新增 | `vitest run src/usage-capture.test.ts src/usage-summary.test.ts` | 15 用例 |
| 版式 | 真实组件 + 真实样式表 + 夹具数据渲染后截图 | `docs/reports/assets/usage-stats/{usage-page-zh,settings-grouped-nav}.png` |

## 4. 未验证（明确列出，不声称通过）

- **真机 Electron 未跑**：本机无法启动 GUI（develop 层面既有问题：`main/updates.ts` 顶层引入
  `autoUpdater`，未打包时构造 `NsisUpdater` 崩溃）。
- **真实模型回合未跑**：没有 GUI 会话与真实 Key，上游 usage 帧无法实跑；采集路径只有事件形状的
  单元测试背书，没有实流量背书。首次实跑时需确认 `turnUsage.hasUsage` 为 true（否则会落成估算行）。
- **`packages/host/src/chat.test.ts` 与 `task-dispatch.test.ts` 在本机失败**（各 9 例，
  `application tools plugin is unavailable`）。在纯 develop（`6ecd1b3`）上同样失败，属本机
  esbuild 临时目录与交互桌面能力缺失，非本分支引入；这两个套件在此环境**不是绿的**。
- `packages/exec-daemon` 未跑（需要符号链接权限）。

## 5. 风险与回退

- 契约新增方法为附加式；若有客户端按方法白名单校验，需同步 v0.10。
- `usage_events.bot_id` 可空：回合结束时 bot 可能已删除，行保留用于总量，`byBot` 中显示为 null。
- 估算口径（字符数/4）只在**上游未上报**时使用，`totals.estimated` 会传递到 UI 并显示声明；
  不能当计费数据使用。
- 回退：`git revert -m 1 <merge-sha>` 撤销合入；迁移 0021 只新增表，回退代码后旧版本会因
  schema 版本更高而拒绝打开（`DATA_VERSION_UNSUPPORTED`），需同时恢复数据库备份。

## 6. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
