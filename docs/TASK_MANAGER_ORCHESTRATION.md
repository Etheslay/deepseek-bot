# 任务书：Manager 调度闭环 —— 主控 bot 建工作流、组团队、派发任务

| 项 | 值 |
| --- | --- |
| 建议编号 | 阶段三新增需求（不在现行 D14–D30 清单内），建议特性族名 `manager-orchestration`，分支命名见 §5 |
| 类型 | 新产品能力（涉及契约新增、新权限能力、Host 新服务、桌面 UI） |
| 基线 | 开工时 `origin/develop` 最新提交为准 |
| 需求来源 | 负责人口述（2026-10-26）：建 manager bot → manager 建工作流 → 按工作流创建其他 bot → 给他们发布任务 → 用户派发任务可经 manager 转发 |
| 状态 | 待评审、待认领（本文档由需求方口述 + AI 起草，契约与安全相关结论须经两位负责人确认） |
| 红线 | 遵守 AGENTS.md：契约变更加小型独立 PR 先合入 develop；独立 feature 分支；不伪造自审；未运行检查不得声称通过；**权限唯一来源是人**（PERMISSIONS.md §8） |

---

## 1. 需求说明

### 1.1 用户故事

- **US-1 组团队**：我在聊天里对 manager 说"组建一个内容小组，要一个写手和一个审校"。manager 在授权与审批下创建分组（可选）并批量创建 bot，头像自动不重复分配。
- **US-2 建工作流**：我说"把我们仨的协作流程搭成工作流：我先提需求，写手出稿，审校把关"。manager 生成工作流定义（节点引用刚创建的 bot）并保存，工作流编辑器里可见、可手工调整。
- **US-3 派发任务**：我在 manager 的聊天里说"把这周的选题任务发给写手"。manager 判断该给谁，经审批/授权后把任务派发给写手；写手在自己的会话里实际执行并产出回复。
- **US-4 直接转发**：我每次派任务时不需要自己去找写手——都交给 manager，由 manager 转发。任务的流转状态（排队/执行中/完成/失败）我随时可见。
- **US-5 结果回流**：写手完成后，manager 的聊天里出现交付通知（可点击跳到写手会话看全文），manager 能基于结果继续向我汇报或追加派发。
- **US-6 权限清晰**：以上全部动作走既有三层权限（capability/grant/approval），审批卡展示精确参数，全程审计；manager 派发 ≠ 拥有写手，写手自己的高危动作仍需我审批。

### 1.2 功能需求（FR）

| # | 需求 | 优先级 |
| --- | --- | --- |
| FR-1 | bot 可被设为**协调者（coordinator）**角色：bot 编辑器人肉切换（模型不可改），侧边栏与会话头显示徽标；每组最多一个协调者 | P0 |
| FR-2 | 协调者可在聊天中**创建工作流**：模型工具绑定既有契约 `workflow.validate`/`workflow.save`，走 `app.create_workflow` 授权；结果在 D07 编辑器可见可改 | P0 |
| FR-3 | 协调者可在聊天中**批量创建 bot**（既有 `create_bots_batch` 真实链路）并与工作流创建组合为一次"组队"计划：一次审批卡同时申请 `app.create_bot` + `app.create_workflow`（D16 已支持多能力单审批） | P0 |
| FR-4 | 新增**任务派发**原语：协调者调用 `dispatch_task` 工具把一段指令派给同组的另一个 bot；目标 bot 的会话中出现带"来自 manager 派发"标记的用户侧消息，并立即触发该 bot 的一个真实聊天回合（流式回复进其会话） | P0 |
| FR-5 | 派发经新能力 `app.dispatch_task`（默认每次询问；可授会话/永久授权），审批卡展示目标 bot 与任务原文；审计记录发起者与执行者两个身份 | P0 |
| FR-6 | 任务记录持久化并可查询：状态机 `queued → running → done/failed/cancelled/interrupted`；协调者可用 `list_tasks` 只读工具查询；人类可在运行监控的任务列表里查看与取消 | P0 |
| FR-7 | 派发回执：任务完成/失败后，协调者会话内出现交付通知（复用 D14 通知条组件），带状态与结果预览，点击直达执行者会话 | P0 |
| FR-8 | **深度限制**：仅协调者可派发（深度 1）；普通 bot 调用 `dispatch_task` 一律拒绝；仅限同组目标；跨组、worker→worker 链式派发 v1 不做 | P0 |
| FR-9 | 角色安全：`role` 字段只能经人类入口修改；模型工具层永不暴露 role 写入（未来若绑 `update_bot` 工具必须剥离该字段）；非协调者调用派发工具在网关层拒绝（不是 UI 隐藏） | P0 |
| FR-10 | 重启语义：Host 重启时 `queued/running` 任务标记 `interrupted`，人类可重新派发；与 D10 调度器中断语义一致 | P1 |
| FR-11 | 用户始终可以直接找任意 bot 聊天（人类派发不需要任何权限）；manager 转发是可选增强而非必经路径 | P0 |
| FR-12 | 中文文案、深浅主题、键盘可达性按既有聊天规范执行 | P1 |
| FR-13 | **交接接力（扩展片 T7，§7）**：manager 派发任务时可预声明下游交接链（如 设计→编码→审查），上游完成后由 Host dispatcher 自动接力下一 bot；链预声明、防环、限深、单卡审批 | P2 |

