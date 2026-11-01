# 开放缺陷收口报告（open-defects）

- 任务书：`docs/TASK_OPEN_DEFECTS.md`（PR #200）
- 基线：`origin/develop` = `030c54db0253eac4742c06bddf00785838c38139`（PR #199）
- 分支：`fix/open-defects`
- 实现提交：`070e090`（§5 台账）、`d687f2b`（§2.2 flash 窗口）、`74acde9`（§2.3 会话子列表）、`8a82684`（§2.1 方案乙）、`4207e36`（flash 档案种子与选择器）、`f8ccb1a`（i18n 守卫修正 + 乙方案文案合入）
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
- 观察项（未改代码）：当前定价页已不列 `deepseek-chat` / `deepseek-reasoner`；二者的 128K 条目保留 V3.1 release note 引用

### §2.3 会话子列表（`74acde9`）

- 纯函数 `planSessionSublistRefresh(previousBotKey, nextBotKey)`（`apps/desktop/src/renderer/src/features/chat/session-sublist.ts`）：同 key → `refresh-in-place`（保留现有列表，请求返回后替换；**失败保持原列表**，不覆盖成空数组），换 key → `clear-then-load`（先清空再拉）；首次挂载按 clear、取消选择按 clear
- `App.tsx` 会话加载 effect 以 ref 记录上次加载的 bot key，按计划执行；依赖仍为 `[selectedBot, bots, desktop]`
- 测试：`apps/desktop/tests/features/session-sublist.test.ts` 五条（同 key 保留、换 key 清空、首载清空、空选择保留、取消选择清空）；`use-bots-stability` 两条回归通过（PR #199 的 useMemo 未动）

### §2.1 视觉标志拆分——已按**方案乙**落地（`8a82684` + `4207e36` + `f8ccb1a`）

- **决策记录**：任务书要求负责人在甲/乙/丙中选择。负责人答复「我看不懂，给个最优」，将选择委托给执行；执行者选**乙**并说明理由——默认模型（chat/reasoner）本就是纯文本，甲会让默认模型发图也走上游占位（白花 token 且看不到图）、丙不修「两标志恒等」这个缺陷本身；乙以最小改动诚实区分「目录内纯文本（无法看图）」与「目录外（未登记）」，负责人可随时否决改走甲
- **文档先行**（任务书对乙的前置要求）：`docs/CONTRACTS.md` v0.14 视觉段与 `docs/TASK_B3P_VISION_INPUT.md` 第二步改为「本地 pinned 目录是图像块准入，不是上游权威声明」，并写明三种情形的行为
- **`visionCapabilityFor` 三行互异**：`deepseek-flash` → `visionKnown=true, visionAvailable=true`；`deepseek-chat` / `deepseek-reasoner`（目录内纯文本）→ `visionKnown=true, visionAvailable=false`；目录外假模型名 → `visionKnown=false, visionAvailable=false`。`vision.status` 响应字段与形状不变，未升协议版本
- **`composeAttachmentBlocks` 三种文案**（`attachments.test.ts` 三条对应用例）：ride-along（图像块随回合发出）/ text-only（「无法看图」）/ unregistered（「未登记视觉能力，本次不附图像块；需要看图可将模型切换为 deepseek-flash」）
- **可识图可达性（负责人需求「我需要能看见图」）**：Host `seedDefaults` 新增第三个内置档案 `FLASH_MODEL_PROFILE_ID`（`deepseek-flash`，INSERT OR IGNORE 共用默认凭据，无迁移、无结构变更）；桌面 bot 表单模型选择器加入 reasoner 与 flash（UUID 跨进程镜像，模式同 reasoner 行）。Host 种子测试钉住三行与幂等总数 3
- i18n 守卫（D22 双语回归）要求 UI 文案走双语目录：flash 选择器标签改用 ASCII 后缀 `(vision)`；模型提示文案保持「i18n-ignore（模型上下文而非界面文案）」既有约定，ignore 标记紧贴模板行

## 验证记录（最终 HEAD `f8ccb1a`）

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过（无输出） |
| `pnpm typecheck` | 全部 10 包通过 |
| `pnpm test`（递归，排除 exec-daemon） | shared 1/1、harness-bridge 2/2、contracts 16/16、agent-tools 15/15、storage 28/28、runtime 15/15、**desktop 80/80（721 用例，含 session-sublist 5、attachments 视觉三态、use-bots-stability 2）**、harness-adapter 10/10、host 46 文件 45 通过（330 用例 + 1 跳过）+ 1 失败 |
| `pnpm --dir packages/exec-daemon run test`（单独跑） | 32 通过 + 7 跳过；ocr 套件与 windows.real 各 1 个失败 |

环境失败说明（与本分支无关，干净 develop 同样失败，有独立探针复现）：本机安全软件拦 esbuild 向 `%TEMP%` 写 `worker.cjs`（host 的 screen-distribution、exec-daemon 的 ocr 套件）；`windows.real` 为 PowerShell 授权失败。因此根级递归先排除 exec-daemon，再单独跑它留档——执行顺序说明，不是掩盖。

## 未跑 / 未验证

- 真机手册 A–F 全部未执行（验收债，按任务书不算缺陷、不改代码）；D13 性能预算与 D23 平台验收仍排其后
- **E4 真实看图往返仍未执行**（需真机 Key 做一次视觉往返，成本见 TASK_B3P ③）——本分支不把它写成已通过
- §2.1 的 UI 行为（flash 选中后的图像卡、text-only/未登记两种提示）未做真机点击复核
- §2.3 的真机点击复核（切换 bot 清空、同 bot 不闪、失败保留）未做

## 负责人自审（留空待填）

- 自审人 / 日期：
- 最新提交 SHA 与差异检查结论：
- 测试证据核对：
- 遗留问题与结论：
