# D21 Local Screen Sensing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Follow the approved scope; do not ask again for routine implementation decisions.

**Goal:** 用户批准后只采集选定窗口，并在本机查看截图与离线中英文 OCR。

**Architecture:** exec-daemon 提供固定窗口采集和离线 OCR；Host 持有目标、单操作锁、权限和本地产物；桌面管理与预览，Harness 仅接收结果元数据。

**Tech Stack:** TypeScript、Windows PowerShell/.NET Framework、Win32 PrintWindow、Tesseract.js 7、既有 Host/D16 网关及 Electron/React。

## 1. 契约与固定依赖

- [ ] 在 contracts 新增 screen 方法、模式及结果 schema，协议 0.6 兼容旧版；先跑新增测试观察失败，再实现和全包验证。
- [ ] 方法请求和响应按设计文档；内部工具输入固定为 `z.object({mode:z.enum(['image','ocr']),selectionId:z.string().uuid(),windowTitle:z.string().max(512)}).strict()`；模型参数只有 mode。
- [ ] 固定 exec-daemon OCR/模型依赖、许可证和离线资源路径；Host 新方法暂以 RUNTIME_UNAVAILABLE 拒绝，确保独立契约 PR 类型检查通过。
- [ ] 测试：`pnpm --filter @deepseek-bot/contracts test`、`pnpm typecheck`。提交目标 develop 的契约/依赖 PR，负责人自审保持待填写。

## 2. Windows 后端和离线 OCR

- [ ] 创建 packages/exec-daemon 的 backend、固定辅助脚本、OCR worker 和构建资源复制逻辑。接口为 `listWindows(signal)`, `capture(windowIdentity,outputDirectory,signal)`, `recognize(pngPath,signal)`, `close()`；capture 返回尺寸和本机受控文件，recognize 返回 UTF-8 文本。
- [ ] 先写目标身份/参数/取消/超时测试，运行失败后实现。身份包含 hwnd、pid、processStartTime；禁止 shell=true、用户命令、网络模型路径与全屏回退。
- [ ] OCR worker 只从随附目录加载固定 eng+chi_sim、core/WASM；构建测试检查产物存在和离线运行，不以开发环境 node_modules 替代打包资源。
- [ ] 用自建 Windows 窗口与合成图片验证真实截图和 OCR，测试 8 MiB/像素限额、语言资源缺失、取消和错误进程清理。

## 3. Host、网关与产物

- [ ] Host 屏幕服务实现 `status/listWindows/select/prepare/check/invoke/cancel/listResults/readResult/deleteResult/close`。选择 token 绑定 bot、代次及窗口快照；每次批准后重验当前目标及 D16 ticket，再调用后端。
- [ ] 单锁覆盖采集、OCR、发布，忙时 RATE_LIMITED。产物先写本次临时目录，通过全部大小/文本/路径检查后原子发布，失败仅清理本次目录；读取/删除只接受匹配 bot 的 UUID 清单项。
- [ ] 增加私有 screen 目录和调用路由，绑定 screen_capture→screen.capture，未启用/未选窗口不进入模型目录。管理方法只供桌面调用，工具结果只返回 `{id,mode,at,width,height,hasOcr}`。
- [ ] 默认 deny，用户只能 ask/deny。停用、清除目标、归档、策略变更、聊天取消、Host 关闭取消相关审批和辅助进程，审计不写标题/图像/文本。
- [ ] 集成测试先确认未实现而失败，再验证批准前零采集、精确审批、并发锁、取消、撤销竞态、结果隔离与反链接保护。

## 4. 桌面与交付

- [x] 设置组件提供 bot、启用、窗口刷新/选择、截图/OCR、取消和仅本次审批；结果列表和本机缩略图/OCR 文本预览，确认后删除。迟到响应不能污染新 bot/目标。桌面设置页见 `apps/desktop/src/renderer/src/features/screen/`。
- [ ] 新增独立真实 Electron 验收脚本，自建测试窗口，本地受控模型；截图/OCR 不发送模型正文，验证结果元数据回传及实际 UI 预览。本分支未开始这一项。
- [ ] 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、Host/desktop build、真实窗口与离线 OCR/Electron 验收，逐条记录真实结果。已跑项与未跑项写在 [D21 桌面报告](../../reports/D21-desktop-report.md)，不把未跑项记为通过。
- [x] 更新 D21 报告、权限/开发计划、许可与恢复说明。功能 PR 目标 develop；依赖的契约、Windows 后端和 Host 网关已在 develop。不使用“已完成真人自审”的表述。
