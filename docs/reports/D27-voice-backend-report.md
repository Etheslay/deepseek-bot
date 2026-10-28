# D27 本地语音后端：whisper.cpp 转写与 Windows SAPI 播报

日期：2026-10-28（Asia/Shanghai）。负责人：Etheslay。分支：`feature/voice-local-backend-8c21`。基线：`dd04d94`（origin/develop，含 PR #103/#104/#105）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论；自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文代填的自审。

## 1. 交付行为

D27（本地语音：whisper.cpp 转写 + Windows TTS 播报，全免费全本地）的后端切片，桌面语音 UI（按住说话/自动断句/播放）不在本片：

| 块 | 实现 |
| --- | --- |
| 契约 v0.8 | 受信桌面方法 `voice.status` / `voice.transcribe` / `voice.speak`（附加式；继续接受 0.1–0.7 发送方，工作流 `schemaVersion` 仍 0.1）。`TEXT_LIMITS` 新增 `voiceTranscript` 4000 / `voiceSpeakText` 2000。剪辑边界：16 kHz、单声道、16-bit PCM WAV、≤20 秒、base64 ≤900,000 字符（1 MiB 消息信封内） |
| 转写 | `packages/host/src/voice.ts`：严格解析 WAV（RIFF/fmt/data 分块走查有界）→ 写临时剪辑（`%TEMP%\deepseek-bot-voice-*`）→ 调用户自备 whisper.cpp（`-m model -f clip.wav -nt -np` 固定参数数组、无 shell、隐藏窗口）→ 返回 `{text, seconds}`。120 秒超时终止；运行结束即删临时目录（Windows 文件锁下短重试，宁可留下系统临时目录也不让失败外泄）。二进制/模型经 `DEEPSEEK_BOT_WHISPER_BIN` / `DEEPSEEK_BOT_WHISPER_MODEL` 配置（`main.ts` 接线） |
| 播报 | Windows SAPI（`System.Speech`）：固定 PowerShell 脚本经 `-EncodedCommand` 执行，文本以 base64 传入，不经 shell 字符串拼接；120 秒超时；非 Windows 拒绝 |
| 可用性 | `voice.status` 只读汇报两侧可用性与短原因（未配置/未找到/平台不符），不启动任何进程 |
| 并发与关闭 | 语音任务一次一个（排队，不并发堆积语音进程）；超时或关闭先 abort 信号（真实子进程随之被杀）再报 `TOOL_TIMEOUT`；`close()`、`data.restore` 与 Host shutdown 中止在途任务并拒绝新任务 |
| 边界 | 模型目录零新增：voice 不是能力、没有工具、不进网关注册表；错误只报稳定错误码与退出码，不回传进程输出；剪辑与合成音频不落库、不进备份、无网络、无云端转写 |

## 2. 实际检查

环境：Windows 11 x64、Node v24.20.0、pnpm 11.28.5。测试需设 `APPDATA`（本执行沙箱默认为空导致 storage 一条数据目录用例失败；用户常规环境不受影响）。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` | 退出 0 |
| `pnpm typecheck` | 退出 0 |
| contracts `vitest run` | 140 通过（新增 `voice.test.ts` 6 例；`screen.test.ts` 协议锚点随 0.8 同步） |
| host `vitest run src/voice.test.ts` | 17 通过（WAV 解析、限额拒绝、串行队列、deadline、关闭清理、handler 接线、模型目录无 voice） |
| `pnpm test`（全仓并行） | contracts 140、storage 200、desktop 55 文件、runtime、agent-tools、exec-daemon、harness-adapter/bridge、shared 全绿；host 并行出现 4 个文件级时序失败（chat×2、mcp-chat×1、real-app-tools×1、task-dispatch×1，均为 harness initialize 15 秒超时 / `waitFor` 超时家族）。chat+mcp-chat 隔离复跑 17/17 通过；real-app-tools+task-dispatch 隔离复跑 16/16 通过。改动前基线同规模并行同样出现 2 个同族失败——本机并行负载下的既有抖动，非本片引入 |
| `git diff --check` | 退出 0 |

## 3. 真机冒烟（Windows，全本地、零网络环回）

| 步骤 | 命令 / 版本 | 结果 |
| --- | --- | --- |
| TTS | SAPI `SetOutputToWaveFile(16 kHz, 16-bit, mono)` + `Speak` | 生成 `smoke.wav`；头校验 RIFF/WAVE、fmt=1（PCM）、ch=1、rate=16000、bits=16；退出 0 |
| STT | whisper.cpp v1.9.2 `whisper-bin-x64.zip` + `ggml-tiny.en-q5_1.bin`（31 MB，经 hf-mirror 下载） | `whisper-cli -m model -f smoke.wav -nt -np`（与服务相同的参数形状）退出 0，输出 " Hello from Deepseekpot Local Voice Test."（tiny 量化模型对合成品牌词的小拼写偏差属预期） |

结论：契约规定的剪辑格式可由 SAPI 路径产生、可被 whisper.cpp 消费——Windows 上"合成 → 转写"全本地闭环成立。冒烟用二进制、模型与脚本位于仓库外 `%TEMP%\dsb-voice-smoke\`，未进仓库。

## 4. 未验证

- 未跑 GitHub Actions（免费分钟额度已用尽；缺席的 Actions 运行不表示代码失败）。
- 真实 Electron、麦克风采集（按住说话/自动断句）、聊天/会话内播放接线未做——语音 UI 与联调归桌面线；本片只交付 Host 后端与契约。
- whisper.cpp 二进制与模型不随应用分发：生产路径以用户本机配置为准，`voice.status` 在未配置时如实报告不可用；不同模型/语言的转写质量未评估。
- `voice.speak` 的真实出声路径未在本冒烟执行（冒烟用 `SetOutputToWaveFile` 落盘验证 SAPI 管道；`Speak` 出声属同一 API 面）。
- host 并行时序失败按隔离复跑与基线对照判定为既有抖动；未做无改动基线的同规模并行对照实验。

## 5. Etheslay 本人自审

- 已审提交 SHA / 日期：
- 差异、需求和错误路径检查结果：
- 测试证据 / 兼容性与权限影响：
- 遗留问题与处理方式：
- 自审结论：

新增提交后更新本节；自审留给 Etheslay 本人填写，此处不代填。
