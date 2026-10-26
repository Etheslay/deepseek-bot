# D16 权限与授权：后端切片

日期：2026-10-26（Asia/Shanghai）。负责人：Etheslay。分支：`feature/permissions-grants`，从最新 `origin/develop` 的 `b693c5b` 创建；该基线已含 PR #42（D15 web_search）、#41（Destinyian bot 模板）和 #40（桌面设置/搜索/附件等）。本报告不代表负责人的真人自审或合并决定。

## 1. 本轮范围与决定

用户确认先交付契约、存储、网关和 Host 授权后端，关闭 D15 写操作默认放行缺口。用户另确认：会话授权在 Host 重启后失效，永久授权保留，未决审批始终失效。

- 默认 app.read / interaction.ask_user 允许，screen.capture 拒绝，其余询问；app.start_run 固定 ask，exec.shell / screen.capture 不能 allow，三者仅支持逐次审批。
- 全局策略与 bot 授权共用 permission_grants。策略 deny 优先；模型无法设置策略、签发或撤销授权。一次授权绑定精确审批；会话授权绑定 bot/session/generation，默认 5 次/2 小时；永久授权无期限及次数限制。
- 模型应用写操作和 network.search 必须绑定有效 bot；身份由受信进程内 ToolCaller 提供，不解析 caller.id，不读取模型参数中的身份。匿名只可调用策略 allow 的读/提问。
- 审批预览保存验证后的精确参数；摘要绑定 invocation、caller/bot/session、工具、能力、参数和启动代次。10 分钟过期；重复、迟到、摘要不符或无效代次不可消费。
- 多能力使用次数在同一 SQLite 事务预扣，执行失败不退还；执行前同步重验参数、策略和授权，不重复扣次。create_bots_batch 携带 newGroup 时需要 create_bot 与 create_group 两项能力。
- 调用取消、超时、Host 关闭清理等待；重启使旧 session/once 授权与 pending 审批失效；永久授权与全局策略保留。

## 2. 交付与兼容性

- contracts：新增能力/策略/grant/AppApproval/PermissionAudit schema 及 7 个 permission.* 人类方法。协议升至 0.3，仍接受 0.1/0.2；工作流文档版本保持 0.1；未知 0.4 拒绝。
- storage：附加 migration 0005，新增 permission_grants、app_approvals、permission_authorizations 执行票据与 permission_audit；既有迁移不改校验和。审计表通过触发器禁止 UPDATE/DELETE。备份自动包含这些表与审批预览原文，仍属本地敏感数据。
- agent-tools：移除 AllowAllGrants，缺少检查器默认拒绝；严格校验参数后授权，执行前重验；JSONL 增加身份/能力/grant/approval/decision 元数据。校验审计仅保存 issue code，异常审计使用固定文本，避免错误消息复制原文。
- Host：装配审批等待协调器与人类控制方法；permission.* 不进入模型 registry。真实 D08 网络授权仍独立检查，D16 的 network.search 放行不免除 D08。
- 无新依赖或 lockfile 变更。默认人类应用管理方法保留当前语义，不能交给模型任意调用。未来模型接线必须仅导出网关工具，并由宿主绑定可信身份、取消信号和 D08 权限句柄。

## 3. 验证证据

执行环境：Windows、本地 Node 24.15.0、pnpm 11.28.5。最终回归时间为 2026-10-26 13:25–13:26（Asia/Shanghai），对应当前未提交实现树，基线 HEAD 为 b693c5b02194d4bd0fa2169e1ebe31b2573b48a4。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --filter @deepseek-bot/contracts test` | 契约包 76 项通过；最终全仓再次覆盖 |
| `pnpm --filter @deepseek-bot/storage test` | 存储包 142 项通过；最终全仓再次覆盖 |
| `pnpm --filter @deepseek-bot/agent-tools test` | 中间实现 68 项通过；审计回归加入后，最终全仓 69 项通过 |
| `pnpm --filter @deepseek-bot/host test` | 中间实现 48 通过、1 跳过；故障注入测试加入后，最终全仓 53 通过、1 跳过 |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 全仓退出 0 |
| `pnpm test` | 全仓退出 0，712 通过、1 跳过；既有覆盖率门槛通过 |
| `pnpm --filter @deepseek-bot/host build` | 退出 0；dist/main.js 为忽略的构建产物 |
| `git diff --check` | 退出 0 |

最终包计数：desktop 176、shared 6、contracts 76、storage 142、agent-tools 69、runtime 128、harness-adapter 52、harness-bridge 10、host 53 通过 + 1 跳过。新增本片测试 43 项（5 契约、18 存储含迁移、4 网关、16 Host）。真实 API smoke 未启用，故跳过 1 项，不算验证通过。

最终行/分支覆盖率：contracts 99.28% / 92.52%，storage 92.99% / 86.88%（权限仓储 99.81% / 91.70%），agent-tools 97.73% / 91.98%，host 90.61% / 82.51%（Host 权限服务 96.70% / 88.60%）。覆盖率配置未放宽。

测试覆盖严格契约、高风险限制、默认拒绝、精确审批、次数/期限、并发多能力消费、会话隔离、重启、deny 优先、撤销、取消、关闭、模型控制面隔离与无原文审计。新增测试先观察失败，再实现对应后端路径。

独立 AI 差异审查发现并纳入修复：已消费授权撤销后即使策略改 allow 也不能复用旧票据；撤销审计按 bot 可查；Zod 多余键/handler 异常可能泄漏输入原文，改为安全摘要；取消/超时/关闭时 SQLite 写失败仍释放等待与资源，并拒绝无活跃等待的迟到决定。只读数据库故障注入先实际复现关机失败，再修复并通过。若无法持久化取消，旧审批行可能暂留 pending；当前 Host 不接受其决定，重启由 generation 过期处理。最终只读复查无未解决发现，此审查不是 Etheslay 的真人自审。

首次全仓回归命中存储层新增的“撤销后改 allow”失败测试，修复后完成上述最终全仓回归。迁移测试使用真实 v4 SQLite 升级 v5，校验旧 settings 数据及已提交 0001–0004 的 SHA-256 不变。共享最后一次会话额度验证使用两个 SQLite 连接依次竞争，未另行执行多进程同时写入压力测试。早期个别 pnpm 命令启动后延迟输出，直接已安装 Vitest/tsc 复核及最终 pnpm 常规命令均执行成功；未据无输出声称检查通过。

## 4. 未验证与后续工作

- 设置页三档策略、授权记录 UI、聊天审批卡、真实 Harness/模型工具调用与会话恢复接线未完成。D14 示例卡片不能作为真实聊天验收，D16 整体仍未交付。
- 能力目录不等于工具实现：app.start_run/update_bot/create_workflow 等未来工具未新增；D08 fs/shell/MCP 的真实资源门语义保持原样。
- 未发起真实付费 API 请求，真实 API smoke 未显式启用；未验证真实 SearXNG 服务、桌面端到端或远程 CI。
- 当前未提交/推送 D16，尚无此切片 PR 或 CI。GitHub 服务端保护规则本轮未核验，不能将本地规范当作已启用保护。

## 5. 自审记录（Etheslay 本人填写）

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异、共享契约、安全策略与迁移兼容性：＿＿＿＿
- [ ] 测试与错误路径证据：＿＿＿＿
- [ ] 远程 CI 与已知限制：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
