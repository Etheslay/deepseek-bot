# D17' 技能库进 Host

日期：2026-10-28（Asia/Shanghai）。任务：[任务书](../TASK_D17_SKILL_HOST_STORE.md)（本分支首笔提交 `ddacf8c`，先书后实现）。分支：`feature/d17-skill-host-store`，从 `origin/develop` 的 `92303eb` 拉出。本文由实现辅助写成，不代表负责人真人自审或合并结论；自审必须针对该分支最新提交 SHA。

## 1. 交付行为（与任务书逐条对应）

**契约（协议 0.10 → 0.11，附加式）**：

- 新 `packages/contracts/src/skills.ts`：`SkillLibrarySchema`（≤30 技能：id/name/description?/instructions ≤20 000/capabilities 字符串数组 ≤64/version/createdAt/updatedAt；bindings ≤50 bot 且逐 bot id 唯一、每 bot ≤30）、`MAX_LIBRARY_SKILLS`、`EMPTY_SKILL_LIBRARY`。
- 新方法 `skillLibrary.get` `{}` → `{library}`；`skillLibrary.save` `{library}` → `{library}`（请求侧整体校验，非法即 `INVALID_INPUT`）。`METHODS` 白名单 +2（主进程 `host-client.ts` 与 Host 双重校验自动生效，121 个方法）。
- `version.ts` 按体例注释：附加式，0.1–0.10 发送方保持接受；`CONTRACTS.md` 补 v0.11 段 + 方法表两行。
- **注入零改动**：`chat.send.skills`（0.8+）仍是唯一注入路径；声明能力仍是本轮网关允许集；库存字符串能力 id，强制发生在发送组装（`skillsForInjection` 未动一字）。

**Host**：

- 新 `packages/host/src/skill-library.ts`：settings KV 行 `skills.library.v1`，读侧 `SkillLibrarySchema.safeParse` 兜底（损坏行 → 空库），写侧走 `setSetting`；handlers 注册两方法（save 由 dispatch 层 schema 校验后整库写入）。
- 无数据库迁移；库随数据库进入 D24 备份/恢复面（localStorage 时代不在备份内——行为改进）。

**渲染层**：

- `skills.ts` 三个操作（save/delete/bind）改纯函数（去 `storage` 参数与内部 `persist`）；`loadSkills` 保留（迁移与降级读）；新增 `toRendererLibrary`（吸收 `exactOptionalPropertyTypes` 下 zod 可选字段的类型差异）与 `localLibraryCandidate`（一次性迁移候选：仅识别**对象形态且含 ≥1 有效技能**的 localStorage 载荷；composer 模板的数组形态返回 null 绝不迁移）。
- `App.tsx` 启动效果：Host 有库即用；Host 为空且 localStorage 有库形态数据 → `skillLibrary.save` 迁移一次（ticket 守卫，本地编辑优先于在途加载）；get 失败（旧 Host / 桥不可用）→ 降级读 localStorage + toast `skills.hostDegraded`。编辑统一 `updateLibrary`：乐观更新 + 整库 `skillLibrary.save`，失败 toast `skills.hostSaveFailed` 并保留会话内状态（与旧配额失败语义一致）。
- `skills-panel.tsx` / `library-io.ts` 适配：技能操作纯化；`exportLibrary(library, storage)` / `importLibrary(library, storage, text)`（bot 模板半边仍走 localStorage，共享导出文件行为不变）。
- composer `skill-store.ts` **零改动**——迁移后它独占旧键，两 store 抢键的既有冲突就此根治。
- i18n：`skills.hostDegraded` / `skills.hostSaveFailed`（zh/en）。

## 2. 实际检查

环境：Windows、Node v24、pnpm 11（本机）。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 退出 0（10 个工作区包；首跑 desktop 三处 `exactOptionalPropertyTypes` 类型错误，以 `toRendererLibrary` 规范化修复） |
| `pnpm lint` | 退出 0 |
| `pnpm --filter @deepseek-bot/contracts test` | 149 通过（含 4 处协议钉子按 v0.11 更新：`chat-skill`/`screen` 版本钉、`methods` 方法数 119→121 与方法组清单 +`skillLibrary`） |
| `pnpm --filter @deepseek-bot/host test` | 285 通过 / 1 跳过 / 1 失败：`screen-distribution.test.ts` esbuild 临时目录 `Access is denied`——已登记的本机环境失败，与未改动基线同型（见 [G9' 报告](G9-update-channel-docs-report.md) §3 基线对照）；新增 `skill-library.test.ts` 5 例全过 |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0，63 文件 / 575 用例全过（含 `skills.test.ts` 16 例 + `library-io.test.ts` 6 例改纯签名后、迁移候选用例、`i18n-scan`） |

测试覆盖要点：Host 往返（空读 / save→get / 二次 save 覆盖 / 绑定与未知能力串保真 / 越限与坏字段 `INVALID_INPUT` 且失败不落库 / 损坏行读空）；迁移候选（数组形态不迁移、空库不迁移、幽灵绑定清理）；渲染层纯操作与注入快照全数保留。

## 3. 未验证边界

- 未打开 Electron 手测：迁移的真实触发（旧数据→重启→Host 库）、双窗口并发编辑的体感、降级 toast 的出现时机需实机确认。
- 双窗口并发 = 整库最后写入胜（与旧 localStorage 语义相同），未做窗口间实时同步——一个窗口的编辑要等另一窗口下一次启动/编辑才可见，如实记录，不做实时广播。
- 旧 localStorage 中单技能指令超过 20 000 字的病态数据会使整库迁移保存被拒 → 走降级路径（会话内可用）；未做静默截断（截断用户数据比拒绝更危险），报告中如实登记。
- `settings.update` 开放 KV 理论上可写 `skills.library.v1` 键：读侧 safeParse 兜底空库，专用方法是唯一受校验写路径；未做服务端键隔离。
- 全仓其余包（runtime/exec-daemon/harness-adapter 等）本分支未触及；exec-daemon 的 2 项环境失败沿用基线证据。

## 4. 负责人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与证据：＿＿＿＿
- [ ] 未验证边界与结论：＿＿＿＿
