# G4 付费真实 Key 全链验收

日期：2026-10-29（UTC）。负责人：Etheslay。分支：`feature/g4-paid-chain-7a29`，目标 `develop`。对应 [GAP_AUDIT](../GAP_AUDIT.md) G4。本文只记录这次实际调用；未运行的路径不记为通过。AI 辅助取证不等于负责人自审，文末自审栏留空。

## 1. 范围与环境

临时 Key 只作为进程环境变量 `DEEPSEEK_API_KEY` 注入需要它的命令，跑完即 `unset`。Key 未写入仓库、未写入本报告、未写入 `.env`。数据根在临时目录，进程结束时删除。

| 项 | 实际值 |
| --- | --- |
| 执行代码 | `20d2d8756d3e068dd381dd322ffd4b1811b31a96`（当时的本地 `develop`） |
| 报告所在基线 | `54af7e68118c640dcbd917a66c33e59388f20e10`（随后的 `origin/develop`，含 #156/#157/#158） |
| 两提交之间的 Host 差 | `handlers.ts` 只给已回答的选择题补 `meta.kind = "choice"`。本次没有调用这条回答路径。聊天、工作流、审批、记忆、知识、附件、`web_search`、`voice.status` 的实现没有变化 |
| OS | Linux。任务允许 Linux |
| Node / pnpm | Node v24.22.2、pnpm 11.28.5。镜像自带 Node 是 v22.23.4，低于仓库 `engines` 的 `>=24`，所以这次用了 v24 |
| 依赖 | `pnpm install --frozen-lockfile`。另外本地执行了 `pnpm --filter @deepseek-bot/harness-bridge build`，否则 Host 没有桥包 `dist` 可装。构建产物在 gitignore 中，未提交 |
| 入口 | 临时 Host 探针：`createHost` + `handleMethod` / `agentTools.call`。探针文件未入库 |
| 未跑 | 全仓 `pnpm lint` / `typecheck` / `test`，GitHub Actions（分钟额度已用尽） |

模型档案用的是 Host 启动时种下的两行：`deepseek-chat`（`44444444-4444-4444-8444-444444444444`）和 `deepseek-reasoner`（`8d5a5e30-0000-4000-8000-000000000005`）。输出上限分别设为 64 和 1024。提示都是最短回复（`pong` / `7`），并写明不要使用工具。

完成了两轮付费探针。第一轮（09:12:11Z–09:12:23Z）的耗时字段在成功路径上被记成 0，原因是计时写在 `await` 之前，该轮耗时作废。该轮的回复和 `usage_events` 仍然是真实调用，用量另列。第二轮（09:13:41Z–09:13:52Z）修正计时后作为延迟证据。在这两轮之前有一次探针卡在未决的 `web_search` 审批上，vitest 600 秒超时杀掉；当时 `chat_messages` 与 `usage_events` 都是 0 行，没有模型调用。

## 2. 逐项结果

状态只表示这一次有没有跑通该 Host 路径。

| 路径 | 状态 | 延迟 | 观察到的结果 |
| --- | --- | --- | --- |
| `voice.status` | 已运行 | 0 ms | `transcribe.available=false`，原因是 whisper.cpp 二进制未配置。`speak.available=false`，原因是 Windows SAPI 只在 Windows 上可用 |
| `voice.transcribe` | 未运行 | — | 没有配置 whisper，也没有提交麦克风录音 |
| `voice.speak` | 未运行 | — | 实现依赖 Windows SAPI。本机是 Linux |
| 桌面按住说话 | 未运行 | — | #157 在探针之后合入，需要麦克风和桌面界面。本次只查了 Host 的 `voice.status` |
| `memory.write` + `memory.list` | 通过 | 2 ms | 写入 `g4-memory-marker` 后按原文命中 1 条 |
| `knowledge.write` + `knowledge.search` | 通过 | 2 ms | 文档 55 字节；检索命中，最高分 0.8963106238227914 |
| `chat.attach` | 通过 | 11 ms | 出现 `import_attachment` 审批卡（`fs.write`），`permission.approval.decide` 一次批准（3 ms）。结果 `imported`，声明大小 5，工作区文件 5 字节 |
| `web_search` 未配置端点 | 失败（预期的关闭路径） | 4 ms | 默认 `network.search` 为 ask，先出审批卡。一次批准后工具返回 `RUNTIME_UNAVAILABLE`：`SearXNG endpoint is not configured`。没有出站 |
| `web_search` 已配置端点 | 失败 | 5023 ms | `search.config.set` 设为 `https://searx.tiekoetter.com/search`，并把 `network.search` 设为 allow。没有第二张卡。返回 `RATE_LIMITED`：`web_search provider rate limit reached`。没有结果。5023 ms 含最多 5 秒等待审批卡（卡未出现） |
| 工作流审批节点 | 通过 | 16 ms | `run.start` 后状态 `waiting_approval`，`approval.decide` 批准，运行 `succeeded`，节点 `gate` 为 `succeeded`。这条路径没有模型调用 |
| `chat.send`（chat 档案） | 通过 | 2318 ms | 回复 `pong`（4 字符）。会话 id 非空 |
| `chat.send`（reasoner 档案） | 通过 | 2334 ms | 回复 `7`（1 字符） |
| `run.start` 单机器人节点 | 通过 | 1759 ms | 运行 `succeeded`，节点 `n1` `succeeded`，有 Harness session，输出摘录 `pong` |
| 聊天回合内的原生工具审批 | 未运行 | — | G3 留下的端到端（弹卡、拒绝无副作用、超时或取消终止回合）需要模型在回合里发出受闸门约束的原生工具调用。本次提示明确不使用工具，`chat.send` 和工作流节点都没有观察到这类卡 |

