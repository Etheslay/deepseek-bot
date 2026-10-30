# 界面状态契约候选报告（拍板 #1 的前置件）

分支：`feature/ui-state-contract` · 目标 `develop` · **契约候选，未接任何 Host 方法 / 未改 IPC 协议版本** · 基线 `origin/develop` = `5248ab6`

## 1. 问题

GAP_AUDIT §2 的 P0 缺口 G1'：契约里没有任何 `ui.*` 方法，`packages/contracts/src/methods.ts` 与 `packages/host/src` 对 `ui.*` 零命中。结果是侧栏机器人/分组排列、当前选中项、界面偏好只活在渲染层内存里，重启即失。SPRINTS §8 拍板 #1（Renderer↔Host 接线方案）仍未记录，B 方案下 `ui.*` 命名空间的方法清单需要负责人先确认——本片只交付清单之前必须先有的**数据结构与校验边界**，不把它当作拍板结论。

## 2. 做了什么

| 位置 | 内容 |
| --- | --- |
| `packages/contracts/src/ui-state.ts` | 新增 `UiStateSchema`（zod，`.strict()`）：`botOrder` / `groupOrder` 为去重 UUID 数组、各最多 1000 项；`selectedBotId` / `selectedGroupId` 为 UUID 或 `null`；导出 `type UiState = z.infer<typeof UiStateSchema>`。不接受的输入：任意额外字段（含 `apiKey` 之类凭据字段）、非 UUID 文本、重复 ID、超过上限的列表 |
| `packages/contracts/src/index.ts` | 追加 `export * from "./ui-state.js";`（公开导出面） |
| `packages/contracts/src/ui-state.test.ts` | 4 组用例：合法快照与空选择；拒绝额外键（含凭据字段）；拒绝非法 ID 与重复项；拒绝超过 1000 项 |
| `docs/RENDERER_HOST_MAPPING.md` | 新增 §5「界面状态契约候选（待负责人确认）」：说明形状与边界、**只定义类型与验证、不开放 Host 方法、不改 IPC 协议版本**；并记录关键前提——现有桌面分组使用会话内数字 key，不能当持久 UUID 用，接线前须核实真实分组实体、创建/移动行为与标识映射，以及空分组/不存在实体的恢复策略 |

**不做的部分（明确边界）**：没有新增 `ui.state.get/set` 方法、没有改动 `packages/contracts/src/methods.ts`、没有碰 `packages/host`、没有改渲染层、没有改存储 schema。因此本片合入后界面持久化行为不变，仍是 G1' 的开放缺口。

## 3. 验证证据

环境：Windows 11 x64 · Node 24 · 基线 `origin/develop` = `5248ab6`

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 契约测试 | `pnpm --filter @deepseek-bot/contracts test` | 全绿（含新增 4 例）；`ui-state.ts` 行覆盖 100% |
| 静态 | `pnpm --filter @deepseek-bot/contracts run typecheck` | tsc 通过 |
| 导出面 | 测试从 `./index.js` 导入 `UiStateSchema` | 通过，证明公开导出可见 |

## 4. 未验证（明确列出）

- **未与拍板 #1 对齐**：`ui.*` 方法清单、存储位置（Harness 会话目录 vs Host 自有库）、防抖写策略均未定；本片不含任何 Host 侧实现，无法端到端验证「重启后状态恢复」。
- **分组 UUID 真实性未核实**：现有分组是会话内数字 key，是否先做实体映射、空分组如何表示，仍未在代码里确认。
- 真实桌面端未运行（本片不触桌面代码）；无截图。

## 5. 风险与回退

- 本片是纯新增类型 + 导出，无运行时行为改变；风险主要是「先定形状后改动」的返工成本——若负责人最终选 A/C/D 方案，`ui-state.ts` 可整文件删除。
- 回退：`git revert -m 1 <merge-sha>`；无迁移、无数据影响。

## 6. 负责人自审记录（待负责人填写，AI 不代签）

- 已审提交 SHA / 日期：＿＿＿＿
- 差异、需求和错误路径检查结果：＿＿＿＿
- 测试证据 / 兼容性与权限影响：＿＿＿＿
- 遗留问题与处理方式：＿＿＿＿
