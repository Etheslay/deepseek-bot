# 原始人模式 + 深度思考入口（composer 双开关）报告

分支：`feature/primitive-mode` · 目标 `develop` · 契约：`chat.send` 可选 `primitive` 字段（附加式，不升 `protocolVersion`）· 任务书：[TASK_PRIMITIVE_MODE](../TASK_PRIMITIVE_MODE.md)

## 1. 做了什么

| 层 | 内容 |
| --- | --- |
| 契约 | `chat.send` 请求新增可选 `primitive: boolean`（缺省即现状；CONTRACTS.md 补记，按 D26 先例不升版本号） |
| Host | `handlers.ts`：primitive 回合跳过历史回放读取（少一次查询），`chat.send(..., { primitive })`；`chat.ts` `composePrompt` primitive 分支——**不带 persona 指令、不带 `【最近对话】`**，保留当轮显式附加的技能块，注入简短指令「【原始人模式】只回答下面这一步：不铺垫、不复述上下文、不做总结；直接给最短可用的答案。」；`chat_messages` 落库两处照旧 |
| 渲染层 | `StreamOptions.primitive` + `host-service` 透传 + `stream-runner` 合并（与 skills 互斥互补、可同时携带）；`features/chat/primitive-mode.ts` 按 bot 记忆（localStorage `deepseek-bot.primitive-mode.v1`，只存开启项，corrupt 容错）；composer 输入框与麦克风之间新增 `.composer-mode` 双 chip：**「原始人」**（新）+**「深度思考」**（复用 PR #73 的 `deepThinking` 状态与 `bot.update` 换 profile 行为） |
| 入口迁移 | 深度思考按钮从顶栏移入 composer（单一入口）；顶栏旧按钮与其 `.deep-thinking-toggle` 样式移除 |
| i18n | `shell.primitiveMode`（原始人/Primitive）、`shell.primitiveModeTitle`（省 token 说明 zh/en）；深度思考沿用 `reasoner.*` 既有键 |

两个开关互不代替：原始人管**提示组装**（Host 侧），深度思考管**模型 profile**（reasoner），可同时开。

## 2. 验证证据

环境：Windows 11 x64 · Node 24.16.0 · pnpm 11.28.5 · 基线 `origin/develop` = `473ec67`（PR #125）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Host 新用例 | `pnpm --filter @deepseek-bot/host test` | 280 过 / 1 skip / 1 失败（`screen-distribution`，本机环境既有，未改动基线同样失败）。新增 2 例全过：① 四轮序列（普通→普通→primitive→普通）钉住"无 persona、无历史回放、无前文泄漏、无残留"；② primitive + skills 并存时技能块保留 |
| desktop 全量 | `pnpm --filter @deepseek-bot/desktop test` | 62 文件 / 555 用例全过（含新增 primitive-mode store 3 例与 i18n 未翻译串扫描） |
| 全仓 | `pnpm -r --no-bail run test` | harness-bridge 30、shared 6、contracts 149、agent-tools 134、storage 219、desktop 555、runtime 137、harness-adapter 65 全过；唯一失败 exec-daemon `windows.real` 为本机环境既有（基线同样失败） |
| 静态 | `pnpm lint`；`pnpm typecheck` | eslint 0 问题；10 包 tsc 全过 |

## 3. 未验证（明确列出，不声称通过）

- **真机 Electron 未跑**：composer 双开关的实际点击、chip 样式与两主题下的观感无截图；UI 行为由 store 单测 + i18n 扫描 + 类型（closed-union 键）背书。
- **真实模型未跑**（当前指示：不发起付费调用）：省 token 的实际幅度、原始人指令对回答质量的实际影响未实测；提示行为由 `echo-model` 假场景钉住（回应即最终提示）。
- exec-daemon `windows.real` 本机失败为环境既有。

## 4. 风险与回退

- 原始人回合丢 persona/历史可能改变回答语气与上下文连续性——这是开关本意，tooltip 已写明；关闭即恢复现状。
- 契约附加可选字段：非 strict 请求对象，旧发送方/旧 Host 互操作不受影响。
- 深度思考入口从顶栏移除属界面变化（单一入口原则，任务书 §2.3 已声明）；若负责人要保留顶栏双入口，恢复 `App.tsx` 一段 JSX 即可。
- 逐回合开关不写 bot 实体、不进 Host 存储——迁移到统一界面态持久化等拍板 #1。
- 回退：`git revert -m 1 <merge-sha>`；无迁移。

## 5. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
