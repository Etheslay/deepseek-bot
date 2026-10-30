# D27' 语音桌面接线（PR #150 事后补录）

> **补录说明**：本报告于 2026-10-30 依合并代码（`6224448`）、提交信息与合并记录（PR #150 `db64e01`，分支 `feature/voice-ui-wiring`）整理入库，补 GAP_AUDIT §7.9 第 9 条登记的「无入库报告」欠账。**这是事后整理，不是 2026-10-29 交付当时的实机验证记录**；自审栏照例留空待负责人签署。
>
> 台账勘误：本 PR 的编号此前在 SPRINTS/GAP_AUDIT 多处被误写作 #151（stream-pacer 的编号）——合并提交为准：**#150 = `feature/voice-ui-wiring`**，#151 = `feature/streaming-reply`。

## 1. 交付行为（PR #150，合入 `db64e01`）

Host 侧 `voice.status/transcribe/speak`（whisper.cpp + Windows SAPI，PR #113）与主进程方法白名单早已就位，但桌面没有任何调用点：输入框麦克风是"即将可用"占位、回复没有朗读入口。本 PR 补上两端：

- **麦克风转写**：渲染层裸 PCM 采集（不用 MediaRecorder——其 webm 容器被契约拒绝是设计决定），本地编码为契约要求的 16 kHz 单声道 16-bit WAV（`wav.ts`），经 `voice.transcribe` 转写；转写文本**只填入输入框、不自动发送**；按契约 20 秒上限自动停止录音。
- **逐条朗读**：每条 bot 回复增加朗读按钮，经 `voice.speak` 播报。
- **门控与失败路径**：两个入口都以 `voice.status` 门控——未配置 whisper 路径或缺语音引擎时给出解释性禁用/提示文案，不静默失败。
- 文件面：`features/voice/clip-recorder.ts`、`wav.ts`、`voice-ui.ts` 新增，`App.tsx` 接线，i18n 词典补充；新增 `voice-ui.test.ts`（13 例）、`voice-wav.test.ts`（9 例）。

## 2. 后续演化（非本 PR 范围，如实区分）

- `feature/d27-hold-to-talk-220a`（PR #157）把录音交互演化为**按住说话**（`composer-mic.tsx`：松开填入输入框、不自动发送，20 秒上限保留）；当前桌面入口即该形态，本 PR 的 WAV 编码与门控逻辑仍是底座。
- whisper 路径持久化由 PR #118/#123（settings KV）承担，先于本 PR。

## 3. 验证证据（补录时复跑）

| 检查 | 命令 | 结果（2026-10-30，develop = `8b9e5bf` 树上复跑） |
| --- | --- | --- |
| 本 PR 引入的测试 | `pnpm --filter @deepseek-bot/desktop exec vitest run --config vitest.config.ts tests/features/voice-ui.test.ts tests/features/voice-wav.test.ts` | 2 文件 22 通过 |
| 交付当时 | PR 正文记载 desktop 套件全绿（无入库报告，以合并记录与提交为准） | 无独立报告文件（本文件即补录） |

## 4. 未验证（沿交付当时口径，补录不追认）

- 真机麦克风录音、真实 whisper.cpp 转写质量、Windows SAPI 实际发声——与 D27 报告的实机欠账同口径，归 GAP_AUDIT §8 第三批「语音实机联调」。
- 无手测截图（`reports/assets/` 下 d27/voice 目录不存在）。
- GitHub Actions 未跑（交付当时与本补录时均未执行）。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　针对提交：`6224448`（PR #150 合入内容）　日期：＿＿＿＿

- [ ] 差异、需求和错误路径检查结果：＿＿＿＿
- [ ] 测试证据 / 兼容性与权限影响（麦克风权限、音频文件落盘位置）：＿＿＿＿
- [ ] 遗留问题与处理方式：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
