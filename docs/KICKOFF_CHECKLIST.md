# 开发启动清单

日期：2026-10-23。执行负责人：Etheslay。状态：阶段 0 进行中；0.1 完成 4/7（服务端强制受免费套餐限制暂缓）、0.2 完成 6/7（余对齐估时）、0.3 进行中（worktree 纪律已执行）。阶段 1 进行中：版本固定与环境基线完成，无 Key 冒烟通过，真实模型验证待 0.3 测试 Key（证据见 [D01_TECHNICAL_VERIFICATION](D01_TECHNICAL_VERIFICATION.md)）。

本文是执行清单，只记录顺序与勾选状态；规则、验收标准和任务详情以各权威文档为准，冲突时以权威文档为准。勾选仅表示对应负责人已实际完成并留证，本文不构成完成声明。桌面侧（D02 / D05 / D07 / D09 / D11 / D13）条目由 Destinyian 认领后补充勾选。

## 阶段 0：启动清障（阻塞 D01，不写应用代码）

### 0.1 GitHub 管理员设置

对应 [REPOSITORY_SETUP](REPOSITORY_SETUP.md) §3 第 2-6 项与 §6 验收。

- [ ] 邀请/核实 Destinyian 的协作者 Write 权限。
- [x] 默认分支从 `main` 改为 `develop`（2026-10-23 ls-remote 核验 HEAD 指向 develop）。
- [x] 合并选项：仅保留 Create a merge commit，关闭 Squash / Rebase，不启用 linear history（合并界面核验无 Squash/Rebase）。
- [x] 为 `main`、`develop`、`release/*`、`hotfix/*` 建立保护规则/ruleset：必需 PR、必需批准数 0、关闭 code-owner 审批与"最后推送需他人批准"、保留必需状态检查与禁止强推/删除（规则集 protected-branches 已建立；私有免费套餐暂不强制，见 REPOSITORY_SETUP §2.1）。
- [ ] 按 REPOSITORY_SETUP §6 用临时 feature 分支 + PR 验证保护行为（错误来源被拒、0 批准可合并、强推被拒），截图或导出留证。（部分执行：探针 C 通过——PR #3 以 0 批准 + merge commit 合并；探针 B 证实推送未遭拒绝，A/B 暂缓至强制生效）
- [x] 回填 REPOSITORY_SETUP §2 状态表（2026-10-23，见该文件 §2 与 §2.1）。
- [ ] 排查 GitHub 连接器对仓库返回 404 的根因（Token 权限或私有库可见性）；未解决前 Issue/PR 全部手工创建。（进行中：gh CLI 不可用、api.github.com HTTPS 不可达，已用 SSH-443 与网页流程绕过）

### 0.2 D00 正式闭环

文档产出已在 develop（合并提交 6bac6ff，来源 `feature/project-standards` bd2946b），按流程补齐正式记录。

- [x] 用 feature_task 模板创建 D00 Issue：负责人 Etheslay，分支 `feature/project-standards`，目标 develop。（链接由负责人补记）
- [x] 在 Issue 记录针对 6bac6ff 的自审：提交 SHA、检查证据、遗留问题、结论。（由负责人在 Issue 填写）
- [x] 显式确认首发平台：Windows 11 x64、简体中文、单机单用户。（D00 Issue 内由负责人确认）
- [x] 显式接受[轻量预算](PRODUCT_REQUIREMENTS.md)为暂定基线；D01 实测后如需调整走 ADR。（D00 Issue 内由负责人确认）
- [x] 显式接受 [ADR-0001](adr/0001-desktop-and-runtime.md) 为建议基线；D01 数据齐备后正式改为"接受"。（D00 Issue 内由负责人确认）
- [x] 冻结[契约](CONTRACTS.md) v0.1：小 PR 将状态由"草案"改为冻结，作为 D03 基线。（PR #3 以 merge commit 合入 develop）
- [ ] 与 Destinyian 对齐 D00-D13：填写估时、可用时间与里程碑日期，写入各自 Issue。

### 0.3 资源准备

- [ ] 准备专用低额度 DeepSeek 测试 Key 与费用预算；不复用个人主力 Key，不放入仓库。（阻塞阶段 1 真实验证项）
- [x] 建立独立 clone/worktree 纪律：同一台机器多任务并行时不共用工作目录（[GIT_WORKFLOW](GIT_WORKFLOW.md) §3）。（2026-10-23：D01 以 `.worktrees/harness-adapter` 独立工作树执行，主工作目录保留另一并行任务分支）
- [ ] 确认许可证义务：采用上游代码时保留其许可与第三方声明；本项目许可证在首次对外发布前由维护者决定（[README](../README.md)）。（上游 MIT 与 THIRD_PARTY_NOTICES.md 已核实，见 D01_TECHNICAL_VERIFICATION §3；项目自身许可证未定）

## 阶段 1：D01 `feature/harness-adapter`（Etheslay）

