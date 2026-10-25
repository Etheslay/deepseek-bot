# D12 运行时集成报告

日期：2026-10-25。任务：D12 `feature/runtime-integration`（负责人 Etheslay）。任务按「小片多 PR」交付，全部自 develop 分出、合入 develop：#20 适配层、#23 审批桥、#25 Host 组装、#26 stdio 服务、#27 桌面接线、#28 run.resume+回归、#31 文档同步+真实冒烟、#34/QA-06 修复（merge 后编号 #35）。依赖 D06/D08/D09/D10 均已合入。

## 1. 交付内容

| 领域 | 实现 |
| --- | --- |
| Harness 适配层（`packages/harness-adapter`，#20 + a8af24f） | `DshSdkExecutor` 实现 runtime 的 `NodeExecutor` 端口：一次节点尝试 = 一个钉扎版本（`@deepseek-ai/dsh` 0.2.1-rc.2，启动时断言清单版本防漂移）的 Harness 子进程 + 独立会话；`HarnessAttempt` 自管进程生命周期（`initialize` 握手、回合结算 = inbox 回执→会话事件→`session.status=idle`、取消/超时立即杀进程、有界优雅关闭）；prompt 组合（`{{input.*}}`，未知输入 `INVALID_INPUT`）；`SessionRegistry`（会话→引擎权限句柄，供审批桥）；**turn 级错误分类**（turn/end `reason.kind:"error"` 结构化信封：401/403/AUTH→`AUTH_FAILED` 不可重试、429→`RATE_LIMITED`、5xx→`MODEL_UNAVAILABLE`，其余可重试 `RUNTIME_UNAVAILABLE`） |
| 审批桥（`packages/harness-bridge` + 适配层桥服务器，#23） | Cordis 插件挂入应用专属 profile，应答上游 `approval/request` 瀑布：按 callId 回读会话日志 `tool/call` 记录取精确参数（上游 serviceAsk 只给 toolName/callId/reason，已核实），经回环 HTTP 转发；Host 侧服务器 127.0.0.1 + 随机端口 + 每启动 token（timing-safe）；工具→D08 动作映射（arguments 为 JSON 字符串、`file_path` 参数，按 D01 夹具实证；未映射工具 fail-closed）；无 Host 通道时不注册监听器，上游链条 fail-closed；profile patch 资产（遥测 DISABLED + 桥挂载）与 profile 内 `file:` 依赖安装 |
| Host 组装（`packages/host`，#25/#28） | 单进程组装数据库 + 引擎 + 调度器 + 适配器 + 审批桥；`handleMethod` 实现 CONTRACTS §3 全部方法（请求/响应双向 schema 校验；`run.start`/`workflow.export` 校验 `REVISION_CONFLICT`；`bot.create` 经信封 requestId 去重；`data.restore` 后宿主拆除待重启）；启动时 `recoverInterruptedRuns`（QA-09）；密钥解密注入式（Host 不碰密钥材料） |
| stdio 服务（#26） | 进程入口 `dist/main.js`（Node ≥ 24）；换行 JSON-RPC：契约调用 `contract/call` + CONTRACTS 信封；反向通道 `credential/resolve`（桌面 main 经 safeStorage 解密应答，密钥只短暂进入 Harness 子进程环境）；`schedule.missed` 通知推送（FR-08）；`host/shutdown` 优雅停机 |
| 桌面接线（#27） | Electron main 拉起 Host（真实 Node ≥ 24，Electron 38 主进程无 `node:sqlite`——主进程不得 import storage 包的约束已锚定）；safeStorage + 凭据 blob 应答解密请求；`HOST_CALL` 通道（sender guard + 契约方法白名单）；preload `window.deepseekBot.host.call/onMissed`；host dist 以 extraResource 携带（Node ≥ 24 runtime 内置属 D13） |
| 契约变更（#25/#28，均附加式或修复性） | `ScheduleDraftSchema` 移除 `nextRunAt`（调度器计算字段，原 schema 使 schedule.save 不可实现）；新增 `run.resume`（D10 引擎恢复此前无契约路径，QA-09 恢复腿不可达）；白名单 23→24 |
| 验收证据 | **QA-05 真实全链路通过**（2026-10-25：三机器人经真实 dsh 0.2.1-rc.2 + deepseek-chat，~26s，顺序+独立分支，会话互异）；QA-09 崩溃恢复回归（库关闭模拟进程死亡 → 新宿主恢复 → `run.resume` 携带已成功节点不重跑）；QA-06 分类回归（真实 401 形状回放：节点 `AUTH_FAILED`、run failed、单 attempt） |

