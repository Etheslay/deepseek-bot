# 人性化错误提醒（聊天失败气泡）报告

分支：`feature/humanized-errors` · 目标 `develop` · 无契约变化 · 基线 `origin/develop` = `9d3ac5b`

## 1. 问题（对标截图反馈）

失败气泡丑且吓人：三列红字挤在一起，露出 Electron 的
`Error invoking remote method 'host:call': HostCallError:` 包装前缀、完整本地路径与
`ENOENT` 原文——用户真正需要的一句「去设置里重新保存 API Key」被淹没。

## 2. 做了什么

| 层 | 内容 |
| --- | --- |
| 渠道信封 | `HOST_CALL` 通道**不再抛异常**：main 侧 `hostCall` 改为始终 resolve `{ok:true, result}` / `{ok:false, error:{code, message, retryable}}`；preload `host.call` 解包——失败时抛带 `code`/`retryable` 的普通 Error。**Electron 包装前缀从此不出现，且 Host 的稳定错误码在 IPC 序列化后得以保留**（此前 code 丢失、渲染层恒显示 RUNTIME_UNAVAILABLE，RATE_LIMITED 等真实码现在能正确上屏） |
| Host 源头 | `chat.ts` 凭据解析失败：原始系统错误（ENOENT/路径/解密失败）**只写 stderr 日志**，聊天里给一句双语人话——缺 Key：「还开不了对话：这台电脑上还没有我能用的 API Key（可能已失效）。到 设置 里重新保存一次，再把刚才的话发一遍就好。」；其他凭据问题：「模型凭据解析失败。到 设置 里检查 API Key 与模型配置，再试一次。」 |
| 失败气泡 | `App.tsx` + 样式重构：三列红字 → 一张安静的单列卡（小错误码 chip + 「重试」一行、下面一句人说的话）；主文案优先取 Host 生成的人话（`failure.message`），目录文案仅作无消息时的兜底；`failure-code/failure-detail` 旧样式移除 |

## 3. 验证证据

环境：Windows 11 x64 · Node 24.16.0 · pnpm 11.28.5 · 基线 `origin/develop` = `9d3ac5b`

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Host 新用例 | `vitest run src/chat.test.ts` | 15 用例：新增「humanizes credential failures」——ENOENT 原文触发时，错误码 `INVALID_INPUT`、消息含「API Key」「设置」、**不含** ENOENT/credentials/反斜杠路径 |
| desktop 全量 | `pnpm --filter @deepseek-bot/desktop test` | 74 文件 / 654 用例全过 |
| 静态 | `pnpm typecheck`；`pnpm lint` | 10 包 tsc 全过；eslint 0 问题 |
| 已知既有 | host `screen-distribution` 本机环境失败（基线同样失败）；全量跑时 `chat.test` MCP-discovery 一例时序 flake——**单测复跑两次全过**，与本日其他工作区观察一致 |

## 4. 未验证（明确列出）

- **真机 Electron 未跑**：截图同场景（未存 Key 直接发消息）的实际观感无新截图；信封语义由 preload/main 代码 + chat 测试背书，无独立通道级自动化（preload 不进 vitest）。
- 其他抛错主进程通道（saveKey、updates 等）未改——它们在设置页有自己的文案面；本次只收口 `host:call`。

## 5. 风险与回退

- 渠道信封是 `host:call` 一条通道的语义变化：所有契约调用经 preload 解包，成功路径形状不变（`result` 原样）；`data.restore` 的重启时序保持原实现。
- 回退：`git revert -m 1 <merge-sha>`；无迁移、无契约文档面变化。

## 6. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
