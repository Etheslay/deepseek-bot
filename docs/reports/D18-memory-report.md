# D18 记忆写入、检索与删除

日期：2026-10-26（Asia/Shanghai）。负责人：Etheslay。分支：`feature/memory-knowledge`。基线：`b57c29ec28a6935498ac3796bfacd876d8df4377`（`origin/develop`，已含 PR #56）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

记忆只属于一个 bot。没有跨 bot 共享开关。知识导入、向量检索和 D19 及之后的项不在本片。

存储新增迁移 `0008-memories`。一行有 id、bot_id、text、created_at。文本去掉首尾空白后为 1–4000 字。检索是不区分大小写的子串；空查询按时间倒序列出最近记录，默认 20 条，最多 50 条。删除是物理删除，没有墓碑。用其他 bot 的 id 删除会得到 `INVALID_INPUT`，原记录还在，错误里不带那条正文。

受信桌面方法是 `memory.list` / `memory.write` / `memory.delete`，只作用于请求里的当前 bot。桌面面板挂在打开的 bot 上，大约每秒读取一次，正文按文本渲染。协议仍为 0.3。

模型工具是 `memory_write` 和 `memory_search`。参数不能带 botId，也没有删除工具。调用方必须有受信 `ToolCaller.botId`，缺失时返回 `UNAUTHORIZED_PATH`。`memory.read` 默认允许，但仍然必须是有效 bot，不能匿名读取。`memory.write` 默认询问，批准前不落库。它们走单独的 `/memory` 路由。`/app-tools` 的就绪名单仍只有八个应用工具。`ask_user` 与 `web_search` 的路由和结果没有改。

网关 JSONL 只存摘要。审批预览沿用既有 D16 行为，会保存这次写入的正文供人查看。本片没有新建 `packages/memory/`。

## 2. 实际检查

环境：Windows、Node v24.22.1、pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0 |
| `pnpm test` | 退出 0。shared 6、harness-bridge 16、contracts 86、agent-tools 72、storage 148、desktop 214、runtime 128、harness-adapter 58、host 85 通过，另有 1 项跳过 |
| `git diff --check` | 退出 0 |

跳过的是既有付费 API 冒烟测试，未显式启用，不计为通过。host 覆盖率语句 88.79%，达到该包既有门槛。既有真实 Harness 验收仍通过八个应用工具的审批与一次写入，同一次请求里的 `web_search` 描述包含 SearXNG。插件会先读取 `/memory` 再就绪；该验收没有执行 `memory_write` 或 `memory_search`。

## 3. 未验证

- 未用真实 Electron 点击记忆面板。桌面测试使用 jsdom。
- 真实 Harness 进程没有让模型写一条记忆或检索记忆。
- 未执行付费 API、远程 CI、安装包、签名或 GitHub 保护规则复核。
- 知识导入、D19 及之后的项未做。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
