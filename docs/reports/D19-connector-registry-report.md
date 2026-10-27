# D19 连接器登记与启停

日期：2026-10-26（Asia/Shanghai）。负责人：Etheslay。分支：`feature/connector-registry`。基线：`9805b6a31acfd9d17aad84c5e702ac7247541a8d`（`origin/develop`，已含 PR #59）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

本机保存连接器记录，可以列出、启用和停用。新建记录的 `enabled` 固定为关闭，调用方不能在登记时打开它。没有出站请求，没有 MCP 会话，没有 Stable Diffusion，也没有视觉输入。

迁移 `0009-connectors`。一行有 id、name、enabled、credential_ref、created_at、updated_at。名称去掉首尾空白后为 1–200 字。`credential_ref` 可空；有值时必须是已有的 `cred:<uuid>` 引用。明文密钥会被拒绝，也不会写入。本片不读取凭据 blob，不调用 `resolveApiKey`。

受信桌面方法是 `connector.list` / `connector.register` / `connector.enable` / `connector.disable`。设置页在网络搜索下面提供登记和启停。这些方法不是模型工具，也不进入八个应用工具目录。`connector.invoke` 仍是每次询问，本片没有调用它。`ToolPolicy.mcp` 的默认值和判定不变。记忆隔离和知识导入不变。协议仍为 0.3。没有新建 `packages/connectors/`。

自定义 MCP、用凭据去调用、本地生图、视觉理解、向量检索、保留策略和 D20 及之后的项不在本片。

## 2. 实际检查

环境：Windows、Node v24.22.1、pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0 |
| `pnpm test` | 退出 0。shared 6、harness-bridge 16、contracts 86、agent-tools 72、storage 150、desktop 220、runtime 128、harness-adapter 58、host 86 通过，另有 1 项跳过 |
| `git diff --check` | 退出 0 |

跳过的是既有付费 API 冒烟测试，未显式启用，不计为通过。host 覆盖率语句 89.05%，达到该包既有门槛。

## 3. 未验证

- 未用真实 Electron 打开设置页点击登记、启用或停用。桌面测试使用 jsdom。
- 未跑真实 Harness，也未让模型调用连接器。
- 未执行付费 API、远程 CI、安装包、签名或 GitHub 保护规则复核。不能据此宣称保护规则已在服务端启用。
- 自定义 MCP、凭据解析、本地 Stable Diffusion、视觉理解、向量检索、保留策略和 D20 及之后的项未做。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
