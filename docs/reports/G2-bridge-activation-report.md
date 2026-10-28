# G2 审批桥激活报告

分支：`feature/approval-bridge-activation` · 目标 `develop` · 无契约变更 · 任务书见 [GAP_AUDIT](../GAP_AUDIT.md) §2 G2

## 1. 目标与背景

审批桥（`@deepseek-bot/harness-bridge`）负责把 Harness 内的 `approval/request` 经回环服务器接到 Host 的 D08 门。桥的挂载 patch（`writeProfilePatches`）在 Host 启动时就写入 profile patch，但桥包本身此前只在**聊天回合开始时**由 `ChatManager.prepareProfile` 经 `prepareAppToolProfile` 拷入钉扎 profile 的 node_modules。

后果：**第一次 dsh 启动**——工作流运行、任务接力跳、或任何早于第一次聊天 prepareProfile 的执行——面对的 profile 里没有 `@deepseek-bot/harness-bridge`，上游打印 `warning: 1 entry did not activate`，该次执行的审批桥不生效。

GAP_AUDIT 第一次刷新把该项记为 G2，建议"Host 启动路径调用 `installBridgeIntoProfile`（pnpm file: 安装）"。本分支**没有**采用 pnpm 路径：`prepareAppToolProfile` 的注释明确警告 legacy pnpm file: 安装可能把写入重定向进源码检出或无关 profile，且会动包管理器/网络；它就是为"钉扎加载器以 profile node_modules 为第二包锚点"设计的免安装器。故实现改为：**启动即用 `prepareAppToolProfile` 幂等 staging**，语义与任务书一致（启动装配 profile 时安装桥、幂等、记录安装结果），机制更安全。

## 2. 做了什么

| 层 | 内容 |
| --- | --- |
| 新模块 | `packages/host/src/bridge-activation.ts`：`stageApprovalBridge` 调 `prepareAppToolProfile` 把桥包拷入 `<harnessHome>/profiles/sdk/node_modules/@deepseek-bot/harness-bridge`（profile 名与 `DshSdkExecutor` 默认 `--profile sdk` 对齐），并把每次结果追加写 `<logs>/bridge-install.jsonl`（`installed` / `unavailable` + 详情）；日志写失败不影响启动 |
| 接线 | `createHost` 在解析出 `bridgePackageDir` 后立即调用一次（best-effort：桥未构建时记录 `unavailable`，不中断 Host 装配；聊天路径的 `prepareProfile` 检查仍会把同一情况报为 `RUNTIME_UNAVAILABLE`） |
| 不变量 | 聊天回合的 `prepareProfile` 保留（会话中途删 profile 的自愈 + 校验）；`installBridgeIntoProfile` 保持原样（仍导出、仍有单测，无调用点——是否删除留给负责人在自审时定） |

## 3. 验证证据

环境：Windows 11 x64 · Node 24.16.0 · pnpm 11.28.5 · 基线 `origin/develop` = `81a0924`（PR #121）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Host 全量 | `pnpm --filter @deepseek-bot/host test`（vitest，含覆盖率） | 37 文件：36 过 / 1 失败；用例 270 过 / 1 失败 / 1 跳过，其中**新增 5 例全过**（staging+日志、幂等不重写、字节变化后重拷、未构建记 unavailable、createHost 集成） |
| 已知环境失败对照 | 在**未改动的 develop（81a0924）主检出**跑 `vitest run src/screen-distribution.test.ts src/task-dispatch.test.ts` | `screen-distribution` 在基线同样失败（真实窗口捕获依赖本机交互桌面；GAP_AUDIT 第一次刷新已记录该类环境失败）；`task-dispatch` 在基线与本分支均通过 |
| 静态 | `pnpm lint` | 0 问题 |
| 类型 | `pnpm typecheck`（10 包） | 全部 Done |
| 真机验证 | — | **未执行**：本报告不声称 `entry did not activate` 告警消失；该验收项需真实钉扎 Harness 启动一次核对（无 GUI/无钉扎二进制的本机环境跑不了），留给负责人或后续 G4 全链验收 |

## 4. 未验证（明确列出，不声称通过）

- **真实钉扎 Harness 未跑**：验收第一条"启动后不再出现 `entry did not activate` 告警"只有单元/集成级背书（staged 文件存在、内容与源一致），没有真实 dsh 启动背书。
- **桥事件端到端未跑**：验收第二条"真实聊天回合内 bridge 事件可达 Host"属于 G3 的通道验证，本分支未覆盖。
- `packages/exec-daemon` 的 `windows.real.test.ts` 在本机失败（基线同样失败，环境既有）。

## 5. 风险与回退

- 每次启动多一次目录比对拷贝（桥包为单 bundle，量级 KB）；无网络、无包管理器调用。
- staging 拒绝符号链接/目录联接：若用户把 bridge 源目录链进别处，启动记录 `unavailable`，行为与此前"聊天时才失败"一致，只是提前且留痕。
- `bridge-install.jsonl` 为追加日志，随启动次数线性增长（每行一条）；如需清理可随数据目录备份策略处理。
- 回退：`git revert -m 1 <merge-sha>`；无迁移、无契约面变化。

## 6. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿（含对"未采用任务书原建议的 installBridgeIntoProfile 路径"的认可与否）
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
