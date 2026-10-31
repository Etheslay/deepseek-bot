# B3'' 用户图片进入模型输入（第一步验证报告 + 接线记录）

> 分支 `feat/image-vision-input`，基于最新 `origin/develop`（c7288e1）。
> 契约 v0.14（additive）：`chat.send` 可选 `images` 数组 + `vision.status` 能力标志。

## 第一步：三问与结论（验收重点）

### ① SDK 层是否支持图片内容块

**支持，证据三层**（pinned `@deepseek-ai/dsh@0.2.1-rc.2`）：
- `@deepseek-ai/dsh-sdk-protocol/lib/types/types.d.ts:42-50`：
  `SdkEncodedImageBlock = { type: 'image', data: base64, mimeType: png/jpeg/webp/gif }`，
  `SdkPromptContentBlock = ContentBlock | SdkEncodedImageBlock`（注释原文
  "Inline raster input admitted into the runtime's durable attachment store"）。
- `@deepseek-ai/dsh-llm/lib/types/content.d.ts`：完整图片策略层——capability
  gating、text-only 模型的确定性文本投影（"Project request image content
  into deterministic text for an exact text-only model"）。
- `@deepseek-ai/dsh-llm-deepseek`：Files API 上传 + 限额内 inline 兜底 +
  vision token 计量（v41 公式逐字移植）+ 归一化图片被供应商拒绝时的归因诊断；
  目录 `deepseek-flash`（V4.1-Flash）声明 `inputModalities: ["text","image"]`。

### ② 协议层实验：接受/忽略/报错？

**接受（准入证实）**。对真实 pinned dsh 运行时（非 fake）做最小实验
（`.tmp-vision-probe/probe.mjs`，probe.mjs 保留在分支外的临时目录，可复跑）：
spawn `lib/bin.js --profile sdk`（`initialize` 返回
`deepseek-harness-sdk-runtime`），`session/prompt` 携带
`[{type:"text"},{type:"image",data:<1×1 PNG base64>,mimeType:"image/png"}]`
→ **返回 `messageId`，回合完整走完（turn/end, status: idle），无任何内容
类型报错**——图片块被准入 attachment store。用无效 Key 是有意的：若上游在
内容层拒绝，错误会落在 admission 阶段；实际错误只会在模型调用阶段（鉴权），
而事件流里连模型失败都以正常 turn/end 收束——「忽略」与「报错」两种失败
处置均未触发。

**待真机验证项**：「模型真的能描述图片内容」需要有效 Key 做一次真实往返
（本沙箱无 Key，数据根的 Key 为 safeStorage 加密）。上游证据链（协议准入 +
适配层 provider 序列化 + 目录声明）使"静默忽略"在结构上不可能——text-only
路由由上游投影占位文本，图片被"宣告"而非丢弃；真机复核仍列为第一未验证项。

### ③ 成本

上游 v41 视觉 token 公式（`dsh-llm-deepseek/image-tokens`，实测调用）：
- **1024×1024 → 652 tokens**（单图上限 1024）
- 1568 长边 → 下采样 1512×1134 → **1001 tokens**
- 800×600 → 317 tokens
渲染层压缩目标（长边 ≤1568px）单图成本 ≤ ~1000 tokens。

## 第二步：接线（契约 v0.14，additive）

- **`chat.send.images`**：可选 `{ data: base64 ≤4MB, mimeType: png/jpeg/webp/gif }[]`
  ≤4 项。缺省 = 无图片块 = pre-vision 线上形状（安全默认）。Host 侧
  `ChatManager.send` 组装 `[text, ...images]` 内容块；adapter `runTurn` 接受
  字符串或块数组（纯字符串线上字节不变）。
- **`vision.status`**（voice.status 模式）：`{botId}` →
  `{model, visionAvailable, visionKnown}`，pinned 目录快照
  （deepseek-flash 有视觉）；目录外模型 `visionKnown=false`，UI 中性，
  发送时上游门控仍是权威。
- **渲染层**：能力已知可用时，图片附件经 `prepareVisionImage`（长边
  ≤1568px + JPEG 质量阶梯至 base64 ≤900K 字符，透明像素合成白底）编码后
  随请求携带；不可用/未知时退回既有说明文案——**图片任何情况下都会存入
  工作区并保留指针文本，绝不静默丢弃**。
- **不变项**：`chat.send` 既有字段语义、覆盖率门槛、testTimeout、
  `read_workspace_file` 路径（工作区副本始终保留）。

## 未验证项

1. 真实模型描述图片内容（需真机 Key 做一次 1024² 视觉往返；成本预期 652
   tokens，见 ③）。
2. canvas 压缩分支（createImageBitmap/toDataURL）为浏览器 API，单测覆盖
   预算策略纯函数；像素级压缩效果需真机确认。
3. Files API 路径（>2MiB inline 预算的上传通道）未触发——渲染层压缩已把
   输入压在 inline 预算内。
