# 工程基线报告（D00）

- 任务：D00 协作区 / 共享工程基线
- 分支：`feature/engineering-baseline`
- 最新 SHA：以本分支 tip 为准（验收时执行 `git rev-parse HEAD`）。文档内容提交短 SHA 见第 9 节。
- PR：未创建（本机执行；由 Push 推远程并开草稿 PR → `develop`）
- 环境：Windows 11 x64；Node v24.16.0；pnpm 11.28.5（corepack prepare）；执行时区 America/Los_Angeles
- 基线：开工时 `origin/develop` = `fba1844`
- `feature/parallel-decision`：已合并，PR #5（`7ecbbba`）

## 1. 开工门禁

| 项 | 结果 |
| --- | --- |
| `origin/develop` 含 DEVELOPMENT_PLAN / KICKOFF_CHECKLIST / CONTRACTS | 通过 |
| `origin/develop` 无 `package.json` / `pnpm-workspace.yaml` | 通过 |
| 工作区干净（仅未跟踪 `handoff/`，不提交） | 通过 |
| 从最新 `origin/develop` 创建 `feature/engineering-baseline` | 通过 |
| 未从 `feature/project-standards` 开工 | 通过 |

## 2. B1–B8 验收证据

### B1 全新安装（frozen-lockfile）

- 命令：`corepack prepare pnpm@11.28.5 --activate`；`pnpm install --frozen-lockfile`
- 时间：2026-10-24 00:21:40 America/Los_Angeles
- 退出码：0
- 关键输出：

`	ext
Scope: all 2 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 365ms using pnpm v11.28.5
`