前置：0.2 完成。从最新 develop 创建分支，目标 develop。验收细节见 [DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md) 任务表与 [HARNESS_INTEGRATION](HARNESS_INTEGRATION.md) §4。

> 注：是否切换为 STAGE_PLAN 提出的 S1–S14 串行执行正在讨论中（方案内容本地存档于 archive/stage-plan-proposal，暂未入库）；结论落地前按本清单与 DEVELOPMENT_PLAN 执行。

### 版本固定与环境基线

- [x] 核实上游 `0.2.1-rc.2` / 提交 `687f282e` 对应的 npm 发行包可用性与完整性，记录固定版本映射。（2026-10-23：双注册表 dist-tags 一致；tarball sha512/sha1 校验通过；源码浅检出核对 86 项依赖映射无增减；见 D01_TECHNICAL_VERIFICATION §1）
- [x] 本机核对 Node `^22.19.0 || >=24`、pnpm 11.28.5；不执行来源未知的安装脚本。（Node v24.15.0 满足；pnpm 本机 11.7.0 与上游固定 11.28.5 不一致，消费发行包实测不受影响，处置见 D01_TECHNICAL_VERIFICATION §2；安装全程 `--ignore-scripts`，跳过脚本与原生预编译清单见 §4）
- [x] 产出依赖许可清单。（86 项直接依赖全部 MIT，逐项 registry 元数据核对，见 D01_TECHNICAL_VERIFICATION §3 / §7；传递依赖清单待 D03 锁文件）

### 真实接入验证（临时独立数据根 + 测试 Key）

- [x] 最小 profile 配置启动真实 Harness。（2026-10-23 无 Key 预验证：web profile 启动、127.0.0.1 回环绑定、token 401、强制终止后端口释放均通过，见 D01_TECHNICAL_VERIFICATION §4；不含模型调用，含 Key 的完整验证仍待执行）
- [ ] 验证流式消息与工具开始/结束事件。
- [ ] 验证审批允许/拒绝、取消、超时。
- [ ] 确定接入方式（SDK / headless / 受支持插件桥）并记录取舍。
- [ ] 未提供 Key 时如实记录"真实验证未执行"，不以桩替代结论。

### 稳定性与 Windows 专项

- [ ] 重启 Host：会话历史可读、失败/中断状态准确、孤儿进程回收。
- [ ] Windows 工具进程回收与原生依赖兼容。（部分：原生预编译清单与 `--ignore-scripts` 启动通过，PTY 未验证，见 D01_TECHNICAL_VERIFICATION §4）
- [ ] 记录额外外联、默认 telemetry、profile 数据位置；关闭不符合本地设计的能力。（记录完成：DSH_HOME 数据位置、默认遥测端点、外联面检索、DISABLED patch 实测生效，见 D01_TECHNICAL_VERIFICATION §5；Host 内固定关闭待实现）

### 指标与产出

- [ ] 实测进程树内存、冷启动、包体基线，回填 ADR-0001 接受条件；超预算时提 ADR。
- [ ] 原始事件样本脱敏后存为契约测试夹具。
- [ ] 输出不支持能力列表。
- [ ] PR 记录针对最新提交的自审（SHA、证据、结论）后合并。

阶段 1 与 D02（Destinyian）并行；M0 退出条件为接入方式、平台、预算与桌面边界可评审。

## 阶段 2 及以后（摘要）

任务详情、依赖与验收以 [DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md) 为准；此处仅列 Etheslay 的顺序。

| 任务 | 前置 | 关键交付 |
| --- | --- | --- |
| D03 `feature/shared-contracts` | D01 + D02 | 契约落成 schema、夹具与双方可用测试；确认依赖锁与版本策略 |
| D04 `feature/local-storage` | D03 | SQLite 元数据、专属 Harness home、凭据存储、迁移与恢复 |
| D06 `feature/workflow-engine` | D04 | DAG 校验、顺序/并发、失败与取消、运行快照、事件去重 |
| D08 `feature/tool-permissions` | D04 + D06 | 后端执行前检查、路径约束、一次性审批、MCP 授权 |
| D10 `feature/local-scheduler` | D06 + D08 | 时区、休眠错过任务、重复触发防护、重启中断状态 |
| D12 `feature/runtime-integration` | D06 + D08 + D09 + D10 | 三机器人真实全链路、故障注入、权限与迁移回归 |

D03 是与 Destinyian 的耦合点：其 D05 / D07 可先用契约夹具开发，接口改动由改动方小 PR 合入 develop 并在 Issue 同步影响。

## 协作机制备忘

- 每项任务一个 feature 分支，目标 develop，禁止直推 main / develop；PR 描述按模板记录自审（最新 SHA、证据、结论），新增提交后更新。
- 开工检查接口/锁文件变化，合并前 `git pull --ff-only` 更新基线。
- AI 辅助检查可用于准备证据，自审结论必须由负责人本人做出并记录。
