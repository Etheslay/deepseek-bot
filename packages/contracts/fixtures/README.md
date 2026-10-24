# D03 契约夹具（packages/contracts/fixtures）

来源：[docs/CONTRACTS.md](../../../docs/CONTRACTS.md) v0.1 §7 要求的契约场景夹具。与 [docs/fixtures/d01](../../../docs/fixtures/d01/README.md) 的上游真实事件样本不同，这里的夹具描述的是**本项目契约层**的请求/响应/事件形态，前端（D05/D07/D09）可直接依据它们开发界面与状态处理，后端（D04/D06/D08）用同一组夹具驱动契约测试。

## 文件格式

每个夹具是一个 JSON 文档：

| 字段 | 说明 |
| --- | --- |
| `scenario` | 场景名（与文件名一致） |
| `covers` | 覆盖的 CONTRACTS 章节 |
| `notes` | 场景语义说明 |
| `interactions[]` | 方法交互：`method` + `envelope`（protocolVersion/requestId/method/payload） |
| `interactions[].expectedResponse` | 成功响应，按 `METHOD_CONTRACTS[method].response` 校验 |
| `interactions[].expectedError` | 错误对象（code/message/retryable/requestId/details），按 `ContractErrorSchema` 校验 |
| `interactions[].expectEnvelopeRejected` | 置为 `true` 表示该 envelope 必须被整体拒绝 |
| `events[]` | 持久事件，按 `EventEnvelopeSchema` + 对应 payload schema 校验 |

测试入口：`packages/contracts/src/fixtures.test.ts`（`pnpm --filter @deepseek-bot/contracts test`）。

## 场景索引（CONTRACTS §7 最低覆盖 + 2 个补充）

| 场景 | 文件 | 覆盖点 |
| --- | --- | --- |
| 成功 | `success-run.json` | run.start → run.completed 全链路、事件 sequence 严格递增、终态必须带 reason |
| 限流 | `rate-limited.json` | RATE_LIMITED 错误对象 retryable=true、Retry-After details、有界重试 |
| 取消 | `cancel-run.json` | cancelling → cancelled、重复 cancel 返回已有终态 |
| 审批拒绝 | `approval-denied.json` | approval.decide、stop-descendants、决定不可重复执行 |
| 重复消息 | `duplicate-message.json` | bot.create 以 requestId 去重、至少一次投递安全 |
| 并发编辑 | `concurrent-edit.json` | expectedRevision、REVISION_CONFLICT |
| 崩溃重连 | `crash-reconnect.json` | events.subscribe 重放、sequence 跨重启连续、snapshotRequired |
| 循环图 | `workflow-cycle.json` | WORKFLOW_CYCLE 可定位到节点 |
| 缺失绑定（补充） | `workflow-missing-binding.json` | MISSING_BINDING 可定位到节点与字段 |
| 路径越界 | `path-escape.json` | UNAUTHORIZED_PATH、授权不来自路径字符串 |
| 过期审批 | `approval-expired.json` | APPROVAL_EXPIRED、审批一次消费 |
| 版本拒绝（补充） | `version-mismatch.json` | 拒绝未知更高 protocolVersion / schemaVersion（DATA_VERSION_UNSUPPORTED） |

## 共享测试 ID

夹具间复用同一组合成 ID（全部为示例数据，无真实用户信息）：

| 名称 | UUID |
| --- | --- |
| Bot A | `11111111-1111-4111-8111-111111111111` |
| Bot B | `12121212-1212-4121-8121-121212121212` |
| Bot A revision 1 / 2 | `22222222-2222-4222-8222-222222222222` / `33333333-3333-4333-8333-333333333333` |
| ModelProfile | `44444444-4444-4444-8444-444444444444` |
| Workspace | `55555555-5555-4555-8555-555555555555` |
| ToolPolicy | `66666666-6666-4666-8666-666666666666` |
| Workflow（revision） | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`（`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`） |
| Run 1 / 恢复 Run 2 | `cccccccc-cccc-4ccc-8ccc-cccccccccccc` / `dddddddd-dddd-4ddd-8ddd-dddddddddddd` |
| NodeRun 1 / 2 | `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee` / `ffffffff-ffff-4fff-8fff-ffffffffffff` |
| Approval | `12341234-1234-4123-8123-123412341234` |
| Artifact | `23452345-2345-4234-8234-234523452345` |
| requestId / eventId 池 | `10000000-0000-4000-8000-0000000000NN` / `20000000-0000-4000-8000-0000000000NN` |

`actionDigest` 统一使用 `9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`。

## 语义约定

- 解析器对未知对象键保持宽容（同版本内的可选字段扩展，见 CONTRACTS §7）；兼容边界由 `protocolVersion` / `schemaVersion` 把守，未知更高版本必须显式拒绝。
- 事件 `sequence` 在同一 Run 内严格递增；夹具内多段事件流共享同一递增空间，供 `isSequenceMonotonic` 校验。
- 错误对象的 `details` 在夹具中已脱敏；真实后端输出必须经同样脱敏（见 `@deepseek-bot/shared` 的 `redactSecrets` 与 CONTRACTS §6）。
