# D01 Harness 接入技术验证记录

日期：2026-10-23（America/Los_Angeles）。任务：D01 `feature/harness-adapter`（负责人 Etheslay）。分支自 develop 1839928 创建。

执行环境：Windows 11 x64（本机内核 10.0.26100）、Node v24.15.0、pnpm 11.7.0、npm 11.12.1。所有安装与运行均在仓库外的临时隔离目录完成，未触碰仓库与个人数据。

**状态：版本固定、完整性与无 Key 冒烟（2026-10-23，§1–§5）与真实接入验证（2026-10-24，测试 Key，§8）已完成并留证；审批端到端、PTY/原生脚本、正式性能基线仍未执行（§6），本文对未验证项如实标注。**

## 1. 版本固定与映射

| 项 | 结论 |
| --- | --- |
| 上游固定源码提交 | `687f282e8625c6b8d11ff58211a90524be2e4317`（与 [HARNESS_INTEGRATION](HARNESS_INTEGRATION.md) §1 调研基线一致；本次经 HTTPS 浅拉取并检出核对） |
| npm dist-tags | `latest` 0.2.1-rc.2、`next` 0.2.1-rc.3、`alpha` 0.2.1-alpha.5；registry.npmjs.org 与 registry.npmmirror.com 双源元数据一致 |
| 发行包完整性 | tarball 25,130 字节（来源 registry.npmjs.org）；sha512 SRI `sha512-tvY+yhfKRifthbqPe/OK0AYxM5ZkvqfYq/jMYgJcEUxiRRL1Vwra3Ti5TB6AXgSWQdiPHYh/Vp6SJa9yHwMNuw==` 与 sha1 `a502d1551aabc881020e3cb7961c38901565731a` 均与注册表元数据一致 |
| 源码↔发行包映射 | 源码根 `@deepseek-ai/dsh-root` 0.2.1-rc.2；`apps/cli/package.json` = `@deepseek-ai/dsh` 0.2.1-rc.2（MIT、无 scripts、bin `dsh` → lib/bin.js）。发布包 86 项依赖与源码 86 项一一对应、无增减，`workspace:*` / `workspace:~` 被替换为精确版本，属标准 monorepo 发布转换 |
| 本项目固定决策 | 消费 `@deepseek-ai/dsh` 精确版本 `0.2.1-rc.2`，映射源码提交 `687f282e`；不使用 `latest`、浮动分支或启动时下载（符合 [HARNESS_INTEGRATION](HARNESS_INTEGRATION.md) §5）。`next` / `alpha` 存在但不采用 |

## 2. 工具链核对

- Node v24.15.0：满足上游 `^22.19.0 || >=24.0.0`（落入 `>=24` 分支）。
- pnpm 本机 11.7.0 ≠ 上游源码 `packageManager` 固定的 11.28.5。实测消费发行包（安装、`--version`、dump、profile 启动）不受影响；需要从源码构建上游时经 corepack 固定 11.28.5。本项目自身的 packageManager / 锁文件基线由 D03 决定并落盘，禁止两人各自漂移。
- 入口发行包未声明 `engines` / `packageManager` 字段；Node 兼容约束来自上游 monorepo 根声明。此为事实记录，安装时不被 npm 强制。
- 安装脚本约束（"不执行来源未知的安装脚本"）：入口包无任何 scripts；本次安装整体使用 `--ignore-scripts`，被跳过脚本的包为 koffi（install）、node-pty（install、postinstall）、protobufjs（postinstall），均为主流公开包，后续如需启用在受控环境单独评估。

## 3. 依赖许可清单

- 86 项直接运行时依赖逐项核对 registry 元数据：**全部 MIT**（86/86，0 项失败），见 §7 表格。
- 入口包 LICENSE：MIT（Copyright (c) 2026 DeepSeek）。
- 上游仓库根提供 LICENSE 与 THIRD_PARTY_NOTICES.md；本项目再分发或捆绑上游代码时必须保留（对应启动清单 0.3 许可义务）。
- 传递依赖许可清单待 D03 生成锁文件后全量导出；本表覆盖直接依赖，供 D03 起步。

## 4. 安装与无 Key 冒烟（隔离环境实测）

验证目录：临时 `install-test` + 独立 `DSH_HOME`（用户临时目录下 `dsh-verify-d01/home`），不与本机既有配置混用。

