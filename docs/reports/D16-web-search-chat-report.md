# D16 web_search 聊天接线

日期：2026-10-26（Asia/Shanghai）。负责人：Etheslay。分支：`feature/web-search-chat`。基线：`134306ab1a77d1e50c67fe1050a74c6ad547ee88`（`origin/develop`，已含 PR #54）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

聊天里的 `web_search` 走单独的 `/web-search` 路由。`/app-tools` 仍只登记八个应用工具，`ask_user` 仍走 `/ask-user`。这两个既有结果不变。

Harness 已经有同名的全局 `web_search`。插件不在全局再登记一次，否则八个应用工具的就绪会一起失败。每个 agent 创建时，插件在该 agent 的上下文里登记本应用的 SearXNG 工具，覆盖这一会话里的内置工具。真实 Harness 测试看到模型收到的 `web_search` 描述包含 SearXNG。

调用顺序：

- 先过既有 D16 `network.search`。默认询问，批准前不发 HTTP。
- 再由 Host 按该 bot 的 `ToolPolicy.network` 做受信 D08 判断。`allowed` 才出站，`disabled` 返回 `UNAUTHORIZED_PATH`。
- 聊天回合没有工作流运行。`approval-required` 直接返回 `APPROVAL_REQUIRED`，不创建运行、不发 HTTP。工作流节点仍使用原来的真实 D08 句柄。
- 模型参数不能带端点或权限对象。多出来的字段按原严格 schema 拒绝。

SearXNG 地址来自桌面 `search.config.set`，键为 `searxng.endpoint`。非法地址不落库。已保存的地址在下次启动时覆盖 `DEEPSEEK_BOT_SEARXNG_URL`；显式清空后，即使进程仍有该环境变量，也不再使用。设置页只保存地址，不探测实例。

成功结果只在调用方 id 以 `chat:` 开头且带有 bot 时记下：当前进程里每个 bot 最多保留 20 条，供 `search.results.list` 轮询；同时写一条助手聊天记录，供之后的回合回放。工作流调用不写聊天记录。网关 JSONL 仍只存摘要。卡片把标题、摘要和地址当文本渲染；只有无凭据的 http(s) 地址变成链接。

`search.config.get` / `search.config.set` / `search.results.list` 是受信桌面方法，不是模型工具。协议仍为 0.3，无迁移。

## 2. 实际检查

环境：Windows、Node v24.22.1、pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0 |
| `pnpm test` | 退出 0。shared 6、harness-bridge 16、contracts 86、agent-tools 70、storage 147、desktop 213、runtime 128、harness-adapter 58、host 83 通过，另有 1 项跳过 |
| `git diff --check` | 退出 0 |

跳过的是既有付费 API 冒烟测试，未显式启用，不计为通过。host 覆盖率语句 88.67%，达到该包既有门槛。既有真实 Harness 验收仍断言八个应用工具的审批与一次写入，并通过；同一次请求里的 `web_search` 描述包含 SearXNG。本机回环 HTTP 只覆盖受控假 SearXNG，不是公共实例。

## 3. 未验证

- 没有真实 SearXNG 实例，没有为演示访问公共或付费搜索接口。
- 未用真实 Electron 点击设置或结果卡。桌面测试使用 jsdom。
- 真实 Harness 进程没有执行一次 `web_search` 调用，只确认工具被该会话覆盖且八个应用工具仍可用。
- 未执行远程 CI、安装包、签名或 GitHub 保护规则复核。
- 其他工具的原生聊天 D08 审批和 D18 不在本片。记忆的写入、检索和删除见 [D18 记忆报告](D18-memory-report.md)；知识导入见 [知识导入报告](D18-knowledge-import-report.md)。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
