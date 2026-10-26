# D28 产物画布共编侧车实现报告

日期：2026-10-26。任务：D28 `feature/canvas-cowrite`（负责人 Destinyian；执行 Bot 按任务书 `handoff/D28_TASK_BRIEF.md` 实施，该目录不入库）。基线 `origin/develop` @ `cc4a379`（PR #61 合入后），分支自该基线新切，工作树为独立 git worktree（`D:\PersonProgram\deepseek-bot-d28`），Owner 在 `feature/gaze-avatar` 上的未提交改动全程未触碰。

## 0. 结论

**实现完成，静态检查与全仓测试全部通过；实机观感与真实 Harness 续写闭环未验证（见 §6），待负责人自审与实机验收。** 验收清单 D28-1–D28-15 的逐项证据见 §4。

## 1. 交付内容

| 层 | 实现 | 提交 |
| --- | --- | --- |
| 契约（v0.3→v0.4） | `artifacts.list / read / save / versions / versionContent / revert` 六个受信桌面方法；`BotArtifactSchema` / `ArtifactVersionSchema` 实体；`artifactMediaTypeForPath` / `isTextEditableMediaType` 媒体判定（HTML 与二进制永不进编辑器）；`MAX_ARTIFACT_CONTENT_BYTES = 768 KiB` 内联内容预算（1 MiB envelope 内留 JSON 转义余量）；`PROTOCOL_VERSION` 升 0.4，0.1–0.3 发送方继续接受；version-mismatch 夹具改用 9.9 以继续演练"拒绝更高版本" | `61d1a2d` |
| 存储 | 迁移 `0010-artifact-versions`：只追加版本表（(bot_id, relative_path, revision) 唯一，author ∈ user\|bot，快照存 `content_path`）；仓库提供插入/最新优先列表/下一 revision/快照路径查询/超量剪除（每文件 50 版，行+文件同删） | `07fd0cf` |
| Host | `packages/host/src/artifacts.ts`：产物 = bot 工作区（`workspaces.canonical_path`）真实文件；保存原子写回（临时文件+rename）+ 恒追加 user 版本；**bot 写入的懒补记**——list/read/versions/save 前先 reconcile，校验和与最新版本不符的工作区内容补记为 bot 版本（Harness 直接写盘不经过方法调用，这是唯一能覆盖它的时机）；save 携带 `expectedChecksum` 做乐观并发，文件已被 bot 改动返回 `REVISION_CONFLICT`；内容无变化的不重复记版本；路径安全 = 契约 schema（禁绝对/`..`）+ `path.relative` 夹紧 + 最深存在祖先的 realpath 校验；超 768 KiB 的盘上文件仍可列出/回看版本但拒绝内联读写，不截断 | `7f15f7f` |
| 桌面主进程 | 无改动：`host-client.ts` 白名单直接引用 contracts `METHODS`，新方法自动放行（已验证） | — |
| 渲染层 | 服务接口迁移到 bot 维度六方法（`desktop-service.ts`），fixture 实现内存工作区+版本链（种子里 bot v1 惰性补记），host 实现走 `bridge.host.call` 并对响应做 schema 校验；`session-history.tsx` 同步迁移；顶栏产物 popover 列真实工作区文件并给"在画布中打开"入口；新组件 `features/canvas/canvas-sidecar.tsx`：编辑（Ctrl+S/按钮）、冲突横幅+重新加载、5 秒轮询（干净则静默刷新 bot 写入，脏则横幅不覆盖草稿）、Markdown 走 D14 安全渲染预览、版本面板（列表/预览/回退，回退确认后以新版本落盘） | `534c38b` |
| 文档 | `CONTRACTS.md` 升 v0.4（方法组/实体/语义）；`BOT_WORKSPACE.md` 增"产物共编与版本"节 | `a207ee6` |

证据截图（无头取证，见 §5）：`docs/reports/assets/d28/d28-canvas-{edit,saved,versions,stale,blocked}-dark.png` + `d28-canvas-edit-light.png`。

## 2. 关键设计决策（须负责人审查）

