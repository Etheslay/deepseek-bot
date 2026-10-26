# 开发环境基线

本文记录 D00 工程基线在干净 Windows 环境实测通过的命令。只写实际跑通的步骤；未验证项见 [engineering-baseline-report.md](reports/engineering-baseline-report.md)。

## 环境要求

| 项 | 版本 / 说明 |
| --- | --- |
| OS | Windows 11 x64（本基线验证环境） |
| Node.js | `>=24`（验证时为 Node 24） |
| 包管理 | pnpm `11.28.5`，由 Corepack 驱动 |
| 包管理字段 | 根 `package.json` 的 `packageManager` 固定为 `pnpm@11.28.5` |

不要使用浮动的 `latest` 安装 pnpm，也不要绕过 Corepack 另装不一致版本。

## 首次安装

在仓库根目录：

```powershell
corepack enable
pnpm install --frozen-lockfile
```

期望：安装成功；`pnpm-lock.yaml` 无改动；无未知来源安装脚本。

若尚未启用 Corepack：

```powershell
corepack enable
corepack prepare pnpm@11.28.5 --activate
```

## 日常质量命令

均在仓库根目录执行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
```

| 命令 | 作用 |
| --- | --- |
| `pnpm lint` | ESLint 9 flat config（含 typescript-eslint） |
| `pnpm typecheck` | 对各 workspace 包执行 `tsc --noEmit` |
| `pnpm test` | 跑各包测试：`@deepseek-bot/shared`（脱敏用例）、`apps/desktop`（IPC 白名单）、`@deepseek-bot/contracts`（契约 schema、夹具场景与 D01 样本校验，含覆盖率门槛）、`@deepseek-bot/storage`（存储、备份恢复与凭据仓，含覆盖率门槛）、`@deepseek-bot/runtime`（工作流引擎：DAG、并发、失败/取消/审批/恢复，含覆盖率门槛） |

## 桌面壳命令（D02 起可用）

`apps/desktop`（Electron + React + TypeScript）已纳入 workspace，命令均在仓库根目录执行：

```powershell
pnpm --filter @deepseek-bot/desktop dev        # 开发模式
pnpm --filter @deepseek-bot/desktop build      # 构建到 apps/desktop/out/
pnpm --filter @deepseek-bot/desktop test       # 桌面壳单元测试
pnpm --filter @deepseek-bot/desktop pack:dir   # 构建 + electron-builder --dir（unpacked）
```

- 根 `pnpm lint` / `pnpm typecheck` / `pnpm test` 已覆盖桌面包，无需额外步骤。
- `electron-vite` 将 main / preload 构建为 CJS（`.cjs`，沙箱 preload 要求）；renderer 为普通 Vite 构建。
- 打包输出 `apps/desktop/release/win-unpacked/`，中间产物 `out/`，均已 gitignore；不要提交。
- electron-builder 需要缓存 Electron 发行包；默认缓存目录不可写时设置 `ELECTRON_CACHE` / `ELECTRON_BUILDER_CACHE` 指向可写目录。
- `pnpm-workspace.yaml` 的 `allowBuilds` 批准了 `esbuild` 与 `electron` 的官方安装脚本；干净克隆后 `--frozen-lockfile` 安装无需交互。
- 结构、IPC 白名单、安全设置与占位范围见 [桌面壳](DESKTOP_SHELL.md)。

## Workspace 布局

```text
package.json              # 私有根包；脚本与共享开发依赖
pnpm-workspace.yaml       # packages/*、apps/*
packages/shared/          # 最小共享包（密钥脱敏）
packages/contracts/       # 契约 schema、场景夹具与契约测试（D03 起存在）
packages/storage/         # 本地存储后端：SQLite、数据目录、凭据 blob、备份恢复（D04 起存在）
packages/runtime/         # 工作流执行引擎 + 后端工具权限层：DAG、并发、失败/取消、审批、事件、恢复、路径约束、工具策略、MCP 授权（D06/D08 起存在）
apps/desktop/             # Electron 桌面壳（D02 起存在）
.github/workflows/ci.yml  # windows-latest + Node 24
```

新任务一律从最新 develop 拉 feature 分支；根配置（`packageManager`、`engines`、workspace 列表、`allowBuilds`）变更走小型独立 PR 并连带锁文件。

## 依赖与版本策略（D03 落盘）

- 包管理器：根 `package.json` 的 `packageManager` 固定为 `pnpm@11.28.5`（与上游 Harness 源码固定一致），经 Corepack 驱动；Node `engines` 为 `>=24`。
- **精确版本**：所有 `dependencies` / `devDependencies` 只写确切版本，不使用 `^` / `~` / `latest`；升级必须是显式 diff 并经该任务负责人自审。
- **锁文件**：单一 `pnpm-lock.yaml` 是依赖图的唯一事实来源，随依赖变更同提交；CI 使用 `pnpm install --frozen-lockfile`，锁文件与 manifest 不一致直接失败。解决冲突时以 develop 为基线重新安装，不手工编辑锁文件。
- **安装脚本**：`pnpm-workspace.yaml` 的 `allowBuilds` 仅批准 `esbuild` 与 `electron`；新增需要 install/postinstall 脚本的依赖（如 D01 记录的 koffi / node-pty）必须在受控环境单独评估后再批准。
- **上游 Harness 依赖**：`@deepseek-ai/dsh` 固定 `0.2.1-rc.2`（源码提交 `687f282e`，见 D01 记录）。它在首个消费方任务（runtime/适配层）中以精确版本进入锁文件；届时全量导出传递依赖许可清单（承接 D01 §3 待办）。在此之前不把上游依赖预先装进仓库。
- **workspace 包版本**：均为 private、不发 npm。`@deepseek-bot/shared` `0.0.0`；`@deepseek-bot/contracts` 跟随契约版本（当前 `0.1.0`）；`@deepseek-bot/storage` `0.1.0`；`@deepseek-bot/runtime` `0.1.0`；`@deepseek-bot/desktop` `0.1.0`。
- **运行时 API 依赖**：`@deepseek-bot/storage` 依赖 Node ≥ 24 内置的 `node:sqlite`（D04 实测 24.15.0），不引入 SQLite 原生依赖；Electron 38 主进程内置 Node 22 无该模块，storage 只能在独立 Host 进程运行（见 [packages/storage/README.md](../packages/storage/README.md)）。

## Windows 注意事项

### D15 SearXNG 搜索服务配置

独立 Host 在启动时读取 `DEEPSEEK_BOT_SEARXNG_URL`；桌面 main 启动 Host 时会继承环境变量。例如使用自行配置、已启用 JSON 的本地 SearXNG：

```powershell
$env:DEEPSEEK_BOT_SEARXNG_URL = 'http://127.0.0.1:8080/search'
pnpm --filter @deepseek-bot/desktop dev
```

地址必须为完整搜索端点、HTTPS 或 HTTP 回环地址，不能含凭据、查询串或 fragment。远程 SearXNG 可使用 HTTPS；未设置时 `web_search` 明确报未配置，不选取隐式公共实例。桌面设置里的 SearXNG 地址会覆盖这个环境变量；在设置里清除后，即使进程仍带有环境变量，下次启动也不使用它。设置页只保存地址，不会为了试通去访问实例。配置地址本身不授权搜索：聊天调用由 Host 按该 bot 的网络策略决定是否出站。搜索查询会发给该服务及其上游引擎，服务须启用 `json` 格式，见 [SearXNG 官方 API](https://docs.searxng.org/dev/search_api.html) 与 [agent-tools 接口说明](../packages/agent-tools/README.md)。

### 通用事项

- 使用 PowerShell 或 Windows Terminal；路径使用仓库根，避免混入未跟踪的 `handoff/`。
- Corepack 需要对本机 Node 安装目录有写权限；若 `corepack enable` 失败，以管理员权限重试或记录阻塞，不要静默换 pnpm 版本。
- 不要提交 `node_modules/`、`dist/`、`coverage/`、`.env`；已由根 `.gitignore` 覆盖。
- CI 与本地均不配置密钥、不调用真实 API。

## CI

GitHub Actions 工作流：[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

- Runner：`windows-latest`
- Node：24 + `corepack enable`
- 步骤：`pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test`

草稿 PR 合并进 `develop` 前，应以该工作流在分支上的真实运行为准。

## 相关文档

- [贡献指南](../CONTRIBUTING.md)
- [测试策略](TESTING.md)
- [工程基线报告](reports/engineering-baseline-report.md)

## 依赖构建脚本（pnpm 11）

pnpm 11 默认忽略未批准的依赖 `postinstall`。本仓库在 `pnpm-workspace.yaml` 中声明：

```yaml
allowBuilds:
  esbuild: true
```

仅批准 vitest 间接依赖 `esbuild` 的官方安装脚本（下载平台二进制）。除此外无其他构建脚本。干净克隆后 `pnpm install --frozen-lockfile` 应直接成功，无需再交互批准。

## Corepack 权限

若 `corepack enable` 因 `C:\Program Files\nodejs\` 写权限失败（EPERM），可用：

```powershell
corepack prepare pnpm@11.28.5 --activate
```

确认 `pnpm --version` 输出 `11.28.5` 后再安装。不要静默换用其他 pnpm 主版本。
