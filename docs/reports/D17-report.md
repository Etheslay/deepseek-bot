# D17 技能与模板实现报告

日期：2026-10-25。任务：D17 `feature/skills-templates`（负责人 Destinyian）。依赖 D05、D15。设计见 [技能库设计规格](../superpowers/specs/2026-10-25-skill-library-design.md)。

分两次交付：

| 切片 | 提交 / 合入 | 内容 |
| --- | --- | --- |
| 模板库切片 | `2572758` → merge `292c3b8` | bot 模板的保存、复用、删除（渲染层） |
| 技能库 + 导入导出 | 本分支 `feature/skills-templates` | 技能定义/复用/版本化；统一库文件的契约校验导入导出；bot 绑定与发送时拼装 |

> **补记说明**：模板库切片合入时未写报告、PR 自审记录未填（清单仅勾选 2/5），该部分报告系事后补记，不追认事前完成自审。

## 1. 交付内容

### 1.1 模板库（已合入 `292c3b8`）

- [`features/templates/bot-templates.ts`](../../apps/desktop/src/renderer/src/features/templates/bot-templates.ts)：`BotTemplate`（名称 + bot 指令 + `avatarUi{avatar, shape, color}` 快照）；存储键 `deepseek-bot.bot-templates.v1`；`MAX_TEMPLATES = 30`；`listTemplates` 损坏容错；`saveTemplate` 返回 `{ok:true, template}` 或 `{ok:false, reason:"limit" | "duplicate"}`；`deleteTemplate`。
- `App.tsx`：菜单"存为模板"、模板列表与删除、以模板创建 bot（`tplDraft` / `tplSeed`）。

### 1.2 技能库（本分支）

| 文件 | 内容 |
| --- | --- |
| [`features/skills/skills.ts`](../../apps/desktop/src/renderer/src/features/skills/skills.ts) | `SkillDefinition`（名称/说明/指令/`capabilities` 声明/`version`/时间戳）与 `SkillLibrary`（技能 + `botId → 有序技能 id` 绑定）；存储键 `deepseek-bot.skills.v1`，`MAX_SKILLS = 30`；`loadSkills` 损坏容错并在给定 bot 列表时剪除孤儿绑定；`saveSkill` 新建 v1、编辑 v+1（同名拒绝、上限拒绝、缺 id 拒绝）；`deleteSkill` 连带清绑定；`setBotSkills` 去重保序、空数组解绑 |
| `buildSkillContext`（同上文件） | 按绑定顺序拼装有界、fence 安全的上下文块：总上限 `MAX_SKILL_CONTEXT_CHARS = 4000`，超限截断并标注；围栏长度自动超过内容中最长的反引号串；无绑定返回空串 |
| [`features/skills/library-io.ts`](../../apps/desktop/src/renderer/src/features/skills/library-io.ts) | `exportLibrary` 产出统一 JSON（技能 + 模板，`format`/`formatVersion`/`exportedAt`）；`importLibrary` 先用契约 `parseLibraryExport` 整份校验，失败即整份拒绝、不做部分导入；通过后按名称合并、同名跳过并计数 |
| [`features/skills/skills-panel.tsx`](../../apps/desktop/src/renderer/src/features/skills/skills-panel.tsx) | 设置页"技能（复用与导入导出）"分区：列表（名称/版本/声明能力/说明）、新建、编辑、删除、导出（下载 JSON）、导入（选文件） |
| [`features/skills/bot-skills-picker.tsx`](../../apps/desktop/src/renderer/src/features/skills/bot-skills-picker.tsx) | bot 编辑表单内的技能多选（经 `BotForm` 新增的 `skillsSlot` 槽位注入，不改表单校验归属） |
| `App.tsx` | 技能库状态、设置页分区挂载、编辑表单技能绑定；**发送时拼装**：`withSkillContext()` 把绑定的技能上下文拼进出站文本，消息气泡仍只显示用户原话 |
| `packages/contracts/src/library-export.ts` | 统一导出文件的 schema + `parseLibraryExport`（PR① 已合入；本分支修正 `TemplateExport` 的 `avatarUi` 为真实结构：avatar 联合对象 + 数字 shape/color） |

## 2. 过程决策

