# 权限与授权

状态：D16 后端、设置页及聊天审批卡已合入 develop；本功能分支将八个应用工具接入真实聊天，并以真实 Electron、Host、钉扎 Harness 和本地受控模型验证授权后继续执行。设置页与聊天卡统一调用 `permission.*`，卡片展示已校验的精确参数，旧 `grant.create` 按钮已移除。`ask_user` / `web_search` 聊天接线、原生聊天 D08 工具审批及付费模型验收仍未完成；不能据此宣称整体平台验收。后端与运行证据见 [D16 报告](reports/D16-report.md) 和 [Harness 工具报告](reports/D16-harness-tools-report.md)。

## 1. 三层模型

| 层 | 回答的问题 | 存在形式 |
| --- | --- | --- |
| 能力 capability | 系统允许做哪些动作 | 代码里的能力注册表 |
| 授权 grant | 某个 bot 在什么范围、多久、几次内可以使用该能力 | 数据库记录，带作用域与过期 |
| 审批 approval | 这一次操作是否放行 | 每次操作一张审批卡（D09 复用） |

模型不能修改 capability 与 grant；只有人类入口（聊天确认、设置页、撤销按钮）能产生或撤销 grant。

## 2. 能力清单

| capability | 动作 | 风险 | 默认策略 |
| --- | --- | --- | --- |
| `app.read` | 读取 bot/分组/工作流/运行现状 | 低 | 始终允许 |
| `app.create_group` | 创建分组 | 中 | 每次询问 |
| `app.create_bot` | 创建 bot（含指令与工作目录） | 中 | 每次询问 |
| `app.update_bot` | 修改 bot | 中 | 每次询问 |
| `app.create_workflow` | 创建工作流与节点/连线 | 中 | 每次询问 |
| `app.start_run` | 启动运行（消耗 API 预算） | 高 | 每次询问（不可改为始终允许） |
| `app.cancel_run` | 取消运行 | 中 | 每次询问 |
| `app.revoke_creation` | 撤销创建批次 | 中 | 每次询问 |
| `interaction.ask_user` | 等待人类回答 | 低 | 始终允许；回答不授予权限 |
| `fs.read` / `fs.write` | 工作目录文件读写 | 中 | D08 路径策略 + 审批 |
| `exec.shell` | 执行本地命令 | 高 | 每次询问 |
| `screen.capture` | 窗口截图 / OCR | 高 | 从不允许（需显式开启） |
| `connector.invoke` | 调用连接器 / MCP 工具 | 中 | 每次询问 |
| `network.search` / D08 `network.request` | web_search 向受信配置的 SearXNG 端点提交搜索 | 中 | D16 每次询问，另需 D08 网络策略放行；缺少受信权限句柄拒绝 |

能力注册表包含未来能力，不会自动产生对应工具；新增工具必须显式绑定能力并同步本文、契约与审计字段。`create_bots_batch` 有 newGroup 时同时需要 create_bot/create_group。草案生成仅回显、不落库，属于 app.read。

`web_search` 先通过 D16 network.search，再通过现有 ToolPolicy.network 及 D08 精确动作授权。工具模型参数不能指定服务地址或传入权限对象；受信调用方经 ToolCallOptions.networkPermissions 绑定当前节点的 D08 句柄。禁止网络时不发请求，要求审批时先等真实审批。网关 JSONL 存摘要；D08 本地 tool.requested 事件按已有规范保存精确搜索参数用于审批。

## 3. 三档策略

每个能力可设为：

| 策略 | 行为 |
| --- | --- |
| 始终允许 | 网关直接放行，仍做参数与路径校验 |
| 每次询问 | 网关弹出审批卡，用户允许后执行 |
| 从不允许 | 网关拒绝，向模型返回可解释原因 |

默认值：app.read / interaction.ask_user 允许，screen.capture 拒绝，其余询问。app.start_run 固定 ask；exec.shell / screen.capture 只能 ask 或 deny，且三者不接受会话/永久授权。策略由受信 permission.policy.set 修改并持久化。设置页按同一约束展示：启动运行只读为每次询问，本地命令和屏幕感知不提供始终允许。

策略 deny 优先于已有授权。写操作和 network.search 即使策略 allow 也须绑定有效 bot；匿名只可使用策略 allow 的读/提问。网关没有检查器、未知能力或无效身份均拒绝。

