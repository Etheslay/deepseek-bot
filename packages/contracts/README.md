# @deepseek-bot/contracts

[docs/CONTRACTS.md](../../docs/CONTRACTS.md) 的可执行实现：zod schema、场景夹具和双方共用的契约测试。D03 交付 v0.1；D15 写层扩展至 v0.2；D16 权限后端扩展至 v0.3。

## 内容

| 模块 | 对应契约 | 说明 |
| --- | --- | --- |
| `version.ts` | §1、§7 | `PROTOCOL_VERSION`（`"0.3"`，SUPPORTED 含 0.1/0.2）与 `WORKFLOW_SCHEMA_VERSION`（保持 `"0.1"`，工作流文档未变）；`isProtocolVersionSupported` 拒绝未知更高版本 |
| `primitives.ts` | §1 | UUID、UTC ISO 8601 时间戳、IANA 时区、绝对/相对路径、media type、sha-256 |
| `errors.ts` | §6 | 16 个稳定错误码与错误对象（code/message/retryable/requestId/details） |
| `status.ts` | §5 | Run / NodeRun 状态机：迁移表、终态判断、`assert*Transition` |
| `entities.ts` | §2 | Bot（v0.2 增 nullish avatar/groupId）、BotGroup、Avatar（规范池 + `assignBatchAvatars` 纯函数）、BotCreationDraft、ModelProfile、Workspace、Workflow/Node/Edge、Schedule、Run、NodeRun、Approval、Artifact |
| `events.ts` | §4 | 持久事件 envelope、10 类事件 payload schema、瞬态 `assistant.delta`、`isSequenceMonotonic` |
| `workflow.ts` | §2、§3、§6 | DAG 校验器：环（WORKFLOW_CYCLE）、悬空边与缺失绑定（MISSING_BINDING）、重复节点/边（INVALID_INPUT），错误定位到节点与字段 |
| `methods.ts` | §1、§3 | 62 个白名单方法的 envelope 与 per-method 请求/响应 schema（`METHOD_CONTRACTS`）、1 MiB 消息上限、`parseRequest` |
| `permissions.ts` | §2、§3 | 能力、全局策略、once/session/permanent grant、精确应用审批、追加式审计及 7 个受信人类 permission.* 方法；严格参数校验与高风险能力限制 |
| `fixtures/` | §7 | 12 个场景夹具（成功、限流、取消、审批拒绝、重复消息、并发编辑、崩溃重连、循环图、路径越界、过期审批 + 版本拒绝、缺失绑定），见 [fixtures/README.md](fixtures/README.md) |

## 双方如何使用

前端（D05/D07/D09，Destinyian）与后端（D04/D06/D08/D10，Etheslay）都通过 workspace 依赖导入同一实现：

```ts
import {
  BotSchema,
  METHOD_CONTRACTS,
  canTransitionRun,
  parseRequest,
  validateWorkflowDraft,
} from "@deepseek-bot/contracts";
```

- 包以 TypeScript 源码直接导出（`exports: "./src/index.ts"`），与 `@deepseek-bot/shared` 一致，无需构建步骤。
- 夹具位于 `fixtures/*.json`，前端可读取后直接驱动 UI 状态；场景语义见夹具 README。
- zod 解析对未知对象键宽容（同版本内可选字段扩展）；版本边界由 `protocolVersion` / `schemaVersion` 显式把守，未知更高版本必须拒绝，不能默默丢字段。

## 测试

```powershell
pnpm --filter @deepseek-bot/contracts test
```

覆盖三类：schema 单元测试、夹具驱动的场景测试（含用真实校验器复算 `workflow.validate` 结果）、对 [docs/fixtures/d01](../../docs/fixtures/d01/README.md) 真实 Harness 事件样本的结构断言（`seq` 严格单调、词汇表一致、工具/中断溯源字段存在）。

覆盖率门槛 80%（行/分支/函数/语句）；当前 ≥ 99% 行、≥ 89% 分支，状态机模块分支 100%。

## 变更规则

CONTRACTS §7：新增可选字段可兼容扩展；删除/更名必需字段、状态语义或事件顺序变化必须提升版本并提供迁移说明，由变更负责人自审并同步使用方。私有 workspace 包版本当前为 `0.1.0`；通信协议版本由 `PROTOCOL_VERSION` 独立标识（当前 `0.3`）。
