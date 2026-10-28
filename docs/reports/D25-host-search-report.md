# D25 host 检索：`search.global` 受信全局搜索

日期：2026-10-28（Asia/Shanghai）。负责人：Etheslay。分支：`feature/d25-host-search-5f3a`。基线：`2dbf850`（origin/develop，含 PR #114–#116）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论；自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文代填的自审。

## 1. 交付行为

[D25 报告](D25-report.md)的"渲染层索引先行，host 检索后接"后半部分，纯 Host 侧切片（渲染层接线归桌面，不在本片）：

| 块 | 实现 |
| --- | --- |
| 契约 | 受信桌面方法 `search.global`：`{query: string≤200, limit?: 1–50（默认 20）}` → `{results: {kind, id, botId, title, snippet, at}[]≤200}`，按时间倒序。**不提升协议版本**（沿用 D26 在 0.x 内加受信方法的先例），方法总数 112 → 113 |
| 检索范围 | 四个渲染层索引看不到的本地语料：bot 名（含已归档）、工作流名、跨 bot 持久聊天消息（`chat_messages`，join bots 取展示名）、产物路径（`artifact_versions` 每文件只取最新版）。`chat.send` 的 `skills` 字段（D17）不参与检索 |
| 匹配语义 | 字面子串：LIKE 通配符 `%` `_` `\` 全部转义并以绑定参数传入，查询文本永远不改变 SQL 形状；每条查询都带硬 LIMIT，无无界扫描 |
| 摘要 | 消息命中只回有界摘要（≤400 字符，折叠空白、围绕首个匹配、省略号标注）；产物命中不含文件系统路径与内容；命中打开走既有逐 bot 方法（`chat.history` / `artifacts.read` 等），检索本身不授权 |
| 边界 | 仅受信桌面调用：不是能力、没有授权面、不进模型工具注册表；返回不含 grant/审批/审计记录 |

## 2. 实际检查

环境：Windows 11 x64、Node v24.20.0、pnpm 11.28.5。测试需设 `APPDATA`（本执行沙箱默认为空；用户常规环境不受影响）。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | 见 §4 最终记录（提交后全量复跑） |
| storage `vitest run src/repos/global-search.test.ts` | 6 通过：bot 名含归档、跨 bot 消息 join bot 名、LIKE 通配符字面量、产物每文件最新版、工作流 limit |
| contracts `vitest run src/search-global.test.ts src/methods.test.ts` | 28 通过：请求边界与默认值、严格命中形状（拒绝 path 等多余键）、方法总数 113 |
| host `vitest run src/global-search.test.ts` | 4 通过：四语料齐中、摘要省略号与 400 上限、通配符字面量、limit 截断、模型目录无 search 工具 |

## 3. 设计取舍

- **不升协议版本**：D26 附件与 D17 技能注入都在 0.x 内附加受信方法/字段；本片同先例，方法白名单新增一项即可。
- **不检索知识库/记忆**：`knowledge.search` 已是逐 bot 的模型工具，全局检索再暴露会重复且扩大面；本片只做渲染层索引缺失的四类语料。
- **消息摘要而非全文**：全文已经在 `chat.history` 可得，摘要足以支撑"找到并跳转"，避免把大段历史塞进一次响应。

## 4. 最终检查记录

（提交后全量复跑，结果见 PR 验证证据表。）

## 5. Etheslay 本人自审

- 已审提交 SHA / 日期：
- 差异、需求和错误路径检查结果：
- 测试证据 / 兼容性与权限影响：
- 遗留问题与处理方式：
- 自审结论：

新增提交后更新本节；自审留给 Etheslay 本人填写，此处不代填。
