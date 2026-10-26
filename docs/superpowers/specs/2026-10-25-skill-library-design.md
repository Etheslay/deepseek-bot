# D17 技能库（渲染层闭环）设计

日期：2026-10-25。负责人：Destinyian。状态：已批准设计，待实现。
上位依据：[DEVELOPMENT_PLAN §6 D17](../../DEVELOPMENT_PLAN.md)、[PRODUCT_REQUIREMENTS FR-14](../../PRODUCT_REQUIREMENTS.md)、[AGENT_PLATFORM §2/§4](../../AGENT_PLATFORM.md)、[SPRINTS §5 B3](../../SPRINTS.md)。
前置切片：bot 模板库已合入（`2572758`，见 [D17-report](../../reports/D17-report.md)）。

## 0. 范围与硬约束

- **渲染层闭环**：本轮不触碰 `packages/host`、`packages/agent-tools`、`packages/storage`；模型侧原生技能注入留给 A 线后续任务，缺口如实记录。
- **不新建 `packages/skills/`**：[ARCHITECTURE.md](../../ARCHITECTURE.md) 约定 D13 通过前不创建该目录，D13 已顺延至收官。
- **契约只做附加式扩展**：新增"导出文件"schema 与校验函数，不改协议方法、不改实体、`PROTOCOL_VERSION` 保持 0.2。契约变更按 DEVELOPMENT_PLAN §1 走独立小 PR 先合。
- 三个已拍板口径：复用走渲染层发送时拼装；版本为自动递增整数；导入导出为统一文件、同名跳过。

## 1. 实体与存储

`SkillDefinition`（渲染层类型，导出 schema 镜像它）：

```ts
type SkillDefinition = {
  id: string;            // crypto.randomUUID()
  name: string;          // 非空、去首尾空白后唯一
  description?: string;
  instructions: string;  // 非空
  capabilities: string[];// 声明元数据，本轮不强制（强制归 D16 grant）
  version: number;       // 整数 >= 1，编辑一次 +1
  createdAt: number;
  updatedAt: number;
};
```

存储：localStorage 键 `deepseek-bot.skills.v1`，载荷 `{ skills: SkillDefinition[], bindings: Record<botId, string[]> }`，上限 `MAX_SKILLS = 30`。

纯函数模块 `apps/desktop/src/renderer/src/features/skills/skills.ts`：

- `loadSkills(storage): SkillLibrary`——JSON 损坏或字段非法时回退空库（与 `settings-store.ts` 同口径）；加载时剪除 `bindings` 中指向不存在 bot 的孤儿项（调用方传入现存 bot id 集合）。
- `saveSkill(storage, lib, input): { ok: true; skill } | { ok: false; reason: "duplicate" | "limit" }`——无 id 为新建（version=1），有 id 为编辑（version+1、updatedAt 刷新）；同名（去空白后比较，排除自身）拒绝。
- `deleteSkill(storage, lib, id): SkillLibrary`——同时清除各 bot 绑定中的该 id。
- `setBotSkills(storage, lib, botId, skillIds): SkillLibrary`——绑定写入；传空数组即解绑。

## 2. 复用路径：发送时拼装

`buildSkillContext(botId, lib): string`——取该 bot 绑定技能的 instructions，拼成**有界、fence 安全**的上下文块：

