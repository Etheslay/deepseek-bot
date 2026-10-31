# G12 多会话（每 bot 多条）—— PR 语义决定先行

> 本文件是 PR 描述的语义依据（B1 硬性要求：先写清 4 个语义决定再动代码）。
> 分支 `feature/g12-multi-session`；本文件是分支第一个提交。

## 背景

- Host 契约只有 `chat.send` / `chat.history` / `chat.cancel` / `chat.status` / `chat.contextUsage`，没有会话列表；渲染层自行拼出 `chat:<botId>`（`stored-session.ts`），一个 bot 只有一条线程。
- 存储层 `chat_messages.session_id` 列**已存在**（迁移 0005），历史值恒为 `chat:<botId>`；`chat_summaries`（迁移 0023）主键已是 `(bot_id, session_id)`。缺的不是列，而是：会话元数据、会话列表/管理方法、以及 send/history/摘要按会话区分。

## 四个语义决定（PR 必须原文包含）

### 1. 会话粒度：每 bot 多条

一个 bot 拥有多条会话；会话不属于全局。跨 bot 的" pair view"（bot 间往来记录）与本特性无关，不改动。同一 bot 同时仍只有一个运行中的回合（`ChatManager` 按 botId 加锁），因此会话切换不产生并发回合。

### 2. 摘要归属：跟随会话

`chat_summaries` 的粒度从"bot + 水位"收窄为"(bot_id, session_id) + 水位"——表结构无需变化（主键已含 session_id），变化的是读写路径全部携带会话 id：`chat.send` 的历史回放、`maybeCompressChat` 压缩、`chat.contextUsage` 计量均按会话进行。删除某条会话的摘要只影响该会话的回放。

### 3. sessionId 缺省语义：缺省即默认会话，行为与现在完全一致

`chat.send` / `chat.history` / `chat.contextUsage` 新增**可选** `sessionId`。缺省时解析为该 bot 的默认会话，其 id 就是沿用至今的 `chat:<botId>`。因此旧调用方（0.1–0.11 发送方、task 派发、自动化通知、question 卡）不传该字段时，读写的仍是与今天完全同一条线程——回放内容、摘要、计量、返回值语义（`chat.send` 响应里的 `sessionId` 仍是 harness 回合 id）全部不变。显式传入的 `sessionId` 必须已存在、属于该 bot 且未归档，否则 `INVALID_INPUT`。

### 4. 旧数据归入：默认会话，零行改写

`chat_messages.session_id` 是 NOT NULL 且历史值恒为 `chat:<botId>`——即默认会话 id 本身。迁移 0024 **只新增 `chat_sessions` 元数据表与索引，不改写任何数据行、不修改任何历史迁移**；旧行天然属于默认会话。默认会话的元数据行由 Host 在 `chat.session.list` 与缺省 `chat.send` 时惰性物化（get-or-create）。会话显示标题在读取时派生：用户重命名的存储标题优先，否则取首条用户消息一行，无线索时按 Host 语言取「新的会话 / New session」；新建会话可带标题，不带则以派生标题展示。

## 契约（v0.12，纯增量）

- 新增方法组（`METHODS` + `METHOD_CONTRACTS`）：
  - `chat.session.list` `{ botId }` → `{ sessions: ChatSession[] }`（`last_message_at` 倒序）。
  - `chat.session.create` `{ botId, title? }` → `{ session }`（新 id 前缀 `cs:`，避免与 harness 回合 id `chat:<botId>:<uuid>` 混淆）。
  - `chat.session.rename` `{ botId, sessionId, title }` → `{ session }`（归档会话不可改名）。
  - `chat.session.archive` `{ botId, sessionId }` → `{ session }`（默认会话不可归档；归档即只读，无取消归档）。
  - `ChatSession = { sessionId, botId, title, archived, messageCount, createdAt, lastMessageAt }`。
- `chat.send` / `chat.history` / `chat.contextUsage` 请求新增可选 `sessionId`（≤128 字符），缺省语义见决定 3。
- 协议版本 0.11 → 0.12：纯增量，0.1–0.11 发送方保持接受。

## 迁移 0024（只加表和索引）

```sql
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  title TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL
);
CREATE INDEX chat_sessions_bot_recent ON chat_sessions(bot_id, last_message_at);
CREATE INDEX chat_messages_bot_session ON chat_messages(bot_id, session_id, created_at);
```

## Host

- 新存储仓库 `repos/chat-sessions.ts`：create / get / list / rename / archive / touch / ensureDefault（默认会话 id = `chat:<botId>`）。
- `listChatMessages` 增加可选 `sessionId` 过滤参数（不传保持 bot 级全量，既有调用方不变）。
- `chat.send` / `chat.history` / `chat.contextUsage` / `maybeCompressChat` / `contextMeterState` 全部携带会话 id；task 派发回放显式固定默认会话（派发标记本就写入默认会话）。
- 授权 "session" 作用域（`permission.grant`）仍绑定 `chat:<botId>`，不随聊天会话扩展——授权语义不属于本特性。

## 渲染层

- `DesktopService.chat` 新增 `createSession` / `renameSession` / `archiveSession`；`history` 与 `stream` 选项透传 `sessionId`；`listSessions` 改读 `chat.session.list`。
- 侧栏：当前选中 bot 行下方内嵌会话子列表（复用 `.session-item` 样式体系）+「新建会话」；点击切换当前线程，双击重命名（复用行内重命名机制），右键弹出会话菜单（重命名/归档，复用 `.menu` 样式）；归档会话点击进入既有只读回放视图。
- 会话线程按 `(botKey, sessionId)` 记忆在内存；发送的回合归属发送时所在会话，若用户已切走，回复写入原会话的缓存而非当前可见线程。
- 顶部「最近会话」弹层读同一份真实会话列表；未归档项点击即切换会话。

## 明确不做

- 不重写 chat 存储层（repo 函数签名仅追加可选参数）。
- 不改 `chat.cancel` 语义（仍按 bot 取消当前回合）。
- 不做会话删除、跨 bot 会话、会话内分页。
- 不改任何历史迁移。

## 测试

- storage：`chat-sessions` 仓库用例 + 迁移 0024 应用。
- host：缺省发送落默认会话并物化元数据；显式会话隔离（回放/历史互不可见）；未知/他人/归档会话拒绝；rename/archive 语义；`chat.session.list` 排序。
- renderer：host-service 会话方法映射、stream/history 携带 sessionId、会话切换纯函数。
- 回归：既有 chat/context-meter/task-dispatcher/automation 用例全部通过。
