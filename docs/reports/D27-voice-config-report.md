# D27 语音配置持久化：`voice.config.get/set`

日期：2026-10-28（Asia/Shanghai）。负责人：Etheslay。分支：`feature/voice-config-kv-c4d2`。基线：`7d8bf69`（origin/develop，含 PR #113 语音后端与 PR #117 host 检索）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论；自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文代填的自审。

## 1. 交付行为

[D27 语音后端](D27-voice-backend-report.md)的收尾片：whisper 路径从"仅环境变量"升级为可持久化配置，为桌面设置页（B 线）铺路：

| 块 | 实现 |
| --- | --- |
| 契约 | 受信桌面方法 `voice.config.get`（`{}` → `{whisperBin, whisperModel}`，null = 未设置）与 `voice.config.set`（同形状请求，回显存储值）。**不提升协议版本**；方法白名单 116 → 118。字符串 ≤1024，null 清除，strict 校验 |
| 生效语义 | set 即时生效（`VoiceService` 内部配置可变，转写 spawn 时读取当前值）；写入 settings KV `voice.whisper.bin` / `voice.whisper.model`，重启后恢复 |
| 种子与权威 | 启动时环境变量（`DEEPSEEK_BOT_WHISPER_BIN` / `DEEPSEEK_BOT_WHISPER_MODEL`）只是种子；**settings KV 存在即为权威**——字符串覆盖种子，null/垃圾值清除（`voice.status` 如实报告未配置），键不存在保持种子 |
| 边界 | 路径只是本地用户选择，模型不可读写；不是能力、无授权面、不进模型工具注册表；不启动任何进程（status/config 均只读汇报或写 KV） |

## 2. 实际检查

环境：Windows 11 x64、Node v24.20.0、pnpm 11.28.5。测试需设 `APPDATA`（本执行沙箱默认为空；用户常规环境不受影响）。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | 见 §4 最终记录（提交后全量复跑） |
| contracts `vitest run src/voice.test.ts src/methods.test.ts` | 32 通过（config 边界：null 清除、空串拒绝、>1024 拒绝、缺字段拒绝；方法总数锚点 118） |
| host `vitest run src/voice.test.ts` | 19 通过：服务级 setConfig 即时生效/清除；handler 级 get 回显环境种子、set 写 KV 并即时生效、**同数据根重开 Host 恢复 KV**、存储 null 权威于环境种子 |

## 3. 设计取舍

- **沿用 searxng.endpoint 模式**：KV + 即时生效 + 启动恢复，与 SearXNG 端点配置完全同构，桌面设置页可以同一套交互实现。
- **KV 存在即权威**：环境变量只在键不存在时兜底，避免"环境变量幽灵复活"用户已清除的配置；垃圾值按清除处理，让 `voice.status` 保持诚实而不是猜。
- **不做路径存在性校验于 set 时**：路径可能指向尚未就位的文件（如先配好再下载模型），`voice.status` 负责如实报告"was not found"。

## 4. 最终检查记录

（提交后全量复跑，结果见 PR 验证证据表。）

## 5. Etheslay 本人自审

- 已审提交 SHA / 日期：
- 差异、需求和错误路径检查结果：
- 测试证据 / 兼容性与权限影响：
- 遗留问题与处理方式：
- 自审结论：

新增提交后更新本节；自审留给 Etheslay 本人填写，此处不代填。