- 总上限 `MAX_SKILL_CONTEXT_CHARS = 4000`，超出按绑定顺序截断并在块尾标注截断；
- 围栏长度自适应：使用比内容中最长反引号串更长的围栏（与 `attachments.ts` 的 `buildAttachmentContext` 同技法），避免技能文本里的 ``` 提前闭合；
- 无绑定技能时返回空串，发送路径不拼接。

接线点：渲染层发送消息处，与附件上下文同一通道、同一顺序（技能块在前、附件块在后）。chat 回复仍为夹具数据的事实不变，本设计不假装打通 Host。

## 3. 契约扩展（独立小 PR，先行）

`packages/contracts` 新增（附加式，仅导出文件用）：

```ts
LibraryExportFile = {
  format: "deepseek-bot-library";   // literal
  formatVersion: 1;                 // literal
  exportedAt: string;               // ISO 8601
  skills: SkillExport[];            // SkillDefinition 的镜像 schema
  templates: TemplateExport[];      // 现模板切片形状的镜像（name/bot{name,instructions,avatarUi}）
}
parseLibraryExport(raw: unknown): { ok: true; file: LibraryExportFile } | { ok: false; reason: string }
```

- 校验失败给出可读 reason（非法 JSON 结构、format 不符、formatVersion 不兼容、条目字段非法）；
- 不新增 IPC/Host 方法，不进 `PROTOCOL_VERSION` 协商面；
- 用例：合法文件通过、format 不符拒绝、formatVersion=99 拒绝、条目缺字段拒绝、多余字段按 zod 默认策略处理并在用例中固定行为。

## 4. 导入导出 IO（渲染层）

`features/skills/library-io.ts`：

- `exportLibrary(lib, templates): string`——产出统一 JSON（缩进 2 行），`exportedAt` 取当前时间；
- `importLibrary(text, lib, templates): { ok: true; summary: ImportSummary } | { ok: false; reason: string }`——先整份过 `parseLibraryExport`，**不过即整份拒绝、不做部分导入**；通过后按名称合并：技能与模板各自同名跳过；`summary = { addedSkills, skippedSkills, addedTemplates, skippedTemplates }`；模板落库复用 `saveTemplate` 的 duplicate/limit 语义（模板到上限或重名时计入 skippedTemplates，limit 情况在 reason 汇总中说明）。导入的模板与技能一律生成新 id，不沿用文件内 id。
- 下载/选取文件由 UI 层用 blob + `<input type="file">` 完成，IO 模块保持纯函数（接收/返回字符串），便于单测。

## 5. UI

- 新组件 `features/skills/skills-panel.tsx`：设置页新增"技能与模板"分区，含技能列表（名称/版本/能力声明）、新建、编辑、删除、导入、导出按钮；**不再向 `App.tsx` 增加逻辑**，App 只挂载面板与传入存储句柄。
- bot 表单（`features/bots/bot-form.tsx`）增加技能多选（checkbox 列表），提交时写绑定。
- 键盘与读屏：列表 `role="list"`、多选 `role="group"` + 逐项 label；不新增全局快捷键。

## 6. 测试

- `tests/features/skills.test.ts`：新建 version=1、编辑 version+1、同名拒绝、上限拒绝、损坏载荷回退、孤儿绑定剪枝、删除清绑定、`buildSkillContext` 有界/截断标注/fence 安全/空绑定返回空串。
- `tests/features/library-io.test.ts`：导出→导入往返无损、同名跳过计数正确、坏 JSON 整份拒绝、format 不符拒绝、formatVersion=99 拒绝、模板上限计入 skipped。
- `packages/contracts` 内 schema 用例（见 §3）。
- 全量：`pnpm --dir apps/desktop run test`、`pnpm --dir apps/desktop run typecheck`、`pnpm run lint`；contracts 包测试随小 PR 跑。

## 7. 交付拆分与流程

1. PR① `feature/contract-library-export`：本规格文档 + contracts schema 与用例。自审后 merge commit 合入。
2. PR② `feature/skills-templates`（PR① 合入后从最新 develop 切）：§1/§2/§4/§5 实现 + 用例 + 更新 [D17-report](../../reports/D17-report.md)（改为完整交付口径并保留本轮缺口）+ [SPRINTS §4](../../SPRINTS.md) 行状态更新。
3. 自审记录留空由负责人签署；证据只写实际运行结果。

## 8. 缺口（如实记录，不计入本轮完成度）

- 无 Host/模型侧原生注入：技能文本经渲染层拼入消息上下文，A 线后续任务可改为网关侧注入；
- `capabilities` 仅声明不强制，强制校验归 D16 三层模型；
- 存储仍在渲染层 localStorage，拍板 #1（Renderer↔Host 方案）后随 Host 持久化迁移；
- 无历史快照与回退（版本仅递增整数标识）；
- 工作流模板的导入导出未覆盖（FR-14 中"工作流模板"部分留给工作流编辑器后续任务）。
