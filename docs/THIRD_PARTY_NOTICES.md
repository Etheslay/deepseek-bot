# 第三方资产与许可

## 运行时直接依赖许可索引

下表为 develop 当前锁文件中**打包进应用的直接第三方依赖**（2026-10-29 实测，权威以锁文件与构建资源为准；传递依赖不在此逐列）：

| 包 | 许可 | 用途 |
| --- | --- | --- |
| dompurify@3.4.17 | MPL-2.0 OR Apache-2.0 | 聊天 Markdown 与 SVG 净化 |
| electron-updater@6.8.11 | MIT | 应用内更新（GitHub Releases 源） |
| highlight.js@11.12.0 | BSD-3-Clause | 代码高亮（common 子集） |
| katex@0.19.1 | MIT | 公式渲染 |
| marked@18.1.1 | MIT | Markdown 解析 |
| mermaid@12.2.0 | MIT | 聊天 mermaid 流程图本地渲染（动态 import 独立 chunk，PR #153） |
| react@19.1.1 / react-dom@19.1.1 | MIT | 桌面 UI |
| @modelcontextprotocol/client@2.2.0 | MIT | MCP 客户端（D19） |
| ajv@8.20.0 / ajv-formats@3.0.1 | MIT | MCP schema 校验（D19） |
| @deepseek-ai/dsh@0.2.1-rc.2、dsh-sdk-protocol@0.2.1-rc.2 | MIT | 钉扎 Harness SDK（版本与 HARNESS_INTEGRATION §1 一致） |
| zod@4.6.7 | MIT | 各包 schema 校验 |
| jpeg-js@0.4.4、pngjs@7.0.0 | BSD-3-Clause / MIT | 截图预览（详见下文 D21 预览图节） |
| tesseract.js@7.0.0、tesseract.js-core@7.0.0 | Apache-2.0 | 本地 OCR（详见下文 D21 节） |

- 全部为 MIT / BSD / Apache / MPL 宽松许可，无 GPL/AGPL 类强传染条款，符合 SPRINTS §9 消费红线。
- mermaid@12.2.0（MIT，锁文件钉住）已随 PR #153 合入并入表。
- 内部 `@deepseek-bot/*` 包为第一方，无第三方声明义务；发现项：9 个工作区包无 license 字段（根 package.json 为 private:true，未发布场景可接受），若将来公开分发需由负责人决定补法，本表不代改 package.json。

## D21 离线 OCR

- 固定引擎：`tesseract.js@7.0.0`、`tesseract.js-core@7.0.0`（Apache-2.0）。来源：[Tesseract.js](https://github.com/naptha/tesseract.js)、[Tesseract.js core](https://github.com/naptha/tesseract.js-core)。
- 固定语言数据：`@tesseract.js-data/eng@1.0.0` 与 `@tesseract.js-data/chi_sim@1.0.0`，上游为 [Tesseract 语言数据](https://github.com/tesseract-ocr/tessdata)，分发说明见 [naptha/tessdata](https://github.com/naptha/tessdata)。
- Worker、WASM 和模型仅作为本地资源使用，不从 CDN 下载，也不向远程 OCR 服务提交图像。构建复制上游 LICENSE/NOTICE 与所使用的数据许可；完整依赖许可证仍以锁文件和发行资源为准。
- `packages/exec-daemon` 的构建把 worker、core/WASM、`4.0.0_best_int` 的 eng/chi_sim 和上述许可复制到构建目录。运行时只读该目录的绝对路径。语言包 1.0.0 的 package.json 声明 MIT，发布包本身没有 LICENSE 文件，构建目录里的 `licenses/tesseract-data.json` 记录了这一点。
- 本片没有发行安装包验收。桌面设置页只显示 Host 已经生成的 JPEG data URL，不新增第三方库，也不把图像或 OCR 正文送出本机。真实 Windows 窗口和打包 Electron 验收仍未在设置页分支执行。

## D21 预览图

- Host 把已检查的 PNG 收成预览 JPEG，使用 `jpeg-js@0.4.4`（BSD-3-Clause，Copyright Eugene Ware；`lib/encoder.js` 另含 Adobe Systems BSD 声明）和 `pngjs@7.0.0`（MIT，Copyright Luke Page、Kuba Niegowski 与贡献者）。
- 预览只写在本机 `screen-outputs`，不进入模型结果、审计或遥测。完整许可证文本以依赖包内 LICENSE 和锁文件为准。

## 本地转写（whisper.cpp）

- 程序与模型由用户自行准备，不随本应用下载或分发。whisper.cpp 为 MIT，来源：[ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)。用户在设置 → 语音中填写本机可执行文件和 ggml 模型路径。
- 运行：`voice.transcribe` 只启动用户配置且已存在于本机的 CLI 和模型，转写时不下载、不上传音频。路径为空时转写不可用。

## DeepSeek 蓝海豚

- 文件：`apps/desktop/assets/avatars/dolphin.png`
- 来源：Owner 提供的 DeepSeek 海豚图，黑色改为蓝色 `#3b82f6`，透明底。
- 用途：侧栏品牌标识；不套白球。
- 说明：第三方动物头像（OpenMoji）和 Emoji 头像已移除，不再随包分发。

## 桌面角色动效（Grok Ball 头像）

- 文件：`apps/desktop/src/renderer/src/features/avatars/grok-ball*.ts(x)`
- 参考：社区对某商业桌面角色实现的公开研究仓库
  （`github.com/blessonism/grok-icon-study`，其自身声明素材归 xAI 所有、仅供学习参考）。
- 采纳的是**公开可讨论的实现思路**：身体单层纯色填充、轮廓由实体投影得到、
  眼睛按柱面贴合身体并被轮廓夹住、idle 只做极小幅度呼吸与慢摆。
- 未复制的内容：该仓库的源码、标识符、几何数据表（身形 / 眼形 / 配色数组）、
  SVG 资源与任何 xAI 素材；形状全部由本项目自行生成。
- 运动参数（摆动幅度、频率、眨眼与视线停留区间）由本项目独立调定，
  与该仓库的取值不同，仅保持同一观感方向。
- 结论：属于「研究思路 + 独立实现」，不构成代码或素材的再分发。
