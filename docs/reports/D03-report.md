# D03 共享契约实现报告

日期：2026-10-24。任务：D03 `feature/shared-contracts`（负责人 Etheslay）。分支自 develop 664f376（D02 合并后）创建，目标 develop。依赖 D01、D02 均已合入，M0 退出条件成立。

## 1. 交付内容

[docs/CONTRACTS.md](../CONTRACTS.md) v0.1 落实为 workspace 包 [packages/contracts](../../packages/contracts/README.md)（`@deepseek-bot/contracts`，private，TypeScript 源码直出，与 `@deepseek-bot/shared` 同模式）：

| 契约章节 | 实现 |
| --- | --- |
| §1 通用规则 | UUID / UTC ISO 8601 / IANA 时区 schema；`expectedRevision` 字段进入全部修改类方法；envelope（protocolVersion/requestId/method/payload）+ 23 个白名单方法；1 MiB 单条消息上限；UI 不读取 Key（`settings.testConnection` 载荷无凭据字段） |
| §2 核心实体 | Bot、ModelProfile、Workspace（结构化 grants）、Workflow/Node/Edge（bot 节点必须带 botId、approval 节点禁止）、Schedule（misfirePolicy 固定 skip-and-notify、5 字段 cron）、Run（含不可变快照与 resumedFromRunId）、NodeRun、Approval（默认 TTL 10 分钟常量）、Artifact（相对路径防目录逃逸、sha-256 校验） |
| §3 方法边界 | 每个方法的请求/响应 payload schema（`METHOD_CONTRACTS`）；create/requestId 去重、update/revision、start/idempotencyKey、cancel 重复调用返回已有终态等语义写入夹具与注释 |
| §4 事件 | 10 类持久事件的 envelope + payload schema；终态事件强制携带 reason；`assistant.delta` 瞬态流（streamId/chunkIndex）；`isSequenceMonotonic` |
| §5 状态与失败 | Run / NodeRun 迁移表与终态判断（`assertRunTransition` 等），cancelling、interrupted、skipped 语义按契约编码 |
| §6 稳定错误码 | 16 个错误码与错误对象 schema（code/message/retryable/requestId/details） |
| §7 夹具与测试 | 12 个场景夹具（见下）+ 三层契约测试 |

工作流 DAG 校验器（`validateWorkflowGraph`）独立成模块：环、悬空边、必填绑定缺失、重复节点/边，错误定位到 nodeId 与字段，输出确定性排序——`workflow.validate` 的响应错误与它逐字段对应。

## 2. 场景夹具（CONTRACTS §7）

`packages/contracts/fixtures/`（12 个 JSON + README），§7 最低清单全部覆盖，另补 2 个：

成功、限流（retryable + Retry-After）、取消（cancelling → cancelled、重复 cancel 幂等）、审批拒绝（决定不可重复执行、stop-descendants）、重复消息（requestId 去重）、并发编辑（REVISION_CONFLICT 带当前 revision）、崩溃重连（事件重放、sequence 跨重启连续、snapshotRequired）、循环图、路径越界、过期审批；补充：版本拒绝（未知更高 protocolVersion 整体拒绝、import 未知 schemaVersion → DATA_VERSION_UNSUPPORTED）、缺失绑定。

夹具的语义断言由测试执行：例如 `workflow-cycle` 夹具的期望错误会与真实校验器输出逐项比对，`duplicate-message` 夹具会实际调用 `parseRequest` 验证两条请求 requestId 一致、返回同一资源 id。

## 3. 测试与覆盖率

`pnpm test`（本包）64 个用例全部通过，分 4 组：

1. **schema 单元测试**（23）：原始类型、错误对象、状态机（含非法迁移抛 `TransitionError`）、实体约束。
2. **方法契约测试**：白名单完整性（23 方法 ↔ 注册表一一对应）、协议版本拒绝、payload 越限、`parseRequest` 定位错误。
3. **夹具场景测试**（14）：每个夹具全量 schema 校验 + 场景语义断言。
4. **D01 真实样本测试**（5）：对 [docs/fixtures/d01](../fixtures/d01/README.md) 两份真实 Harness 事件样本断言——首行 session 头无 seq、其后 seq 从 0 起严格单调（对应"sequence 跨重启连续"的映射前提）、词汇表与文档一致（见 §5 发现）、`tool/result` 溯源字段与 `turn/end reason.kind=interrupted` 存在。

