# D20 事件自动化：触发规则与评审队列

日期：2026-10-27（Asia/Shanghai）。负责人：Etheslay。分支：`feature/automation-triggers`。基线：`ae0c6be`（origin/develop，含 PR #63）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

FR-17（事件触发与规则、评审队列；重复触发防护；错过触发可见且不静默补跑）的后端第一片：

| 块 | 实现 |
| --- | --- |
| 触发规则 | 迁移 `0013-automation-triggers`：`trigger_rules`（名称/目标工作流/事件类型 run.failed·run.completed/可选源工作流过滤/启停/游标）。受信方法 `trigger.list/save/enable/disable/delete`——规则管理只属于桌面控制面，不是模型工具；目标与源工作流必须存在，新建默认关闭，删除级联清理评审记录 |
| 评审队列 | `trigger_firings`：规则命中持久事件流后入队（UNIQUE (rule, source event)——**一个事件只触发一次**）。受信方法 `trigger.firing.list/decide`；`decide("start")` 复用 run.start 路径（同策略钉扎、revision 校验、幂等键）启动目标工作流并记录 `started_run_id`；`decide("dismiss")` 仅关闭条目。**没有任何自动启动路径** |
| 重复触发防护 | 两层： firing 唯一约束（单事件单触发）；**循环防护**——队列自己启动的运行（started_run_id）在评估时被跳过，失败的自愈链路不会无限级联 |
| 错过可见 | 评估器按规则游标扫 `events` 表（持久事件流），Host 启动时补扫一次 + 5 秒轮询（间隔可配，shutdown 清理）；**宕机期间积累的事件以 reason="missed" 入队**——可见、由人决定，绝不静默补跑。游标只在整次扫描成功后推进 |
| 聊天内可见 | 只读模型工具 `list_automations`（能力 `app.read`，默认允许，走新 `/triggers` 通道与桥接目录）：模型可汇报规则清单/启停状态/待评审条目——"启停状态在聊天内可见"的平台半边；对标通知条渲染（D20 × D14）属 B 线 |
| 桌面 | 设置页新增"事件自动化"面板：规则管理（名称/目标工作流/事件类型，启停/删除）+ 评审队列（逐条启动/忽略，错过补记标记）；全部文本渲染。为此补了最小受信方法 `workflow.list`（只回 id/name/revision 摘要，选择器用） |

## 2. 实际检查

环境：Windows 11 x64、Node v24.16.0、pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | 退出 0 |
| `pnpm test` | 退出 0（连续两轮）：shared 6、harness-bridge 16、contracts 90、agent-tools 80、storage 163、desktop 229、runtime 128、harness-adapter 58、host 92 通过，另有 1 项跳过（既有付费 API 冒烟） |

新增用例覆盖：规则 CRUD 与工作流引用校验、(rule, event) 去重、decide 单次守卫、循环防护查询、评估器端到端（匹配入队/过滤源工作流/跳过队列自启运行/missed 标记）、decide start 经真实引擎启动工作流、面板三区交互（jsdom）、`list_automations` 只读工具（空参严格/审计/网关拒超参）。

## 3. 未验证

- 未用真实 Electron 手测设置页面板；桌面测试使用 jsdom。
- 真实 Harness 下"运行失败 → 评审 → 启动修复工作流"的完整人工闭环未演练（评估器用真实引擎 + 直接注入事件验证）。
- 聊天内通知条（对标 #5）未接线——依赖 D14 通知条组件（B 线）；模型汇报链路已由 `list_automations` 打通，真实模型会话未演练。
- 远程 CI、安装包、签名、GitHub 保护规则复核未执行。
- 迁移编号协调：develop 的共编侧车持 `0011-artifact-versions`，连接器 PR 持 `0012-connectors-endpoint`；本分支迁移顺延为 `0013-automation-triggers`，按 id 顺序应用。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