1. **产物 = bot 工作区真实文件**（而非夹具时代的 run 产物元数据行）。用户保存写回工作区文件，bot 下一轮经自身文件工具读到用户版本——共编闭环不需要新通道。工作流引擎的 run 产物（`artifacts` 表、`layout.artifacts/<runId>`）不受影响；版本快照放 `artifacts/coedit-versions/<botId>/`，含产物备份即含版本。
2. **bot 版本是"懒补记"**：Harness 写盘发生在任何方法调用之外，Host 无法实时观察；每次读取路径 reconcile 补记。语义上版本链"最终完整"，但两次读取之间的中间态不逐个留痕。契约注释与报告均如实声明。
3. **内容上限 768 KiB**：envelope 1 MiB 是整个 payload 的 JSON 字节数，文本转义可放大体积，故内联内容预算留余量；超限拒绝不截断。若未来要编更大文件，需分块或走文件引用，属契约变更。
4. **用户保存走 Host 直通道**，不经 D15 工具网关与审批（用户主动操作 vs 模型副作用的既有分界）；bot 写入仍走 Harness 工具 + 既有审批与审计。
5. **过程中修复的两个自身缺陷**（已入测试）：host `save()` 内层变量遮蔽导致对已有文件的保存被误判为无变化返回旧版本（`artifacts.test.ts` 的连续保存用例覆盖）；侧车复用 `.ghost-btn` 基类被其绝对定位规则弹到页面中部（`.canvas-versions-toggle` 覆盖为 static，"放弃修改"改用 `pill-btn`）。

## 3. 过程偏差

- 无新依赖、无 lockfile 变化；契约/存储/权限既有测试中的硬编码断言随迁移数与协议版本同步更新（`database.test.ts`、`permissions.test.ts`、`methods.test.ts` 的方法数 56→62 与版本支持集）。
- 取证方式为"组件级静态预览页 + 无头 Edge 截图"（esbuild 打包真实组件与样式，一次性入口已删除），**不是** Electron 实机截图——本机 Electron 无法启动（见 §6），与 B-AVATAR-02 的取证方式一致。

## 4. 验收清单证据

环境：Windows 11（NT 10.0.26200）x64 · Node v24.16.0 · pnpm 11.28.5 · 分支 `feature/canvas-cowrite` @ `a207ee6`

| # | 项 | 证据 | 结果 |
| --- | --- | --- | --- |
| D28-1 | 分支与基线 | worktree 自 `cc4a379` 新切；`git log` 首五个提交连续；无 WIP 混入 | ✅ |
| D28-2 | 静态检查 | `pnpm run typecheck` exit 0（9 包）；`pnpm run lint` exit 0 | ✅ |
| D28-3 | 契约评审 | 本报告 §1/§2 + CONTRACTS.md v0.4 变更；**须 Owner 在 PR 自审中确认** | ⏳ 待审 |
| D28-4 | 存储迁移 | `artifact-versions.test.ts`（4 例：迁移 0010 应用、往返、非法 bot/重复 revision 拒绝、最新优先+剪除）；`database.test.ts` v4 库升级至 10 且旧校验和不变 | ✅ |
| D28-5 | Host 读路径 | `artifacts.test.ts`：列出真实文件+bot 版本补记、文本读取、HTML/二进制/超限 blocked | ✅ |
| D28-6 | Host 写路径 | save 原子写回+user 版本、无变化不重复记版本、`../`、`..\\`、`a/../../b` 全部拒绝且无文件落盘 | ✅ |
| D28-7 | 版本记录 | user/bot 版本元数据（revision/author/size/sha256）断言；并发改写场景产出 `["bot","user"]` 链 | ✅ |
| D28-8 | 回退 | revert 后文件内容=目标版本、生成 v3、历史 [3,2,1] 完整 | ✅ |
| D28-9 | 侧车 UI | 截图 6 张（深/浅主题、编辑/保存/版本/冲突/拦截）；全键盘路径（Ctrl+S/Esc/Tab）为组件实现+代码审查，未做实机走查 | ✅* |
| D28-10 | 安全 | HTML 不渲染不执行（read blocked + save 拒绝 + 侧车拦截截图）；768 KiB 上限行为明确；未保存关闭有确认 | ✅ |
| D28-11 | 续写闭环 | **真实链路未执行**（无 Key）；替代证据：host 集成测试模拟"bot 直接改写 → 用户保存 REVISION_CONFLICT → bot 内容入版本链可回退"；侧车轮询行为有截图（stale 横幅） | ⚠️ UNVERIFIED |
| D28-12 | fixture 同步 | fixture 六方法 + 5 例单测（列表/读取拦截/保存回退/冲突/版本内容） | ✅ |
| D28-13 | 文档同步 | CONTRACTS.md v0.4、BOT_WORKSPACE.md §产物共编与版本 | ✅ |
| D28-14 | 手测截图 | `docs/reports/assets/d28/` 6 张（组件级取证，非实机，见 §3/§6） | ✅* |
| D28-15 | 报告 | 本文件 | ✅ |