### 1.3 非目标（本次不做）

- v1 基线（§3.3/FR-8）只做深度 1 的中心派发；多跳接力不做自由形态，仅按 §7 扩展片 T7 的"预声明交接链"实现（worker 仍无自主派发权）；跨组派发、bot 自主扩编后自动开工不做；
- 不做 bot 间自由聊天：bot 之间不存在消息通道，沟通仅通过任务指令附言（context）、交接摘要与工作区产物；
- 不做常驻后台 agent（派发触发的是**一个**回合的执行，回合结束即停；持续工作靠再次派发或工作流）；
- 不做 `start_run` 的模型工具（工作流运行仍只由人类启动；manager 派发 ≠ 启动工作流运行）;
- 不改 `app.start_run` 的"每次询问"锁定；不给 manager 读取其他 bot 记忆的能力（memory 工具本就锁定调用者自身）；
- 不做 manager 自动撤销/修改其他 bot（`revoke_batch` 只能撤销**自己**创建的批次，保持现状）。

## 2. 现状与差距（2026-10-26 核对）

| 需求段 | 现状 | 差距 |
| --- | --- | --- |
| 建 manager bot | ✅ D05 bot CRUD 完备 | 仅缺 `role` 角色字段与徽标 |
| manager 批量建 bot | ✅ `create_bots_batch` 真实链路已验证（受控模型） | 无 |
| manager 建工作流 | ❌ 契约已有 `workflow.save/validate`（D06/D07），但**模型工具未绑定** | 绑定两个工具 + 审批接线 |
| 按工作流组队 | ⚠️ 两段能力都齐，但无组合引导 | 工具描述引导"先建人后建流程"的标准编排，无需新代码 |
| 派发任务 | ❌ 完全没有：无 bot 间通信（`App.tsx` `talkTo` 为占位脚本），无 task 契约/存储/执行 | 全新能力面（见 §3.3） |
| 状态可见与回执 | ⚠️ D14 交付通知组件已有（UI 占位） | 接真实任务状态 |

## 3. 实现方法

### 3.1 角色模型（FR-1/FR-9）

- 契约：`BotProfile` 增加可选字段 `role: "standard" | "coordinator"`（缺省 `standard`，向后兼容，协议版本 0.3 → 0.4 附加式）。
- 约束：Host 在 `bot.update`/`bot.batchCreate` 落库前校验"每组至多一个 coordinator"；违反拒绝（`INVALID_INPUT`）。
- 修改入口：仅桌面 UI（bot 编辑器开关）。模型工具层**不绑定**任何可写 role 的工具；未来绑定 `update_bot` 工具时，其入参 schema 必须剥离 `role`（写进工具定义的测试）。

### 3.2 工作流创建工具（FR-2/FR-3）

- 在 `packages/agent-tools` 新增 `bindWorkflowTools`：
  - `save_workflow`：入参为契约 workflow 文档的 zod 镜像 → 先 `workflow.validate` 再 `workflow.save`；绑定既有能力 `app.create_workflow`（默认每次询问）。
  - `describe_workflow_expectations` 不需要——组队编排靠工具描述：`create_bots_batch` 描述追加"先建成员、再保存引用其 botId 的工作流"的推荐顺序。
- 一次"组队"= manager 连续调用 `create_bots_batch` + `save_workflow`；两能力合并进一张多能力审批卡（D16 审批摘要本就绑定能力集合，事务预扣已实现），无需新组合工具。
- 前端零改动：保存后的工作流在 D07 编辑器正常可见可改。

### 3.3 任务派发（FR-4～FR-8，本任务书核心新增）