- 说明：`corepack enable` 对本机 `C:\Program Files\nodejs\` 写权限 EPERM；改用 `corepack prepare … --activate` 后 `pnpm --version` = 11.28.5。pnpm 11 需在 `pnpm-workspace.yaml` 声明 `allowBuilds.esbuild: true`（仅 esbuild 官方 postinstall）。锁文件无改动。

### B2 lint

- 命令：`pnpm lint`
- 时间：2026-10-24 00:22:10 America/Los_Angeles
- 退出码：0
- 关键输出：`$ eslint .`（0 error，0 warning）

### B3 typecheck

- 命令：`pnpm typecheck`
- 时间：2026-10-24 00:22:15 America/Los_Angeles
- 退出码：0
- 关键输出：`$ tsc -p tsconfig.json --noEmit`（packages/shared）

### B4 test

- 命令：`pnpm test`
- 时间：2026-10-24 00:22:17 America/Los_Angeles
- 退出码：0
- 关键输出：

`	ext
RUN  v3.2.4 D:/PersonProgram/deepseek-bot/packages/shared
✓ src/redact.test.ts (6 tests)
Test Files  1 passed (1)
Tests  6 passed (6)
redact.ts coverage: Stmts/Branch/Funcs/Lines 100%
`

### B5 CI

- 状态：**UNVERIFIED**
- 原因：分支尚未推送，无 GitHub Actions 运行。工作流已添加：`.github/workflows/ci.yml`（`windows-latest`、Node 24、corepack、lint/typecheck/test）。Push 开草稿 PR 后应以真实运行结果为准，不得伪造通过。

### B6 安全与卫生

- 无 Key / `.env` / 用户数据 / 构建产物入库意图
- `node_modules` / `coverage` / `dist` 由 `.gitignore` 覆盖
- `handoff/` 保持未跟踪，不提交
- `git status` 在提交完成后应仅含本任务预期已跟踪文件

### B7 文档

- 新建 `docs/DEVELOPMENT_SETUP.md`（命令与本节实测一致）
- `CONTRIBUTING.md`「开发环境基线」指向该文档
- `README.md` 文档入口已加入该文档

### B8 边界

- 无 `apps/desktop`、无 Electron/React/UI、无 Harness、无数据库、无 `packages/contracts`
- `packages/shared` 仅含 `redactSecrets` 脱敏工具与测试

## 3. 依赖版本与许可证

直接开发依赖（确切版本）：

| 包 | 版本 | 许可证（结论） |
| --- | --- | --- |
| `@eslint/js` | 9.37.0 | Apache-2.0 / MIT 系（与 eslint 生态一致） |
| `eslint` | 9.37.0 | MIT |
| `typescript-eslint` | 8.46.0 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `prettier` | 3.6.2 | MIT |
| `vitest` | 3.2.4 | MIT |
| `@vitest/coverage-v8` | 3.2.4 | MIT |

传递依赖许可证以 `pnpm licenses list` 为准：主要为 MIT / Apache-2.0 / ISC / BSD-2-Clause / BSD-3-Clause / BlueOak-1.0.0 / Python-2.0。未发现与本私有仓库开发工具链明显冲突的 copyleft 分发问题。`esbuild` 为唯一批准的构建脚本依赖（MIT）。

## 4. 未验证项

| 项 | 原因 | 最高可能判定 |
| --- | --- | --- |
| 远程 CI 绿 | 分支未推送 / 无 PR | PASS-WITH-FIXES（待 Push 后补证据） |
| 跨盘符全新 clone 路径 | 本机验证在 `D:\PersonProgram\deepseek-bot`；pnpm 因跨盘无法硬链而改用 `D:\PersonProgram\.pnpm-store` | 记录事实；不影响功能 |

## 5. 已知问题与风险

1. `corepack enable` 在无管理员写权限时 EPERM；文档已写 `prepare --activate` 绕过。
2. pnpm 提示 store 跨盘符无法硬链，使用项目旁 store；可接受。
3. `eslint@9.37.0` 安装时标记 deprecated（上游提示有更新）；按任务要求固定确切版本，不顺手升级。
4. CI 未跑；合并前必须有真实 Actions 结果。

## 6. 回退方式

`powershell
git checkout develop
git branch -D feature/engineering-baseline
# 若已推送：关闭草稿 PR，删除远程 feature 分支（由负责人/Push 执行）
`

根配置与 `packages/shared` 整包随分支删除即可；无数据迁移。

## 7. 对 D01 / D02 的前置说明

D01（Harness）与 D02（桌面壳）应从合并后的 `develop` 拉分支，复用本仓库根 `package.json` / workspace / CI，不再改根工具链。共享脱敏使用 `@deepseek-bot/shared` 的 `redactSecrets`。

## 8. PR 描述草稿

> 由 Push 创建草稿 PR（base=`develop`）时使用。负责人自审记录保持空模板。

### 变更与目标

- 关联 Issue / Dxx：D00 工程基线
- 作者 / 负责人：（负责人本人）
- 来源分支 → 目标分支：`feature/engineering-baseline` → `develop`
- 可观察行为变化：仓库具备 pnpm workspace、lint/typecheck/test 与 Windows CI；新增 `packages/shared` 密钥脱敏与文档

### 范围与接口

- 涉及模块：根配置、`.github/workflows/ci.yml`、`packages/shared`、开发文档
- 契约 / 数据格式 / 权限变化：无
- 不做的和后续任务：无 Electron/Harness/数据库/契约 schema（属 D01+）

### 验证证据

| 检查 | 提交 SHA / 日期 | 关键结果 | 本地证据 |
| --- | --- | --- | --- |
| lint / typecheck / test | （Push 后填最新 SHA） / 2026-10-24 | 本地均 exit 0；coverage 100% | 本报告 B2–B4 |
| CI windows-latest | — | UNVERIFIED（待 PR） | workflow 已添加 |

未执行或未验证的检查及原因：远程 CI（分支未推送）。

### 负责人自审记录

- 最新提交 SHA / 日期：
- 检查、测试和关键路径覆盖：
- 安全证据 / 数据与权限影响：
- 遗留问题与处理方式：
- 自审结论：

（新增提交后更新本节；不替代下一道门槛，也不用 GitHub 的 Reviewer Approve 作为自审形式。）

### 风险、迁移与回退

无数据/契约迁移。回退见第 6 节。已知问题见第 5 节。

### 合并前

- [ ] 分支目标符合 Git 工作流；提交不含凭证和用户数据。
- [ ] 代码、测试和文档一致；依赖 PR 已合入。
- [ ] 最新提交的必要检查通过或问题已解释。
- [ ] 负责人已对最新提交完成自审，并记录 SHA、日期、验证证据与结论。
- [ ] 若目标是 main（release/hotfix），已完成验证包与安装升级验证（参见 RELEASE.md）。

## 9. 提交记录

| SHA | 说明 |
| --- | --- |
| `9052062` | `build: add pnpm workspace baseline` |
| `a3748d6` | `ci: add windows quality workflow` |
| `0ff63e7` | `feat(shared): add secret redaction helper` |
| `fba1844` | `docs: record development setup and baseline report` |

