# 机器人工作区（D05）

`apps/desktop` 的机器人工作区把 D02 的占位壳升级为可用前端：机器人管理、聊天（流式/工具/取消/失败）、会话历史回放、产物面板与设置接入。**所有数据来自 `@deepseek-bot/contracts` 的可执行 schema 校验；真实 Harness / API / 持久化分别属于 D06 / D12 / D04，本任务全部为夹具驱动占位，不冒充真实结果。**

## 服务层（可替换）

```text
src/renderer/src/services/
  desktop-service.ts     接口：bots / settings / chat / artifacts（含 UI-only ChatSessionView）
  fixture-service.ts     唯一实现：读 packages/contracts/fixtures，内存态
  contract-validation.ts BotSchema / ModelProfileSchema / ArtifactSchema / EventEnvelopeSchema 统一校验
  service-context.tsx    React Context 注入；组件不直接 import 夹具
```

- 组件通过 `useService()` 拿服务；未来换成 IPC/Host 实现时只动 services 目录。
- 服务层所有出参先经 contracts schema 校验再返回；非法数据抛 `ServiceError`（稳定错误码）。
- 夹具种子：3 个 Bot（含 1 个已归档）、2 个会话（success-run / cancel-run 事件回放）、2 个产物（markdown 可预览 / html 拦截）。

## 机器人管理（FR-02 前端）

- 创建/编辑表单（`features/bots/bot-form.tsx`）：名称、instructions、modelProfileId、workspaceId、toolPolicyId——`BotSchema` 校验，错误定位到字段。
- 复制：新 id/revision + 名称“副本”，不复制会话（服务层强制）。
- 归档：`archivedAt` 标记后侧边栏显示“已归档”，**不能发起新聊天**（服务层拒绝 + 输入禁用 + 横幅提示），历史会话仍可查看。
- revision 冲突：`REVISION_CONFLICT` 提示并自动刷新列表。
- 分组/置顶/未读等仍是会话内 UI 状态（CONTRACTS v0.1 无 Bot.group，不进契约）。

## 聊天（FR-03 前端，夹具驱动）

- 流式：`features/chat/chat-reducer.ts` 纯 reducer（增量追加 / 工具状态卡 / 取消冻结 / 失败终态），发送走 `service.chat.stream`。
- 工具状态卡：工具名 + 状态（请求中/执行中/已完成/失败）+ 摘要。
- 取消：流式中显示取消按钮；取消后状态 `cancelled`，不再追加增量。
- 失败：稳定错误码 + 可读文案（`failureMessage`），`retryable` 的提供重试。
- Bot 间交流（Grok 风格，UI 占位）：主时间线仅显示居中通知行（已发消息给/消息来自 + 小头像），完整对话存 pairTranscripts，点开在右侧内容区显示配对聊天视图（侧边栏保留）。

## 会话历史与产物（FR-07/QA-14 前端）

- `features/chat/session-history.tsx`：会话列表（标题/状态/事件数）→ 回放持久事件（时间标签 + 事件中文标签）。
- 产物列表：relativePath / mediaType / size / sha256 摘要；预览仅 text/plain 与 text/markdown，HTML 一律拦截并提示 QA-14，不执行任何脚本。

## 设置（FR-01 前端）

- API Key **只写不读**：password 输入、保存后占位符仅显示“已配置（输入新值覆盖）”，明文永不回显；真实加密存储由 D04/D08 接线。
- 测试连接三态：夹具默认如实返回 `UNVERIFIED`（RUNTIME_UNAVAILABLE），不冒充成功。

## 命令与测试

- 命令不变：`pnpm --filter @deepseek-bot/desktop dev / build / test / pack:dir`（见 [开发环境基线](DEVELOPMENT_SETUP.md)）。
- 测试：`tests/services/`（服务层 22 例）、`tests/features/`（表单校验 5 例 + chat reducer 7 例）；主进程 IPC 测试不变。

## 契约边界速查

| 能做（D05） | 不能声称 |
| --- | --- |
| 夹具驱动的流式/工具/取消/失败 UI | 真实 Harness 流式/取消（D06/D12） |
| Key 表单 + 只写不读 + UNVERIFIED | Key 已安全保存 / 连接成功（D04/D08） |
| 归档禁新聊、复制、字段校验 | 重启保留（持久化 D04 未接线） |
| 分组/表情/引用 UI 会话态 | 契约实体 / 持久化已实现 |
