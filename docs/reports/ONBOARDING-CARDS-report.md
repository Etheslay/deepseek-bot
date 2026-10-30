# 新建 bot 意图选择卡 + 卡片回答后变暗（对标学习）报告

分支：`feature/onboarding-cards` · 目标 `develop` · 无契约变化 · 基线 `origin/develop` = `9d3ac5b`（PR #160）

## 1. 做了什么（对标 Grok Bot 截图反馈）

| 项 | 内容 |
| --- | --- |
| 按名字出意图卡 | 新模块 `features/bots/onboarding.ts`：`onboardingCardFor(name, language)`——名字关键词（设计/写/码/审/翻/学/管/数/画/剪/音/计 12 族，zh+英词干、大小写不敏感）推导 2-3 个具体方向，固定追加「先随便聊聊再定」「我自己说」，尾行「其他」自由说明；无命中时落三件通用方向。开场白按语言出亲切问候（「嗨，我是 {name}。你建我就是为了让事情更好办……」）。**本地确定性推导，不调模型、零成本** |
| 接入 | `App.tsx` `welcomeThread` 重写：种子消息从两条改一条——问候语 + 选择卡（选项即推导结果）挂同一气泡，与对标一致；语言切换即时生效（按 `currentLanguage()` 取标签） |
| 卡片回答后变暗 | `choice-answer.ts` 新增纯函数 `findPendingChoiceCard`（最新一张可答种子卡）；composer 自由文字发送时若存在待答卡 → `onAnswerSeedCard` 以该文字标记已答 → 卡片折叠为 ✓ 已答行、不再纠缠（既有 ChoiceCard 折叠/锁定行为），回复本身照常走正常回合 |
| 清理 | 旧固定选项的 6 个孤儿 i18n 键移除（welcomeMessage/welcomeChoicesHint/choicesQuestion/choiceDeepThinking/choiceDraftWorkflow/choiceRunMonitor）；新文案在模块内双语数据（`i18n-ignore` 逐行标注，扫描过） |
| 不变 | 已答卡重启丢失仍是会话内存态（等待拍板 #1 的既有边界）；点击「其他」→ 输入框直接回答的既有路由不动 |

## 2. 验证证据

环境：Windows 11 x64 · Node 24.16.0 · pnpm 11.28.5 · 基线 `origin/develop` = `9d3ac5b`

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 新用例 | `vitest run tests/features/onboarding.test.ts` | 7/7：designer 名字 → 设计方向 + id 序列 A-D；英文名词干匹配 + en 文案；无命中回退通用三件；多族命中封顶 5 项且「我自己说」恒在末位；待答卡查找/自由文字变暗/answered 后不再可答 |
| i18n 扫描 | `vitest run tests/i18n-scan.test.ts` | 3/3（双语数据逐行 i18n-ignore 标注；孤儿键清理后无未用键告警面） |
| desktop 全量 | `pnpm --filter @deepseek-bot/desktop test` | 75 文件 / 661 用例全过 |
| 静态 | `pnpm typecheck`；`pnpm lint` | 10 包 tsc 全过；eslint 0 问题 |

## 3. 未验证（明确列出）

- **真机 Electron 未跑**：卡片观感（对比截图的 A–F 排版）、名字关键词在真实命名下的命中率、语言切换即时性无截图；推导为纯函数 + 组件复用既有 ChoiceCard（其行为已有测试）。
- 关键词表是 v1 版本（12 族）：真实使用中命不中的名字类型（如「 research assistant 2 号」以外的复合名）可后续扩表，不动结构。

## 4. 风险与回退

- 纯渲染层 + localStorage 无关（种子卡是会话内存态）：无迁移、无契约变化、无权限面变化。
- 种子卡在线程打开时展示、真实历史行到位后被替换（既有行为）——onboarding 卡因此只对"还没有真实对话"的新 bot 出现，不会重复打扰。
- 回退：`git revert -m 1 <merge-sha>`。

## 5. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
- 自审结论：＿＿＿＿