本次批准只匹配精确 invocation/参数摘要，最多一次；会话授权绑定 botId、sessionId、Host generation，默认 5 次/2 小时，可设 1–100 次/1–1440 分钟；永久授权绑定 bot，无期限或次数上限。多能力授权在一个事务中预扣次数，任何能力缺失都不扣；handler 失败不退还。执行前同步重验政策、撤销、有效期和参数摘要，不重复扣次数。Host 重启会撤销旧 once/session 授权并使未决审批过期；永久授权和策略保留。

应用审批默认等待 10 分钟，取消信号或 Host 关闭结束等待，迟到/重复/摘要不符的决定拒绝。问题回答入口不会修改授权。精确参数存于 app_approvals 供人类预览；permission_audit 与 JSONL 不保存原文，备份包含审批预览数据。

## 4. 聊天内授权

```mermaid
sequenceDiagram
    participant U as 用户
    participant B as 主控 bot
    participant G as 工具网关
    participant P as 权限门
    U->>B: 建一个 3 人工作流，你当调度
    B->>G: 需要 app.create_group / app.create_bot / app.create_workflow
    G->>P: 查询 grant
    P-->>G: 无授权（默认每次询问）
    G-->>U: 授权卡片（仅本次 / 本会话 / 永久 / 拒绝）
    U->>P: 本会话允许（maxUses=5，2h）
    P-->>G: grant 生效
    G->>G: 执行并写审计
    G-->>B: 返回结果
    B-->>U: 回执卡片（已创建）+ 撤销按钮
```

授权卡字段固定：能力列表、作用域（本次/会话/永久）、次数上限、过期时间、申请理由。当前聊天卡片列出该 bot 的 pending 审批：申请理由用工具名，能力用中文名。本会话按契约默认 5 次、2 小时；永久不限次数。`app.start_run` / `exec.shell` / `screen.capture` 以及没有 sessionId 的审批不提供更长授权。决定调用 `permission.approval.decide`，并带回精确 `actionDigest`。

## 5. 设置页

```
设置 → 电脑与权限
  在这台电脑上执行        [ 始终允许 ▾ ]（默认每次询问）
    创建分组              [ 每次询问 ▾ ]
    创建 bot              [ 每次询问 ▾ ]
    修改工作流            [ 每次询问 ▾ ]
    启动运行              [ 每次询问 ]（只读）
    屏幕与窗口感知        [ 从不允许 ▾ ]
  本地数据：位置 / 打开目录
  授权记录：查看与撤销
```

设置页只改变默认策略；聊天内授权是临时叠加，过期回到默认。两者共用同一张 grant 表，差异在 `scope`。页面列出 `permission.policy.list` 返回的全部能力。授权记录来自 `permission.grant.list`，不把 `scope=policy` 的全局策略行当成可撤销授权；撤销调用 `permission.grant.revoke`。上面草图里的「本地数据：位置 / 打开目录」仍未接在这一页。

## 6. 审计与撤销

- 每次工具调用写一条审计：`at`、`botId`、`capability`、`argsDigest`、`grantId`、`decision`、`result`、`runId?`；
- 审计不可由模型写入或删除；
- 批量创建记录 `batchId`，支持一键撤销整批（回滚分组、bot、工作流）；
- 撤销 grant 立即生效，进行中的操作在下一次网关检查时终止。

## 7. 与 D08 的关系

D08 已实现：路径规范化与包含校验、策略评估、一次性审批门、MCP 授权检查、启动代次绑定。v0.2 在其上增加：

1. 新的 `app.*` 能力类别；
2. grant 表与作用域；
3. 聊天内授权卡片与设置页；
4. 审计与批量撤销。

不改变 D08 的既有语义：副作用前拦截、一次消费、重启后旧审批不可重放。

## 8. 安全红线

- 模型不能调用授权接口给自己或其它 bot 授权；
- “从不允许”必须在网关层拒绝，不能只靠 UI 隐藏；
- `app.start_run` 不得配置为始终允许；
- 屏幕截图/OCR 默认关闭，采集内容不出本机；
- 审计与撤销记录不能由模型修改；
- 任何绕过路径（例如直接写数据库、直接调用 IPC）都视为缺陷。
