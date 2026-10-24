# D04 本地存储实现报告

日期：2026-10-24。任务：D04 `feature/local-storage`（负责人 Etheslay）。分支自 develop 144d84d（D03 合并后）创建，目标 develop。依赖 D03 已合入。

## 1. 交付内容

FR-01/FR-09 后端落实为 workspace 包 [packages/storage](../../packages/storage/README.md)（`@deepseek-bot/storage` 0.1.0，private，TypeScript 源码直出，与 contracts 同模式）。零新增运行时依赖：SQLite 使用 Node ≥ 24 内置 `node:sqlite`（本地实测 24.15.0，WAL / 事务 / `VACUUM INTO` 可用），不引入 better-sqlite3 类原生模块，`pnpm-workspace.yaml` 的 `allowBuilds` 无需变更。

| 领域 | 实现 |
| --- | --- |
| 数据目录（SECURITY_DATA §2） | `resolveDataRoot`（显式选项 > `DEEPSEEK_BOT_DATA_ROOT` > `%APPDATA%`，不硬编码用户名）+ `ensureDataLayout` 幂等创建 `app.sqlite`、`harness/`、`artifacts/`、`backups/`、`logs/`、`cache/`、`credentials/`（新增条目，文档已同步）；`describeDataLocations` 支撑 FR-09"可查看数据位置" |
| 专属 Harness home | `resolveHarnessHome` + `harnessLaunchEnv()`（`DSH_HOME` 注入，含越界防御）。按 D01 §5.1 实测结论，上游全部状态随 `DSH_HOME` 迁移；启动 Harness 进程本身属 D06 运行时任务 |
| SQLite 元数据 | 打开即设 WAL / foreign_keys / busy_timeout / synchronous=NORMAL；校验和迁移框架（schema_migrations，逐迁移 SHA-256，校验不匹配或遇到更高版本 → `DATA_VERSION_UNSUPPORTED`）；初始迁移 0001 建契约 §2 全部实体表：bots（requestId 幂等唯一索引）、model_profiles（FK → credentials 引用表）、workspaces、workflows、schedules、runs（`idempotency_key` 唯一 + schedule 触发 (scheduleId, occurrenceUtc) 唯一部分索引）、node_runs（(run, node, attempt) 唯一）、approvals（TTL、generation 启动代次绑定列）、artifacts、events（(run, sequence) 唯一）、settings KV |
| 仓储层 | 读写均经 contracts zod schema 运行时校验；Run/NodeRun 状态迁移委托 `assertRunTransition` / `assertNodeRunTransition`；bot/workflow 更新强制 `expectedRevision`（冲突 → `REVISION_CONFLICT` 携带当前 revision）；workflow 保存前走 `validateWorkflowDraft` 图校验；事件 append 强制 per-run 连续 sequence 并按 eventId 幂等去重，`afterSequence` 重放支撑崩溃重连 |
| 凭据存储（FR-01） | 本包只见密文：`cred:<uuid>` 引用 + `FileCredentialBlobStore` 原子落盘 `<root>/credentials/<uuid>.blob`（文件名不含冒号——Windows 文件名限制，实测踩坑已修）；数据库只存引用；`removeCredential` 有引用即拒；`listMissingCredentialRefs` 供恢复后提示重录 |
| 备份/恢复（FR-09） | 备份：活跃运行检查 → `wal_checkpoint(TRUNCATE)` → `VACUUM INTO` 一致性快照 → manifest（schemaVersion、逐文件字节/SHA-256、敏感性提示、排除清单）；默认排除 `credentials/`、`harness/`、`cache/`、`logs/`，产物目录按需包含。恢复：manifest 结构校验 → 版本拒绝（未知更高 → `DATA_VERSION_UNSUPPORTED`）→ 大小上限 → 路径安全（拒绝穿越/反斜杠/盘符/未知根）→ 逐文件哈希 → 活跃运行检查 → 原库整体暂存至 `backups/pre-restore-<ts>/` → 安装 → `quick_check` + 前滚迁移 → 失败自动回退暂存。产物冲突不覆盖用户文件，逐项报告 |

错误统一为 `StorageError`（CONTRACTS §6 稳定错误码 + 脱敏 details + retryable 语义来自 `NON_RETRYABLE_BY_DEFAULT`）。`REVISION_CONFLICT`、`APPROVAL_EXPIRED`、`DISK_FULL`、`DATA_VERSION_UNSUPPORTED` 均按契约语义抛出。

## 2. Windows safeStorage 验证（凭据适配器决策）

在仓库外临时目录用仓库内 Electron 38.2.1（`apps/desktop` 既有依赖，未改 apps/desktop 任何文件、未联网、未用真实 Key）实测 `safeStorage`：