| 步骤 | 结果 |
| --- | --- |
| `pnpm install --ignore-scripts` | resolved 629 / downloaded 526 / added 557，32 秒完成 |
| `dsh --version` | 输出 `0.2.1-rc.2` |
| `dsh --profile web --dump-default-config` / `--dump-config` | 输出完整组合配置树（1,229 行），退出码 0；按官方文档不启动进程、不调用模型 |
| `dsh --profile web` 最小启动（无 Key） | 成功监听 `127.0.0.1:3080`（默认，netstat 证实仅回环）；未携带 token 的请求返回 401，真实访问 URL 含一次性 `?token=`；首次启动约 15–25 秒（profile 模板初始化）；默认自动打开系统浏览器，`--no-open` 可关闭 |
| 进程回收 | 对监听进程强制终止后端口 3080 释放、进程消失；优雅关闭（协议 shutdown / 有界关闭）路径本次未测，列入 §6 |
| 原生依赖（Windows） | 原生二进制以预编译形式随包分发：sharp-win32-x64、koffi-win32-x64 3.1.1、node-addon-require-builtin-win32-x64-msvc（napi-v9 prebuilt）、node-pty prebuilds（含 win32 conpty）。`--ignore-scripts` 下 CLI 与 Web 服务正常；PTY/终端功能未验证 |
| 已知上游问题 | peer 依赖警告：@opentelemetry/api 安装 1.10.0，上游 otel 系列要求 `<1.10.0`。属上游打包不一致，未阻塞本次冒烟；升级上游版本时复核 |

初步结论：发行包在本机 Windows 11 x64 + Node 24 上无需本地构建工具链即可安装、启动、提供本地 Web 服务（--ignore-scripts 条件下）。进程 RSS 约 187 MB（单样本粗测，正式基线待 §6）。

## 5. 数据位置、遥测与外联面

### 5.1 profile 数据位置（DSH_HOME 首次运行产物）

- `.anonymous-user-id`（匿名标识持久化文件）
- `.credentials.yaml`（凭据存储入口；本次未读取内容）
- `profiles/web/`：`cordis.yml`、`cordis.patch.yml`、`package.json`、`pnpm-workspace.yaml`
- `storages/workspace.json`

全部位置随 `DSH_HOME` 迁移，可指向应用数据根下的专属 Harness home——这是 D04 存储设计的直接输入。凭据文件内容不进入仓库与本记录。

### 5.2 默认遥测（必须处置的外联）

- `session-telemetry-otel`：默认模式 `FEEDBACK_ONLY`（仅当用户显式提交反馈时上传会话历史），OTLP exporter 默认指向 `https://dsh-otel-collector.deepseeksvc.com/v1/logs`（gzip）。
- 合法模式仅 `FEEDBACK_ONLY | DISABLED`（固定版本源码 `packages/session/session-telemetry-otel/src/index.ts` 枚举）；`DISABLED` 不读取端点与超时配置。
- 已实测处置方式：`--patch` 覆盖层写入 `- id: session-telemetry-otel / config: { mode: DISABLED }`，`--dump-config` 组合结果生效并注明补丁来源文件。本项目 Host 将固定该 patch。
- `desktop-product-telemetry` 与 `product-analytics` 仅在 desktop profile 启用（profileContext 判定），web / sdk 下禁用。

### 5.3 其余默认面

- Web 服务默认绑定 `127.0.0.1:3080`（经 `ctx.webStartup.host/port` 可覆盖）。
- 沙箱权限默认 `DSH_PERMISSION_MODE ?? 'workspace-write'`——D08 权限设计的输入项。
- CLI 拒绝 `desktop` profile（保留给 Electron 宿主），与 [ADR-0001](adr/0001-desktop-and-runtime.md) 的参考关系一致。
- 配置 dump 全文 URL 检索仅命中遥测收集端点一处；未发现默认更新检查或其他遥测外联。运行时级的外联观测（含模型 API）列入 §6 受控网络项。

## 6. 接入方式结论与未执行清单

### 结论（2026-10-24 经真实验证确认，证据见 §8）

- **首选接入：`dsh --profile sdk`**（JSON-RPC over stdio）。方法面自固定版本源码 `packages/sdk/protocol/src/types.ts` 核验，并经真实客户端实测：`initialize {cwd, provider, model, reasoningEffort?, maxTokens?}` → `{serverInfo:{name:"deepseek-harness-sdk-runtime"}}`；`session/prompt {sessionId, contentBlocks}` → `{messageId}` 持久入队回执；`session/resume {sessionId}` 修复中断轮次；`session/wait` 等待空闲；`shutdown` 优雅退出（exit 0）。通知：`session.event`（每会话持久事件，不过滤）、`session.status`（agent running/idle 转换）、`subagent.started/finished`。
- 辅助：`dsh web`（本地 UI）；`dsh --profile headless` 单任务冒烟可用（注意其默认模型为 `deepseek-flash` 且 `reasoningEffort: high`，并有标题生成 LLM 请求，成本高于 SDK 路径；SDK 组合包禁用标题 LLM，已实测确认）。
- 会话按客户端指定的 sessionId + 工作目录分桶持久化；事件 `seq` 全局单调且跨进程重启连续。

