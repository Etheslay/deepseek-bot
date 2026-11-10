# 机器人工作区（D05）

`apps/desktop` 的机器人工作区把 D02 的占位壳升级为可用前端：机器人管理、聊天（流式/工具/取消/失败）、会话历史回放、产物面板与设置接入。**所有数据来自 `@deepseek-bot/contracts` 的可执行 schema 校验；真实 Harness / API / 持久化分别属于 D06 / D12 / D04，本任务全部为夹具驱动占位，不冒充真实结果。**（上句为 D05 交付时口径；其后聊天运行时、历史与设置持久化已接真实 Host——PR #97/#103 起聊天/历史走 `host-service.ts`，夹具实现仅存于离线演示模式，详见文末速查注。）**

## 服务层（可替换）

```text
src/renderer/src/services/
  desktop-service.ts     接口：bots / settings / chat / artifacts（含 UI-only ChatSessionView）
  host-service.ts        真实实现：经 IPC 调 Host（PR #97/#103 起为默认通道）
  fixture-service.ts     离线演示实现：读 packages/contracts/fixtures，内存态
  stored-session.ts      每 bot 单会话视图（基于 chat.history）
  contract-validation.ts 统一 schema 校验
  service-context.tsx    React Context 注入
```

- 组件通过 `useService()` 拿服务；IPC/Host 实现已落地（`host-service.ts`），切换仍只动 services 目录。
- 服务层所有出参先经 contracts schema 校验再返回；非法数据抛 `ServiceError`（稳定错误码）。
- 夹具种子：3 个 Bot（含 1 个已归档）、2 个会话（success-run / cancel-run 事件回放）、2 个产物（markdown 可预览 / html 拦截）——仅离线演示模式使用。

## 机器人管理（FR-02 前端）

- 创建/编辑表单（`features/bots/bot-form.tsx`）：名称、instructions、modelProfileId、workspaceId、toolPolicyId——`BotSchema` 校验，错误定位到字段。
- 复制：新 id/revision + 名称“副本”，不复制会话（服务层强制）。
- 归档：**Owner 决定移除归档 UI**（D05 UI 调整）；服务层 archive 能力保留但界面不提供入口，种子不含归档 Bot。
- revision 冲突：`REVISION_CONFLICT` 提示并自动刷新列表。
- 分组/置顶/未读等仍是会话内 UI 状态（CONTRACTS v0.1 无 Bot.group，不进契约）。

## 聊天（FR-03 前端，夹具驱动）

- 流式：`features/chat/chat-reducer.ts` 纯 reducer（增量追加 / 工具状态卡 / 取消冻结 / 失败终态），发送走 `service.chat.stream`。
- 工具状态卡：工具名 + 状态（请求中/执行中/已完成/失败）+ 摘要。
- 取消：流式中显示取消按钮；取消后状态 `cancelled`，不再追加增量。
- 失败：稳定错误码 + 可读文案（`failureMessage`），`retryable` 的提供重试。
- Bot 间交流（Grok 风格，UI 占位）：主时间线仅显示居中通知行（已发消息给/消息来自 + 小头像），完整对话存 pairTranscripts，点开在右侧内容区显示配对聊天视图（侧边栏保留）。

## 会话历史与产物（FR-07/QA-14 前端）

- `features/chat/session-history.tsx`：会话列表（标题/状态/事件数）→ 回放持久事件（时间标签 + 事件中文标签）。
- 产物列表：relativePath / mediaType / size / sha256 摘要；预览仅文本类（D28 起读真实工作区文件），HTML 一律拦截并提示 QA-14，不执行任何脚本。

## 产物共编与版本（D28）

- **产物即工作区文件**：`artifacts.list/read/save/versions/versionContent/revert` 操作的是 bot 工作区（`workspaces.canonical_path`）里的真实文件，按 `(botId, relativePath)` 寻址；隐藏项（`.` 前缀）与符号链接不列出、不跟随。
- **共编闭环**：用户在画布侧车（`features/canvas/canvas-sidecar.tsx`）保存 → Host 原子写回工作区文件 → bot 下一轮经自身文件工具读到用户版本再续写；bot 直接写盘的内容由下次 list/read/versions 补记为 `author=bot` 版本。侧车 5 秒轮询：干净时静默刷新，有未保存修改时显示"已被修改"横幅而不覆盖用户草稿。
- **版本链**：迁移 `0011-artifact-versions` 只追加；快照内容存数据根 `artifacts/coedit-versions/<botId>/<versionId>.bin`（含产物备份即含版本快照），元数据含 author/size/sha256；每文件保留最近 50 版，超出剪除最旧（行+文件）。回退 = 以历史内容生成新版本，不改写历史。
- **安全边界**：路径经 `RelativeArtifactPathSchema` + realpath 夹紧，写不越工作区；内联读/写上限 768 KiB（超限显式拒绝，文件仍可列与回看版本）；text/html 与二进制不进编辑器、不内联渲染（QA-14）；Markdown 预览走 D14 本地安全渲染链。
- **并发**：save 携带编辑基准 `expectedChecksum`，文件已被 bot 改动时返回 `REVISION_CONFLICT`，UI 提示重新加载而非静默覆盖。

