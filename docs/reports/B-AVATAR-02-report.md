# B-AVATAR-02 · Grok Ball 头像：纯色身体 + 编译式立体身形

- 任务：B-AVATAR-02（B-AVATAR-01 的后续）
- 板块：B / Owner
- 分支：`feature/gaze-avatar`（Owner 指示直接在本分支继续）
- 基线：本分支 `7a2ce5c`（含 `102f85d wip(desktop): pointer-following gaze avatars`）；**不是** `origin/develop`
- 实现提交：`1538b58`（契约）· `2533f84`（渲染与几何）· `bf88286`（参考声明）
- 状态：实现完成、质量门禁通过；**待 Owner 自审确认**

## 0. 基线偏差（须先知晓）

`feature/gaze-avatar` 无 upstream，且由 Owner 指示在本分支继续，因此本任务的基线是本分支已提交的 WIP 提交，不是 `origin/develop`。推送时 `git rev-list --left-right --count origin/develop...HEAD` = **6 behind / 5 ahead**：`origin/develop` 期间前进了 6 个提交（到 `7de305b`），本分支**未同步**。按 GIT_WORKFLOW，是否同步由负责人决定，执行 Bot 不自行 merge。

## 1. 概述

本轮把头像的渲染路线整体改写：身体回到**单层纯色**，体积改为**只由几何承担**——轮廓是旋成体在当前 yaw 下的真实投影，每帧重算；身形改为**隐式图元编译生成**（圆角是显式参数）；眼睛改为**贴在身体柱面上的贴片**；idle 从"一直摆动"改成"几乎静止 + 偶发特技"；配色换成参考产品的主题成对色。

参考了社区对某商业桌面角色的公开研究仓库（`github.com/blessonism/grok-icon-study`）**的实现思路**。该仓库无 LICENSE 且其几何数据自述由应用包抽取，因此未复制任何代码、path 数据、眼形表、配色数组或图标；详见 `docs/THIRD_PARTY_NOTICES.md`。

## 2. 本轮要求对照

| # | Owner 要求 | 实现 | 位置 |
|---|-----------|------|------|
| 1 | 伪 3D、转身不是平面饼 | 轮廓由 `projectSilhouette()` 从实体投影得到，随 yaw/pitch 每帧重算；非球体身形转身时轮廓真实改变 | `grok-ball-3d.ts` |
| 2 | 有真实的构造立体几何 | 每个身形 loft 成闭合实体（赤道＝2D 轮廓，双极收束）；背面按法线剔除 | `grok-ball-3d.ts` |
| 3 | 要纯色，不要"加暗色" | 身体为**一条路径一个颜色**；删除逐面平涂（同心环带）、渐变、高光叠加 | `grok-ball.tsx` |
| 4 | 圆角、不要方角、稍微减尖度 | 身形由隐式图元编译，`swept()` 的圆盘半径即圆角半径 → 构造上不可能出现方角/尖针 | `grok-ball-model.ts` |
| 5 | 不要倒三角 | `wedge`/`triangle` 均为**顶点朝上**的圆角体；断言"上窄下宽" | `grok-ball-model.test.ts` |
| 6 | 身形学参考那套 | 改为圆滑基础体家族：blob / squircle / cylinder / hex / gem / crystal / shield / arch / cloud / leaf / heart | `grok-ball-model.ts` |
| 7 | 删掉第 2,3,4,6,7,12,14,17 个图形 | 删除 pebble / bean / egg / tablet / capsule / wedge / dome / teardrop；其中 `egg`、`capsule` 是旧契约 id，改为**下架但保持可渲染** | `grok-ball-model.ts` |
| 8 | 配色也学参考 | 取参考的 10 组色对（light/dark），`data-tone` + CSS 变量按主题解析 | `grok-ball-model.ts` / `styles.css` |
| 9 | 跟随也学参考 | 指针映射到椭圆（横向权限 1.57×纵向）+ 距离 sqrt 压缩；gaze 用临界阻尼弹簧（freq 13 / damp 1）；眼睛常驻微抖 | `grok-ball.tsx` |
| 10 | 不要老摇来摇去 | idle 视线目标恒为 0，只保留 ±1.1°+0.45° 双正弦慢摆、亚像素漂移、0.9% 呼吸 | `grok-ball.tsx` |
| 11 | 没事时会蹦跶 | 偶发特技：首次 2.5–5 s，之后 9–18 s 一次；转一圈后落地衰减弹跳（4 段，44→23→10→4） | `grok-ball.tsx` |