## 5. 检查命令与关键输出

| 命令 | 结果 |
| --- | --- |
| `pnpm run typecheck` | exit 0（9 包全过） |
| `pnpm run lint` | exit 0 |
| `pnpm -r --if-present run test` | exit 0；9 包套件全过。直接改动包用例数：contracts **88**（含新增 artifacts 请求校验/路径穿越/内容上限）、storage **154**（含 artifact-versions 4 例）、desktop **249**（含 fixture artifacts 5 例、host-service artifacts 3 例）、host **98 + 1 skip**（含 artifacts 集成 11 例）、shared 6、harness-bridge 16；agent-tools / runtime / harness-adapter 套件通过（本任务未改动其源码） |
| 无头截图 | Edge headless `--screenshot` × 6，输出 `docs/reports/assets/d28/` |

## 6. 未验证 / 已知限制

- **Electron 实机未启动**：本会话无法拉起 Electron（`STATUS_INVALID_IMAGE_HASH`，B-AVATAR-02 §9 已记录该机器限制）。侧车在真实应用窗口中的观感、焦点流与 confirm 对话框行为待 Owner 实机验收。
- **真实 Harness 续写闭环未执行**：无 Key 预算授权。链路"用户保存 → bot 下一轮读到用户版本"的 host 侧机制（写回真实文件）已被集成测试覆盖，但端到端（真实模型一轮对话）未发生。
- **轮询/冲突路径无自动化测试**：侧车 5 秒轮询与 REVISION_CONFLICT 横幅目前只有组件截图证据，未写 vitest 交互用例（后续可补 rendering test）。
- **性能口径**：`artifacts.list` 对最多 200 个文件逐个 sha256；版本快照写盘+DB 行两步无事务（失败时尽力清理孤儿文件）。单用户本地场景可接受，列作已知限制。
- **CI 未读结果**：本机无 `gh` CLI；push 后 `ci.yml`（push: feature/**）自动运行，结果由负责人在 GitHub 页面确认。
- 手测键盘走查（Tab 顺序、Narrator）未执行，列为 D23 平台验收输入。

## 7. 回退

单分支五个提交，无数据迁移风险之外的外部影响；回退整分支即可。若仅回退渲染层保留 Host：契约 v0.4 方法组向后兼容（附加式），旧渲染层不受影响。数据库迁移 0010 只增表，旧版本代码打开新库不受影响（migration runner 只拒绝更高版本）。

## 8. PR 描述（目标 `develop`）

**Title**：feat: co-edit canvas sidecar over bot workspace artifacts (D28)

**Summary**：产物面板从夹具只读预览升级为共编侧车：产物即 bot 工作区真实文件；用户在侧车编辑保存（Ctrl+S、乐观并发、冲突横幅），bot 写入经轮询/补记进入版本链；每文件只追加版本历史（user|bot），可预览可回退（回退=新版本）；HTML/二进制与超 768 KiB 内容显式拒绝不截断。契约 v0.4（附加式，0.1–0.3 兼容），迁移 0010 只增表。

**Test plan**：`pnpm run typecheck` / `pnpm run lint` / `pnpm -r --if-present run test` 全绿（contracts 88、storage 154、desktop 249、host 98+1skip 等）；host 集成测试覆盖并发改写/穿越拒绝/回退；无头截图 6 张入 `docs/reports/assets/d28/`。

**Risk**：契约语义新增（v0.4）；bot 版本为读取路径懒补记（中间态不逐个留痕）；`artifacts.list` 全量哈希的性能上限（≤200 文件）。

**Rollback**：revert 分支五个提交；迁移只增表，无破坏性。

## 9. 自审记录（模板 · 须由负责人本人填写）

- 提交 SHA：`61d1a2d` / `07fd0cf` / `7f15f7f` / `534c38b` / `a207ee6`
- 自审覆盖范围（代码 / 测试 / 错误路径 / 兼容性）：
- 检查命令与关键输出：
- 契约变更确认（v0.4 artifacts.* 与迁移 0010）：
- 结论（PASS / PASS-WITH-FIXES / FAIL）：
- 负责人签字与日期：

> AI 不填写本节，也不代表负责人结论。