**契约面（T1）**：新增方法（附加式进 `METHODS`，协议 0.4）：

| 方法 | 方向 | 说明 |
| --- | --- | --- |
| `task.dispatch` | 网关内部（模型工具） | `{ toBotId, task: string(1..8000), context?: string }`；仅由 dispatch 工具经网关调用 |
| `task.list` | 人类 + 模型只读工具 `list_tasks` | 按发起/执行 bot、状态过滤 |
| `task.cancel` | 仅人类 | 取消 queued 任务；running 任务转 `chat.cancel`/引擎取消语义 |
| 事件 | 复用 `events.subscribe` | 新事件种 `task.status`（去重沿用 D06 事件机制） |

**能力面**：注册表新增 `app.dispatch_task`，默认 `ask`；允许 once/session/permanent 授权（理由：一次派发 = 一个聊天回合的成本，上限远小于一次工作流运行；执行者自身的高危工具仍受各自策略约束。与 `app.start_run` 的差异及理由写入 PERMISSIONS.md）。

**网关与角色检查（T3）**：`dispatch_task` 工具绑定 `app.dispatch_task`；检查点在授权之外追加角色规则（按受信 `ToolCaller.botId` 查库）：调用者必须为 `coordinator`、目标 bot 必须与调用者同组、目标不得为自身。任何不满足返回可解释拒绝；该检查在网关层实现（红线：不能只靠 UI 隐藏）。

**Host TaskDispatcher（T3）**（`packages/host/src`，与 ChatManager 平级）：

1. `task.dispatch` 通过审批后落库任务（status=queued）并向执行者会话投递一条系统标记的用户侧消息（`meta: { kind: "dispatch", taskId, fromBotId }`，渲染层据此显示"来自 manager 的派发"样式）；
2. 每 bot 串行队列：执行者忙（回合进行中）则排队；轮到时 Host 以该 bot 身份发起一个真实聊天回合（复用 D30 ChatManager 路径：新建钉扎 Harness attempt、回放近期历史、流式落库），status=running；
3. 回合结束：status=done/failed，结果摘要（最终回复截断）写入任务记录，发 `task.status` 事件，并向协调者会话写入交付通知消息（复用 D14 notice 结构，带 taskId）；
4. 执行者回合内自己的工具调用走既有网关（审计记执行者 botId——派发不改变行为主体）；
5. 启动清扫：将 queued/running 标记 `interrupted`（FR-10）。

**存储（T2）**：新迁移（下一编号）`tasks` 表：`id`、`from_bot_id`、`to_bot_id`、`instruction`、`status`、`result_summary`、`created_at/started_at/finished_at`、`worker_message_ids`；索引 `(to_bot_id, status)`、`(from_bot_id, status)`；纳入 `data.backup/describe`。

**桌面 UI（T5）**：

- bot 编辑器：角色开关（协调者）；侧边栏/会话头徽标；
- 审批卡：零新组件——D16 卡片天然展示 `app.dispatch_task` + 精确参数（目标 bot、任务原文）；
- 执行者会话：派发消息的特殊样式（"来自 manager「名字」的派发"标签）；
- 协调者会话：交付通知条 + 状态徽标（queued/running/done/failed/interrupted），点击跳转执行者会话；
- 运行监控（D09）：新增"任务"页签：列表 + 过滤 + 取消按钮（`task.cancel`）。

### 3.4 安全边界汇总（与 PERMISSIONS.md §8 对齐）

- 权柄不变式：manager 能做的只有"派发一段指令"；它不拥有执行者，不读其记忆，不改其配置，不能替它审批；
- 执行者的一切工具调用仍按其自身 grant/策略审批与审计；
- 深度 1 + 同组 + 非自身，三层拒绝在网关实现；
- 审批卡展示任务原文（人类知情）；审计双身份（发起者/执行者）；
- 模型无法自授角色或授权（role 无模型写入口，`permission.*` 本就不在模型注册表）。

## 4. 任务说明（切片、分支、依赖）

> 每片独立 feature 分支、独立 PR 与报告；契约片按 AGENT_PLATFORM 规则先行合入 develop，其余片再更新基线。A 线 = Etheslay（后端），B 线 = Destinyian（前端），可并行处标注。

