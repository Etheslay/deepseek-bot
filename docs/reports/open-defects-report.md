# 开放缺陷收口报告（open-defects）

- 任务书：`docs/TASK_OPEN_DEFECTS.md`（PR #200）
- 基线：`origin/develop` = `030c54db0253eac4742c06bddf00785838c38139`（PR #199）
- 分支：`fix/open-defects`
- 实现提交：`070e090`（§5 台账）、`d687f2b`（§2.2 flash 窗口）、`74acde9`（§2.3 会话子列表）
- 执行：AI 会话辅助；负责人自审未做，文末留空

## 已交付

### §5 台账修正（`070e090`）

- `docs/TASK_G12_MULTI_SESSION.md`：契约节 v0.12 → **v0.14**、迁移 0024 → **0026-chat-sessions**（0025 已被 attachment-parses 占用）；文首加勘误段说明集成时的真实版本；「四个语义决定」按任务书保持原样
- `README.md`「当前阶段」：D16 里程碑句改为指向 `docs/GAP_AUDIT.md` 与 `docs/SPRINTS.md` §4 的现状句（运行时与桌面已集成到协议 v0.14，发布验收未完成）
- `docs/SPRINTS.md` §4 末行：侧栏闪烁修复「本 PR」→ **已合入 PR #199（SHA `030c54d`）**

### §2.2 deepseek-flash 上下文窗口（`d687f2b`）

- **供应商文档原句**（api-docs.deepseek.com/quick_start/pricing 的 Models & Pricing 页，2026-11-01 查阅）：deepseek-flash 与 deepseek-v4-pro 共用一行 **"CONTEXT LENGTH 1M"**（MAXIMUM: 384K）；模型名列作 `deepseek-flash(1)`，脚注说明 legacy 名 deepseek-v4-flash(-vision-exp) 已退役、由 DeepSeek-V4.1-Flash-1017 服务
- 据此 `MODEL_CONTEXT_WINDOWS` 新增 `"deepseek-flash": 1_000_000`，注释写明来源与查阅日期
- 测试：`context-window.test.ts` 新增「flash 已登记 1M、不再走 65,536 回落」的断言；既有的逐模型循环断言自动覆盖新条目
- 观察项（未改代码）：当前定价页已不列 `deepseek-chat` / `deepseek-reasoner`；二者的 128K 条目保留 V3.1 release note 引用。若供应商后续给出独立条目，另行更新

### §2.3 会话子列表（`74acde9`）

- 纯函数 `planSessionSublistRefresh(previousBotKey, nextBotKey)`（`apps/desktop/src/renderer/src/features/chat/session-sublist.ts`）：同 key → `refresh-in-place`（保留现有列表，请求返回后替换；**失败保持原列表**，不覆盖成空数组），换 key → `clear-then-load`（先清空再拉，失败保持空态）；首次挂载按 clear、取消选择按 clear
- `App.tsx` 会话加载 effect 以 ref 记录上次加载的 bot key，按计划执行；依赖仍为 `[selectedBot, bots, desktop]`
- 测试：`apps/desktop/tests/features/session-sublist.test.ts` 五条（同 key 保留、换 key 清空、首载清空、空选择保留、取消选择清空）；`use-bots-stability` 两条回归通过（PR #199 的 useMemo 未动）

## §2.1 视觉标志拆分——**阻塞**

负责人尚未在甲 / 乙 / 丙中选择，按任务书 §7.3 未动代码。选项照录：**甲** = 目录外仍附图像块交上游门控并改中性提示；**乙** = 维持不附但拆开两个标志，且先改 CONTRACTS / TASK_B3P 措辞；**丙** = 维持现状只改文档。负责人把选择写入 PR 后，再按 §2.1 的验收（三个模型名三行互不相同的断言、提示文案与方案一致）补实现。

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过（无输出） |
| `pnpm typecheck` | 全部 10 包通过 |
| `pnpm test`（递归，排除 exec-daemon） | shared 1/1、harness-bridge 2/2、contracts 16/16、agent-tools 15/15、storage 28/28、runtime 15/15、**desktop 80/80（含 session-sublist 5 用例）**、harness-adapter 10/10、host 46 文件 330 通过 + 1 跳过 + 1 失败 |
| `pnpm --dir packages/exec-daemon run test`（单独跑） | 32 通过 + 7 跳过；ocr 套件与 windows.real 各 1 个失败 |

环境失败说明（与本分支无关，干净 develop 同样失败，有独立探针复现）：本机安全软件拦 esbuild 向 `%TEMP%` 写 `worker.cjs`（host 的 screen-distribution、exec-daemon 的 ocr 套件）；`windows.real` 为 PowerShell 授权失败。因此根级 `pnpm test` 递归跑时先排除 exec-daemon，再单独跑它留档——这是执行顺序说明，不是对本分支失败的掩盖。

## 未跑 / 未验证

- 真机手册 A–F 全部未执行（验收债，按任务书不算缺陷、不改代码）；D13 性能预算与 D23 平台验收仍排其后
- §2.1 的三个方案均未实现（阻塞中，等负责人选择）
- §2.3 的真机点击复核（切换 bot 清空、同 bot 不闪、失败保留）未做——本任务按验收要求只交纯函数与回归测试

## 负责人自审（留空待填）

- 自审人 / 日期：
- 最新提交 SHA 与差异检查结论：
- 测试证据核对：
- 遗留问题与结论：
