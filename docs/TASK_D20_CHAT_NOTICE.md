# 任务书：D20' 聊天内自动化状态通知条

| 项 | 值 |
| --- | --- |
| 任务 | 只补聊天通知条：错过的触发在聊天里看得见，规则启停状态在聊天里看得见 |
| 分支 | `feature/d20-chat-notice`（从 `origin/develop` = `968aa0b` 拉出） |
| 来源 | GAP_AUDIT（docs/gap-audit-refresh 版）§5 D20 剩余："聊天内自动化启停状态通知条、错过触发可见" |
| 红线 | 不重写规则引擎；不改调度去重；不加契约方法、不改冻结契约；不动 Host/runtime 包 |
| 复用 | D14 聊天内通知行视觉语言（`.deliver-notice`/`.sys-line` 一族的居中弱化行 + 计数）；D20 设置页（`event-rule-settings.tsx`）的取数模式与 i18n 键 |
| 状态 | 任务书随本分支首笔提交入库；实现随后按本方案提交 |

## 1. 背景与现状（2026-10-28 对 `origin/develop` 核实）

已有（本任务全部复用，不改其行为）：

- **规则与生命周期**（PR #66/#84/#85/#87，`packages/runtime/src/event-rules.ts` + Host `eventRule.*` 受信方法）：规则可保存/启停/转评审；本地事件匹配后"一次匹配只启动一次"（幂等键），重复事件记 `duplicate`；停用规则、来源运行已由规则启动、评审拒绝等情形记 `skipped`；启停/切评审在标志真变化时追加一条状态行。数据面（`packages/contracts/src/methods.ts:1323-1494`，均已在册，零新增）：
  - `eventRule.list {botId}` → 规则（含 `enabled`/`review` 标志与名称）；
  - `eventRule.record.list {botId, limit≤100}` → 匹配记录，`outcome: "started" \| "duplicate" \| "skipped"`，附稳定英文 `reason` 与时间；
  - `eventRule.state.list {botId, limit≤100}` → 状态历史行，`state: "enabled" \| "disabled" \| "review"`；
  - `eventRule.review.list {botId, limit≤100}` → 待评审项。
- **桌面侧现状**：设置页 `features/event-rules/event-rule-settings.tsx` 已按 bot 展示规则状态、待评审（可批/拒）与状态历史；它自己声明"本面板不加聊天横幅"——本任务补的正是那一块。
- **D14 通知组件**：聊天消息流内的居中弱化行（`App.tsx:3700-3749` 的 `.deliver-notice` 头像堆通知、`.sys-line` 系统行、`.chat-time` 时间行）。"通知组件"即这一族样式与语义（`role="status"`、弱化、不进气泡、不进历史）。
- **缺口**：聊天页没有任何自动化可见性——错过（skipped/duplicate）、启停（状态行）、待评审都只能去设置页翻。

`record.reason` 为 Host 写入的稳定英文常量（`runtime/event-rules.ts`）：`"rule disabled"`、`"review denied"`、`"duplicate event"`、`"source run was started by an event rule"`、`"matching local event"`、`"review approved"`、`"event rule trigger failed: {错误信息}"`。渲染层做显示映射，数据原样不动。

## 2. 需求（任务书正文）

1. 当前 bot 存在自动化规则时，聊天页头部（静态占位行之下、消息列表之上）出现一条**自动化通知条**；该 bot 没有任何规则时不渲染任何东西。
2. 通知条默认**折叠为一行摘要**，摘要给出计数（错过 N · 待评审 M · 状态变更 K）；有内容才显示，无内容不占位。点击展开详情、可再收起；展开/收起是会话内 UI 态，不持久化。
3. **错过的触发可见**：详情里按时间倒序列出最近的 `skipped`/`duplicate` 记录（最多 5 条），每条含规则名、结果（已跳过/重复已去重）、原因（映射后的界面语言文案）与时间。
4. **启停状态可见**：详情里列出最近的状态变更行（最多 5 条，新在前），每条含规则名、新状态（已启用/已停用/评审模式）与时间。
5. **待评审可见**：有待评审项时摘要与详情都给出计数；详情提供"去设置处理"的跳转（打开设置 → 自动化分区），不在聊天里直接批/拒（批/拒仍归设置页，本片不做第二套操作面）。
6. 数据获取：挂载时拉一次 + 每 20 秒轮询（组件存活期间）；bot 切换（botId 变化）重新拉取，陈旧响应不写入（ticket 守卫）。请求全部走既有受信方法，响应一律过 `METHOD_CONTRACTS` 响应 schema 解析后才进 UI。失败静默降级：保留最近一次成功的数据继续显示，无数据则不渲染；不弹错、不打断聊天，20 秒后自动重试。

