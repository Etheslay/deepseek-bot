# B-AVATAR-01 · Grok Ball 头像（灵动感 + 眼睛跟随 + 多形体）

- 任务：B-AVATAR-01
- 板块：B / Destinyian
- 分支：`feature/desktop-avatar-ball`（独立 worktree）
- 基线：`origin/develop` @ `0c4a9dd`（开工前 fetch 记录）
- 实现提交：`1a664c2`（球球主体）· `c049d41`（补卡：固定位立牌 + 主题反相）· `32b3432`（R1 有机 soft-blob 立体渲染）
- 状态：R1 返修完成（同分支 `feature/desktop-avatar-ball` / PR #22；待负责人自审确认）

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

> R1.1 起本节的低模轮廓已被替换为 15 款 180 点采样的平滑轮廓（`circle`/`blob`/`pebble`/`cloud`/`egg`/`capsule`/`squircle`/`diamond`/`triangle`/`pentagon`/`hexagon`/`star4`/`star5`/`flower6`/`pumpkin`），以下为历史记录。

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

## 补卡 · 固定位立牌 + 主题反相（c049d41）

### 1) 固定位 bot 立牌（不是飘在聊天的球）
`GrokBall` 增加 `variant` 身份槽位与尺寸预设（`GROK_BALL_SIZES`）：

| variant | 尺寸 | 动画 | 用途 |
|---------|------|------|------|
| `sidebar` | 40 | 动 | 侧栏圆角卡片固定 avatar+名称 |
| `message-header` | 26 | 动 | 消息头小尺寸复用同一图标 |
| `preview` | 96 | 动 | 创建/编辑弹窗预览 |
| `inline` | 26 | **静** | 消息流内头像、选择器缩略图 |

`inline` 为**静态身份字形**（无 RAF / 无全局 mousemove），所以灵动的球只出现在固定槽位（侧栏立牌、消息头、预览），不会“飘在聊天里”，也避免长会话里几十个动画循环的开销。消息头由原 `BlobMark` 改为复用选中 bot 的球图标。

### 2) 亮暗黑白互相反相
`mono`（黑白）球随主题反相：Light=深色身+浅色眼，Dark=浅色身+深色眼。
实现：身体/眼填充改由 CSS 变量 `--avatar-mono-bg` / `--avatar-mono-eye` 驱动（`.gb-mono .gb-body/.gb-eye`），配 `transition: fill 200ms`；切换主题时 200ms 插值，gaze/blink 动画不中断。橙星等强调色（thinking/done aura、彩色 bot）为主题无关，保留不变。

### 3) 与多 shape / 自研形体 / 状态机并存
反相与立牌只作用于 `mono`；15 款自研形体、`GrokBallState` 状态机、眼环逐点插值、投影/阻尼/呼吸/眨眼全部不变。

### 验收截图
- `docs/reports/B-AVATAR-01-light.png`：浅色——预览/侧栏立牌/消息头为黑身白眼；彩色 bot 保持自身色。
- `docs/reports/B-AVATAR-01-dark.png`：深色——`mono` 预览反相为白身黑眼；彩色 bot 不变。

## R1 返修 · 有机 soft-blob 立体渲染（Owner 纠偏）

**问题**：R0 的身体是纯色 `fill`，在选择器里呈扁平贴纸感，没有官方那种有机 soft-blob / 多瓣 / 果冻形体的体积感；眼睛本身已符合要求，保留不动。

**改法**（全部在 SVG 内完成，仍无外部依赖、无 WebGL）：

| 目标 | 实现 |
|------|------|
| 柔和渐变体积 | 身体改为 `radialGradient`（焦点 30%/24%，左上），三档：lit（基色混白 55%）→ base → occluded（基色混黑 34%） |
| 观察角约 45° 左上 | 高光/镜面/边缘光固定在左上，核心阴影落在右下（渐变中心 68,74） |
| 边缘光 | 沿轮廓描边，`linearGradient` 左上白 0.7 → 中段透明，宽 2，clip 在形体内 |
| 镜面高光 | 左上肩椭圆（36,32，12×8.5，-34°），径向渐变 + 高斯模糊 2.6，中心 0.45，避免硬白斑 |
| 接触阴影 | 形体下方椭圆（50,96，27×3.4）+ 模糊，`--gb-contact`，让球"坐"在立牌上而不是悬浮 |
| 形体重做（R1.1） | 全部轮廓改为解析函数 + 180 点采样，旧版 18–36 点低模轮廓被移除（折角/多边形感消除）：`circle`/`blob`/`pebble`/`cloud`/`egg`/`capsule`/`squircle`/`diamond`/`triangle`/`pentagon`/`hexagon`/`star4`/`star5`/`flower6`/`pumpkin`，共 15 款 |
| 多瓣 / 果冻 | `flower6`(6 瓣)、`star4`(4)、`star5`(5)、`pumpkin`(6 瓣 + 褐色小梗) 用余弦半径调制，并加柔和径向褶皱（模糊 2.6，clip 内） |
| 配色随主题 | 调色板 10 色；黑白只保留一个随主题反相的 mono 色块（浅色=黑、深色=白），色块不带眼睛；浅色主题不出白色、深色主题不出黑色 |
| 眼睛颜色 | 浅色主题白眼、深色主题黑眼（`--gb-eye`）；mono 球保持反相 |
| 视线 | 静息视线朝左上约 45°（`RESTING_GAZE`），闲置扫视围绕该方向；鼠标跟随修正 Y 方向，可看正面与斜侧 |
| 亮暗反相 | mono 不再用纯色 `fill`：三档改用 `--gb-mono-hi/mid/shade` 变量（深色主题 白→浅灰，浅色主题 灰→黑），仍随主题切换 |
| 保留 | 眨眼弹簧、状态帧逐点插值、呼吸、固定位立牌（sidebar/message-header/preview 动、inline 静）未动；视线改为静息左上并修正鼠标 Y 方向；眼睛仅加 0.8px 投影 |

