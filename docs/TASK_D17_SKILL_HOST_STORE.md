# 任务书：D17' 技能库进 Host（渲染层 localStorage → Host 持久化）

| 项 | 值 |
| --- | --- |
| 任务 | 把 D17 技能库（技能定义 + bot 绑定）从渲染层 localStorage 迁到 Host 持久化 |
| 分支 | `feature/d17-skill-host-store`（从 `origin/develop` = `92303eb` 拉出） |
| 来源 | Owner 指示（2026-10-28）：技能库进 Host；`chat.send` 的技能注入与能力白名单已在 develop（PR #115），不重做注入 |
| 红线 | 注入链路零改动；能力白名单语义不变（声明的能力仍是白名单，网关在授权前拒绝名单外工具；无能力技能只注入说明）；不碰 runtime/exec-daemon |
| 状态 | 任务书随本分支首笔提交入库；实现按本方案随后提交 |

## 1. 现状（2026-10-28 对 `origin/develop` = `92303eb` 核实）

- **库模型**（`apps/desktop/src/renderer/src/features/skills/skills.ts`）：`SkillLibrary = { skills: SkillDefinition[]; bindings: Record<botId, skillId[]> }`，上限 30 技能，纯函数操作（save/delete/bind/load），持久化在 localStorage 键 `deepseek-bot.skills.v1`（整库覆写）。
- **注入链路（不动）**：发送时 `skillsForInjection(botId, library)` 组装 `ChatSkillInjection[]` 随 `chat.send.skills` 交 Host（契约 methods.ts:595-598，协议 0.8 起可选字段）；Host 注入说明、`skill.capabilities` 并集为本轮网关允许集，未声明工具在授权检查前拒绝（PR #115，`packages/host/src` skill-injection + gateway）。
- **既有冲突（本任务顺带根治）**：composer 的提示词模板库 `skill-store.ts`（`Skill = {id,name,prompt,…}`，数组形态，MAX 20）与 D17 技能库**共用同一个 localStorage 键** `deepseek-bot.skills.v1`，整库覆写互相清空——D17-skill-injection 报告原话"这是原有冲突"。两者数据形态不同（对象 vs 数组），读取时互相解析失败得空库。
- **Host 存储面**：`settings` KV 表（`packages/storage/src/repos/settings.ts`，JSON 值，`getSettingRaw`/`setSetting` 现成，无迁移）；`settings.update` 契约的 patch 是开放 KV（`z.record(string, unknown)`）。备份/恢复（D24）覆盖整个数据库——库进 Host 后自动纳入备份面，而 localStorage 今天不在备份内。
- **方法白名单**：`packages/contracts/src/methods.ts` 的 `METHODS` 数组同时供主进程（`apps/desktop/src/main/host-client.ts:277`）与 Host 双重校验——新增方法一处声明两侧生效。
- **协议版本**：当前 `0.10`；附加式新方法按惯例 minor bump 并保留旧发送方兼容（v0.9 voice、v0.10 usage 均如此）。

## 2. 需求

1. 技能库的唯一持久化副本在 Host（随数据库走：重启、备份/恢复、多窗口读同一份）；localStorage 不再是技能库的写路径。
2. 一次性迁移：Host 库为空且 localStorage 里存在**技能库形态**（`{skills, bindings}` 对象、skills 非空）的数据时，把它写入 Host；localStorage 里若是 **composer 模板形态**（数组）则原样保留、绝不迁移——根治两 store 抢键的冲突。迁移后 localStorage 键不删除（回滚安全），但技能库不再读它。
3. 编辑面行为不变：新建/编辑（同名拒绝、30 上限、版本自增）、删除（连带清绑定）、bot 绑定（有序、去重）、导入导出（合并式、契约校验）全部保持；只是写路径从 `localStorage.setItem` 换成 Host 方法。
4. Host 不可用/旧 Host（方法不存在）时降级：回退读 localStorage（现行为），编辑仅在会话内生效并如实提示——与今天 localStorage 配额失败的语义一致。
5. 注入与白名单零改动：`skillsForInjection` 仍是发送时快照组装器；未知能力串依旧在发送时拒绝而非静默丢弃；无能力技能只注入说明。

### 验收清单

- [ ] 新建技能并重启应用 → 技能仍在（Host 持久化）；localStorage 键里没有新技能（不再写 localStorage）；
- [ ] 旧数据迁移：localStorage 含技能库形态数据、Host 为空 → 首次启动后 Host 库与之一致；再次重启不重复迁移、不丢编辑；
- [ ] localStorage 是 composer 数组形态 → 不迁移、composer 模板功能不受影响（冲突根治）；
- [ ] `skillLibrary.save` 拒绝非法库（31 个技能、缺字段、绑定指向未知结构）并报 `INVALID_INPUT`；
- [ ] 旧 Host（无此方法）→ 渲染层降级为 localStorage 读 + 会话内编辑 + 明确提示，发送与白名单行为不变；
- [ ] 导出文件包含技能与 bot 模板（现状不变）；导入合并语义不变；
- [ ] 契约：协议版本 0.11、CONTRACTS.md 收录两方法；`pnpm lint` / `pnpm typecheck` / 受影响包测试全绿。

## 3. 实现方案

### 3.1 契约（v0.11，附加式）

`packages/contracts/src/skills.ts`（新文件）：

