# D10 本地调度实现报告

日期：2026-10-25。任务：D10 `feature/local-scheduler`（负责人 Etheslay）。分支自 develop 0cda281（D08 合并后）创建，目标 develop。依赖 D06、D08 均已合入。

## 1. 交付内容

FR-08 本地调度（时区明确；应用打开或驻留托盘时触发；休眠错过任务标记 missed，不批量静默补跑）落实在 [packages/runtime/src/scheduler/](../../packages/runtime/src/scheduler/cron.ts) 与 storage 的附加式扩展。零新增外部依赖（cron 求值用 Node 内置 `Intl`，lockfile 无变化）；契约无 schema 变更（Schedule 实体、RunTrigger、schedule.* 方法契约在 D03 已定义，本任务首次给出可执行实现）。

| 领域 | 实现 |
| --- | --- |
| cron 求值（`scheduler/cron.ts`） | 5 字段语法（分 时 日 月 周；`*`、列表、区间、步进，纯数字），vixie 语义：日/周均受限时按 OR 匹配，7 归一化为周日。语法错误以 `INVALID_INPUT` 返回字段级详情。触发时刻按 schedule 的 IANA 时区逐墙钟分钟求值：`Intl.DateTimeFormat` 缓存实例做墙钟↔UTC 双向换算；春季跳时的不存在分钟无实例（跳过）、秋季回拨的重复分钟产生两个实例，`nextCronOccurrence` 返回**严格晚于参考时刻的最早实例**而非下一个墙钟分钟（回拨日"较早分钟的第二次出现"不会漏）；搜索上界 4 个日历年，永不匹配的表达式（如 `0 0 30 2 *`）返回 null。半小时/45 分钟时区以毫秒运算覆盖 |
| 调度器（`scheduler/scheduler.ts`） | `LocalScheduler`：宿主 start/stop 绑定生命周期；定时器自重新排队（tick 完成后再排下一次，不重叠）；`start()` 首个 tick 同步评估重启 misfire。到期 occurrence 经 `engine.startRun` 以 `kind: schedule` + (scheduleId, occurrenceUtc) 触发；runs 表唯一索引保证重复触发防护——触发后、推进 nextRunAt 前崩溃，重启首个 tick 重放为 `duplicate` 而非第二个 Run。tick 默认 30s，misfire 宽限窗默认 60s（≥ 一个 tick，正常抖动不判错过） |
| misfire（skip-and-notify） | 到期观察时迟到超过宽限窗：不运行，逐条登记 `schedule_misses`（UNIQUE(schedule_id, occurrence_utc) 幂等；单 tick 单 schedule 上限 500 条防失控），推进到下一未来 occurrence；`onMissed` 回调供宿主接 UI 通知（D12 接线）。触发失败（工作流非法、bot 归档等确定性错误）同样登记为可见 miss 并越过该 occurrence，不无限重试 |
| schedule 门面 | `upsertSchedule` / `setEnabled` / `listMisses` 对接 CONTRACTS §3 schedule.save / enable / disable（D12 接 IPC）。保存时计算 nextRunAt（禁用为 null）；重新启用时 nextRunAt 已过期则从当前时刻重算—— elapsed 的 occurrence 不补跑（FR-08：重新启用不是批量追账） |
| 恢复（`engine.resumeRun`） | 仅 `interrupted` 状态可恢复；以原 Run 的不可变快照（workflowSnapshot + botSnapshots）创建**新 Run**，`resumedFromRunId` 关联，trigger 为 manual，可传 `idempotencyKey` 使重复恢复调用幂等。bot 逐个从存储复核（缺失/归档拒绝），policy+workspace 按当前存储重新钉扎（与其他 run.start 同规则）。种子：原运行已成功节点携带 Harness 会话与持久化输出直接置 succeeded（不重复执行副作用，QA-09）；skipped 重置为 pending（上游重跑后由 stop-descendants 重新裁决）；其余节点全新 attempt 1 |
| 输出持久化（storage） | migration `0003`：`schedule_misses` 表（外键 schedules，ON DELETE CASCADE）+ `node_runs.outputs_json` 列。`setNodeRunOutputs` 在节点成功结算时写入内联输出值（契约的 outputRefs 仍指 artifact 引用，语义不变）；恢复运行据 `getNodeRunOutputs` 重建数据流，无需重跑已完成前驱 |

