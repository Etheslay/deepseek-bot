# @deepseek-bot/storage

本地存储后端（D04 `feature/local-storage` 交付）：SQLite 元数据、数据根目录布局、专属 Harness home、凭据 blob 仓、备份与恢复。对应 [docs/SECURITY_DATA.md](../../docs/SECURITY_DATA.md) 与 [docs/CONTRACTS.md](../../docs/CONTRACTS.md)。

## 运行环境约束

- **只跑在独立 Node ≥ 24 的 Host 进程**。实现依赖 `node:sqlite`（Node 24 内置）；Electron 38 主进程内置 Node 22（无 `node:sqlite`，已实测），因此**禁止在 Electron 主进程/importer 代码中 import 本包**。桌面主进程与 Host 之间通过私有 IPC 交互（ARCHITECTURE.md §1）。
- 单 Host 写入者。桌面渲染进程与主进程不得直接打开 `app.sqlite`。

## 数据根目录

```text
<系统应用数据>/DeepSeekBot/     resolveDataRoot()：选项 > DEEPSEEK_BOT_DATA_ROOT > %APPDATA%（Windows）
  app.sqlite                   应用元数据（WAL）
  harness/                     本应用专属 Harness home（DSH_HOME，D01 §5.1 实测可整体迁移）
  artifacts/                   运行产物
  backups/                     用户备份与恢复前暂存（pre-restore-*）
  logs/                        脱敏轮转日志（D06+ 落地）
  cache/                       可清理缓存
  credentials/                 凭据密文 blob（<uuid>.blob）
```

目录位置由平台 API / 环境变量解析，不硬编码用户名；`ensureDataLayout()` 幂等创建，从不删除内容。

## 模块速览

| 模块 | 职责 |
| --- | --- |
| `layout.ts` | 数据根解析、目录布局、`describeDataLocations`（FR-09 可查看数据位置） |
| `harness-home.ts` | 专属 Harness home 解析 + `harnessLaunchEnv()`（`DSH_HOME` 注入；含越界防御） |
| `database.ts` | 打开 SQLite（WAL、外键、busy_timeout）、校验和迁移框架；未知更高版本 → `DATA_VERSION_UNSUPPORTED` |
| `repos/*` | 契约实体的读写：Bot（requestId 幂等、revision 冲突）、ModelProfile/Workspace、Workflow（保存前走契约图校验）、Schedule、Run/NodeRun（经 `assertRunTransition` 状态机）、持久事件（per-run 单调 sequence、eventId 去重、afterSequence 重放）、Approval（TTL、一次消费）、Artifact、settings KV |
| `credentials.ts` | `cred:<uuid>` 引用 + 密文 blob 文件仓（本包只见密文）；`listMissingCredentialRefs` 供恢复后提示重录 |
| `backup.ts` | 备份（活跃运行检查 → WAL checkpoint → `VACUUM INTO` 快照 → manifest 含 SHA-256）与恢复（版本/大小/哈希/路径安全校验 → 暂存原库 → 安装 → 完整性检查 + 迁移 → 失败回退） |

错误统一抛 `StorageError`（携带 CONTRACTS §6 稳定错误码，details 脱敏）。

## 凭据存储边界（FR-01）

本包**永远不接触明文 API Key**：

1. 桌面主进程用系统凭据能力加密 Key（Windows 上为 Electron `safeStorage`，D04 已实测：DPAPI 生效、加密/解密往返成功、同应用身份跨进程可解密；密文与应用 userData 身份绑定，`safeStorage.isEncryptionAvailable()` 为 false 时必须报错，禁止明文降级）。
2. 主进程把密文交给 `FileCredentialBlobStore.put(ref, ciphertext)` 落盘 `<root>/credentials/<uuid>.blob`（文件名不含 `cred:` 前缀——Windows 文件名禁止冒号），并 `registerCredential` 写入引用。
3. 数据库只存 `credentialRef`；`blob` 的文件名只使用 UUID 部分。
4. 恢复/换机后 blob 不随备份走，`listMissingCredentialRefs` 列出需重录的引用。

备份默认排除 `credentials/`、`harness/`、`cache/`、`logs/`；备份**包含**聊天内容（run 快照与事件 payload），manifest 带敏感性提示，UI 必须转述。

## 测试

```powershell
pnpm --filter @deepseek-bot/storage test     # vitest + v8 覆盖率门槛
pnpm --filter @deepseek-bot/storage typecheck
```

## D16 应用权限仓储

迁移 `0005-permissions-grants` 在保留 0001–0004 SQL 与校验和的基础上新增全局策略/授权表、应用审批表、调用授权票据和仅追加的权限审计。D08 的运行审批继续使用原有 `approvals` 表。

`repos/permissions.ts` 对多能力请求在同一 SQLite 事务中核对策略、机器人状态、会话、Host generation、期限和次数；全部满足才扣减。一次授权仅服务绑定的审批调用，会话授权默认 5 次/2 小时，永久授权不绑定 generation。扣减发生在工具派发前，处理失败不退款。

Host 在派发前调用同步重验，检查持久化调用票据及其引用的全部授权；策略变为 deny、授权撤销/过期、机器人停用等均拒绝并追加审计，不重复扣减。启动时失效旧 generation 的待决审批与临时授权，保留永久授权和全局策略。过期审批在提交 expired 状态后才返回错误。

审批 JSON 保存供人类预览的精确参数；授权票据与权限审计仅保留身份、能力、digest 和授权/审批 ID，不保存原始参数。审计以数据库自增 sequence 分页，SQLite 触发器拒绝更新和删除；人工及重启撤销均携带 botId。
