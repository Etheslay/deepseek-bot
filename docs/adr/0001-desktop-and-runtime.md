# ADR-0001：桌面载体与 Harness 接入

日期：2026-10-22。状态：建议，待 D00 双方评审及 D01 验证后接受。决策负责人：Etheslay、Destinyian。

## 背景

项目需要轻量桌面、本地执行和双人可维护性。上游已有基于 Node / Electron 的桌面运行方式，当前仍处于预览期；不能忽略兼容变化与安装包成本。

## 选项

| 选项 | 优点 | 代价 | 判断 |
| --- | --- | --- | --- |
| Electron + 独立 Host + Harness 适配层 | TypeScript 技术栈统一；与上游技术接近；Windows 调试/打包路径较直接 | Chromium/Node 体积与内存需要实测；必须加固 IPC | 建议首选 |
| Tauri + WebView + Node sidecar | 壳可能更小，使用系统 WebView | 仍需 Node/Harness；Rust 与 TypeScript 双栈；跨进程与平台兼容投入增加 | 若轻量指标不达标再用数据比较 |
| 直接复制上游完整 Desktop 并修改 | 最快获得上游现有能力 | 产品与内部结构耦合、升级差异大；无关能力扩大资源开销 | 仅用于技术验证，不作为默认长期 fork 策略 |

## 建议决定

使用 Electron + React + TypeScript，Host 通过上游受支持的启动方式复用真实 Harness；按需复用上游模块、保留许可和版本记录。本项目只拥有机器人工作台、工作流产品行为和必要适配层。

首发采用本地 API Key，不把上游账户或云同步功能默认引入本产品。部署环境只需要安装包提供的运行时；不以用户自行安装 Node / pnpm / Rust 作为普通用户前提。

## 接受条件

D01 必须提交：固定上游提交与发行包版本、会话与取消验证、工具审批验证、干净 Windows 安装试验、进程树内存/启动/包体基线。D02 同时验证界面壳与 IPC。

如预算不满足，由两人对相同功能闭环进行 Electron/Tauri 比较；新决策记录数据、取舍与迁移影响，不仅比较空壳安装体积。未完成验证时，本 ADR 保持“建议”。

参考：[上游架构](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/architecture.zh.md)、[上游桌面包](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/package.json)。
