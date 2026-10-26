# Agent tools（D15 / D16）

模型工具网关：能力注册、严格参数校验、grant 检查点及摘要审计。Host 负责装配，网关不直接访问数据库。

## D16 授权检查点

网关先严格校验参数，再调用 GrantCheckpoint，执行前同步 revalidate；缺少检查器时拒绝全部调用。Host 已装配持久化权限服务，写操作需要受信 caller.botId，session 授权还需 caller.sessionId；caller.id 仍是不透明审计标识，禁止由模型提供或从字符串推断身份。默认读/ask_user 允许，其余询问（screen 默认拒绝）。完整能力清单与作用域见 [PERMISSIONS.md](../../docs/PERMISSIONS.md)。

受信 Host 控制面 permission.* 读取审批并批准/拒绝、设置策略、撤销授权；模型 registry 不包含这些方法。本次审批 10 分钟过期，调用取消或 Host 关闭会结束等待。会话授权重启失效，永久授权保留。授权预扣发生在 handler 前，失败不返还次数；JSONL 增加 bot/session、能力、grant/approval ID 与决策，异常与校验审计使用固定摘要，不复制参数原文。

## `ask_user` 后端切片

`ask_user` 接受 `question`、`options: [{ id, label }]` 与 `allowOther`（默认 `true`）。问题与标签去除首尾空白后必须非空；问题最多 2,000 字符，标签最多 1,000 字符。选项数为 2–4，ID 只能为 A–D 且不能重复。

工具调用返回的 Promise 会等待人类回答。Host 的 `userQuestions.listPending(callerId?)` 返回独立快照，包含请求 ID、所属调用方、问题、选项及创建/过期时间；不应将这个内部控制面直接开放给模型。

```ts
const caller = { id: "chat:<sessionId>/<botId>" };
const result = host.agentTools.call(caller, "ask_user", {
  question: "先处理哪项？",
  options: [{ id: "A", label: "整理资料" }, { id: "B", label: "起草报告" }],
  allowOther: true,
}, { signal });

// 由受信 Host 调用方读取请求，在真正得到人类回答后提交：
host.userQuestions.answer(requestId, caller.id, { optionId: "A" });
// 或 { text: "其他安排" }；两种形式互斥，自由文本去除空白后为 1–4,000 字符。
await result; // { requestId, optionId: "A", text: "整理资料" }
```

`caller.id` 是不透明的所有者标识，不从字符串解析会话或 bot。受信入口必须使用原始调用方 ID；仅凭请求 ID 或不同调用方 ID 不能回答/取消。无效答案不会消费请求，成功答案只消费一次。网关不注册提交答案、取消等待或修改授权的工具。

`userQuestions.cancel(requestId, callerId)` 与调用的 `AbortSignal` 以 `CANCELLED` 结束等待。等待 30 分钟后以 `TOOL_TIMEOUT` 结束；回答入口也会检查期限，迟到答案不能抢在延迟的定时器前生效。Host 关闭以 `RUNTIME_UNAVAILABLE` 结束全部等待，同时清除定时器与监听器；重启不恢复问题。此时上层需要重新发起提问。

问题与答案只存在 Host 内存。JSONL 审计沿用网关的参数/结果 SHA-256 摘要，错误消息使用固定文本。未来聊天接线负责显示卡片并将结构化答案回写会话；本切片没有桌面 IPC、真实 Harness 调用方或会话持久化。

## `web_search` 后端切片

搜索来源为 SearXNG 的官方 JSON API（[官方接口说明](https://docs.searxng.org/dev/search_api.html)）。Host 由受信配置指定完整 `/search` 或 `/` 地址；不默认选公共实例，不需要 API Key，不自动发起请求。服务地址必须启用 `json` 输出；公共实例可能禁用 JSON、限流或临时不可用。

```ts
const host = await createHost({
  dataRoot,
  resolveApiKey,
  webSearch: { endpoint: "http://127.0.0.1:8080/search" },
});

// 在受信 NodeExecutor 中使用真实 D08 节点上下文：
// caller 由宿主绑定 botId/sessionId，且先经 D16 network.search 审批/授权。
const result = await host.agentTools.call(caller, "web_search", {
  query: "DeepSeek Harness documentation",
  maxResults: 5,
}, { signal: executionContext.signal, networkPermissions: executionContext.permissions });
// { provider: "searxng", query, results: [{ title, url, snippet }], warnings: [] }
```

`query` 去除首尾空白后为 1–512 字符，`maxResults` 为 1–10 的整数、默认 5。工具参数不接受自选 endpoint、权限句柄或授权开关。`networkPermissions` 是受信进程内调用选项，结构兼容 D08 `NodePermissionHandle`；缺少句柄时返回 `UNAUTHORIZED_PATH`。真实聊天调用方接入时必须由宿主绑定对应 bot/运行的权限句柄及取消信号，不得由模型自行构造。

出站前将精确 endpoint、POST、query、输出数量及固定请求参数交给 D08 `authorize`：禁用时拒绝，每次审批时等待，允许或批准后才发请求。查询通过 POST 表单发送给所配置的 SearXNG 服务及其上游搜索引擎。网关 `agent-tools-audit.jsonl` 只记参数/结果摘要；**D08 的本地 `tool.requested` 运行事件仍保存精确 query 与参数，用于审批和追踪**。

仅允许 HTTPS 或 HTTP 回环地址；配置不能含凭据、查询串或 fragment。HTTP 默认超时 15 秒（配置 `timeoutMs` 可设 1–60,000 毫秒，仅计算 HTTP 阶段），响应体上限 1 MiB；禁止跟随重定向、无自动重试。返回标题/摘要文本（各最多 300/2,000 字符）与无凭据 HTTP(S) URL，按去掉 fragment 的 URL 去重，不访问结果网页。结果属于不可信外部内容，消费方仍需安全渲染，不能作为宿主指令或授权。

无配置、提供方 HTTP/JSON 异常返回 `RUNTIME_UNAVAILABLE`，429 返回 `RATE_LIMITED`，超时为 `TOOL_TIMEOUT`，调用取消为 `CANCELLED`；Host 关闭终止活动请求并返回 `RUNTIME_UNAVAILABLE`。异常消息采用固定文本，避免原始查询、端点或响应内容混入网关错误审计。合法空结果返回空数组；上游报告引擎失败时返回“不完整结果”提示。未配置真实服务地址时，不将受控 HTTP 测试宣称为公共实例验证。

独立 Host 进程可在启动前配置 `DEEPSEEK_BOT_SEARXNG_URL`，见[开发环境说明](../../docs/DEVELOPMENT_SETUP.md)。D15 搜索切片不增加公开契约或桌面 IPC；D16 另增人类权限控制面。真实模型调用/聊天渲染仍待接线。

## 检查

`pnpm --filter @deepseek-bot/agent-tools test`（含覆盖率）与 `pnpm --filter @deepseek-bot/agent-tools typecheck`。Host 集成验证位于 `packages/host/src/ask-user.test.ts` 与 `web-search.test.ts`；后者覆盖真实 D08 的网络允许、禁用与审批后出站。
