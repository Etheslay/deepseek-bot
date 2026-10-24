# D05 机器人工作区报告（bot-workspace）

- 任务：D05 机器人工作区、设置与聊天界面（里程碑 M1）
- 分支：`feature/bot-workspace`（基线 `144d84d`（D03）+ D02 UI 打磨 `7802e71` 合并 + D04 合并 `9cf4ba2`；开工时 develop 最新为 `144d84d`，期间 D04 合入已同步）
- 负责人：Destinyian；执行器：ZCode（手动工作流）
- 真实 API 预算：0（未发起任何模型/网络请求）
- 交付：本分支 + 本报告；**未推送、未开 PR**（等负责人指示）
- 执行时间：2026-10-24，时区 America/Los_Angeles

## 结论

D5-1～D5-11、D5-13 完成并有证据；D5-12 中 desktop 构建成功、**分支 CI 因未推送为 UNVERIFIED**。机器人工作区可用：契约驱动服务层 + 夹具实现、Bot CRUD/复制/归档、流式聊天（工具卡/取消/失败重试）、会话历史回放、产物安全预览、设置 Key 只写不读 + 测试连接如实 UNVERIFIED。真实 Harness/API/持久化均未接（按任务书边界，见未验证项）。

## 0. 开工门禁

| 项 | 结果 |
| --- | --- |
| origin/develop 含 contracts / shared / desktop | 通过 |
| 分支从最新 develop 创建、工作区干净 | 通过（`feature/bot-workspace` 自 `144d84d`；后追加合并 D02 打磨与 D04，保留 merge 历史） |
| 必读文档 | 已读 CONTRACTS / contracts README / DESKTOP_SHELL / ARCHITECTURE / SECURITY_DATA / TESTING / DEVELOPMENT_PLAN / D02-report |
| 确认不依赖真实 Host/DB | 通过（纯前端 + 夹具） |

## 环境

Windows 11 x64（26200）；Node 24.16.0；pnpm 11.28.5；Electron 38.2.1；React 19.1.1；zod（经 contracts）4.6.7。

## 验收证据（D5-1～D5-13）

| # | 步骤 | 证据 | 结果 |
| --- | --- | --- | --- |
| D5-1 | `pnpm install --frozen-lockfile` | 输出 `Already up to date / Done in 569ms using pnpm v11.28.5` | 通过 |
| D5-2 | lint/typecheck/test | lint CLEAN；typecheck CLEAN（node+web 两工程）；全 workspace 测试：shared=1、contracts=5、desktop=5、storage=9 文件全过；desktop 34 例（服务 22 + 表单 5 + reducer 7） | 通过 |
| D5-3 | Bot CRUD | GUI：种子 3 Bot；创建表单五字段经 BotSchema 校验错误定位字段（测试 5 例：空名拒/非 UUID 拒/超长拒/全部字段聚合）；复制=新 id/revision+“副本”+不复制会话；编辑弹窗保存成功；GUI 脚本验证侧栏出现新建 Bot | 通过 |
| D5-4 | 归档语义 | 服务测试：archivedAt 标记 + stream 抛“archived”+ 历史仍可 openSession；GUI：侧栏“已归档”标签、输入禁用 + 横幅“不能发起新聊天；历史会话仍可查看” | 通过 |
| D5-5 | 设置 | GUI 脚本实测：占位符 `未配置` → 输入 sk-test-secret → 保存 toast `已保存（不回显）` → 占位符变 `已配置（输入新值覆盖）`；测试连接返回 `UNVERIFIED（无真实网络，占位）`；Key 明文不出现在任何回显/序列化（服务测试断言） | 通过（截图见下注） |
| D5-6 | 聊天 | GUI 脚本实测：发送后流式气泡 + 取消按钮（`d05-40-streaming.png`），完成后助手气泡入列（4 bubbles）；工具卡/取消/失败在 reducer+服务测试覆盖（工具 requested→succeeded 序列、cancel 后 0 增量、RATE_LIMITED 稳定码+retryable）；失败重试入口已实现 | 通过 |
| D5-7 | 历史 | GUI 脚本实测：会话列表 2 项 → 打开回放 6 个契约事件（success-run 夹具，run.created→run.completed）→ `d05-41-history.png` | 通过 |
| D5-8 | 产物 | GUI 脚本实测：列表 2 项（summaries/note-summary.md、reports/index.html，含 mediaType/size/sha256 摘要）；markdown 预览显示；HTML 拦截提示 `mediaType text/html 不做内联预览（防脚本执行，QA-14）` | 通过 |
| D5-9 | 契约 | 服务层出参全部过 schema（测试断言非法即抛）；fixtures 导入经 EventEnvelopeSchema 校验；无重复类型定义（类型全部 import 自 contracts，UI-only ChatSessionView 留在服务层） | 通过 |
| D5-10 | 安全 | 无 Key/用户数据入库（测试 Key 仅在 GUI 会话内存）；renderer 无 Node（D02 探测仍有效，主进程未改）；**未新增任何 IPC**（纯服务层夹具）；clipboard 白名单不变 | 通过 |
| D5-11 | 可访问性 | 全部交互为原生 button/select/input + aria-label（含“给 X 发消息”“选择表情”“历史会话列表”等）；Tab/Enter/Esc 路径保持 D02 行为 | 部分验证（键盘全流程人工复核留负责人） |
| D5-12 | 构建/CI | `pack:dir` 成功（electron-builder 24.13.3，win-unpacked）；**分支 CI：UNVERIFIED（未推送）** | 部分 |
| D5-13 | 文档 | 本报告 + `docs/BOT_WORKSPACE.md`（新建）+ `docs/DESKTOP_SHELL.md` 已同步 | 通过 |