| 切片 | 分支建议 | 依赖 | 内容 | 负责线 |
| --- | --- | --- | --- | --- |
| T1 契约 | `feature/task-dispatch-contracts` | — | BotProfile.role（附加）、`task.*` 三方法与 schema、事件种 `task.status`、能力注册表 + `app.dispatch_task`、协议 0.4、夹具与契约测试；同步 CONTRACTS.md | A（契约负责人自审） |
| T2 存储 | `feature/task-storage` | T1 | tasks 表迁移与仓库、备份/恢复纳入、重启中断标记的存储侧、存储测试 | A |
| T3 Host 派发 | `feature/task-dispatch-host` | T1、T2 | TaskDispatcher（队列/回合发起/回执/清扫）、dispatch 工具绑定 + 角色三重检查、`list_tasks` 只读工具、`task.cancel` 人类方法、审计双身份、Host 测试；同步 PERMISSIONS.md | A |
| T4 Host 工作流工具 | `feature/chat-workflow-tools` | T1 | `save_workflow` 工具绑定（validate→save）、组队编排工具描述、Host 测试 | A（与 T2/T3 并行） |
| T5 桌面 UI | `feature/task-dispatch-ui` | T3 | 角色开关与徽标、派发消息样式、交付通知接真实状态、运行监控"任务"页签、键盘/主题 | B（与 T4 并行） |
| T6 验收 | `feature/manager-loop-acceptance` | 全部 | 真机端到端（§6）、文档收口（AGENT_PLATFORM 工具表更新）、报告与自审 | A+B |

里程碑：**M-A 指挥闭环** = T1+T2+T3+T5+T6（US-3/4/5/6 可用）；**M-B 编排** = +T4（US-1/2 可用）；**M-C 交接接力** = §7 扩展片 T7（依赖 M-A 全部合入）。三个里程碑可分别发布验收。

## 5. 测试与验收标准

单元/集成：

- [ ] U1 角色约束：standard 调 `dispatch_task` 网关拒绝；跨组拒绝；自派发拒绝；深度恰为 1；
- [ ] U2 role 仅人类可写：模型侧任何工具入参无法触达 role 字段（schema 测试）；
- [ ] U3 队列：忙 bot 的派发进 queued 并按序执行；`task.cancel` 取消 queued；running 取消走引擎取消；
- [ ] U4 重启清扫：queued/running → interrupted，可查；
- [ ] U5 审批：`app.dispatch_task` 默认 ask；会话授权次数/过期/撤销语义与 D16 一致；策略 deny 优先；
- [ ] U6 `save_workflow`：validate 失败不落库；成功后 D07 可见；多能力审批单卡扣减正确；
- [ ] U7 审计双身份：一条派发至少产生 dispatch（发起者）+ 执行者回合内各自记录。

真机验收（截图存 `docs/reports/assets/manager-loop/`，需真实/受控模型与用户 Key）：

- [ ] E1 组队：聊天内一句话让 manager 建 2 人小组 + 协作工作流；单张审批卡列全部能力；完成后编辑器可见工作流；
- [ ] E2 派发：向 manager 说任务 → 审批卡 → 写手会话出现"来自 manager 的派发"并流式产出回复；
- [ ] E3 回执：任务完成通知出现在 manager 会话，状态徽标正确，点击跳转正确；
- [ ] E4 边界：让 worker 尝试派发 → 拒绝且解释；执行者触发 exec.shell → 仍弹其自身审批卡；
- [ ] E5 中断：任务运行中杀 Host → 重启后任务显示 interrupted，可重新派发；
- [ ] E6 权限页：`app.dispatch_task` 出现在策略列表，三档可调；授权记录可撤销且立即生效。

流程门槛：`pnpm lint`/`typecheck`/相关包 `test` 全绿（附实际输出）；各片 PR 附对照清单；自审由负责人本人填写。

## 6. 开放问题（评审时拍板）

| # | 问题 | 建议 |
| --- | --- | --- |
| Q1 | `app.dispatch_task` 是否允许永久授权 | 允许但设置页加风险提示（持续消耗 API）；`start_run` 维持锁定不动 |
| Q2 | manager 可否取消它派发的 running 任务 | v1 仅人类取消；Q2 顺延到使用反馈后 |
| Q3 | 每 bot 排队上限 | 建议默认 10，超出派发拒绝并提示（防失控刷任务） |
| Q4 | 派发回合的结果是否自动回灌 manager 上下文 | v1 仅通知条 + `list_tasks` 拉取；自动摘要回灌列入后续（省 token、避免隐性链路） |
| Q5 | 跨组派发 | v1 拒绝；如需"全公司总管"，届时引入组间委托审批（另行立项） |