- **复用走渲染层拼装**：`buildSkillContext` 在发送路径把技能指令作为参考上下文拼给模型，不改 Host、不改协议；模型侧原生注入留给 A 线后续任务。选择理由见设计规格 §0。
- **版本只做递增整数**：编辑一次 +1，界面可见；不做历史快照与回退（YAGNI，回退留给后续）。
- **导入绝不覆盖**：同名跳过并计数，整份校验失败即整份拒绝，避免半套数据。
- **绑定与技能同键存储**：`{skills, bindings}` 同存一个键，删除技能时一并清绑定；绑定键是渲染层私有状态，不写进导出文件。
- **不新建 `packages/skills/`**：遵守 ARCHITECTURE 里"D13 通过前不创建"的约束。
- **契约修正**：PR① 当时把模板 `avatarUi.avatar/color` 猜成字符串，实际是 `{kind:"mono"}|{kind:"grok",...}` 与数字索引；本分支按真实结构修正并补了三类反例用例。

## 3. 测试与验证

| 检查 | 提交 / 环境 | 命令 | 结果 |
| --- | --- | --- | --- |
| 桌面全量 | 本分支 head / Windows 11 x64 + Node v24.16.0 + pnpm 11.28.5 | `pnpm --dir apps/desktop run test` | **21 文件 / 197 用例通过** |
| 技能与导入导出专项 | 同上 | `tests/features/skills.test.ts`、`tests/features/library-io.test.ts` | 18 用例：v1 创建、编辑递增版本且保留 createdAt、同名拒绝/自身改名放行、上限与缺失 id 拒绝、坏载荷回退、孤儿绑定剪枝、删除清绑定、绑定去重与解绑、上下文顺序与版本、空绑定空串、超限截断标记、围栏自适应 |
| 类型检查 | 同上 | `pnpm --dir apps/desktop run typecheck` | exit 0 |
| 契约用例 | 同上 | `pnpm --dir packages/contracts run test` | 6 文件 / 81 用例通过（含新增 avatar 联合与反例 3 例） |
| Lint | 同上 | `pnpm run lint` | exit 0 |
| CI | — | — | 本机无 `gh` CLI，以推送后页面 checks 为准 |

未执行：真实 Host 端到端（技能拼接只影响出站文本，模型是否遵从需真实 API 手测）；设置页与表单的键盘/读屏手测；截图证据（`docs/reports/assets/d17/` 仍缺）。

## 4. 依赖与文档同步

- 无新增依赖；无 storage 迁移；`PROTOCOL_VERSION` 仍 0.2。
- 已同步：[CONTRACTS.md §8](../CONTRACTS.md)（库导出文件）、[SPRINTS §4](../SPRINTS.md)、本报告、progress.md。
- **未同步**：[BOT_WORKSPACE.md](../BOT_WORKSPACE.md) 仍未写入模板与技能入口；THIRD_PARTY_NOTICES 无新增依赖故无需变更。

## 5. 未做项与边界（D17 验收缺口）

| 验收要求（开发计划 §6 D17） | 状态 |
| --- | --- |
| bot 模板与本地模板库 | **已做** |
| 技能定义与复用与版本化 | **已做**（渲染层：定义、按 bot 绑定、版本递增）。发送时拼装已改由 Host 注入，见 [技能注入报告](D17-skill-injection-report.md) |
| 导入导出走契约校验 | **已做**（统一文件 + 整份校验 + 同名跳过） |
| 工作流模板的保存/导入导出 | **未做**：FR-14 里"工作流模板"部分归工作流编辑器后续任务 |
| 技能在 Host/网关注入与能力强制 | **后续切片已做**：见 [技能注入报告](D17-skill-injection-report.md)。声明的能力 id 由网关限制；D16 授权仍然生效。本文件记录的是更早的渲染层切片 |
| 技能历史版本回退 | **未做**（仅递增标识） |
| 存储经 Host 持久化 | **未做**：仍在渲染层 localStorage，等 SPRINTS §8 待拍板 #1 |
| 手测截图与 BOT_WORKSPACE 文档同步 | **未做** |

## 6. 自审记录（由负责人填写）

自审人：＿＿＿＿　提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 差异检查结果：＿＿＿＿
- [ ] 检查证据（lint/typecheck/test/CI run）：＿＿＿＿
- [ ] 遗留问题：＿＿＿＿
- [ ] 结论：＿＿＿＿
