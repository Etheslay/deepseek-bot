# D01 事件样本夹具

来源：2026-10-24 D01 真实接入验证（上游 `@deepseek-ai/dsh` 0.2.1-rc.2，源码提交 `687f282e`）。两份会话事件日志均为**真实运行**产生，已程序化脱敏。D03 将其落成可执行契约测试；映射关系见 [D01_TECHNICAL_VERIFICATION](../../D01_TECHNICAL_VERIFICATION.md) §8。

| 文件 | 场景 | 事件数 |
| --- | --- | --- |
| `tool-run-session.jsonl` | headless profile，单轮：模型调用 write/read 文件工具完成任务的完整事件流 | 34 |
| `interrupt-resume-session.jsonl` | SDK profile（JSON-RPC stdio），两轮：轮次中进程被 SIGKILL 中断 → 新进程 `session/resume` 修复 → 续轮完成 | 29 |

## 事件词汇（与会话日志一致）

`session`（头部，仅首行）、`permission/preset`、`sandbox/mode`、`approval/policy`、`agent/inbox/spliced`、`turn/start`、`turn/end`（含 `reason.kind`: `completed` / `interrupted`）、`step/start`、`step/end`、`system/message`、`user/message`、`assistant/message`（`data.stream` 内嵌逐 chunk 的 compact 流：文本、reasoning、工具调用增量）、`request/header`（模型路由、maxTokens、工具 schema）、`request/context`、`tool/call`（`callId`、`name`、`arguments`）、`tool/result`（`message.isError`、`meta.operation/path`、`sourceEventSeqs` 溯源）、`session/title`、`session-log-deepseek/delivery-accepted`、`session/end-seed`（resume 播种）。

## 与本项目契约的对应（供 D03 参考）

- 事件 `seq` 单调递增、跨重启连续，可映射 CONTRACTS §4 的 `sequence`。
- `tool/call` / `tool/result` 对应 `tool.requested` 及工具开始/结束语义；`sourceEventSeqs` 提供因果链。
- `turn/end reason.kind` 的 `completed` / `interrupted` 对应 Run/NodeRun 的 `succeeded` / `interrupted` 终态来源。
- `assistant/message.data.stream` 为契约 `assistant.delta`（瞬态流）的映射来源。
- `approval/policy`、`sandbox/mode`、`edit` 工具 schema 中的 `sandbox_permissions` 一次性提权枚举是 D08 权限设计输入。

## 脱敏说明

- 本机路径（用户目录、临时验证根、默认工作区）统一替换为 `<USER_HOME>` / `<VERIFY_ROOT>` / `<DEFAULT_WORKSPACE>`；流式 token 数组中的身份片段替换为 `<user>` / `<redacted>`。
- 已扫描确认无 API Key 形态字符串（`sk-…`）残留。
- 提示词与回复均为本次验证的合成英文测试内容，无真实用户数据；UUID、callId、时间戳为结构性示例，原样保留。