## 附件（D26）

两条路径都在。聊天发送走理解闭环；网关导入仍是独立的 `chat.attach` 入口。

- **理解闭环**：＋ 菜单/拖拽选中的非空文件（≤ 20 MiB）在发送前经 `attachment.begin/append/commit` 进入当前 bot 工作区 `attachments/`。重名加后缀，不覆盖。暂存与失败清理见 [CONTRACTS](CONTRACTS.md) attachment 行。上传失败中止发送并保留草稿。文件不进数据库，产物面板与画布把它当普通工作区文件列出。
- **bot 如何看到闭环附件**：消息同时带工作区路径。文本 ≤ 16 KiB 以内联围栏注入（fence 安全、4000 字截断，并受 `chat.send` 的 4000 字上限裁剪）；更大的文本不内联，并提示 `read_workspace_file`。PDF、Word（`.docx`）和 PPT（`.pptx`）由 Host 抽出正文再注入；用户没另写文字时，回复先是「收到文件，我先打开看看内容。」再转述总结。整篇覆盖走 `write_document`。新建、读取、追加、替换、删除文字、删除文件，以及 docx 与 pdf 互转，走 `edit_document`。转成 PDF 会在工作区写出那个 PDF，源文件还在。用户要求做 Word 时，等待文案是「制作文档」；要求转成 PDF 时是「转换成 PDF」。图片与二进制只给路径和说明。能放下时另附一句，让模型用 `read` 读取同一路径。文件卡片显示文件名和大小，点击打开产物侧车。图片缩略图留在卡片上。
- **工具网关**：`service.chat.importAttachment` 仍分块调用 `chat.attach`。真实 Host 在 `fs.write` 为 ask 时等待审批，通过后才写入工作区 `attachments/`。夹具服务写入内存工作区，不模拟审批。审批预览不含正文。模型工具 `read`（能力 `fs.read`）读取该路径：文本可截断，图片和其它二进制只返回类型与体积。
- **安全边界**：模型不选择上传路径。`read_workspace_file` 夹紧在工作区内，拒绝 `../`、隐藏项、目录、二进制和超过 768 KiB 的文件，不截断。默认 bot 共用一个工作区目录，读授权通过后可以看到该目录里的附件。

## 设置（FR-01 前端）

- API Key **只写不读**：password 输入、保存后占位符仅显示“已配置（输入新值覆盖）”，明文永不回显；真实加密存储由 D04/D08 接线。
- 测试连接三态：夹具默认如实返回 `UNVERIFIED`（RUNTIME_UNAVAILABLE），不冒充成功。

## 命令与测试

- 命令不变：`pnpm --filter @deepseek-bot/desktop dev / build / test / pack:dir`（见 [开发环境基线](DEVELOPMENT_SETUP.md)）。
- 测试规模自 D05 起已随各切片大幅增长，以 [TESTING](TESTING.md) 与仓库当前用例为准（本文件不再维护用例计数）。

## 契约边界速查（D05 历史口径，不再维护）

下表保留 D05 交付时点口径。其后已落地并推翻其中「不能声称」列的有：聊天真实链路与历史持久化（D30，PR #97/#103）、设置持久化与保险库（D24，PR #78/#119；真实 Key 全链验收归 [GAP_AUDIT](GAP_AUDIT.md) G4）、分组契约与批量创建（v0.2）、夹具仅存离线演示模式。当前能力与缺口以 [GAP_AUDIT](GAP_AUDIT.md) 与 [SPRINTS §4](SPRINTS.md) 为准。

| 能做（D05 当时） | 当时不能声称（现已大部落地） |
| --- | --- |
| 夹具驱动的流式/工具/取消/失败 UI | 真实 Harness 流式/取消（D06/D12） |
| Key 表单 + 只写不读 + UNVERIFIED | Key 已安全保存 / 连接成功（D04/D08） |
| 归档禁新聊、复制、字段校验 | 重启保留（持久化 D04 未接线） |
| 分组/表情/引用 UI 会话态 | 契约实体 / 持久化已实现 |