### 未执行清单（不以桩替代结论，2026-10-24 更新）

1. 审批允许/拒绝端到端：SDK 协议的 server→client 请求能力上游未启用（Python SDK 应答接口为未来审批预留），需先做受支持插件桥 / web API 接入决策（D08/D09 输入，见 §8.4）。
2. PTY/终端功能与 koffi / node-pty 安装脚本的受控启用对照验证。
3. 正式性能基线（进程树内存、包体、冷启动分布）与 ADR-0001 接受条件回填；§8.6 仅有粗测值。
4. 受控网络观测：确认除遥测（应已 DISABLED）与模型 API 外无其他运行时外联。
5. 将事件样本落成 D03 可执行契约测试（样本已存 [fixtures/d01](fixtures/d01/README.md)）。
6. 遥测 DISABLED patch 在 Host 中的常驻化（本阶段仅验证 patch 机制）。

## 7. 直接依赖许可清单（86 项，registry 元数据核对）

| 包 | 解析版本 | 许可证 |
| --- | --- | --- |
| @deepseek-ai/cordis | 4.0.5 | MIT |
| @deepseek-ai/cordis-plugin-include | 1.0.10 | MIT |
| @deepseek-ai/cordis-plugin-loader | 1.0.6 | MIT |
| @deepseek-ai/cordis-plugin-timer | 1.1.7 | MIT |
| @deepseek-ai/dsh-acp-app | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-agent-instructions | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-agent-preset | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-agent-tool-presentation | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-app-boot | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-atomic-write | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-base | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-client-ui-agent-preset | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-client-ui-cordis | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-cmdline | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-command-compact | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-command-goal | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-compaction-basic | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-compaction-tool-result-pruner | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-cordis-client-runner | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-agent-team-profile | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-auto-review | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-badge-skill-bundle | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-cot-translation-bundle | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-inspector-profile | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-plugin-market-bundle | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-ralph-bundle | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-session-search | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-session-titles-bundle | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-terminal-bundle | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-tool-worktree | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-experimental-voice-input-bundle | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-fs-local | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-goal | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-goal-round-driver | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-headless | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-hmr | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-home-paths | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-http-proxy | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-jobs-local | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-launch-environment | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-mcp-client | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-mcp-resources | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-persona | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-plan-mode | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-plugin-manager | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-pwsh-local | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-pwsh-sandbox | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-schedule | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-sdk-app | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-sdk-minimal | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-session-projection | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-session-reference | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-skill | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-skill-filesystem | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-skill-office | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-terminal | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-terminal-bash | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-time-context | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tmux-context | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-token-meter | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-ask-user | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-bash | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-bash-persistent | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-cordis | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-fs | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-fs-search | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-goal | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-jobs | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-present | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-pwsh | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-pwsh-persistent | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-schedule | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-skill | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-str-replace-editor | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-subagent | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-subagent-control | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-todo | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-web | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-workflow | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-tool-workspace-dependencies | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-web-app | 0.2.1-rc.2 | MIT |
| @deepseek-ai/dsh-workflow-ptc | 0.2.1-rc.2 | MIT |
| @deepseek-ai/schemastery | 3.18.5 | MIT |
| commander | 15.0.0 | MIT |
| js-yaml | 4.3.2 | MIT |
| node-addon-require-builtin | 0.1.9 | MIT |

## 8. 真实接入验证结果（2026-10-24，测试 Key）

验证环境与 §4 相同（隔离临时目录 + 独立 `DSH_HOME`）。测试 Key 由操作者预先配置于本机环境变量（`sk-` 前缀 35 字符，DeepSeek Key 形态），启动时注入 `DEEPSEEK_API_KEY`；值未打印、未写入任何文件或本记录。是否为 0.3 要求的专用低额度 Key 由负责人认定。

### 8.1 真实调用与流式

