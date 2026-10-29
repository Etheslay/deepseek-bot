# 合并前独立审查：三条在途切片（2026-10-29）

| 项 | 值 |
| --- | --- |
| 性质 | AI 独立只读审查（经负责人授权），不代替归属人自审，不改变分支，不代开 PR，不合并 |
| 对象 | `feature/context-meter`（头 `7caf386`，基线 3e21112）、`feature/d14-mermaid`（头 `3e325c8`，基线 3e21112）、`feature/d17-skill-host-store`（头 `348891f`，基线 92303eb） |
| 方式 | 每片在 `.worktrees/review-*` 建只读 detached worktree（`pnpm install --frozen-lockfile`，d14 按其锁文件在线补拉 mermaid），读任务书/报告/关键 diff，独立复跑受影响包测试与全仓 lint/typecheck |
| 环境 | Windows 11 x64 · Node v24 · pnpm 11.28.5 · develop = `5740049`（PR #142 后） |
| 结论 | 三片实现与各自任务书一致，质量整体良好；**2 条需归属人处理前合并的发现**（cm 文档并发断言失实 P2、d14 主题切换偏差 P3）+ 若干备忘；测试断言全部通过 |

## 1. 独立复跑证据（本机实测，非转抄报告）

| 包 | context-meter | d14-mermaid | d17-skill-host-store |
| --- | --- | --- | --- |
| contracts | 149/149 ✓ | 149/149 ✓ | 149/149 ✓ |
| storage | 224/224 ✓ | 未触及 | 未触及 |
| host | 全过（`task-dispatch` 1 例首跑失败 = 既有抖动家族成员，隔离复跑 18/18 ✓） | 未触及 | 全过（`mcp-chat` 1 例首跑失败 = 同族既有抖动，隔离复跑 9/9 ✓） |
| desktop | 66 文件 / 587 用例全过 ✓ | 67 文件 / 595 用例全过 ✓ | 63 文件 / 575 用例全过 ✓ |
| typecheck（10 包） | 退出 0 | 退出 0 | 退出 0 |
| lint | 退出 0 | 退出 0 | 退出 0 |

环境说明：多次出现「断言全过但进程退出码 -1」的间歇现象（同一套件复跑退出 0），与本机已登记的 worker teardown 抖动家族（`ERR_IPC_CHANNEL_CLOSED` / harness 15s 超时）同源；三次首跑失败（task-dispatch、mcp-chat）隔离复跑均绿。无任何断言失败。

## 2. 发现项（供归属人自审处理）

### 2.1 context-meter —— P2：并发语义的文档断言与实现不符

- **事实**：`packages/host/src/chat.ts` 的 `send()` 以 `session.busy` 实现每 bot 忙锁（busy 时 `RATE_LIMITED`，chat.ts:169–184）；新增的 `compressTurn`（chat.ts:343 起）**不读取也不设置** `session.busy`，`maybeCompressChat` 仅以 `compressingChats` Set 防压缩重入。
- **后果**：后台摘要回合与用户下一条消息是**真并发**（两个并行 Harness 会话、同一 bot profile），而任务书 §5 与报告 §1 均写「压缩回合占用期间新 sends 会排队（RATE_LIMITED 既有语义）」——该断言不成立。
- **影响评估**：功能正确性未破坏（摘要 upsert 覆盖式、水位取自压缩前快照、`compressingChats` 防重入）；实际风险是并发回合的 provider 限流/用量行交错，以及 `chat.contextUsage` 在两者间取最近一行的口径抖动。
- **建议（二选一，归属人定）**：① `compressTurn` 复用发送忙锁/队列，兑现文档语义；② 修订任务书与报告为「压缩与发送并发（各自独立会话）」，并如实说明限流风险。

### 2.2 d14-mermaid —— P3：主题切换后新图仍用旧主题（任务书验收偏差）

- **事实**：`mermaid.initialize` 只在首次懒加载时执行一次（`loadMermaid` 以 `modulePromise` 缓存，mermaid.ts:33–45）；`setMermaidTheme`（App.tsx:480 调用）只更新模块变量，该变量仅参与渲染缓存键。
- **后果**：深→浅切换后**新渲染**的图仍用旧主题配色，与任务书验收「渲染时刻的主题决定配色（已挂载的图不重绘）」的前半句不符；后半句（已挂载图不重绘）成立。
- **建议（二选一）**：① `setMermaidTheme` 里补一次 `mermaid.initialize({ theme })`（mermaid 支持重复 initialize，已缓存模块下开销极小）；② 修订任务书/报告，把「新图随主题」从验收中移除。

### 2.3 d17-skill-host-store —— P3 备忘（不阻塞）

- `App.tsx` 新增两处直接 `window.deepseekBot.host.call(...)`（行 497/513），绕过 `host-service.ts` 服务层封装（内联 `METHOD_CONTRACTS` 响应解析，功能等价）——层一致性问题，归属人可选择收敛到服务层或接受现状。
- `settings.update` 开放 KV 理论可写 `skills.library.v1`：读侧 `safeParse` 兜底空库、专用方法是唯一受校验写路径——报告已如实登记，可接受。
- 迁移候选只识别对象形态且 ≥1 有效技能的 localStorage 载荷；病态超限数据走「save 被拒 → 降级」路径——报告已如实登记，符合「截断用户数据比拒绝更危险」的取舍。

## 3. 已核实无问题的要点（抽样）

- **context-meter**：迁移 `0023-chat-summaries` 编号紧跟 develop 的 0022（变基后重编号正确，报告已注明初版撞号史）；`compressTurn` 以 `openTurn(..., [])` 空工具面 + 无审批闸 + finally 清理，摘要回合无工具调用面；`rowsAfterWatermark` 在水位滑出 20 行回放窗时回退整窗（行为正确）；`chat_messages` 全程不删，删摘要行即恢复全量回放。
- **d14-mermaid**：供应链干净——锁文件钉住 `mermaid@12.2.0` / `@mermaid-js/parser@2.0.1`（+837 行，动态 import 独立 chunk）；全渲染层 `git grep` 无 mermaid.ink/CDN/kroki 等远程路径；strict + DOMPurify svg profile + shadow DOM 三层防线与任务书一致；失败回退保原文（错误行为 `textContent`，无 HTML 注入）。
- **d17-skill-host-store**：契约 v0.11 附加式（SUPPORTED 列表正确追加 0.10、0.11，0.1–0.10 发送方保持接受）；注入链路与能力白名单零改动（`skillsForInjection` 未动）；composer 模板库同键冲突就此根治（数组形态绝不迁移）。

## 4. 未验证（如实列出）

- 真实模型行为（cm 摘要质量、d14 真实语法图、d17 迁移实机）——各报告同口径登记为未验证；本审查未发起付费调用。
- 真机 Electron 与 mermaid chunk 的实际产物体积（d14 报告自记本机 esbuild 临时目录 `Access is denied` 的基线构建限制）。
- d17 的 27 落后与 CONTRACTS.md 冲突、cm/d14 的 8 落后：合入前归属人需变基/重放（台账 §10 已登记）。
- 本审查为静态阅读 + 本机测试复跑，不构成归属人自审；三片自审栏均留空，由 Destinyian 本人签署。

## 5. 审查痕迹

- 三个只读 worktree `.worktrees/review-cm|d14|d17`（detached HEAD，未占用三条分支），报告入库后由审查会话清理。
- 除安装依赖（d14 按其锁文件拉取 mermaid，`--frozen-lockfile` 校验和锁定）外未改动任何分支内容；三条分支 tip 与审查前一致（`7caf386` / `3e325c8` / `348891f`）。
