# G2 审批桥激活：启动时把 harness-bridge 装入钉扎 profile

日期：2026-10-28（Asia/Shanghai）。负责人：Etheslay。分支：`feature/g2-bridge-staging-e8f4`。基线：`94bc05d`（origin/develop，含 PR #118）。对应 [GAP_AUDIT](../GAP_AUDIT.md) G2（PR #122 文档稿；本片未改该文件）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论；自审必须针对该分支最新提交 SHA。

## 1. 交付行为

| 块 | 实现 |
| --- | --- |
| 现状 | `BRIDGE_MOUNT_PATCH` 在每次 Harness 启动时挂 `dsb-approval-bridge` 插件行，但桥包只在聊天回合被 `prepareAppToolProfile` 懒拷贝进 profile——工作流运行（`run.start` 路径）从不安装，钉扎 Harness 报 `warning: 1 entry did not activate`，D08 审批桥在真实运行中不生效（[GAP_AUDIT G2](../GAP_AUDIT.md) 实测证据） |
| 修复 | `createHost` 启动时（计算出 `bridgePackageDir` 后）调用一次 `prepareAppToolProfile`，把 `@deepseek-bot/harness-bridge` 幂等拷入 `<harnessHome>/profiles/sdk/node_modules/`——executor 与聊天回合都用 `--profile sdk`（`dsh-executor.ts:202`），一次安装覆盖全部启动路径。拷贝式安装是仓库现行机制（文件头注释记录了 pnpm file: 安装会被 junction 重定向的问题，已弃用），比 GAP_AUDIT 建议的 `installBridgeIntoProfile`（pnpm add）更安全，审计的验收标准不变 |
| 失败路径 | 桥包未构建时安装抛错：启动不失败（try/catch 记入本地诊断 stderr `[host] approval bridge staging failed: …`），保持原懒加载行为——聊天回合仍会重试并给出"先构建 Host 与桥"的既有错误 |
| 幂等 | 重开同一数据根重复安装只是覆盖拷贝，不产生副作用（测试覆盖三轮 open/close） |
| 边界 | 不改契约、无迁移、无权限变化；不触碰 GAP_AUDIT.md（属未合并的 PR #122） |

## 2. 实际检查

环境：Windows 11 x64、Node v24.20.0、pnpm 11.28.5。测试需设 `APPDATA`。

| 实际命令 | 结果 |
| --- | --- |
| host `vitest run src/bridge-staging.test.ts` | 2 通过：启动后 `<harnessHome>/profiles/sdk/node_modules/@deepseek-bot/harness-bridge/dist/index.js` 存在；同一数据根三轮 open/close 幂等重装不损坏 |
| host 包全量 | 268 通过 + 既有抖动（connector-invoke 1 例、real-app-tools 1 例并行负载下 harness 超时家族，两文件隔离复跑均通过；本片不改这些路径） |
| `pnpm lint` / `pnpm typecheck` | 见 PR 验证证据表（全量复跑） |

## 3. 未验证

- **真实钉扎 Harness 的告警消失**：验收标准"启动后不再出现 `entry did not activate`"需要真实 `dsh` 启动观察 stderr，本片只验证桥包已就位（文件级）；真实链路复核归 D21'/D23 真机项。
- 桥事件在真实聊天回合可达 Host（审计 G2 第二条验收）依赖真实 Harness + 模型回合，归 G3/G4 真实链路验收。
- 未跑 GitHub Actions（分钟额度已用尽）。

## 4. Etheslay 本人自审

- 已审提交 SHA / 日期：
- 差异、需求和错误路径检查结果：
- 测试证据 / 兼容性与权限影响：
- 遗留问题与处理方式：
- 自审结论：

新增提交后更新本节；自审留给 Etheslay 本人填写，此处不代填。