## 2. 过程修复的缺陷（自测发现）

- **QA-06 模型失败误报成功**（产品级）：坏凭据下 Harness 轮次仍转 idle 且无会话日志错误事件（`agent/request-error` 是 Cordis 事件，不在会话事件流）——探针实证真实信号为 `turn/end` `reason.kind:"error"` + 结构化信封后，适配层按 code/status 结构化分类（见 §1）。
- **ScheduleDraftSchema 不可实现**：请求 schema 要求调用方传 `nextRunAt`（调度器计算字段）——首次实现该方法时暴露，移除之。
- **run.resume 契约缺口**：引擎恢复能力无契约路径，重启后中断的运行对调用方不可达——新增附加式方法。
- **引擎结算在宿主拆除后抛未处理拒绝**：QA-09 崩溃模拟暴露——库已关闭时 `settleAttempt` 直接写库抛 `ERR_INVALID_STATE`；入口加 `isOpen` 守卫，拆除后放弃结算、交由下次启动的恢复流程。
- **pnpm 11 构建脚本审批**：dsh 依赖树 5 个包未决定即 install 失败——`pnpm-workspace.yaml` 显式记 `false`（与 D01 `--ignore-scripts` 口径一致）。

## 3. 测试与覆盖率

当前全仓：shared 6 / contracts 64 / harness-bridge 10 / desktop 147 / storage 115 / runtime 128 / harness-adapter 52 / host 19 + 1 跳（真实 QA-05 无 Key 自动跳过）= **641 通过**；lint/typecheck 全绿。覆盖率：harness-bridge 行 100%/分支 96%、harness-adapter 行 90%/分支 84%、host 行 ~82%/分支 ~73%（阈值 70：响应契约守卫等公共面不可达防御分支，vitest.config 点名）。QA 矩阵映射：QA-05（假线回归 + 真实通过）、QA-06（真机实证 + 假线回归）、QA-09（崩溃恢复 + 结算守卫）、QA-11（data.backup/restore 方法面 + storage 迁移/损坏库测试）、QA-07/08（D08 门与桥单测；真实 ask 链路未端到端，见 §5）。

## 4. 依赖与文档同步

- 新增锁定依赖 `@deepseek-ai/dsh` + `@deepseek-ai/dsh-sdk-protocol`（精确 0.2.1-rc.2，均 MIT，与 D01 §7 清单口径一致）；无其他运行时依赖。
- `docs/ARCHITECTURE.md` §2 同步三包布局与主进程约束；`docs/RENDERER_HOST_MAPPING.md` 为渲染层真实数据切换提案（待两负责人拍板，SPRINTS §8-1）。
- 契约变更按 §7 记录：ScheduleDraftSchema（修复）、run.resume（附加式）；**已知引擎缺口**：`run.created` 列于 CONTRACTS §4 但引擎自 D06 起未发射，消费方以 run 行为准——待后续小片修复或契约勘误。

## 5. 未验证项与边界（不以桩替代结论）

- **QA-10 睡眠唤醒**：托盘驻留 + 睡眠/唤醒后首个 tick 的 misfire 判定待真机手测（`schedule_misses` 表兜底可见性已备）。
- **QA-07/08 真实 ask 端到端**：审批桥单测覆盖插件/服务器/映射，但真实 Harness 发起 `approval/request` → 桥 → D08 门 → 工具执行的完整链路未在真机走过（需真实工具调用回合）。
- **QA-11/12 真库演练**：方法面与 storage 迁移测试覆盖备份/恢复/较新格式拒绝；真实旧版本数据库升级演练未做。
- **渲染层真实数据**：`DesktopService` 的 chat/artifacts 面仍为夹具（映射提案 D→B 待拍板）；设置真实化同批。
- **打包边界**：Node ≥ 24 runtime 内置（干净机无系统 Node 时 Host 无法启动）属 D13；D11 遗留的安装/启动/升级/卸载试验仍未补。
- QA-14/QA-15 不在 D12 范围。

## 6. 自审记录（由负责人填写）

- [ ] 自审人 / 提交 SHA / 日期：
- [ ] 差异检查结果：
- [ ] 检查证据（lint/typecheck/test/CI run）：
- [ ] 遗留问题：
- [ ] 结论：