## 3. 两个真实 bug（本轮根因）

1. **透视符号反向**：`f = P/(P + z)` 使靠近镜头的一侧**缩小**，球体读起来是凹的，且转动时轮廓尺寸漂移。改为 `P/(P − z)`，并把相机距离拉远到 6（伪 3D 观感由轮廓与眼睛承担，不靠强透视）。
2. **把支撑函数当半径**：轮廓一度先最大化 `p·û`（支撑函数＝切线距离）再当极径输出。该等式只对圆成立，结果方形/柱形身形在对角线上鼓包、在边上塌陷（"花生腰"）。改为**密集采样壳面（128×16）→ 按角度分桶取最远投影点 → 一阶平滑**。

## 4. 身形：隐式图元编译器

- 词汇表：`disc` / `swept`（折线被圆盘扫掠）/ `weld`（平滑并，去折痕）/ `carve`（平滑交，倒圆角），用射线二分求 r(θ)。
- 编译期把轮廓尺寸归一化进 50 px 盘子（`outline()` 的 `fit`），避免 `weld` 的外鼓把身形顶出槽位。
- **bean 的教训**：用"圆盘减圆盘"咬缺口时，咬盘会被同一条射线穿两次，r(θ) 变成多值、二分静默返回内交点（尺寸凭空缩水 + 尖崖）。凡凹形必须直接写成 r(θ) 的极坐标凹口。

## 5. 眼睛与跟随

- 眼睛按**身体自身柱面**贴合：以当前轮廓在该纬度上的半宽为半径，`asin` 求角后随 yaw 转动；前缩、越过边缘淡出（smoothstep）、并逐顶点夹在实时轮廓内。
- 转整圈时眼睛会在背面各消失约半圈——**这是参考产品的行为**（其 `bre = cos(角) > 0.02` 即隐藏），不是缺陷。
- 跟随：椭圆映射 + sqrt 距离压缩 + 临界阻尼弹簧；指针驱动时状态视线权重降低，避免与跟随打架。

## 6. 运动

- idle：视线目标 (0,0)；`spin = sin(0.42t)·1.1° + sin(0.13t)·0.45°`，位移 < 1 px，呼吸 0.9%。
- ±14°/±8° 的转头权限只给指针跟随与 thinking / working；每状态的视线窗口与眨眼窗口独立配置。
- 特技：`spin`（smoothstep 转满 360°，随后落地弹）/ `hop`（直接弹）；`prefers-reduced-motion` 或指针驱动时不触发。

## 7. 配色

- `GROK_BALL_TONES` 提供 10 组 light/dark；**持久化值仍是 light hex**（契约枚举不变），`toneKeyFor()` 反查色对，SVG 根节点挂 `data-tone`，CSS 按主题给出 `--gb-body`。
- 色板按钮同样挂 `data-tone`，选色片与球身显示同一颜色。
- 不在色板内的 hex（含全部 `AVATAR_COLORS_RETIRED`）无 tone，`var()` 回落为自身，两主题一致。
- 新增守卫测试：读 `styles.css` 断言每个 tone 的暗/亮值与 `GROK_BALL_TONES` 完全一致，防止 CSS 与 TS 漂移。

## 8. 契约变更（需负责人自审）

| 项 | 变更 |
|----|------|
| `AVATAR_SHAPES` | 换成 11 款编译体；旧 id 全部进入 `AVATAR_SHAPE_IDS_RETIRED` |
| `AVATAR_COLORS` | 换成 10 个新色值；旧值全部进入 `AVATAR_COLORS_RETIRED` |
| `AvatarSchema` | `shape` / `color` 均接受「新集 ∪ 旧集」，**已存数据不会失效** |
| `canonicalAvatarPool()` | 组合数 140 → 110（11×10） |
| `agent-tools` | `create_bot_draft` 不再重复枚举，直接复用 `AvatarSchema`（该副本此前已与契约漂移） |

语义影响：批量建号的可分配组合变少、外观集合整体替换。属契约语义变更，需负责人确认后再合并。

## 9. 验证证据

环境：Windows 11（NT 10.0.26200）· Node v24.16.0 · pnpm 11.28.5