覆盖率（v8）：语句 99.19%、分支 89.71%、函数 94.59%、行 99.19%，均高于 [TESTING.md](../TESTING.md) §3 建议的 80%；状态机模块分支 100%（对应权限/状态机 ≥90% 要求）。未覆盖行为防御性 guard（如 DFS 边界），已在 vitest 配置中保持全量统计、未做排除。

## 4. 依赖锁与版本策略

已落盘至 [DEVELOPMENT_SETUP.md](../DEVELOPMENT_SETUP.md) 新增"依赖与版本策略"小节，要点：

- `packageManager` 固定 `pnpm@11.28.5`（与上游源码一致，本地实测 11.28.5 生效）、Node `>=24`。
- 全仓依赖精确版本（无 `^`/`~`/`latest`）；单一 `pnpm-lock.yaml` 为唯一事实来源，CI `--frozen-lockfile`；本次新增依赖 `zod@4.6.7`（精确版本）已随本分支进入锁文件。
- `allowBuilds` 维持 esbuild + electron；koffi / node-pty 等带安装脚本的依赖须受控评估后再批准（承接 D01 §2 记录）。
- workspace 包版本：contracts `0.1.0` 跟随契约版本；shared `0.0.0`、desktop `0.1.0` 维持不变。
- **上游 Harness 依赖未预先引入**：`@deepseek-ai/dsh 0.2.1-rc.2` 将在首个消费方任务（runtime/适配层）以精确版本进锁文件，届时全量导出传递依赖许可清单。D01 §3"传递依赖许可清单待 D03 生成锁文件后全量导出"一项据此顺延——D03 交付物是契约包，不引入模型运行时依赖，提前装入仅上游 86 项直接依赖而无消费方的锁文件只会制造噪音；此调整请负责人在自审中确认。

技术选型说明：选择 zod 4.6.7 作为可执行 schema 实现（类型推导 + 运行时校验一体，renderer 与 main 进程均可用），替代手写校验器；代价是引入唯一一个运行时依赖，收益是 11 个实体、23 个方法、10 类事件的校验代码保持可维护并可直接生成错误定位。契约包类型输出经 `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` 严格模式编译。

## 5. 过程中发现并修正的问题

- `docs/fixtures/d01/README.md` 事件词汇表遗漏 `session/title-llm-request`（tool-run 真实样本中实际存在，与 D01 §8.1 headless 标题生成记录一致）——已补记，D01 样本测试以补后的词汇表为准。
- `docs/DEVELOPMENT_SETUP.md` 的"后续 D01/D02 应从 develop 拉分支"已过时，改为通用规则（新任务从 develop 拉 feature 分支，根配置变更走小型 PR）。
- `docs/CONTRACTS.md` 状态行从"D03 将实现"更新为指向已存在的实现（冻结条款本身未动）。

## 6. 未验证项与边界

- 本任务无真实 Harness 调用、无付费 API 请求；D01 样本测试只做结构断言，事件词汇 → 契约事件的**语义映射器**属于适配层（后续任务），不在本包内。
- 桌面壳尚未消费契约包（D02 的 `apps/desktop/src/shared/ipc-channels.ts` 保持原样）；Destinyian 在 D05 接入。contracts 的方法白名单与 IPC 白名单是两层不同边界（Host 方法面 vs Electron IPC 面），合并策略留待 D05 与桌面负责人对齐。
- `sequence` 跨 Run 唯一性、审批"启动代次绑定"等运行时语义由 Host 实现，schema 只固定数据形态；相应夹具已给出期望形态。
- CI 在分支推送后以真实运行结果为准；本文档记录的均为本地 Windows 11 x64 + Node 24.15.0 + pnpm 11.28.5 实测。

## 7. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
