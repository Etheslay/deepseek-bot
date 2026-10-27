# 第三方资产与许可

## D21 离线 OCR

- 固定引擎：`tesseract.js@7.0.0`、`tesseract.js-core@7.0.0`（Apache-2.0）。来源：[Tesseract.js](https://github.com/naptha/tesseract.js)、[Tesseract.js core](https://github.com/naptha/tesseract.js-core)。
- 固定语言数据：`@tesseract.js-data/eng@1.0.0` 与 `@tesseract.js-data/chi_sim@1.0.0`，上游为 [Tesseract 语言数据](https://github.com/tesseract-ocr/tessdata)，分发说明见 [naptha/tessdata](https://github.com/naptha/tessdata)。
- Worker、WASM 和模型仅作为本地资源使用，不从 CDN 下载，也不向远程 OCR 服务提交图像。构建复制上游 LICENSE/NOTICE 与所使用的数据许可；完整依赖许可证仍以锁文件和发行资源为准。
- `packages/exec-daemon` 的构建把 worker、core/WASM、`4.0.0_best_int` 的 eng/chi_sim 和上述许可复制到构建目录。运行时只读该目录的绝对路径。语言包 1.0.0 的 package.json 声明 MIT，发布包本身没有 LICENSE 文件，构建目录里的 `licenses/tesseract-data.json` 记录了这一点。
- 本片没有发行安装包验收。桌面设置页只显示 Host 已经生成的 JPEG data URL，不新增第三方库，也不把图像或 OCR 正文送出本机。真实 Windows 窗口和打包 Electron 验收仍未在设置页分支执行。

## D21 预览图

- Host 把已检查的 PNG 收成预览 JPEG，使用 `jpeg-js@0.4.4`（BSD-3-Clause，Copyright Eugene Ware；`lib/encoder.js` 另含 Adobe Systems BSD 声明）和 `pngjs@7.0.0`（MIT，Copyright Luke Page、Kuba Niegowski 与贡献者）。
- 预览只写在本机 `screen-outputs`，不进入模型结果、审计或遥测。完整许可证文本以依赖包内 LICENSE 和锁文件为准。

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