| 检查 | 命令 | 结果 |
|------|------|------|
| typecheck | `pnpm run typecheck`（仓库根） | exit 0 |
| lint | `pnpm run lint` | exit 0 |
| 全仓测试 | `pnpm -r --if-present run test` | exit 0 |
| 头像特性测试 | `pnpm exec vitest run --config vitest.config.ts tests/features/` | 18 文件 / **147 passed** |

观察到的分包用例数（同一次全仓运行）：desktop **231**、storage **147**、runtime **128**、contracts **86**、agent-tools **69**、host **77 + 1 skipped**、harness-bridge **15**、harness-adapter **58**、shared **6**。

运行时取证：`pnpm exec electron` 在本机无法启动（`STATUS_INVALID_IMAGE_HASH`），改用无头 Edge 对生成页截图复核每个身形的 −18°…+18° 转头与 26/40 px 实机尺寸；线框层同屏对照，用于确认轮廓来自真实体。取证页 `handoff/grok_ball_v2_sheet.html` 属一次性产物（`handoff/` 已 gitignore），生成脚本为临时工具、未入库。

## 10. 变更文件

- 改 `apps/desktop/src/renderer/src/features/avatars/grok-ball-model.ts`：图元编译器、11 款身形 + 8 个保留 id、主题色对、眼环尺寸
- 改 `apps/desktop/src/renderer/src/features/avatars/grok-ball-3d.ts`：loft 实体、密集云轮廓、背面剔除、透视修正、`spanAtY`
- 改 `apps/desktop/src/renderer/src/features/avatars/grok-ball.tsx`：纯色单路径、柱面眼贴合、弹簧跟随、idle 克制、特技、`data-tone`
- 改 `apps/desktop/src/renderer/src/features/avatars/avatar-picker.tsx`：色板按钮挂 `data-tone`
- 改 `apps/desktop/src/renderer/src/styles.css`：`--gb-body-*` 主题变量与 `[data-tone]` 规则（仅追加本段；同文件另有 Owner 并行改动静止在工作区，未纳入提交）
- 改 `apps/desktop/tests/features/grok-ball-{model,3d,solid}.test.ts`
- 改 `packages/contracts/src/entities.ts`、`packages/agent-tools/src/write-tools.ts`
- 改 `docs/THIRD_PARTY_NOTICES.md`

## 11. 未验证 / 已知限制

- **未做真人观感确认**：本 Bot 只能通过无头截图复核，未在真实应用窗口内逐身形、逐状态确认。
- **未在提交后的纯净 HEAD 上重跑测试**：验证时工作区含 Owner 并行编辑的 `App.tsx` / `avatar-meta.ts` / `mentions.ts` / 部分 `styles.css`。这三处与头像测试无引用关系，但严格意义上"HEAD 单独通过"未取证。
- 暗色主题色对只做了变量与规则级断言，未截图确认实际渲染差异。
- 未同步 `origin/develop`（落后 6 个提交），见 §0。
- 未建 PR（本机无 `gh`），描述见 §13。

## 12. 回退

单提交回退即可，无数据迁移、无依赖变更：
`git revert --no-commit bf88286 2533f84 1538b58` 后重新验证。
旧身形与新身形在代码层共存（旧 id 仍可渲染），因此回退不会造成历史头像无法显示。

## 13. PR 描述（目标 `develop`）

**Title**：feat(desktop): rebuild grok-ball avatars on compiled solid bodies

**Summary**：头像回到单层纯色；体积改由实体投影承担；身形由隐式图元编译生成（圆角显式、无方角尖针）；眼睛贴合身体柱面并被实时轮廓夹住；idle 改为几乎静止 + 9–18 s 一次的偶发特技；配色改为主题成对；契约色板与身形池同步替换并保留下架 id 的兼容。

**Test plan**：`pnpm run typecheck` / `pnpm run lint` / `pnpm -r --if-present run test` 全绿；`tests/features/` 147 passed；无头截图逐身形复核。

**Risk**：契约语义变更（可分配组合 140 → 110）；已存数据由 `*_RETIRED` 兼容，不失效。

**Rollback**：revert 三个提交。

## 14. 自审记录（模板 · 须由负责人本人填写）

- 提交 SHA：
- 自审覆盖范围（代码 / 测试 / 错误路径 / 兼容性）：
- 检查命令与关键输出：
- 契约变更确认：
- 结论（PASS / PASS-WITH-FIXES / FAIL）：
- 负责人签字与日期：

> AI 不填写本节，也不代表负责人结论。