- `SkillLibrarySchema`：`{ skills: 0..30 条, bindings: 记录 }`。
  - 技能：`id` NonEmptyString(64)（渲染层有非 UUID 的历史回退 id，不用 UuidSchema）、`name` NonEmptyString(TEXT_LIMITS.name)、`description?` ≤500、`instructions` NonEmptyString(20_000)（入库上限宽于注入上限 4_000——注入时才截断，与今天库内可存长文一致）、`capabilities` string[]（≤64 条 × ≤64 字符；**存字符串不存 CapabilityId**——库语义允许未知旧串存在，强制发生在注入时）、`version` int 1..1_000_000、`createdAt`/`updatedAt` epoch 毫秒 int ≥0。
  - 绑定：`z.record(UuidSchema, z.array(UuidSchema).max(MAX_CHAT_SKILLS))`，≤50 个 bot 键。
- `METHODS` += `skillLibrary.get`、`skillLibrary.save`；`METHOD_CONTRACTS`：
  - `skillLibrary.get` `{}` strict → `{ library: SkillLibrarySchema }`；
  - `skillLibrary.save` `{ library: SkillLibrarySchema }` strict → `{ library: SkillLibrarySchema }`（入参解析即校验，越限整体 `INVALID_INPUT`）。
- `version.ts`：`CONTRACT_VERSION` → `"0.11"`，SUPPORTED 追加，注释按 v0.9/v0.10 体例说明"附加式，0.1–0.10 发送方保持接受"；`CONTRACTS.md` 补 v0.11 段与方法行。

### 3.2 Host

- `packages/host/src/skill-library.ts`（新）：
  - `readSkillLibrary(db)`：`getSettingRaw(db, "skills.library.v1")` → `SkillLibrarySchema.safeParse`，失败/缺失 → `emptyLibrary`（渲染层镜像结构在契约 schema，Host 不再复制常量——上限取自契约导出）；
  - `writeSkillLibrary(db, library)`：`setSetting(db, "skills.library.v1", library)`。
- `handlers.ts` 注册两方法：get 直读；save 先经请求 schema 解析（自动整体校验）再写并回显。
- 备份/恢复零额外工作（settings 行随库备份）；`data.describe` 的 counts 不加项（保持简单）。

### 3.3 渲染层

- `skills.ts`：`saveSkill`/`deleteSkill`/`setBotSkills` 去掉 `storage` 参数与内部 `persist`，变纯函数；`loadSkills` 保留（迁移与降级读 localStorage 用）；`skillsForInjection`/`skillsForBot`/`buildSkillContext` 一字不动。
- `library-io.ts`：`exportLibrary(library, storage, now)`（技能取自内存库，bot 模板仍读 storage）；`importLibrary(library, text)` 纯合并，返回 `{ok, summary, library}`。
- `skills-panel.tsx`：props 去掉 `storage`，`onChange` 语义不变（交给 App 统一持久化）。
- `App.tsx`：
  - 启动效果（ticket 守卫）：`skillLibrary.get` → Host 有数据即用；为空则调 `shouldMigrateLocalLibrary(localStorage 原文)`，返回库则 `skillLibrary.save` 后采用，返回 null（空/数组形态）则以空库起步；get 失败（含旧 Host 的 UNKNOWN_METHOD）→ 降级 `loadSkills(window.localStorage)` + toast（新键 `skills.hostDegraded`）。
  - 编辑统一走 `updateLibrary(next)`：乐观 `setSkillLibrary(next)` + 异步 `skillLibrary.save(next)`，失败 toast（新键 `skills.hostSaveFailed`）并保留会话内状态。
  - `skillContext` 回调：库未加载完成时按空库组装（`emptyLibrary()`），避免空指针。
- composer `skill-store.ts` **一行不改**（数组形态继续用同一 localStorage 键；库迁走后不再冲突）。

### 3.4 测试计划

- contracts：`SkillLibrarySchema` 边界（30/31 条、未知能力串可存、绑定形状、坏 id 拒绝）。
- host：新 `skill-library.test.ts`——空读、save→get 往返、二次 save 覆盖、非法 save 被 INVALID_INPUT 拒、损坏行读为空库、（同连接）重启后再读仍在。
- desktop：
  - `skills.test.ts` / `library-io.test.ts` 适配纯签名；
  - 新迁移用例：技能库形态迁移、composer 数组形态不迁移、Host 失败回退 localStorage、迁移保存失败降级；
  - 面板/选择器既有用例改 props 后全过；`i18n-scan` 过（新键双语）。

### 3.5 并发与安全说明

- 双窗口并发编辑 = 整库最后写入胜（与今天 localStorage 语义相同，不新增锁）。
- 库内容是"将被注入模型的数据"：Host 存取都过 schema；能力强制不因存储迁移改变（仍在 `chat.send` 校验点 + 网关授权检查前）。
- `settings.update` 的开放 KV 理论上可写 `skills.library.v1` 键：读取侧 safeParse 兜底为空库，fail-safe；专用方法是唯一受校验的写路径。

## 4. 提交计划

1. `docs(d17): add the skill library host store task book`（本文件）；
2. `feat(contracts): add skillLibrary.get/save (protocol v0.11)` + Host 存取与测试；
3. `feat(desktop): move the skill library onto the host store` + 迁移 + 测试 + 报告。

PR：base=`develop`，merge commit；自审栏留空待负责人签署。