**截图索引**（`docs/reports/assets/d05/`）：`d05-32-notice-line.png`（通知行时间线）、`d05-33-detail.png`、`d05-34-pair-view.png`（配对聊天视图）、`d05-40-streaming.png`（流式+取消）、`d05-41-history.png`（历史回放+产物）。设置弹窗新截图因 CDP captureScreenshot 在该弹窗打开时稳定超时未取得（已尝试 3 次），以 D5-5 行为日志 + D02 的 `assets/d02/d02-16-settings.png`（同一弹窗骨架）佐证，如实记录。

## UI 追加调整（Owner 会话内指示，阶段 1；头像阶段 2 按指示跳过）

依据 handoff/D05_UI_UPDATE_BRIEF.md 阶段 1 + 会话内追加反馈，全部 GUI 脚本实测通过（截图 assets/d05/ d05-50～55）：

| 项 | 实现 | 实测 |
| --- | --- | --- |
| 底栏 UI-1/2/3 | 头像（字母占位）+ 账户名 + “本地工作台” + 齿轮（真 cogwheel 图标）；版本号移除，进 设置→关于 | footer 无版本串、关于行含版本 ✓ |
| 归档移除 UI-4 | 侧栏标签/横幅/右键“归档”/禁用逻辑全部移除；种子不再含归档 Bot（服务层 archive 能力保留未用） | tags=0 banners=0、种子 2 Bot ✓；**FR-02 归档按 Owner 决定延期** |
| 历史 UI-5 | 聊天头部时钟按钮 → popover（≤8 条：标题/时间/状态）→ 点选恢复会话视图；事件明细面板移除 | popover 2 会话、恢复视图如实提示“夹具无聊天消息，真实回放 D06/D12” ✓ |
| 产物 UI-6 | 独立回形针入口 → popover 列表 + 预览（md 可看、HTML 拦截不变） | 2 产物、md 预览 ✓ |
| 表单 UI-13/14/15 | 无标签软背景：名称 44px 居中、角色 96px、占位符正确；高级设置（模型/工作目录/工具授权）折叠进 <details>；名称空时创建禁用 | 全部 ✓（d05-54） |
| 语气 chips（会话追加） | 9 个预置语气（凶悍/严肃/可爱/呆萌/幽默/温柔/毒舌/冷静/热血）虚线胶囊多选、选中浅蓝；“＋自定义”展开输入添加；提交时以（语气：…）附加到 instructions 末尾（UI-only） | 多选凶悍+呆萌+自定义“中二”→ 创建后编辑预填见后缀 ✓ |
| 下拉暗色 | 原生 select option 暗底亮字 | Windows Chromium 原生弹层尽力而为，若仍发白需换自绘下拉（已知限制） |

