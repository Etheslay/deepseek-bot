# D18 收尾：独立知识表、本地向量检索与保留策略

日期：2026-10-26（Asia/Shanghai）。负责人：Etheslay。分支：`feature/knowledge-base`。基线：`cc4a379`（origin/develop，含 PR #61）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 背景

D18 前两片（[记忆](D18-memory-report.md)、[知识导入](D18-knowledge-import-report.md)）交付了 bot 隔离的记忆读写删与 .txt/.md 导入，报告留了三项欠账：向量检索、独立知识表、保留策略。本片补齐，D18 至此按验收口径完成。

## 2. 交付行为

| 块 | 实现 |
| --- | --- |
| 独立知识表 | 迁移 `0010-knowledge-docs`：`knowledge_docs`（id/bot_id/title/text/created_at），bot 外键、bot 域隔离与记忆同规则。正文上限 100000 字（`TEXT_LIMITS.knowledgeText`），标题 200 字。受信桌面方法 `knowledge.list`（仅摘要，不回正文，1 MiB 消息上限安全）/ `knowledge.write` / `knowledge.delete` / `knowledge.search` |
| 导入改写知识库 | `.txt`/`.md` 上限从 16 KiB 提到 256 KiB（UTF-8、≤100000 字不变），导入从 `memory.write` 改为 `knowledge.write`，标题取文件名主干（隐藏文件名回退"未命名知识"）；主进程仍不向渲染层暴露路径 |
| 本地向量检索 | `knowledge.search` 与模型工具 `knowledge_search`：查询与文档按 480 字窗（100 字重叠）分窗，词袋 = CJK 双字（孤立字回退单字）+ 拉丁/数字词，IDF 取自该 bot 的窗口全集，余弦排序，窗口含完整查询短语加 0.2（总分封顶 1），score≤0 不返回。**纯本地、零依赖、不预存向量、不引嵌入模型、无运行期网络**——这是词法-语义混合排序，不是神经语义检索；设计边界为每 bot 数百条满幅文档（用 knowledgeMaxPerBot 约束），超出该规模的神经方案留待后续评估 |
| 保留策略 | 受信方法 `memory.retention.get/set`（单设置键 `memory.retention`）：`retentionDays`（记忆按天过期）/ `memoryMaxPerBot` / `knowledgeMaxPerBot`（按 bot 保最新 N 条）。0 = 不限制（默认）；**损坏值按 0 读——损坏的设置只会让清理变保守**。Host 启动清扫一次 + 每次记忆/知识写入后清扫；知识文档不按时钟过期（用户资产），只有数量上限 |
| 权限与路由 | `knowledge_search` 映射能力 `memory.read`（只读，默认策略沿用记忆读取），走 `/memory` 通道与 `memory_write`/`memory_search` 同路由；桥接插件目录名单从 2 个记忆工具扩到 3 个；八个应用工具目录不变 |
| 桌面 | 记忆面板三区：记忆（原行为不变）、知识库（导入/搜索/删除/文档列表）、保留策略（三个数字输入 + 保存）；全部文本按文本渲染，无 HTML 注入面 |

## 3. 实际检查

环境：Windows 11 x64、Node v24.16.0、pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0 |
| `pnpm test` | 退出 0：shared 6、harness-bridge 16、contracts 88、agent-tools 75、storage 159、desktop 226、runtime 128、harness-adapter 58、host 88 通过，另有 1 项跳过（既有付费 API 冒烟） |
| `git diff --check` | 退出 0 |

新增用例覆盖：知识读写删与 bot 隔离、分词/分窗/排序纯函数、短语加分、检索隔离、保留策略损坏值回退、过期清扫与按 bot 截断（可注入时钟）、面板导入/搜索/保留策略往返、桥接目录三工具名单、`/memory` 路由放行与目录。

## 4. 未验证

- 未用真实 Electron 点击新面板三区；桌面测试使用 jsdom。
- 真实 Harness 未让模型调用 `knowledge_search`（路由与权限路径有单测，真实链路未跑）。
- 检索质量只验证了排序与隔离的确定性用例，未做真实语料的人工相关性评估。
- 未执行付费 API、远程 CI、安装包、签名或 GitHub 保护规则复核。
- 神经语义检索（本地嵌入模型）未评估——当前方案不承诺同义改写匹配。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
