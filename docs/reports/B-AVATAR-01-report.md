# B-AVATAR-01 · Grok Ball 头像（灵动感 + 眼睛跟随 + 多形体）

- 任务：B-AVATAR-01
- 板块：B / Destinyian
- 分支：`feature/desktop-avatar-ball`（独立 worktree）
- 基线：`origin/develop` @ `0c4a9dd`（开工前 fetch 记录）
- 实现提交：`1a664c2`
- 状态：DONE（待 Integrator 代开草稿 PR / 负责人自审确认）

## 概述

在 `apps/desktop` 桌面壳内新增可复用的 **GrokBall** 头像组件，替换原先静态的 minimal 头像系统。
基于开源 grok-ball 的观感自研几何轮廓，未复制任何官方导出图 / 商标素材。组件为纯 SVG + `requestAnimationFrame`，无外部依赖、无 WebGL。

设计文档：`docs/superpowers/specs/2026-10-25-grok-ball-avatar-design.md`

## 必须项对照

| # | 要求 | 实现 | 位置 |
|---|------|------|------|
| 1 | 轮廓采样 + 双眼球面投影（背面藏眼） | `sampleContour()` 采样轮廓；`projectEye()` 将球面眼位绕 Y/X 轴旋转后正交投影，`z<0` 时置 `opacity=0` 隐藏；`<clipPath>` 保证不穿模 | `grok-ball-model.ts` / `grok-ball.tsx` |
| 2 | gazeX/Y∈[-1,1]，60–120ms 阻尼跟随 | 指数平滑，时间常数 `GAZE_TIME_CONSTANT_MS=105ms`，鼠标相对组件中心归一到 [-1,1] | `grok-ball.tsx` |
| 3 | 闲置扫视 + 呼吸缩放（~1–2%，3–4s） | 静止 >2.4s 后每 1.8–5s 触发随机扫视；呼吸 `1 + sin(t/3.6s·2π)·0.014`（1.4%，3.6s） | `grok-ball.tsx` |
| 4 | 眨眼弹簧（2–6s 随机） | 位置-速度弹簧（stiffness 180 / damping 22），下次眨眼 `2000 + rand·4000 ms` | `grok-ball.tsx` |
| 5 | 状态机 Idle/Thinking/Working/Waiting/Blocked/Done | `GrokBallState` + `GROK_BALL_STATE_FRAMES`；`state` prop 可对接 emotionId | `grok-ball-model.ts` |
| 6 | 表情切换眼环关键帧逐点插值（200–350ms），禁硬切 | 每状态眼环为 8 点关键帧，`interpolateStateFrame` 逐点线性插值，`MORPH_MS=260ms` | `grok-ball-model.ts` / `grok-ball.tsx` |

状态观感：Thinking 有环绕轨道（虚线环 + dashOffset 流动）、Done 有短促扩散 burst、Blocked 红色眼环、Waiting 大眼、Working 聚焦。

## 形体集合（共 15 款，全部自研轮廓）

基础集（对齐官方/API 常见子集）：
`circle` · `blob` · `pebble` · `bean` · `egg` · `squircle` · `capsule` · `hex` · `cloud`

本次补卡新增（6 款）：

| shape id | 轮廓来源 | 说明 |
|----------|----------|------|
| `soft-diamond` | 超椭圆指数 2.4 旋转 45° | 比 hex 更软的圆角菱形 |
| `droplet-tilt` | 10 点水滴 + 整体旋转 16° | 微倾水滴，比 teardrop 更动态 |
| `pill-wave` | 12 点胶囊，下缘两处波谷 | 一侧轻微波浪凹凸 |
| `moon-slice` | 12 点厚月牙（上凹下厚） | 缺圆，正面下缘足够贴双眼（eyeY=60） |
| `petal` | 半径 3 次谐波调制（40+7·cos3θ） | 三瓣花瓣合成的椭圆体 |
| `soft-triangle` | 半径 3 次谐波 + 横向拉伸 | 超圆角三角（盾形更钝） |

切换 shape 时双眼仍走同一 `projectEye` 投影与同一状态机，眼环关键帧不变。

## 变更文件

- 新增 `apps/desktop/src/renderer/src/features/avatars/grok-ball-model.ts`（纯几何/状态，可单测）
- 新增 `apps/desktop/src/renderer/src/features/avatars/grok-ball.tsx`（渲染 + 动画）
- 改 `avatar.tsx`（渲染器改为 GrokBall：mono→circle 黑白，grok→shape/color/state）
- 改 `avatar-meta.ts`（Avatar 联合类型 `mono | grok`，`avatarColor`/`defaultAvatarFor`/`avatarKey`）
- 改 `avatar-picker.tsx`（形状网格用 GROK_BALL_SHAPE_IDS，颜色网格 12 色 + 黑白）
- 改 `App.tsx`（默认头像 grok/blob/蓝；拖拽幽灵适配 grok/mono）
- 改 `styles.css`（`.grok-ball` 基础样式）
- 删 `avatar-minimal.ts`（被 grok-ball-model 取代）
- 新增 `apps/desktop/tests/features/grok-ball-model.test.ts`（12 例）

## 验证证据

- `pnpm typecheck` → 0（6 包全绿）
- `pnpm lint` → 0
- `pnpm --filter @deepseek-bot/desktop test` → 132 passed（含 grok-ball-model 12 例：轮廓采样/闭合路径/眼投影背面剔除/颜色与关键帧插值/状态帧点数一致）
- `pnpm --filter @deepseek-bot/desktop build` → 0（167 modules）
- 运行时截图 `docs/reports/B-AVATAR-01-shapes.png`：15 形状网格 + 12 色 + 黑白；预览 blob 竖眼、侧栏 bot 小尺寸投影正常，无穿模。

## 已知限制 / 后续

- 状态机 prop（`state`）已就绪，但**尚未接入 Agent 运行状态**；emotionId→GrokBallState 的接线属 D12 运行时集成范围，本任务仅提供对接点。
- 眼珠为投影竖眼（对齐用户所选观感），未做瞳孔高光；如需可后续加。
- 黑白（mono）随主题反转由 CSS 变量 `--avatar-mono-bg/-eye` 驱动，浅色黑球、深色白球。

## 自审记录（AI 执行，需真人确认）

- 已核对：15 形状 id 与 `GROK_BALL_SHAPES` 键一致（单测断言）；投影/插值/背面剔除有单测覆盖；typecheck/lint/test/build 均通过并记录退出码。
- 未验证：真人在应用内手动切换 6 状态与全部形状的观感确认；未接 Agent 状态。
- 结论：代码层面 ACCEPT 项达成；**请 Destinyian 本人审阅并确认自审，AI 记录不冒充真人身份。**