Harness 适配边界不变：调度器只经 `WorkflowEngine.startRun` 触发，真实适配层接入属 D12。

## 2. 过程修复的缺陷（自测发现）

- **恢复种子未同步内存状态**：`applyResumeSeed` 初版只把已成功节点写库，未更新执行器内存中的 nodeRuns 表，pump 按内存的 pending 状态重复调度已成功节点，触发存储层 `succeeded -> running` 非法转移异常。修复：每次转移后 `replaceLatest` 同步内存。
- **回拨日的时刻序 vs 墙钟序**：逐墙钟分钟扫描若"遇到首个有未来实例的分钟即返回"，回拨日会漏掉更早墙钟分钟的第二实例（01:31 EDT 早于 01:30 的第二实例这种交错）。最终算法：分钟首实例在未来的直接胜出（后续分钟首实例必然更晚）；仅第二实例有效的分钟记为候选并继续扫完当天取最小——两天之间的实例区间不重叠，按天取最小即全局正确。
- **测试脚手架时点错误**：misfire 用例初稿把 `*/5` 误当作"每 5 分钟连续时刻"，按 12:05→12:06 推算错过次数；`*/5` 是分钟刻度（12:00、12:05、12:10），用例时间线已按正确语义重写。

## 3. 测试与覆盖率

根目录 `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。用例数：desktop 86、shared 6、contracts 64、storage 115（新增 schedule-misses 2 + 输出持久化 1）、runtime 128（D06/D08 存量 90 + D10 新增 38：cron 15、resume 6、scheduler 17）。

QA-10 对应：时区（上海/纽约/加尔各答含半小时时区）、DST 跳时（不存在分钟跳过）与回拨（同一墙钟分钟两次触发、交错序）、休眠错过（逐条登记可见、不批量补跑、miss 后下一时刻正常触发）、重复触发（同 tick 不重复、崩溃重放 duplicate）、重启（start 首个 tick 评估 misfire；恢复运行携带已完成工作）均有自动化用例。

runtime 包 v8 覆盖率：行 90.1%、分支 83.49%（阈值 80% 达标）；scheduler 目录行 97.2%、分支 88.2%（cron 96.9%/94.3%、scheduler 97.5%/78.6%）。余下未覆盖分支为定时器停止竞态守卫与 setEnabled 的未来时刻早退等防御路径，未通过排除文件或缩阈值达成，与 D06/D08 报告同口径如实记录。

## 4. 依赖与文档同步

- 无新增运行时依赖；lockfile 无变化。
- storage migration `0003` 附加式，0001/0002 校验和不变，旧库升级走既有迁移测试路径。
- ARCHITECTURE.md §2（布局清单加 D10 调度器）与 §6（调度去重与 misfire 从"属 D10"改为已实现语义）已同步；引擎头注释同步恢复入口。

## 5. 未验证项与边界

- 真实宿主生命周期（托盘驻留、Windows 睡眠/唤醒后定时器行为）未在真机验证——测试以注入时钟与显式 tick 驱动；唤醒后首个 tick 判定 misfire 的行为属 QA-10 手测项，D12 联调覆盖。
- `schedule.*` IPC 方法、missed 通知到界面的链路属 D09/D12；本任务提供存储可见性与 `onMissed` 回调。
- 未禁止对同一 interrupted 运行多次恢复（不同 idempotencyKey 会产生多个恢复运行）；防重复恢复操作由 UI/宿主层负责。
- 触发-推进 nextRunAt 非同一事务；单 Host 单写者模型下 tick 串行执行，重复触发防护由 runs 唯一索引兜底（崩溃重放为 duplicate），已测。
- CI 以分支推送后的真实运行为准。

## 6. 自审记录（由负责人填写）

- [ ] 自审人 / 提交 SHA / 日期：
- [ ] 差异检查结果：
- [ ] 检查证据（lint/typecheck/test/CI run）：
- [ ] 遗留问题：
- [ ] 结论：
