# B4' PDF / Office 附件解析注入（附件闭环最后一块）

> 分支 `feat/pdf-office-attachment-parse`，基于最新 `origin/develop`（c7288e1）。
> 硬约束遵守：不改协议（无新方法、无请求/响应字段变更）、不改 chat.send 语义、
> 覆盖率门槛未动、testTimeout 未动。PR 自审栏留空待负责人签署。

## 第一步：定位结果（实现前核实）

1. **`attachment.commit` 之后文件元数据存哪**：不落数据库。`attachments.ts`
   的 `commit()` 把 staging 文件改名进工作区 `attachments/<name>`（同名加
   `-N` 后缀去重），sha256 在内存里与 begin 声明比对后只存在于**返回值**
   `{botId, path, size, checksum}`；持久体只有工作区文件本身。
2. **模型提示里的附件块由谁拼**：渲染层 `attachments.ts`——
   `buildAttachmentContext` 拼路径指针块（`【附件 name · size · path】` +
   read 工具指示），`composeAttachmentBlocks` 按 kind 分支：text ≤16KB 内联
   / 超限指向 read 工具；image 一句话说明；binary 仅元数据。拼接发生在
   `sendWithAttachments` → `composeAttachmentPrompt`，随 payload.text 进
   chat.send。**Host 侧此前零解析**（`git grep pdf|docx -- packages/host/src
   packages/agent-tools/src` → 0 命中）。
3. **现有上限与应用点**：`MAX_TEXT_INLINE_BYTES = 16KiB`（小文本内联阈值，
   `attachments.ts:45`）、`MAX_TEXT_CONTEXT_CHARS = 4000`（内联正文再截）、
   `MAX_CHAT_ATTACHMENT_BYTES = 2MiB`（上传/解析输入上限）、
   `readWorkspaceFileText`（read 工具：拒绝二进制，故 PDF/docx 原件读不出
   正文——这就是"只存储"的现状）。

## 与既有 `feature/b4-binary-parsing` 分支的关系（重要）

此前在未合并栈上交付过同域功能（`chat.send.documents` 字段，协议 v0.15）。
本任务按"不改协议"重做：**协议零变更**，改为 commit 时解析落库 +
chat.send 组装时按提示文本中已命名的路径注入。若负责人更愿意直接合并带
协议变更的 b4 分支，本分支可废弃。

## 设计

- **迁移 0025-attachment-parses**：`PRIMARY KEY (bot_id, path)`，字段
  `media_type / source_checksum / status('ok'|'parse_failed') / text /
  truncated / original_chars / pages / paragraphs / error_reason / parsed_at`。
  `source_checksum` 把缓存钉在精确字节上；`parse_failed` + 原因是一等结果
  （"能解释为什么读不到"），不是异常。
- **解析时机**：`attachment.commit` 成功后**后台预热**（fire-and-forget，
  不阻塞/不影响上传返回）；chat.send 组装时读缓存，无行则现场解析并落库
  （缓存丢失自愈）。解析引擎永不 throw——一切失败落 `parse_failed` 行。
- **注入**：chat.send 组装时从提示文本提取渲染层已命名的
  `attachments/*.pdf|docx` 路径（确定性格式，≤4 份/回合），每份追加
  `【附件正文 name】` 块：≤16KiB 直接围栏内联；超限内联前 16KiB +
  `（附件正文已截断：原始 N 字符；完整内容可用 read_workspace_file 读取
  <path>）`；`parse_failed` → `无法提取正文：<原因>`。注入文本随
  payload.text 同写入 `chat_messages`（落库 = 模型实收，与 D26 指针一致）。
- **安全边界**：输入 ≤2MiB（上传上限，解析前复查）；docx 只按中心目录取
  `word/document.xml` 单条目、解压前按声明尺寸拒绝 >16MiB（zip bomb）、
  不写盘；PDF 页数上限 200（超出取前 200 页并标 truncated）；**解析超时
  10s**——页循环逐页检查中止信号，超时销毁 pdf.js 文档，Host 不会被单次
  附件卡死；路径经 symlink-safe 工作区围栏解析。
- **依赖**：`unpdf@2.0.0`（0 运行时依赖，磁盘 2.07MB，MIT）+ `fflate@0.8.3`
  （磁盘 ~0.1MB，MIT，dsh 自身已传递引用同包另一版本）。`pnpm why` 输出见
  PR 正文。**bundle 实测：2.6MB → 4.9MB（+2.3MB）**，占 ≤200MB 安装包预算
  ~1.2%，低于"单包 >5MB 或总量 >10MB 需停"门槛。

## 已知边界（如实）

- 截断标记提示 read_workspace_file 可读完整内容：原件是二进制，read 工具
  按现有策略会拒绝——超限部分实际不可经 read 获取。保持任务给定文案；如需
  诚实改写或落盘 `<path>.extracted.txt`，等确认。
- xlsx 未做（任务标注可选）。
- 真实扫描件、加密 PDF 未用真实文件测试（单测覆盖"无文本层"与"损坏"路径）。
- 迁移号 0025 与未合并栈 `feature/g12-multi-session` 的 0024-chat-sessions
  存在编号语境差异（develop 最新为 0024-event-rule-keys），先合本分支则无冲突。