### 验收清单

- [ ] 为 bot 建一条规则并停用 → 触发匹配事件后，聊天通知条出现"已跳过 · 规则已停用"行；
- [ ] 启用该规则 → 通知条摘要计数增加"状态变更"，详情含"已启用"行；
- [ ] 同一事件第二次匹配 → 通知条出现"重复已去重"行（调度去重行为本身未被改动）；
- [ ] 评审模式的规则命中 → 通知条计数出现待评审，点"去设置处理"打开设置自动化分区；
- [ ] 无规则的 bot 聊天页不出现通知条；请求失败时聊天不受影响；
- [ ] 通知条不写入 `chat_messages`、不出现在历史回放里（纯渲染层组件）；
- [ ] `pnpm lint` / `pnpm typecheck` 全绿；desktop 套件含新增组件用例全过。

## 3. 实现方案

### 3.1 文件与改动面

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/renderer/src/features/automation/chat-automation-notice.tsx` | **新增**。通知条组件（见 3.2） |
| `apps/desktop/src/renderer/src/App.tsx` | 聊天页（`BotsPlaceholder` 内，`App.tsx:3687` 静态占位行与 `:3690` `.chat` 列表之间）挂一行 `<ChatAutomationNotice botId={me.bot.id} />`；其余不动 |
| `apps/desktop/src/renderer/src/styles.css` | 新增 `.automation-notice` 一族样式（弱化行语言，与 `.deliver-notice`/`.sys-line` 同调；详见 3.4） |
| `apps/desktop/src/shared/i18n/messages/automation-notice.ts` | **新增** i18n 域文件，`messages/index.ts` 挂载（见 3.3） |
| `apps/desktop/tests/features/chat-automation-notice.test.ts` | **新增**组件用例（见 3.5） |
| `docs/reports/D20-chat-notice-report.md` | **新增**交付报告（检查证据 + 自审留空） |

不改动：`packages/*`（契约、storage、runtime、host、agent-tools 全部零改动）、既有 `event-rule-settings.tsx`、调度去重逻辑、聊天历史持久化。

### 3.2 组件设计（`ChatAutomationNotice`）

```tsx
export function ChatAutomationNotice(props: { botId: string }): JSX.Element | null
```

- **状态**：`rules / missed / states / pending / failed`（均为 `null`=未加载）。`useRef` 的 `alive` + `ticket` 守卫沿用设置页模式（`event-rule-settings.tsx:124-126`），防陈旧响应写入。
- **取数**：`refresh()` 用 `Promise.all` 并发四个既有方法（`eventRule.list`、`eventRule.record.list`、`eventRule.state.list`、`eventRule.review.list`，各 `limit: 10`），响应过 `METHOD_CONTRACTS[...].response.parse` 后进入本地化映射。挂载与 `botId` 变化时拉取；`setInterval(refresh, 20_000)`，卸载清除。
- **派生**：
  - `missed = records.filter(outcome !== "started")`（新在前，截 5 条）；
  - `states` 截 5 条；`pending = review.items.length`；
  - 任一非空 → 渲染通知条，全空 → `null`（连同 `rules.length === 0` 一起决定）。
- **原因映射**（仅显示层；未知原因原样展示，错误详情后缀原样保留）：

  | Host 常量 | i18n 键 |
  | --- | --- |
  | `rule disabled` | `eventrule.noticeReasonRuleDisabled` |
  | `review denied` | `eventrule.noticeReasonReviewDenied` |
  | `duplicate event` | `eventrule.noticeReasonDuplicate` |
  | `source run was started by an event rule` | `eventrule.noticeReasonSourceRunAuto` |
  | `event rule trigger failed: {rest}` | `eventrule.noticeReasonTriggerFailed`（rest 作 {0}） |

- **结构**：

  ```
  <div class="automation-notice" data-testid="chat-automation-notice">
    <button class="automation-notice-toggle" aria-expanded> ⚡ {摘要} </button>
    {expanded && (
      <div class="automation-notice-body" role="region">
        [待评审行]  {pending} 条待评审 · 去设置处理
        [状态行]    {规则名} → {已启用|已停用|评审模式} · {时间}
        [错过行]    {已跳过|重复已去重} · {规则名} · {原因} · {时间}
      </div>
    )}
  </div>
  ```

  摘要计数文案：`eventrule.noticeSummary`（"错过 {0} · 待评审 {1} · 状态变更 {2}"，0 值省略该段）。
- **跳转**："去设置处理"复用既有设置打开路径——`App.tsx` 传回调 `onOpenAutomation()`（映射到既有的 `setSettingsOpen(true)` + 分区选择自动化页；具体键以实现时 App.tsx 实际分区常量为准，不改设置页本身）。
- 无障碍：折叠钮 `aria-expanded` + `aria-controls`；详情 `role="region"` + `aria-label`；行内时间用 `<time dateTime>`。

### 3.3 i18n（新键，zh/en 双语）

`eventrule.noticeTitle`、`eventrule.noticeSummary`、`eventrule.noticeExpand`/`noticeCollapse`（aria 用）、`eventrule.noticePendingLine`、`eventrule.noticeOpenSettings`、`eventrule.noticeRecordSkipped`、`eventrule.noticeRecordDuplicate`、`eventrule.noticeStateTo`（"{0} → {1}"）、`eventrule.noticeLoadFailed`，及 3.2 表中 4 个原因键。状态词复用既有 `eventrule.stateEnabled/stateDisabled/stateReview`；规则名缺失回退既有 `eventrule.unknownRule`。

### 3.4 样式

新族 `.automation-notice`（容器：弱化底色 + 细边框，圆角与聊天卡片一致）、`-toggle`（透明按钮整行）、`-body`（纵向行列表）、`-row`（复用 `.automation-rule-row` 的间距节奏但配色跟随聊天弱化行）、`-time`、`-meta`。深浅两主题各过一遍对比度；不加图标字体，前缀符号用既有文本符号（⚡ 或 ·），不引入依赖。

### 3.5 测试计划（`tests/features/chat-automation-notice.test.ts`，jsdom + mock `window.deepseekBot.host.call`）

1. 无规则 → 组件渲染 `null`（容器不存在）；
2. 有 skipped/duplicate 记录 + 状态行 → 摘要计数正确，展开后行文案、规则名、原因映射（含 `event rule trigger failed: x` 前缀映射与未知原因原样兜底）正确；
3. 待评审计数与"去设置处理"回调被调用；
4. 响应不合法/调用 reject → 显示"加载失败"弱化行，不抛错；
5. botId 变化 → 重新拉取（新 bot 的数据，旧响应不写入——ticket 守卫用例）；
6. 组件不调用任何写方法（`eventRule.enable/disable/...` 零调用断言）；
7. 调用失败且无既有数据 → 组件不渲染（静默）；有既有数据 → 数据保留显示。

## 4. 边界与不做什么

- 不重写规则引擎、不改幂等/去重/游标逻辑（`runtime/event-rules.ts` 只读复用）；
- 不加、不改任何契约方法；协议版本不动；
- 不在聊天里做批/拒操作（第二操作面留给设置页；如后续要"聊天内一键批准"另行立项）；
- 通知条内容**不持久化**：不写 `chat_messages`，历史回放不受影响；展开态不持久化；
- 不做推送事件（Host 不加广播）：20 秒轮询是本片的有意取舍，实时性收益不抵契约与复杂度成本；记录面板上限 100 条内取 10 条足够近况可见；
- 消费红线：纯本地渲染 + 本机 Host 调用，无网络请求。

## 5. 提交计划

1. `docs(d20): add the chat automation notice task book`（本文件）；
2. `feat(desktop): add the chat automation status notice (D20')`（组件 + 挂载 + 样式 + i18n + 测试 + 报告）。

PR：base=`develop`，merge commit；自审栏留空待负责人签署。
