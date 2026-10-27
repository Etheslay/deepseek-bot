# D21 首片：指定窗口截图与本地 OCR

用户于 2026-10-27（Asia/Shanghai）确认首片范围：指定窗口截图＋本地 OCR。基线为含 PR #67–#69 的 develop（e6a54b1）。本方案是实现依据，不代表已经交付或真人自审。

## 用户行为与范围

默认 screen.capture=deny。设置页由用户显式改为 ask，选择 bot，刷新可用窗口列表并选定一个窗口。窗口选择只存于当前 Host 代次，重启后重新选择。截图和截图后 OCR 都需独立的单次审批，不提供会话或永久授权。设置页可以直接发起，也可由当前 bot 的 screen_capture 工具发起；工具不能更改目标或策略。

操作使用一把全局锁，批准后仍忙时拒绝，不静默排队；可以取消等待审批或进行中的采集/识别。停用、撤销目标、归档 bot、策略变更、聊天取消和 Host 关闭会使相关操作失效。取消只结束本应用拥有的辅助进程。

截图原图 PNG、预览 JPEG、OCR UTF-8 文本和结果清单位于数据根 screen-outputs/<botId>/<resultId>/。模型只获得结果编号、模式、尺寸、时间和是否有 OCR，不获得文件路径、像素或识别正文。产物目录在 bot 工作区之外。受信界面可读取缩略图和文本，或删除指定产物；不接受任意文件路径。

## 结构与边界

- packages/exec-daemon：只读 Windows 后端。固定 Windows PowerShell/.NET Framework 辅助脚本经参数数组启动，隐藏窗口，无任意命令输入；EnumWindows 只列元数据，指定 HWND/PID/进程启动时间的 PrintWindow 只在批准后调用。目标关闭、句柄复用、最小化、尺寸异常或保护属性明确禁止时拒绝。同步 Win32 调用放在独立进程，超时或取消结束该辅助进程；不调用全桌面截图回退，不激活或操作目标窗口。
- OCR 使用固定的 Tesseract.js 7.0.0、core 7.0.0 及 eng/chi_sim 数据包 1.0.0。构建产物随附 worker、WASM、语言数据和许可，运行时只加载绝对本地路径；没有 CDN、远程 OCR 或自动模型下载。缺少资源明确报 RUNTIME_UNAVAILABLE。Windows.Media.Ocr 的正式桌面支持要求包身份，不作为 NSIS 运行基线。
- Host 屏幕服务：拥有随机窗口 token、每 bot 选择的快照、全局操作锁、超时/取消、产物清单及读取边界；核对操作批准前后的目标身份和 D16 授权。网关内部参数包含 mode、selectionId、windowTitle，模型目录仅接受 mode。公共 tool.invoke 无可信 bot 身份，不能伪造调用。
- 桌面复用权限卡。窗口标题和识别文本均作为转义文本；缩略图以受限 data URL 显示。识别正文不自动进入聊天消息、Harness、审计或遥测。设置页提供单独的结果浏览与确认删除。

## 接口与限额

协议升至 0.6，继续接受 0.1–0.5，工作流文档版本 0.1。新增 screen.status({botId})、screen.windows.list({})、screen.target.set({botId,id:UUID|null})、screen.request({botId,mode:image|ocr})、screen.cancel({botId})、screen.results.list({botId})、screen.result.read({botId,id})、screen.result.delete({botId,id})。所有管理/读取方法仅供受信桌面使用。

窗口目录最多 200 条，token 仅当前代次有效。全局同时一个采集/识别，图像每边最多 8192 像素、最多 1600 万像素和 8 MiB PNG；超出拒绝。预览 JPEG 最多 256 KiB，OCR 正文最多 64 KiB，超限拒绝并清理本次临时产物，不截断冒充完整结果。窗口采集 10 秒，OCR 60 秒，审批沿用 10 分钟。结果每 bot 最多 50 条，满额要求用户删除；不自动覆盖或删除已有结果。

结果元数据 {id,mode,at,width,height,hasOcr}。screen.result.read 返回元数据、JPEG base64（最多 360000 字符）及 text:string|null，低于 1 MiB 信封上限。清单按新到旧保存，每次成功原子发布；重启只恢复产物，不恢复窗口选择。产物目录和正文不进入元数据备份；恢复备份后缺少产物时明确报不可用。

Host 对 bot/结果 UUID、目录链接、文件类型和大小执行验证。每次工具调用只审计摘要、决定和稳定错误码，不记原图、窗口标题或 OCR 原文。Shell、键鼠输入、桌面全屏采集、任意路径 OCR、实时视频、远程识别不在本片。

## 验收

测试先失败后实现：默认拒绝、仅本次审批、不同 bot 隔离、目标快照变更、无批准不调用后端、取消与并发锁、保护/消失/最小化窗口、超时、资源缺失、产物超限、文件链接/跨 bot 读取/删除、成功与失败审计无原文。OCR 用本地合成中英文图验证真实引擎；Windows 采集使用测试自建窗口，不读取用户其他窗口内容。

真实 Electron 验收使用独立数据根、自建测试窗口、本机受控模型：选择目标、审批前采集数 0、拒绝/取消后仍 0、批准后截图/OCR 可在本机预览、模型只收到元数据。执行 lint、typecheck、全仓测试、构建、无网络 OCR 验收；记录 CI、截图、未验证项及负责人待填自审。

参考：[PrintWindow](https://learn.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-printwindow)、[Windows OCR 包身份要求](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr?view=winrt-26100)、[Tesseract 本地资源配置](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)。