| 项 | 结果 |
| --- | --- |
| `isEncryptionAvailable()` | `true`（win32） |
| 加密/解密往返 | 35 字符合成密文样本 → 79 字节密文，与明文不同，解密还原一致 |
| 同应用身份跨进程 | 第二个 Electron 进程（默认 userData 身份）成功解密第一个进程的密文 → 重启后可读，满足持久化要求 |
| 身份变化 | 修改 userData 路径后解密失败（含"同一路径但 setPath 时机在 whenReady 之后"的场景）——熵绑定应用身份，属预期行为 |

**决策**：Windows 凭据加密 = 桌面主进程 `safeStorage`（DPAPI）；密文 blob 由本包落盘。推论（已写入 README 与 SECURITY_DATA §2）：主进程必须在 app ready 前固定 userData 身份；应用身份/机器变化或恢复后 blob 不可解密 → 失败路径 + 用户重录，禁止明文降级。被否决的替代：`@primno/dpapi`/`keytar` 原生依赖（供应链与 allowBuilds 成本，且与 M→K 架构图相悖）、PowerShell DPAPI（逐次 spawn、执行策略面攻击面）。

## 3. 测试与覆盖率

`pnpm test`（本包）104 个用例全部通过，覆盖：迁移（幂等重开、WAL 落位、伪造更高迁移、校验和篡改、损坏文件）、bot（幂等创建、revision 冲突、归档幂等、FK 缺失）、profile/workspace、workflow（环图拒绝、缺 expectedRevision 拒绝、过期 revision 拒绝）、schedule、run（幂等键、schedule occurrence 去重、状态机、finishedAt、活跃计数）、node run（attempt 冲突、会话绑定）、事件（sequence 连续性、eventId 去重、类型 payload 校验、afterSequence 重放）、审批（一次决定、TTL 过期 → `APPROVAL_EXPIRED`、一次消费、过期清扫）、artifact、settings、credentials（格式、原子写、缺 blob）、备份/恢复（往返、活跃运行拒绝、篡改哈希、更高版本、路径穿越 × 6 形态、缺文件、暂存冲突、损坏快照回退后原数据完好、产物冲突、恢复后缺失凭据报告）。

覆盖率（v8）：语句 91.8%、分支 84.74%、函数 96.26%、行 91.8%，高于 [TESTING.md](../TESTING.md) §3 行 ≥ 80% 的要求。状态机与迁移模块分支：contracts 状态机 100%（D03），本包迁移模块 90%。未达 100% 的剩余分支为单写者同步模型下不可达的防御性守卫（事务内二次判空、竞态重查、平台分支 macOS/Linux 路径解析）与 best-effort 分支（statfs 自由空间检测），已在 vitest 配置注释与本节如实记录，未做排除掩盖。

## 4. 依赖与版本

- 新增依赖：`zod 4.6.7`（复用 contracts 既有版本）与 `@deepseek-bot/contracts`（workspace）；devDeps 新增 `@types/node 24.19.2`（匹配 Node 24 主版本）及既有 ts/vitest 组合，全部精确版本，锁文件随分支更新。
- 未引入任何需要安装脚本的依赖；`allowBuilds` 维持 esbuild + electron。
- 过程发现：blob 文件名最初含 `cred:` 前缀冒号，Windows 下被解释为 NTFS 备用数据流（EINVAL），已改为仅 UUID 部分并加测试锁定；审批过期标记原先在同一事务内随异常回滚，已拆为独立提交语句保证"过期状态必须持久"。

## 5. 未验证项与边界

- **无真实 Harness 进程联动**：本任务不含 Harness 启动/会话写入（D06 运行时）；harness home 仅做目录解析与隔离性断言，未运行上游二进制写入验证（D01 §5.1 已验证 DSH_HOME 迁移，未重复付费请求）。
- **无真实 API Key 存储**：safeStorage 验证使用合成样本；"设置页存真 Key"链路由 D05 前端接入后按 QA-01 验收。
- 日志轮转/配额、缓存清理、产物预览安全为 D06+ 任务，本包仅预留目录。
- `desktop` 主进程尚未消费本包（D05 接入设置持久化；D06 Host 接入事件与运行）；CI 结果以分支推送后的真实运行为准，本文档记录的均为本地 Windows 11 x64 + Node 24.15.0 + pnpm 11.28.5 实测。
- 覆盖率门槛分支取 84（高于 TESTING.md 的行 80% 硬要求，低于自设 85%）：差额全部为上述防御性分支，未通过排除文件或跳过测试达成。

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