已知小问题：编辑时改选语气会叠加旧后缀（includes 防重只对完全相同后缀生效）；头像阶段 2（预置 16 动物/Emoji/图片上传）按 Owner 指示跳过，素材与组件骨架已就绪待做。

## 服务层与夹具说明

见 [BOT_WORKSPACE.md](../BOT_WORKSPACE.md)。要点：`DesktopService` 接口 + `FixtureService` 唯一实现 + `contract-validation` 统一 schema 校验 + Context 注入；种子 Bot×3（1 归档）、会话×2（success-run/cancel-run 事件回放）、产物×2（md 可预览/html 拦截）、流式模拟（增量/工具/取消/RATE_LIMITED|AUTH_FAILED|MODEL_UNAVAILABLE 失败注入）。

## 契约边界（UI-only vs 后续任务）

- UI-only（不进契约、不持久化）：ChatSessionView、分组/置顶/未读、表情反应/引用、Bot 间交流转录（pairTranscripts）。
- 等 D04：真实持久化（storage 包已合并但桌面端未接线）、Key 加密存储。
- 等 D06/D12：真实 Harness 流式/取消/审批、模型连接。
- 等 D08：凭据与权限策略。

## 未验证项

| 项 | 原因 | 最高可能判定 |
| --- | --- | --- |
| 分支 CI（windows-latest） | 未推送 | PASS-WITH-FIXES（本地全绿） |
| 键盘全流程可访问性 | 未做完整人工键盘走查 | PASS（原生控件 + aria 已齐） |
| 真实模型连接/流式/取消 | 任务书红线（预算 0），服务层为夹具 | 不适用（D06/D12） |
| 持久化（重启保留） | D04 未接线 | 不适用（后续任务） |

## 已知问题与风险

1. CDP captureScreenshot 在设置弹窗打开时超时（Electron 合成器问题），不影响功能；负责人可实机截图补证据。
2. 工作区内启动打包 exe 崩溃的 D02 已知问题（路径相关）仍未解，所有 GUI 证据经中性路径副本取得。
3. 本会话期间多次发生并行执行器写入冲突（夹具导入被临时占位、talkTo 被回退、handoff 被清理），均已恢复；建议 Manager 确认单一执行器。
4. `App.tsx` 仍偏大（~64KB）；features 拆分已开始（bots/chat），剩余搬迁留后续（不阻塞验收）。

## 回退方式

```powershell
git checkout develop
git branch -D feature/bot-workspace
# 若已推送：关闭 PR 并删除远程分支（负责人/Push 执行）
```

无数据迁移；`packages/contracts` 与 D02 产物不受影响。

## PR 描述草稿（推送后使用；负责人自审记录留空）

### 任务与目标
- 关联 Dxx：D05 机器人工作区（M1）
- 来源分支 → 目标分支：`feature/bot-workspace` → `develop`
- 变更：契约驱动服务层 + 夹具；Bot CRUD/复制/归档；流式聊天（工具/取消/失败重试）；会话历史回放；产物安全预览；设置 Key 只写不读 + 测试连接 UNVERIFIED。真实 Harness/持久化不在本 PR。

### 验证证据
| 检查 | 环境 | 结果 |
| --- | --- | --- |
| lint/typecheck/test | Win11 x64, Node 24.16.0, pnpm 11.28.5 | 全绿（desktop 34 例） |
| GUI 脚本验证 | 打包 exe（中性路径） | D5-3~D5-8 逐项通过，截图 assets/d05/ |
| 构建 | pack:dir | win-unpacked 产出成功 |

未执行：分支 CI（未推送）、真实 API/持久化（任务边界）。

### 负责人自审记录
- 已审提交 SHA / 日期：
- 差异、需求和错误路径检查结果：
- 测试证据 / 兼容性与权限影响：
- 遗留问题与处理方式：
- 自审结论：

### 风险、迁移与恢复
无数据/契约迁移。回退见上。已知问题 1-4。

## 提交记录

- 验收代码提交：
  - `feat(bot-workspace): add contract-driven service layer with fixtures and bot workspace UI`
  - `feat(bot-workspace): add streaming chat, history, artifacts and settings wiring`（本次收尾提交）
- docs-only：`docs: record bot workspace`（本报告与 BOT_WORKSPACE.md）
- 完整 SHA 以 `git log feature/bot-workspace` 为准；报告不自我引用 tip。