| 项 | 结果 |
| --- | --- |
| headless 文本轮次 | 提示"仅回复 OK"→ 输出 `OK`，退出码 0 |
| headless 工具轮次 | 模型真实调用 write/read 工具；磁盘产物验证一致（hello.txt，内容 "hi"） |
| SDK 握手 | `initialize` 返回 `serverInfo: deepseek-harness-sdk-runtime/0.0.1`；冷启动 4.1–5.1 秒（含首次模板初始化）、暖启动 4.0 秒 |
| SDK 提示词 | `session/prompt` 回执 14–16 ms（持久入队 `{messageId}`）；完整模型轮次约 1.0 秒（`deepseek-chat`） |
| 事件流 | 每轮 `session.event` 18 条 + `session.status` 2 条实时推送；事件词汇与会话持久日志完全一致 |
| 工具事件 | 持久日志与 wire 均观测 `tool/call` / `tool/result`；`tool/result` 带 `message.isError`、`meta`（operation/path）与 `sourceEventSeqs` 溯源 |
| 优雅关闭 | `shutdown` 应答后 dispose 并 exit 0 |
| 计费规模 | 全部验证共约 5 次微请求，远低于轻量预算关注线 |

默认模型事实：headless 默认路由 `deepseek-flash` + `reasoningEffort: high`、maxTokens 256000（`request/header` 事件）；SDK 可在 `initialize` 显式指定模型（本次用 `deepseek-chat` 控制成本）。

### 8.2 取消 / 中断 / 重启恢复（已验证）

- 上游 SDK 协议**没有取消方法**（协议文档明示：放弃轮次的方式是关闭运行时进程）。
- 实测：轮次进行中 SIGKILL 进程 → 新进程 `session/resume {sessionId}` 返回 `{}` 成功 → 续轮可用；恢复后日志将中断轮记为 `turn/end reason.kind = "interrupted"`，事件 `seq` 跨重启延续（不重置、不重放历史）。
- 结论：宿主取消语义 = 终止进程 + `session/resume` 修复，与本项目 CONTRACTS 的 `interrupted` 状态与恢复模型吻合；`CANCELLED` / `TOOL_TIMEOUT` 需 Host 层实现（上游无请求级超时 API）。

### 8.3 审批（存在协议缺口）

- 事件层已观测：`approval/policy`（"ask"）、`permission/preset`（"workspace-write"）、`sandbox/mode`。
- 协议层缺口：server→client 请求能力存在但上游从未使用（传输支持、Python SDK 应答接口为未来审批预留）——**SDK 客户端当前无法驱动审批**。web UI 经自身 HTTP API 操作审批（本阶段未验证）。
- 对 D08/D09：审批链路需经受支持插件桥（Cordis 插件挂接 user-approval 服务）或 web API，不能依赖当前 SDK 协议。
- 权限设计输入：`edit` 工具 schema 内建 `sandbox_permissions` 一次性提权枚举（`workspace-write` → `danger-full-access`，需 `justification`）。

### 8.4 不支持能力列表（上游 0.2.1-rc.2，经验证）

1. SDK 协议无取消/会话关闭方法（放弃 = 关闭进程；恢复 = `session/resume`）。
2. SDK 协议无审批驱动通道（server→client 请求未启用）。
3. SDK 协议无请求级超时参数；无协议版本协商（握手仅 `serverInfo.version` 0.0.1，无兼容承诺——升级需走 HARNESS_INTEGRATION §5 流程）。
4. CLI 拒绝 `desktop` profile（保留给 Electron 宿主）；npm CLI 不提供插件管理（`dsh plugin` 转发 pnpm，仅限 profile 使用）。
5. headless 默认路由为高推理档模型并发起标题生成 LLM 请求（成本控制需在组合层显式覆盖）。

### 8.5 指标（粗测，正式基线待 §6 第 3 项）

- SDK 冷启动（initialize 完成）4.1–5.1 s；暖启动 4.0 s；prompt 回执 14–16 ms；轮次 ~1.0 s。
- web profile 首次启动 15–25 s（模板初始化）；进程 RSS ~187 MB（单样本）。
- 安装足迹：node_modules 535 MB（含全部直接+传递依赖；打包需裁剪，正式包体基线待 D11 阶段口径）。

### 8.6 原始事件样本

- [fixtures/d01/tool-run-session.jsonl](fixtures/d01/tool-run-session.jsonl)（34 事件，headless 工具轮次）
- [fixtures/d01/interrupt-resume-session.jsonl](fixtures/d01/interrupt-resume-session.jsonl)（29 事件，SDK 中断+恢复）
- 脱敏规则与契约映射见 [fixtures/d01/README.md](fixtures/d01/README.md)。
