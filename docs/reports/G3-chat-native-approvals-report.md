# G3 原生聊天回合内的 D08 审批（后端片）：ChatNativeGate + 桥注册

日期：2026-10-28（Asia/Shanghai）。负责人：Etheslay。分支：`feature/g3-chat-native-approvals-9d4b`。基线：`968aa0b`（origin/develop，含 PR #123 G2）。对应 [GAP_AUDIT](../GAP_AUDIT.md) G3（PR #122 文档稿；本片未改该文件）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论；自审必须针对该分支最新提交 SHA。

## 1. 交付行为

G3 的 Host 后端片：聊天回合内的原生 Harness 工具审批请求从"无处落地"变为走 D16 检查点。桌面聊天卡片渲染复用既有 AppApproval 卡面（与应用工具同一条链路），本片不改渲染层文件。

| 块 | 实现 |
| --- | --- |
| 闸门 | 新增 `packages/host/src/chat-gate.ts` `ChatNativeGate`：实现 D08 `NodePermissionHandle`（evaluate/authorize），把桥转来的封闭动作词表映射到既有 D16 能力——`file.read/list → fs_read`（fs.read）、`file.write/delete → fs_write`（fs.write）、`shell.exec → exec_shell`（exec.shell）、`mcp.call → mcp_call`（mcp.call，server/tool 入参）、`network.request → 聊天 D08 网络缝（chatNetworkPermissions）`。策略 allow 直接放行、deny 以稳定错误码拒绝、ask 落一张 AppApproval（精确参数 + digest + 10 分钟 TTL + 一次决定），等待走 `check()` 既有 waiter；回合中止信号即取消等待 |
| 注册 | `ChatManager` 新增可选 `bridgeRegistration` / `nativeGate` 接线：回合开始把闸门以 `RegisteredSessionContext`（runId/nodeRunId = 本回合 sessionId）注册进 D08 桥会话表，finally 注销。接线缺省时行为与从前完全一致（原生审批继续 fail closed）——G2 装好的桥包从此有可解析的会话闸门 |
| 能力映射 | `agent-permissions.ts` 的工具→能力映射补 `fs_read`/`fs_write`/`fs_delete`/`exec_shell`（fs.read/fs.write/exec.shell 三个能力 id 在 D16 契约里早已存在；exec.shell 由 `requiresPerActionApproval` 锁定为逐次询问，策略 allow 不可设） |
| 边界 | 契约零变更（能力 id 已在 `CAPABILITY_IDS`）；无迁移；桌面渲染复用既有 `permission.approval.list/decide` 面与本卡组件，工具名显示 `fs_read` 等原值（友好名归 B 线）；native MCP 走 `mcp.call` 能力闸门，definition 级 grant 检查仍只属网关路径（边界已记录） |

## 2. 实际检查

环境：Windows 11 x64、Node v24.20.0、pnpm 11.28.5。测试需设 `APPDATA`。

| 实际命令 | 结果 |
| --- | --- |
| host `vitest run src/chat-gate.test.ts` | 9 通过：read 出卡→批准→放行；策略 deny 分类拒绝；exec.shell 锁 ask（policy.set allow 被拒）且出卡后取消即 CANCELLED；回合中止取消等待；network 走 D08 缝（caller/URL 断言）；mcp.call 能力 deny；一次拒绝后下一次 ask 不受污染 |
| host 包全量 | 269 通过 + 既有抖动（chat×2、mcp-chat×1、real-app-tools×1、task-dispatch×2 并行负载下 harness 15 秒超时家族；chat/task-dispatch 隔离复跑通过，本片不改 harness 启动路径） |
| `pnpm lint` / `pnpm typecheck` | 见 PR 验证证据表（全量复跑） |

## 3. 设计取舍

- **复用 AppApproval 而非新表**：run 级 approvals 表以 runId 主键锚定，聊天无 run；AppApproval（invocationId/callerId/botId/tool/params/digest/TTL）语义完全覆盖且桌面渲染面现成。native MCP 的 definition 级 grant 检查只属网关路径，能力闸门为聊天原生路径的第一道门（边界记录于代码与本文）。
- **默认策略**：fs.read/fs.write/exec.shell 均为 ask（D16 `defaultPermissionMode`），即 Harness 自己决定升级为审批的原生调用默认可见、可拒绝；用户可在设置页按能力放宽/收紧。
- **fail closed 保持**：接线缺省（未来若桌面禁用桥）时原生审批仍被拒绝——与 GAP_AUDIT 记录的现状一致，不引入静默放行路径。

## 4. 未验证

- **真实 Harness 回合内的端到端**：卡片弹出、拒绝后无副作用、超时/取消语义终止回合——需要真实 `dsh` + 模型回合（G4 授权后或真机复核），本片以单元/夹具级验证为准。
- 渲染层卡片在聊天流中的视觉与交互（复用组件，预期零改动）归桌面确认。
- 未跑 GitHub Actions（分钟额度已用尽）。

## 5. Etheslay 本人自审

- 已审提交 SHA / 日期：
- 差异、需求和错误路径检查结果：
- 测试证据 / 兼容性与权限影响：
- 遗留问题与处理方式：
- 自审结论：

新增提交后更新本节；自审留给 Etheslay 本人填写，此处不代填。
