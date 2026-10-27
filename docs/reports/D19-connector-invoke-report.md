# D19 连接器调用管道与本地 SD 生图

日期：2026-10-27（Asia/Shanghai）。负责人：Etheslay。分支：`feature/connector-invoke`。基线：`ae0c6be`（origin/develop，含 PR #63）。本文记录本地实现与检查，不代表真人自审、远程 CI 或合并结论。自审必须针对该分支最新提交 SHA。提交作者行是本机已配置的 Git 身份，不是本文填写的自审。

## 1. 交付行为

D19 登记片（[D19-connector-registry-report](D19-connector-registry-report.md)）建立了本地连接器目录。本片补上调用管道与首个官方动作：

| 块 | 实现 |
| --- | --- |
| 端点配置 | 迁移 `0012-connectors-endpoint`：`connectors.endpoint` 列；受信方法 `connector.setEndpoint`（清除传 null）。**只接受回环 http(s) URL**（127.0.0.1 / localhost / [::1]、不带路径），存储层校验——存量数据无论怎么写都不可能把 Host 指向远程目标；登记时可带端点，管理从不探测、从不出站 |
| 模型工具 | `connector_invoke`（能力 `connector.invoke`，默认 ask）：严格 schema `{ connectorId, action: "txt2img", params }`；每次调用经 D16 检查点带精确参数审批；模型不能登记连接器、不能改端点、不能读目录（`connector.*` 控制面仍只对桌面开放）。走新的 `/connectors` 通道路由，桥接插件目录名单同步 |
| 官方动作 | `txt2img` → 本机 SD WebUI API `POST {endpoint}/sdapi/v1/txt2img`（prompt/negativePrompt/width/height/steps，batch_size 固定 1，120 秒超时）。响应取首张 base64 图片，解码后 ≤8 MiB，落盘 `<dataRoot>/connector-outputs/<connectorId>/<日期>-<uuid>.png`，返回绝对路径 + 字节数——**图片字节不进契约信封**（1 MiB 上限），错误信息脱敏（不带响应体/堆栈） |
| 产物边界 | `connector-outputs/` 是数据根新目录（layout 保障创建）；**不进备份**（可再生成，备份清单语义不变）；与 run 产物系统（runId 域）完全分离。聊天内图片预览的展示通道归 B 线（D26/D28），本片只交付落盘与路径 |
| 凭据边界 | 延续登记片承诺：本片不解析 credentialRef、不读取凭据 blob——本地 SD 服务无需密钥；需要凭据的连接器是后续显式切片 |

## 2. 实际检查

环境：Windows 11 x64、Node v24.16.0、pnpm 11.28.5。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | 退出 0 |
| `pnpm test` | 退出 0：shared 6、harness-bridge 16、contracts 89、agent-tools 78、storage 161、desktop 228、runtime 128、harness-adapter 58、host 92 通过，另有 1 项跳过（既有付费 API 冒烟） |
| `git diff --check` | 退出 0 |

新增用例覆盖：回环端点校验（协议/主机/路径/格式拒绝）、setEndpoint 往返、驱动对假 SD 服务的全链路（参数透传、落盘路径与字节）、禁用/无端点/未知动作/不可达/HTTP 500/非 JSON/空图七类失败路径、网关工具 schema 拒绝与审计、桥接目录与请求顺序、桌面端点保存（jsdom）。

## 3. 未验证

- **真实 Stable Diffusion 未联调**：本机未安装 SD WebUI；全链路用本地假 HTTP 服务验证协议与落盘，真实 `/sdapi/v1/txt2img` 行为（响应形状、生成耗时、显存）待用户环境实测。
- 未用真实 Electron 手测设置页端点输入；未跑真实 Harness 让模型发起带审批的生图调用。
- 远程 CI、安装包、签名、GitHub 保护规则复核未执行。
- 聊天内图片预览、img2img、自定义 MCP、凭据解析调用、视觉理解未做（后续切片）。

## 4. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、权限边界与兼容性：＿＿＿＿
- [ ] 自动化检查、错误路径与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
