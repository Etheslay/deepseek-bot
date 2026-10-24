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
| `pnpm test` | 跑各包测试；当前包含 `@deepseek-bot/shared` 的 `redactSecrets` 用例与覆盖率门槛 |

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
apps/desktop/             # Electron 桌面壳（D02 起存在）
.github/workflows/ci.yml  # windows-latest + Node 24
```

后续 D01（Harness）与 D02（桌面壳）应从 `develop` 拉分支，不再改根配置。

## Windows 注意事项

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
