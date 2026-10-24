# DeepSeek Harness 接入与兼容规范

## 1. 调研基线

核查日期：2026-10-22。官方仓库：`deepseek-ai/deepseek-harness`。本次读取 master 的提交：`687f282e8625c6b8d11ff58211a90524be2e4317`。仓库根包与 Desktop 包声明 `0.2.1-rc.2`，Node engine 为 `^22.19.0 || >=24.0.0`，包管理器为 `pnpm@11.28.5`。

这些是**源码调研结果**，不代表已经验证对应 npm 包发布状态、安装成功或适合生产。D01 必须核实发行包、完整性与匹配关系，再生成本项目锁文件。

## 2. 已核实与本项目决策

| 上游资料中的能力 | 本项目使用方式 | 验证要求 |
| --- | --- | --- |
| Cordis 插件与 profile 组合 | 通过受支持组合配置能力，不直接改 agent loop | 最小配置能启动真实 Harness |
| SDK / headless / Web 等启动 profile | 选择适合私有 Host 的接口；若 SDK 无所需能力则补受支持插件桥 | 稳定流事件、取消、审批和重连 |
| Electron Desktop 与本地 Host | 作为打包和生命周期参考 | 去掉不需要的账户、遥测、云相关默认配置 |
| 会话持久日志和版本迁移 | 保留 Harness 读写入口，应用只维护关联 | 升级后旧会话可读且不损坏 |
| 工具注册、执行拦截与本地后端 | 挂接确定性权限检查与审批 | UI 绕过、直接工具调用也被拒绝 |
| 实验性 Agent Teams | 非首发必要条件 | 如未来启用，单独版本/能力开关与回归 |

## 3. 适配层职责

对应用公开的是[本项目契约](CONTRACTS.md)，不是上游内部 JSON 或内存对象。适配层将会话创建、输入发送、流事件、工具申请、审批、取消、恢复和运行时健康状态映射成稳定事件。

禁止把此文档中的 `startRun` 等应用方法名描述为官方 SDK 原生方法；实际官方签名必须从固定版本类型及文档验证。禁止未核实就假定 CLI stdout 是稳定 JSON 协议。

## 4. D01 接入验证步骤

1. 在 `feature/harness-adapter` 建立技术验证记录，选择并固定上游发行版本与源码 SHA。
2. 检查发行包与依赖许可、Node 兼容、Windows 原生依赖；不要自动执行来源未知的安装脚本。
3. 使用临时独立数据根、合成样例和明确授权的测试 Key，完成一次真实模型工具调用。未提供 Key 时记录真实验证未执行，不能用桩替代结论。
4. 验证流式消息、工具开始/结束、审批允许与拒绝、取消和超时。
5. 重启 Host，验证会话历史、失败/中断状态与孤儿进程回收。
6. 运行协议契约测试并记录原始事件样本；脱敏后存入测试夹具。
7. 记录额外外联、默认 telemetry 和 profile 数据位置；关闭不符合本地设计的能力。
8. 提交推荐接入方式、实测指标和不支持列表，由该任务负责人自行审查并记录结论。

## 5. 固定与升级

固定确切依赖版本、锁文件和上游提交映射，不在生产使用 `latest`、浮动 Git 分支或启动时临时下载。签名/哈希校验失败时拒绝运行已替换的 runtime。

升级走独立 `feature/harness-upgrade-<version>`，检查官方破坏性变更、重跑兼容与会话迁移测试；同时评估应用数据库与 Harness 原生日志。验证失败保留旧版本，不在 release 分支临时追新。

## 6. 固定来源

- [README 与预览状态](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/README.md)
- [架构与扩展点](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/architecture.zh.md)
- [根包和工具链](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/package.json)
- [Desktop 包及打包命令](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/package.json)

以上为来源索引，不要求将整个上游仓库复制到本项目。