**验证**（Windows 11 · Node v24.16.0 · pnpm 11.28.5）：

- `pnpm lint` → exit 0
- `pnpm typecheck` → exit 0（6 包）
- `pnpm --filter @deepseek-bot/desktop test` → **136 passed**（新增 2 例：三档明暗推导、多瓣褶皱元数据；形状总数 15）
- `pnpm --filter @deepseek-bot/desktop build` → exit 0（renderer JS 1062.27 kB / CSS 100.13 kB）
- 运行时取证（生产 bundle + 无头 Chrome 1100×720 @2x，驱动脚本 `handoff/r1-capture.mjs`，不入库）：
  - `B-AVATAR-01-r1-compare.png`：before（纯色扁平）/ after（R1）同主题并排对比
  - `B-AVATAR-01-r1-picker-dark.png`：深色主题选择器（白色 mono 色块、黑眼、无黑色块）
  - `B-AVATAR-01-r1-shapes-zoom.png`：15 形体放大（平滑轮廓 + 渐变 / 边缘光 / 接触阴影）
  - `B-AVATAR-01-r1-picker-light.png` · `-light-mono.png`：浅色主题（黑色 mono 色块、白眼、无白色块）
  - 断言日志 `B-AVATAR-01-r1-capture-log.json`（shapes=15、colors=11、monoClicked=true）

**顺带修复**：`styles.css` 中 D09 注释处的 em dash 被截断为字节 `E2 80 3F`（文件因此不是合法 UTF-8），已还原为 `E2 80 94`；只改字节，未改任何规则。

**未做**：未接 Agent 状态（仍属 D12）；未加瞳孔高光；未改 `packages/contracts`、IPC、preload。

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

R1 返修（`32b3432`）：

- 改 `grok-ball.tsx`：渐变身体、边缘光、右下核心阴影、接触阴影、软化镜面高光、多瓣褶皱、南瓜小梗、静息视线
- 改 `grok-ball-model.ts`：`shadePalette()`、15 款平滑轮廓（180 点采样）、`creases`/`stem` 元数据、主题调色板 10 色
- 改 `avatar-picker.tsx`：mono 色块改为纯色圆（不带眼睛）、按主题显示黑/白、新增 `theme` prop
- 改 `App.tsx`：把 `theme` 传给选择器
- 改 `styles.css`：新增 `--gb-eye`、`--gb-mono-hi/mid/shade`、`--gb-contact`、`--gb-crease`；移除 mono 纯色 fill；修复无效 UTF-8
- 改 `tests/features/grok-ball-model.test.ts`：明暗推导、褶皱元数据、新形体集合
- 新增 `B-AVATAR-01-r1-*.png` 5 张取证图 + `B-AVATAR-01-r1-capture-log.json`

## 验证证据

- `pnpm typecheck` → 0（6 包全绿）
- `pnpm lint` → 0
- `pnpm --filter @deepseek-bot/desktop test` → 134 passed（含 grok-ball-model 14 例：轮廓采样/闭合路径/眼投影背面剔除/颜色与关键帧插值/状态帧点数一致/变体尺寸/静态变体）
- `pnpm --filter @deepseek-bot/desktop build` → 0
- 运行时截图：`B-AVATAR-01-shapes.png`（15 形状网格）、`B-AVATAR-01-light.png` / `B-AVATAR-01-dark.png`（固定位立牌 + mono 主题反相）。

## 已知限制 / 后续

- 状态机 prop（`state`）已就绪，但**尚未接入 Agent 运行状态**；emotionId→GrokBallState 的接线属 D12 运行时集成范围，本任务仅提供对接点。
- 眼珠为投影竖眼（对齐用户所选观感），未做瞳孔高光；如需可后续加。
- 黑白（mono）随主题反转由 CSS 变量 `--avatar-mono-bg/-eye` 驱动，浅色黑球、深色白球。

## 自审记录（AI 执行，需真人确认）

- 已核对：15 形状 id 与 `GROK_BALL_SHAPES` 键一致（单测断言）；投影/插值/背面剔除有单测覆盖；typecheck/lint/test/build 均通过并记录退出码。
- 未验证：真人在应用内手动切换 6 状态与全部形状的观感确认；未接 Agent 状态。
- 结论：代码层面 ACCEPT 项达成；**请 Destinyian 本人审阅并确认自审，AI 记录不冒充真人身份。**
