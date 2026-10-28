# D19 stdio MCP 与凭据注入

日期：2026-10-28。负责人：Etheslay。实现分支：`feature/d19-stdio-credentials`。基线为已含设备输入 PR #104 与会话列表 PR #103 的 `develop`。本文是 AI 辅助实现与实际检查记录，**不是真人自审或合并结论**。自审栏留空，由 Etheslay 本人填写。

## 1. 交付行为

- 设置中可登记 `mcp-stdio`。命令是单个可执行文件名或绝对路径，参数是字符串数组。不经过 shell。新建默认关闭。
- `mcp-http` 与 `mcp-stdio` 可以保存 `cred:<uuid>`。登记仍然只存引用，不读密文。发现工具和实际调用时，Host 经既有 `resolveApiKey` / `credential/resolve` 通道取得明文。
- HTTP 把明文放进 `Authorization: Bearer`。没有引用时仍不发送该头，401/403 仍表示不支持认证。有引用而服务拒绝时，错误是认证失败，响应体和令牌都不进入错误文本。
- stdio 把明文放进一个环境变量，默认名 `MCP_CREDENTIAL`，也可指定符合规则的名字。明文不进入 argv。`PATH`、`LD_PRELOAD`、`NODE_OPTIONS` 等名字不能用来放凭据。`@modelcontextprotocol/client` 仍会带上它默认可继承的变量（Linux 上是 `HOME`、`LOGNAME`、`PATH`、`SHELL`、`TERM`、`USER`），再写入这一个凭据变量。Host 的其余环境不会传给子进程。stderr 走管道，超过 1 MiB 即关闭，不写入日志。
- 按 bot 白名单、`mcp.call` 单次审批、停用或改命令后的失效，沿用 HTTP 片。审批里看到的是 `stdio:<命令>`，不是环境变量的值。
- 视觉理解没有开始。

## 2. 协议与迁移

协议升到 0.8，继续接受 0.1–0.7 的发送方。工作流文档版本仍是 0.1。新增受信方法 `connector.setCommand`。连接器响应增加可选的 `command`、`args`、`credentialEnv`。

迁移 `0020-mcp-stdio` 重建连接器表，允许 `mcp-stdio`，并增加命令、参数和环境变量名列。已有 HTTP 与 SD 行保留端点和凭据引用。已应用迁移的 SQL 未改。

回退程序不能直接打开迁移后的数据库。应使用升级前备份恢复匹配旧版本的数据根。

## 3. 实际验证

环境：Linux，Node v22.23.4（仓库要求 Node ≥ 24，本机没有 24；`node:sqlite` 可用并打印 ExperimentalWarning）。没有付费模型请求，没有真实第三方 MCP 服务，没有 Electron 桌面验收。

已通过：

- `pnpm --filter @deepseek-bot/contracts test`（134）
- `pnpm --filter @deepseek-bot/contracts exec tsc -p tsconfig.json --noEmit`
- `pnpm --filter @deepseek-bot/storage exec vitest run src/repos/connectors.test.ts src/repos/mcp-grants.test.ts src/credentials.test.ts src/database.test.ts`（32）。完整 `pnpm --filter @deepseek-bot/storage test` 另有 2 个失败，都在 `layout.test.ts` 的 Windows `APPDATA` / 盘符根路径断言；本机是 Linux，且本次未改 `layout.ts`。CI 跑在 `windows-latest`。
- `pnpm --filter @deepseek-bot/storage exec tsc -p tsconfig.json --noEmit`
- `pnpm --filter @deepseek-bot/harness-bridge build`
- `pnpm --filter @deepseek-bot/host exec tsc -p tsconfig.json --noEmit`
- `pnpm --filter @deepseek-bot/host test`（211 通过，1 跳过；含覆盖率）
- `pnpm --filter @deepseek-bot/desktop exec tsc -p tsconfig.json --noEmit`
- `pnpm --filter @deepseek-bot/desktop exec vitest run tests/features/connector-settings.test.ts tests/i18n-scan.test.ts tests/features/i18n.test.ts`（28）
- `pnpm lint`
- `pnpm typecheck`

stdio 用例用 `process.execPath` 拉起临时脚本，确认发现成功、环境变量等于明文、argv 不含明文，以及命令名 `bash` 被拒绝。

## 4. 未验证

- 任意第三方 stdio / HTTP MCP 服务的兼容性。
- Windows 上的绝对路径、`PATHEXT` 和真实子进程。
- Electron 设置页点击、safeStorage 解密和审批卡截图。
- 发行安装包、签名、干净机、升级和 GitHub Actions。
- 视觉理解。
- GitHub 服务端保护规则。不根据规范文件宣称保护已启用。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、需求、迁移与兼容性：＿＿＿＿
- [ ] 权限竞态、撤销、错误路径及自动化证据：＿＿＿＿
- [ ] 真实桌面、远程 CI 与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