`web_search` 没有可用的本机 SearXNG，也没有另起搜索服务。公网实例返回 429 后即停止，没有换实例重试。

## 3. 用量

`usage.summary` 的 `estimated` 两轮都是 `false`，`source` 都是 `harness`。`usage_events.model` 两轮都是空，汇总里的模型名是 `unknown`。Harness home 里能扫到的 `deepseek-*` 字符串只有包名片段 `deepseek-ai` 和 `deepseek-bot`，没有 `deepseek-chat` 或 `deepseek-reasoner`。

因此：**请求侧档案是 chat 与 reasoner 各一轮，回复也符合提示；账单侧模型名没有核对上。** 没有打开服务商账单页面。

工作流机器人节点不写 `usage_events`。下面两轮各有一次工作流模型调用（回复都是 `pong`），token 不在表内。服务商侧用量会高于下表。

### 3.1 计时有效的一轮（09:13:41Z）

| 机器人 | 档案（请求侧） | input | output | cached | 时间 (UTC) |
| --- | --- | --- | --- | --- | --- |
| g4-chat | deepseek-chat | 223 | 3 | 0 | 09:13:48.730Z |
| g4-reasoner | deepseek-reasoner | 223 | 2 | 0 | 09:13:51.078Z |
| 合计 | 汇总模型名 `unknown` | 446 | 5 | 0 | 2 回合 |

### 3.2 计时作废、用量仍有效的一轮（09:12:11Z）

同一提示、同一回复（`pong` / `7`）。input 与上一轮不一致；没有原始事件可以解释差额，这里只记 Host 落库的数。

| 机器人 | input | output | cached | 时间 (UTC) |
| --- | --- | --- | --- | --- |
| g4-chat | 11869 | 3 | 0 | 09:12:18.705Z |
| g4-reasoner | 11869 | 2 | 0 | 09:12:21.236Z |
| 合计 | 23738 | 5 | 0 | 2 回合 |

两轮 Host 已记账合计：input 24184，output 10，cached 0，4 个 `chat.send` 回合。另有 2 个工作流模型回合未记账。output 在两轮中稳定（chat 3、reasoner 2）；input 不稳定（11869 与 223）。

## 4. 未验证

- 账单或控制台里的模型名是否为 `deepseek-chat` / `deepseek-reasoner`。
- `web_search` 返回真实结果。这次只证明了未配置时的关闭，以及配置公网 SearXNG 后的 `RATE_LIMITED`。
- 语音转写、朗读、按住说话、麦克风。
- 原生 Harness 工具在真实回合里的审批卡、拒绝无副作用、超时或取消。
- Windows、GPU、键鼠、屏幕。本次不需要它们，也没有跑。
- 工作流回合的 token。Host 没有把它们写入 `usage_events`。
- GitHub Actions 与全仓 lint / typecheck / test。
- 钉扎 Harness 启动时是否还打印 `entry did not activate`。聊天和工作流都返回了回复，但没有保存 stderr。

## 5. Etheslay 本人自审

- 已审提交 SHA / 日期：
- 差异、需求和错误路径检查结果：
- 测试证据 / 兼容性与权限影响：
- 遗留问题与处理方式：
- 自审结论：

新增提交后更新本节；自审留给 Etheslay 本人填写，此处不代填。
