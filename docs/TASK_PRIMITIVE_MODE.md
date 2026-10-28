# 任务书：原始人模式 + 深度思考入口（发消息处双开关）

| 项 | 值 |
| --- | --- |
| 性质 | 任务书 + 实现方案（二合一）；实现随本分支提交 |
| 分支 | `feature/primitive-mode` → PR 目标 `develop` |
| 基线 | `origin/develop` = `473ec67`（PR #125） |
| 上游 | 深度思考 = 已合入的 PR #73（G5，`features/chat/reasoner.ts` + bot.update 换 modelProfileId），本任务**不重做**，只把入口从顶栏移到输入框旁；原始人模式 = 新能力 |
| 契约 | `chat.send` 请求新增**可选** `primitive: boolean`（附加式，缺省即现状；按 D26 先例不升 `protocolVersion`，CONTRACTS.md 补记） |
| 红线 | 两个开关互不代替；原始人模式不删历史——`chat_messages` 落库照旧，只是**提示组装**不复读上下文；不发起付费调用做验证 |
| 负责人 | 待认领；自审由负责人本人签署 |

## 1. 背景与现状（证据，2026-10-28 对 `473ec67`）

- 深度思考（G5，PR #73）：`isDeepThinkingEnabled(bot.modelProfileId)` 判定、`toggleDeepThinking()` 经 `bot.update` 在 chat/reasoner 两个内建 profile 间切换；**入口当前只有顶栏一枚胶囊按钮**（`App.tsx` 头部 `deep-thinking-toggle`），输入框旁没有。
- 提示组装（`packages/host/src/chat.ts` `composePrompt`）：`bot.instructions` + 技能块 + `【最近对话】`（最多 20 条历史回放）+ `[用户消息]`。长会话 + 长 persona 指令是小任务省 token 的主要浪费。
- `chat.send` 请求：`{botId, text, skills?}`（zod object，非 strict；可选字段完全向后兼容）。

## 2. 需求（验收）

1. 发消息处（composer）出现**两个独立开关**：「原始人」「深度思考」；互不代替——可同时开（原始人管提示组装，深度思考管模型 profile）；
2. 原始人模式开启的回合：
   - 提示**不含** `bot.instructions`、**不含** `【最近对话】`历史回放（只答这一步，不复述上下文）；
   - 保留用户当轮显式附加的**技能块**（显式附加的指令不静默丢弃；技能的能力白名单本就在 `openTurn` 单独生效，与提示文本无关）；
   - 注入一条简短的原始人指令（直接回答这一步/不铺垫/不复述/最短可用）；
   - **落库照旧**：用户行与助手行完整写入 `chat_messages`（G1 历史回放不受影响），用量照记（自然更省）；
3. 深度思考入口移至 composer（顶栏原按钮移除，单一入口避免双处状态展示）；行为与 PR #73 完全一致（bot.update 换 profile、toast 反馈）；
4. 原始人模式按 bot 记忆（渲染层 localStorage，`deepseek-bot.primitive-mode.v1`，只存开启项）；重启保持；Host 侧无新表；
5. 关闭任一开关即回到现状行为，无残留。

## 3. 实现方案

### 3.1 契约（`packages/contracts`）

- `methods.ts` `chat.send` 请求加 `primitive: z.boolean().optional()` + 注释（"one-step terse turn: the Host composes a minimal prompt — no persona instructions, no history replay; storage unchanged"）。附加式可选字段，旧发送方不受影响；`CONTRACTS.md` 补一行说明（按 D26 先例不升版本号）。

### 3.2 Host（`packages/host`）

- `handlers.ts` `chat.send`：`const primitive = payload.primitive === true;` —— primitive 时**跳过历史读取**（`history = []`，少一次查询），`chat.send(bot, text, history, skills, { primitive })`；`appendChatMessage` 两处照旧。
- `chat.ts` `ChatManager.send` 增加第 5 参 `options?: { primitive?: boolean }`；`composePrompt` 增加 primitive 分支：
  - 跳过 `bot.instructions` 与历史块；
  - 保留技能块；注入简短指令：`【原始人模式】只回答下面这一步：不铺垫、不复述上下文、不做总结；直接给最短可用的答案。`（与既有 `【最近对话】`/`[用户消息]` 同为中文提示文案，zh 列不变原则不受影响——这是发给模型的提示，非界面文案）；
  - `[用户消息]` 收尾不变。

### 3.3 渲染层（`apps/desktop`）

- 服务面：`desktop-service.ts` `StreamOptions` 加 `primitive?: boolean`（fixture 注释：fixture 忽略）；`host-service.ts` `chat.stream` 透传 `primitive: true`；`stream-runner.ts` deps 加 `primitive?: boolean` 并合并进 options（技能与原始人可同时携带）。
- 开关状态：新模块 `features/chat/primitive-mode.ts`（`loadPrimitiveModes` / `setPrimitiveMode`，localStorage 只存开启项）；`App.tsx` 按当前选中 bot 读写。
- Composer UI：输入框与麦克风之间加一组紧凑开关（`.composer-mode` chip ×2）：「原始人」新开关 + 「深度思考」（复用 `reasoner.toggleLabel` 文案与 `deepThinking` 状态/handler）；顶栏原 `deep-thinking-toggle` 按钮移除。
- i18n：`shell.primitiveMode`（原始人/Primitive）、`shell.primitiveModeTitle`（省 token 说明，zh/en）；深度思考沿用 `reasoner.*` 既有键。

### 3.4 测试

- `packages/host/src/chat.test.ts` 新增："primitive mode answers just this step: the prompt drops persona instructions and history replay"——`echo-model` 场景（回应即最终提示）：先普通发一条，再 `primitive: true` 发一条；断言第二条提示**不含** `be brief`（persona）与 `【最近对话】`，**含** `【原始人模式】` 与 `[用户消息]`；再发一条普通消息确认历史回放恢复（开关无残留）；`chat.history` 全程 6 行（落库不受影响）。
- `apps/desktop/tests/features/primitive-mode.test.ts` 新增：store 的 load/set/toggle 与只存开启项语义。
- 契约：无既有 chat.send fixture；附加可选字段由 host e2e 用例覆盖（zod 解析 + strict 兼容）。

## 4. 边界与非目标

- 不做 primitive 专属的回复后处理（不截断模型输出——"最短"靠提示达成，如实呈现模型回答）；
- 不动 reasoner 机制本身（PR #73 面）；
- 原始人模式是**逐回合生效**的提示组装开关，不写 bot 实体、不进 Host 存储（等拍板 #1 的统一界面态持久化再迁移）；
- 与 G13（上下文窗口可见性）无交叉：primitive 是显式开关，不是截断策略；
- 验证不跑真实模型（当前指示：不发起付费调用）；提示行为由 echo-model 假场景钉住。

## 5. 风险与回退

- 契约附加可选字段：旧客户端/旧 Host 互操作不受影响（非 strict，缺省即现状）；
- 原始人回合丢 persona 可能改变回答语气——这是该开关的本意，UI title 已说明；
- 顶栏深度思考按钮移除属界面变化，任务书已声明（单一入口原则）；
- 回退：`git revert -m 1 <merge-sha>`；无迁移。

## 6. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
