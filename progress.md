# 工作记录

## 2026-11-01：侧栏会话子列表闪烁修复（fix/g12-session-sublist-flash）

- 用户真机首跑（develop `e16c5db`，`pnpm dev`）报：侧栏「新建会话」子列表一直闪、无法点击。
- 根因：`useBots` 返回 `visible = bots.filter((b) => !b.hidden)`——**每次渲染新数组引用**；G12 会话加载 effect（`[selectedBot, bots, desktop]` 依赖，每轮先 `setHistorySessions(null)`）于是无限循环：置 null → 重渲染 → 新 `bots` 引用 → effect 重跑 → ……子列表在隐藏/显示间高频翻转（闪 + 点击被吞），每轮还发一次 `chat.session.list` IPC。#194 合入时 CI 未恢复且无真机验证，故首跑才暴露。
- 修复：`visible` 以 `useMemo(() => bots.filter(...), [bots])` 包住（一处根治所有以 `bots` 引用为依赖的 effect；state 变化时仍会重算，隐藏过滤语义不变）。
- 回归测试 `tests/features/use-bots-stability.test.ts`（沿 manager-orchestration 的 jsdom + act 惯例）：①同一 root 重渲染两次 `bots` 引用不变；②`hide()` 后过滤重算（长度变化 + 引用更新）。插曲：vitest include 只收 `*.test.ts`（仓库惯例 createElement 而非 .tsx）；ServiceProvider 的 props 联合类型破坏 createElement 推断，按仓库 `as never` 惯用法绕过。
- 检查：desktop 79 文件全过、typecheck exit 0、根 eslint 通过。真机复核由用户在修复分支上重跑 dev 确认。

## 2026-11-01：打包 CI 发布缺陷修复（feature/package-publish-never，PR #198 已合入）

- 用户在 develop 上 workflow_dispatch 实跑 `package.yml` 失败：electron-builder 在 CI 环境因 electron-builder.yml 的显式 `publish: provider: github`（D24 更新元数据源）构造 GitHubPublisher，缺 `GH_TOKEN` 即失败——yml 注释声称的「`--publish never` 默认」不成立，CI 上没有这个默认。
- 修复：package.yml 构建步骤改为 `pnpm exec` 两段式并显式传 `--publish never`（CI 只产 artifact 不上传；`latest.yml` 仍随安装包生成，满足 artifact 清单与 RELEASE.md §4.1）；electron-builder.yml 注释改为如实记录成因与修法；`pack:win` 脚本本身不动（本机无 CI 环境变量，默认本就不上传）。
- 台账：GAP_AUDIT §7 第 11 条补记「Actions 已恢复执行」证据（本次实跑即证明，`quality` 恢复情况待下次实跑核实）；SPRINTS §4 补本行、并把第九次刷新行「待建 PR」勘误为 #197 `e16c5db`；progress 本条。
- 本地验证：electron-builder 24.13.3 `--help` 核对 `--publish never` 取值存在；未本地复跑 NSIS 全量构建（本机无 CI 环境变量，复现不了原故障路径）；CI 复跑验证由负责人触发。
- **PR CI 随片修复**：本 PR 的 PR CI 首次真正执行全套测试（G12 代码合入时 CI 尚未恢复），暴露 `chat-sessions.test.ts`「newest-activity-first」用例依赖真实时钟——ISO 时间戳毫秒精度内 `createChatSession` 与 `touchChatSession` 打平后按 `rowid DESC` 决胜翻序（本机慢、CI 快，故只在 CI 挂）。修复：`tempDb` 增加可选 `now`（沿 agent-tests 的注入惯用法），该用例改步进时钟；并把打平决胜路径直接钉住（同戳断言 extra 在前）。storage typecheck exit 0、28 文件/231 用例全绿、根 eslint 通过。**教训**：凡断言「A 排在 B 前」的时间戳用例必须注入时钟，不能赌墙钟推进。

## 2026-10-31：台账第九次刷新（分支收口核对，#185–#196 入账）

- 基线：`origin/develop` = `3110004`（PR #196 合入后）。triage 的 11 支已全部处置完毕：#189–#194 按建议顺序逐支合入，#195 摘入链条 B 尚未入库的链尾（性格单选 + 边界清扫对应当前契约的测试 + ＋ 菜单开关），#196 删除远端残余 7 支——`origin` 长期分支只剩 `develop`/`main`。SPRINTS §10 的 triage/摘链/收口三节由处置分支自己写齐，本刷新不重复。
- 核实入账（GAP_AUDIT 第九次刷新）：**G12 关闭**（#194：`chat.session.*` v0.14、可选 `sessionId` 缺省=默认会话、迁移集成时 0025→**0026** 改号、侧栏会话子列表）；D19 视觉理解**接线**入档（#192：`chat.send.images` + `vision.status`，上游准入实验见 TASK_B3P，真实模型往返归 MANUAL_ACCEPTANCE 新增 E4）；「去分组选择器 vs 分组实体化」核对结论为共存（#193 只移除 bot 对话框入口，方法面与侧栏分组菜单未动）。
- **发现并修正 CONTRACTS.md 契约文档漂移**：文件头 G12 段落仍写「v0.12 / 当前 protocolVersion 为 0.12 / 接受 0.1–0.11」，实际随 v0.14 入库（version.ts：v0.14 三合一=视觉输入+分组实体化+多会话），迁移号也是草案的 0024；已改为 v0.14/0.14/0.1–0.13/0026 并注明改号原因。§3 方法表行本来就对（v0.14），漂移只在文件头段落。
- 新治理债（GAP_AUDIT §7 第 11 条）：#189–#195 七个代码切片均无 `docs/reports/` 交付报告（三个任务书代部分证据，自审栏均待签）；**远程 CI `quality` 自账单/支出上限起未真正运行**（run `41178324878` 注解），此后 GitHub 红叉/绿叉都不构成检查证据，合入判断以本机检查为准。
- 本 PR（`feature/gap-audit-refresh9`）：GAP_AUDIT 九处（头部两行、§0 九次总览、§1 地图两行、§1.1 G12 行、§5 D19、§6 收口勘误、§7 第 3/11 条、§8 两行）+ CONTRACTS.md 段落勘误 + MANUAL_ACCEPTANCE E4 + SPRINTS §4 补 13 行 + progress 本条。纯文档；未运行代码检查（无代码改动）。

## 2026-10-31：在途分支 triage（11 个未合并远程分支）

- 合并 #186/#187 后发现 11 个未合并远程分支：两组并行开发线与已合入工作撞车（链条 B：g12→g1-ui-state→b3 视觉→b4 解析→persona→composer 串行堆叠 16 提交、基于 #153；链条 A：equal-bots 六特性→g12 多会话；另有基于 #182 尖端的两个精简重做版与两个独立分支）。
- 逐个 merge-tree 试算 + 内容比对后写入 SPRINTS §10 triage 表：`fix/host-test-stability`（vitest forks 限 2，治抖动家族，零冲突）最先合；`context-window-metering` 与 #138 互补；PDF/视觉各有精简版与大链版二选一；`g1-ui-state` 已被 #181–#184 取代建议废弃；`g12` 需拍板；`equal-bots-ui` 的「去分组选择器」与 #183/#184 分组实体化方向相反需重点审。
- GAP_AUDIT 状态行指向该 triage。处置决定（采纳/废弃/摘链）属两位负责人。

## 2026-10-31：G1' 全链收口（ui.* 方法面/接线 + 分组实体化）+ 台账八次刷新

- 基线：`origin/develop` = `c7288e1`（PR #179–#182 合入后）。用户指示继续推进。
- `feature/ui-state-methods`（`557228d` → PR #181，协议 **v0.13**）：`ui.state.get/set` 受信方法 + `UiStateSchema`（#175 候选采纳）+ settings KV `ui.state.v1`（损坏降级空态，镜像 skills.library.v1 模式）；拍板 #1 记录进 RENDERER_HOST_MAPPING §4（Etheslay 授权推进，Destinyian 会签待补）；contracts 161 过。
- `feature/ui-state-wiring`（`d1d3e7e` → PR #182）：DesktopService.uiState + 启动恢复（bot 顺序/选中，过期快照不选已归档 bot）+ 500ms 防抖写整快照；useBots.applyPersistedOrder；desktop 697 过。**插曲**：`git add -A` 误提交 tmp-inspect.txt，amend 移出（残件仍未跟踪待处置）。
- `feature/group-entity-contract`（`2401380` → PR #183，协议 **v0.14**）：`group.archive` + `UiStateSchema.collapsedGroupIds` 可选；语义核对修正——仓库先校验 revision 再走幂等分支，归档轮换 revision，重试须用首次返回的 revision；host groups.test 3 例；contracts 161 过。
- `feature/group-entity-wiring`（`0697b9e` → PR #184）：分组加载携 UUID+revision、建组先落库、移动共用 moveBotToGroup（失败回退）、删空组走 archive、启动恢复成员映射/分组顺序/折叠、防抖快照加 groupOrder/collapsedGroupIds；i18n +2 键；desktop 699 过。**教训**：makeBridge handler 类型为 `(payload: unknown) => unknown`（逆变），带类型解构参数不过 typecheck，用 unknown 入参内部断言。
- `feature/gap-audit-refresh8`（本 PR）：GAP_AUDIT 八次刷新（§0 总览 #178–#184、**G1' 归档**、缺口地图、§7.3 自审清单、§8 批次、头部行）；SPRINTS §4 补六行、§5 A7、§7 审计行、§10 八次清点；progress 本条。G1' 全链收口：A 线工程切片基本清零，余真机验收（工作流 12 步/分组 ui.state 四条/语音）、D13/D23、Destinyian 会签与自审签署。

## 2026-10-30：chat.stream 契约补记 + #150/#151 报告补录与编号勘误（两分支）

- 基线：`origin/develop` = `8b9e5bf`（PR #178 合入后）。用户指示：推进工作后推送远程并开 PR，由负责人手动合并。
- `feature/chat-stream-notice-contract`（`82107d9`）：收口 GAP_AUDIT §7.10 登记的契约漂移——`ChatStreamNoticeSchema` 钉进 contracts（events.ts 瞬态流节 + `TEXT_LIMITS.streamSegment`），host 发送端与桌面消费端改为从 contracts 取类型（单一类型源），桌面手写 typeof 三连检换成 `safeParse`（畸形通知整条忽略，行为不变）；CONTRACTS.md §4 新增「服务端→桌面 stdio 通知」段（`schedule.missed` + `chat.stream`）；不升 protocolVersion。测试：contracts 158 通过（新增 1 例）、desktop 78 文件全过（host-client 假 fixture 改用线内真实 UUID botId 并压入畸形通知断言跳过）、lint/typecheck/desktop build 全绿；host 全量首跑 2 失败为既有抖动家族（隔离复跑 18/18+1/1，develop 基线复跑同样 2 失败）。报告 `docs/reports/B6-chat-stream-contract-report.md`。
- `feature/backfill-reports-150-151`：补录 #150/#151 两份报告（D27 语音接线、stream-pacer，均标注事后整理、复跑切片自带测试 22+10 例全绿），并**勘误台账互换的 PR 编号**——合并提交为准：#151=`feature/streaming-reply`（stream-pacer）、#150=`feature/voice-ui-wiring`（D27' 语音接线）；修正 GAP_AUDIT（第四次刷新行、§0 表、§1.1、§5、§7.9）与 SPRINTS（§4 两行、§7 审计行、§10）共 9 处。
- 仍开放：桌面 UI 端到端人工验收（12 步清单，D23 前置）、拍板 #1（ui.* 清单 → RENDERER_HOST_MAPPING §4）、语音实机联调、D13/D23 收官；`tmp-inspect.txt`（工作区根目录未跟踪残件）待负责人处置。

## 2026-10-30：波1–波2 三片落地 + 接线后台账刷新（文档）

- 基线：`origin/develop` = `ad617a0`（PR #173–#177 合入后）。本会话依次交付并合入：#173 第七次刷新（GAP_AUDIT §7.10 + SPRINTS 账目）、#174 工作流回合 token 入 `usage_events`（`model=null`/`source=estimated`，用量解析迁入 `@deepseek-bot/harness-adapter`）、#175 `ui.*` 界面态契约候选（`UiStateSchema`，仅类型与校验）、#176 工作流读面 v0.12（`workflow.get`/`run.snapshot`/`approval.list`）、#177 桌面 `workflows`/`runs` 切真实 Host（导入保持惰性、`playback` 显隐夹具控件、审批 status 回退文案）。
- 本 PR 为接线后台账刷新：GAP_AUDIT 头部加「接线后勘误」行、§0 新增 10-30 接线勘误总览、§7.10 补「接线结果/仍存差异/未完成那一步」、§8 第五批更新进度、§2 G1' 记 #175 契约候选；SPRINTS §4 补 #173–#177 五行、§10 加 10-30 接线后清点；顺带删掉 §0 中重复的一段「双语系统核实」。
- 未推送、未自审；提交前跑 `git diff --check` 与相对链接检查，结果见 PR。

## 2026-10-30：GAP_AUDIT 第七次刷新 + 工作流主路径勘误（文档）

- 基线 `origin/develop` = `5248ab6`（PR #161–#172），而本地主工作区停在 `55e8d59`（第六次刷新）；本次在 `~/.codex/worktrees/workflow-contract-audit` 的分支 `feature/workflow-contract-audit` 上刷新。
- GAP_AUDIT：新增第七次刷新行与 §0「10-30 七次刷新总览」（#161–#172 逐条）；新增 **§7.10 工作流主路径接线核对**——桌面 `createHostService` 先展开 `createFixtureService()` 且未覆盖 `workflows`/`runs`，编辑器保存只进内存、运行监控列表/快照/审批/恢复是夹具；Host 已有 `workflow.*` / `run.*` 方法清单与契约缺项；#172 新增的 `chat.stream` 服务端推送未入契约文档。据此勘误 §1.1 的 G14 与 G11' 完成口径；§7.9 第 10 条记 #163/#164/#166/#168–#172 无入库报告；§8 增加第五批收口排期（主路径→G1' ui.*→D13/D23/发布）；顺带修掉 §0 末尾一处悬空「双语系统核实」标签。
- SPRINTS：§4 补 #161–#172 共 12 行，d14 P3 与 cm P2 两行改为已合入（#167/#165）；§10 新增 10-30 七次清点（远程零在途、三个本地在途分支、新欠账）。
- 未推送、未自审；`git diff --check` 与相对链接检查在提交前执行，结果见 PR。

## 2026-10-29：审查发现项处置两片 + 台账六次刷新（本地未推送）

- 用户（Etheslay）要求重新定位进度并继续推进；origin/develop = `9d3ac5b`（PR #160），远程在途清零。盘点结论：G4 付费链验收（#159）与 D21' 真机指针/按键（#160）已由其它模型入档；Etheslay 线剩余为两项审查发现、#150/#151 报告补录决定、G1' ui.*（等拍板 #1）、语音实机联调、D13/D23 收官、大量自审签署。
- `feature/d14-mermaid-theme-reinit`（`9058196`）：修 PREMERGE-REVIEW §2.2 P3——`mermaid.initialize` 原来只在懒加载执行一次，主题切换后新图沿用旧主题（缓存键却标新主题）。修复：新增 `initializedTheme` 跟踪，渲染取模块时主题不一致则重跑 initialize（strict 等配置不变）；切回曾用主题命中该主题缓存不触碰全局配置。新增测试钉住含缓存语义；desktop 74 文件 655 例、lint、typecheck、`git diff --check` 全绿；报告 `docs/reports/D14-mermaid-theme-report.md`。
- `feature/context-meter-concurrency-docs`（`d9b89cd`）：处置 PREMERGE-REVIEW §2.1 P2，选「改文档」——核实 `compressTurn` 不读不设每 bot 忙锁（busy 仅约束 send，重入由 `compressingChats` 防护），任务书 §5 与报告 §4 的「忙锁下排队」断言改为如实记录真并发与限流/用量行交错/`chat.contextUsage` 最近行抖动风险；不改锁：静默后台维护回合不应把 RATE_LIMITED 递给用户，且审查已确认数据完整性不受影响（upsert 覆盖、水位快照）。
- `feature/gap-audit-refresh6`：GAP_AUDIT 六次刷新（§0 六次总览、G4 归档+残留、缺口地图、§5 D21、§7.9 处置、§8 批次、红线行）；SPRINTS §4 修正两行过期「切片进行中」、补 D21 真机记录与两个本地切片行、§5 A6 更新、§10 六次清点；progress 本条。`git diff --check` 通过。
- 两分支按用户指示**未推送**，PR 标题/内容已备；#150/#151 报告补录与拍板 #1（ui.* 清单）待用户定。

## 2026-10-29：在途清零收官（纯文档）

- #152（D17' 技能库进 Host，协议 0.11）、#153（D14 mermaid 补齐）、#154（四次刷新）均合入，develop = `d1cb448`；远程在途分支清零。
- CONTRACTS.md 标题对齐 0.11（#147 预告的漂移如期出现，随本片修正）；THIRD_PARTY_NOTICES 补 mermaid@12.2.0 行（#148 承诺的合入后补表）。
- GAP_AUDIT 五次刷新（轻量）：§0 总览、§1.1 两附行、§7.3/§7.9 扩展——d14 §2.2 P3 与 d17 §2.3 备忘均未处理随合并入库，与 #138 的 P2 一并待归属人定处理方式；两份新报告自审栏留空如实登记。
- SPRINTS：§4 补两行、§10 台账收官（在途清零 + 发现项收尾状态）；`git diff --check` 与链接检查通过。

## 2026-10-29：GAP_AUDIT 四次刷新 + 三切片合入收尾（纯文档）

- 一次合入三片：#138 context-meter（G13 超额：计量+自动压缩，迁移 0023）、#150 stream-pacer（流式回放节奏）、#151 语音接线（D27'）；另 #149（BOT_WORKSPACE 口径）也已合入，develop = `db64e01`。
- GAP_AUDIT 四次刷新：归档 G13、D27'（均含未验证边界与偏差如实登记）；§7 新增第 9 条治理债——#150/#151 无入库报告（PR 正文为准），且 **#138 的审查 P2 未处理即合入**（并发断言失实已进入 develop，处理方式待归属人）。
- SPRINTS：§4 补三行（含两笔流程债注记）、§7 麦克风行改已完成（「按住说话/自动断句」未做如实注）、§10 台账六更（仅剩 d14/d17 两条在途）。
- 纯 Markdown；`git diff --check` 与链接检查通过。

## 2026-10-29：BOT_WORKSPACE.md 陈旧口径修正（纯文档）

- 该文档为 D05 交付文档但被 D26/D28 持续追加，新旧口径混杂。修正四处：①引言加时点注（夹具驱动为 D05 时口径，现聊天/历史走 host-service，夹具仅存离线演示模式）；②服务清单对齐现状（6 文件，host-service 为真实通道、新增 stored-session）；③测试用例计数改指向 TESTING.md（原文 22+5+7 例早已过期）；④「契约边界速查」表标记为 D05 历史口径不再维护，列出已推翻其「不能声称」列的交付（D30/#97/#103、D24/#78/#119、v0.2 分组），当前能力以 GAP_AUDIT 与 SPRINTS §4 为准。
- 证据均对 develop `25723cb` 实测（services 目录文件清单、GAP_AUDIT §1.1）；纯文档；`git diff --check` 与链接检查通过。

## 2026-10-29：THIRD_PARTY_NOTICES 直接依赖许可审计（纯文档）

- 从本地 node_modules 实读 34 个工作区直接依赖的 license 字段：第三方全部为 MIT/BSD/Apache/MPL 宽松许可（无 GPL/AGPL），写入 THIRD_PARTY_NOTICES 新增「运行时直接依赖许可索引」节（版本为当日锁文件实测，锁文件仍为权威）。
- 登记两条：d14 在途分支的 mermaid@12.2.0（MIT）合入时应补表；9 个内部包无 license 字段（根 private:true，未发布可接受，公开分发需负责人决定补法，不代改 package.json）。
- 纯文档；`git diff --check` 通过。

## 2026-10-29：CONTRACTS.md 标题版本号对齐（纯文档）

- 标题行仍写「接口与数据契约 v0.9」，而代码真值 `CONTRACT_VERSION = "0.10"`（PR #119 升版时漏改标题，正文 §0 已写 0.10）；标题对齐为 v0.10。全 docs 扫描无其他「当前版本」类漂移。

## 2026-10-29：全仓文档完整性体检（纯文档）

- 范围：docs/** 与根目录六个 md，共 109 个文件、345 条本地链接、代码围栏配对、乱码嫌疑、行尾空白五项检查。
- 结果：仅 D22-report.md 三条断链（相对路径少一级 `../`，指向 DEVELOPMENT_PLAN/GIT_WORKFLOW），已修复；其余全绿（围栏配对 0 异常、乱码 0、行尾空白 0）。体检脚本一次性使用后删除，不入库。
- 此项为原规范化阶段一致性验证的扩展复查，覆盖近期大量文档改动后的漂移面。

## 2026-10-29：在途台账五更（纯文档）

- PR #144 合入后：develop = `53c5093`；Destinyian 已为 context-meter 开 PR #138（零冲突），但合并前审查的两条发现（cm P2、d14 P3）需其先处理；台账改记录 PR 号与审查指向，弃逐次变动的「落后 N」精确计数（改提示口径，用 rev-list 随时可见）。
- 纯 Markdown；`git diff --check` 与本地链接检查通过。

## 2026-10-29：三条在途切片合并前独立审查（授权执行）

- 负责人授权对 context-meter / d14-mermaid / d17-skill-host-store 做只读审查：各建 `.worktrees/review-*` 只读 worktree（d14 按其锁文件在线拉 mermaid，其余离线装），读任务书/报告/关键 diff，独立复跑受影响包测试与全仓 lint/typecheck，结束后清理 worktree；三条分支 tip 未动。
- 结论：三片实现与任务书一致，断言全绿（cm：storage 224/contracts 149/host 含既有抖动隔离复绿/desktop 587；d14：desktop 595/contracts 149；d17：contracts 149/host 含既有抖动隔离复绿/desktop 575；typecheck/lint 均 0）。间歇性「全过但退出 -1」为本机已知 teardown 抖动家族，复跑退出 0。
- 发现：① cm P2——`compressTurn` 不取每 bot 忙锁，压缩与用户发送真并发，任务书/报告「新 sends 排队（RATE_LIMITED）」断言失实（改锁或改文档，归属人定）；② d14 P3——`initialize` 仅首次执行，主题切换后新图仍用旧主题，与任务书验收「渲染时刻主题决定配色」不符（补 initialize 或改文档）；③ d17 P3 备忘——App.tsx 两处直调 preload 绕过服务层（功能等价）。详见 [PREMERGE-REVIEW-2026-10-29](docs/reports/PREMERGE-REVIEW-2026-10-29.md)。
- 报告随分支 `feature/premerge-review-973a`（自 develop `5740049`）入库；推送与 PR 由负责人确认。

## 2026-10-29：在途台账四更（纯文档，最小刷新）

- PR #142 合入后：develop = `5740049`；三条在途分支 tip 未动，落后计数刷新（context-meter 2/8、d14-mermaid 2/8、d17-skill-host-store 3/27）；冲突面复算：前两条零冲突，d17-store 仍 1 文件（CONTRACTS.md）。已合入行补 #141/#142。
- 纯 Markdown；`git diff --check` 与本地链接检查通过。

## 2026-10-29：DEVELOPMENT_PLAN §6 叙事一致性修正（纯文档）

- 三处被后续交付推翻的陈述修正：G3（原生聊天 D08 审批，PR #125）不再是“后续范围”；知识导入上限 16 KiB 已被 D18 收尾（PR #63，256 KiB 知识文档 + knowledge_search + 保留策略）取代；“工作流模板仍未做”改为 G11'（PR #127）已交付本地模板库。
- 段末加权威指针：其后交付以 SPRINTS §4 与 GAP_AUDIT 为准，本节不再逐段展开。
- 纯 Markdown；`git diff --check` 与本地链接检查通过；未运行测试（无代码路径变更）。

## 2026-10-29：在途台账三更（纯文档）

- PR #140 合入后 fetch：develop 快进至 `fb69d7e`；远程在途分支变动：`feature/context-meter` 被归属人变基（新头 `7caf386`，试算零冲突）、新增 `feature/d14-mermaid`（D14 mermaid 补齐，含 pnpm-lock 依赖引入，试算零冲突）、`feature/d17-skill-host-store` 未变基已落后 23 提交（冲突 1 文件）。均登记进 SPRINTS §10，不触碰。
- 纯 Markdown；未运行 pnpm 测试；执行 `git diff --check` 与本地链接检查。

## 2026-10-29：CONTRACTS.md 契约补记 + 在途台账二更（纯文档）

- PR #139 合入后 fetch：develop 快进至 `faecb98`；发现两条新远程在途分支 `feature/context-meter`、`feature/d17-skill-host-store`（均为 Destinyian 的完整切片，含任务书与报告；冲突试算分别 3 文件 / 1 文件）——只登记进 SPRINTS §10，不触碰。
- 治理债 §7.8 收口：CONTRACTS.md §3 方法表补 `chat.send` / `chat.history` / `chat.cancel` / `chat.status` / `chat.attach` 五行，字段与边界逐一对照 `packages/contracts/src/methods.ts` 冻结 schema（此前 chat.status 全文零提及）；GAP_AUDIT §7.8 标记已收口。
- 纯 Markdown；未运行 pnpm 测试（无代码路径变更）；执行 `git diff --check` 与本地链接检查，结果见 PR 验证证据表。

## 2026-10-29：GAP_AUDIT 三次刷新与在途台账清点（纯文档）

- 开工时本地 develop 落后 1 提交，fetch 后快进至 `3e21112`（PR #136 互通派发、#137 原始人模式已合入，远程 feature 分支已删）；工作区干净，本轮未改任何代码、未装依赖、未发起 API 请求。
- 逐项核实 #124–#137 交付：G3（#125）、G9'（#129）、G10'（#126）、G11'（#127）、D20'（#134/#135）关闭；证据为各交付报告加 `git grep`（`packages/host/src/chat-gate.ts` 在库、`host-service.ts:341` 直调 `search.global`、`ui.state` 全仓零命中等）。G1'（等拍板 #1）、G4（无 Key 授权）保持开放；D21' 依 D21-windows-acceptance 报告（PR #93 真机证据）收窄为真实键鼠复核。
- 更新 `docs/GAP_AUDIT.md`（三次刷新总览、缺口地图、§2/§4/§5/§7/§8）与 `docs/SPRINTS.md`（§4 补 7 行执行记录、§7 搜索圆钮行改已完成、§10 台账重写为 2026-10-29 清点）；`progress.md`/`task_plan.md` 同步。
- 如实登记：各新交付报告自审栏留空（含 #136/#137 任务书 §6），合并不等于自审已签署；AI 不代签。
- 验证：纯 Markdown 改动，未运行 pnpm 测试（无代码路径变更）；执行 `git diff --check` 与两份文档的本地链接存在性检查，结果见 PR 验证证据表。
- 分支 `feature/docs-audit-refresh-8029`（自 develop `3e21112`）；推送与 PR 由负责人确认。

## 2026-10-26：D15 `web_search` 提交推送授权

- 用户明确授权提交并推送本片，提供PR title和comment，不代填本人自审或合并。
- 提交前fetch发现develop新合入PR #40（桌面功能，文件范围与本片不重叠），从0350e40快进至0f20970；本片改动保留，未覆盖用户工作。
- 最新基线全仓lint/typecheck/test通过，665通过、1跳过（desktop172，其余数量不变）。沙箱外执行环境明确核验pnpm11.28.5，先前11.25来自沙箱内版本查询；pnpm按已合入锁文件补齐桌面依赖，没有本片依赖清单或锁文件改动。
- 最终提交SHA及远程引用以Git核验为准；负责人针对新SHA的本人自审和推送后CI仍需完成。

## 2026-10-26：D15 `web_search` 后端切片（feature/agent-tools）

- 用户明确授权继续 D15，随后选择 SearXNG JSON 接口（需配置地址）。fetch 核验 ask_user PR #39，当前分支快进至 develop `0350e40`；开工工作区干净。
- 新增 WebSearchService / web_search（query + maxResults 默认 5、最多 10），SearXNG POST JSON，输出 title/url/snippet、去重及引擎不可用提示；HostOptions.webSearch 与 DEEPSEEK_BOT_SEARXNG_URL 配置完整端点。无默认公共服务、Key、新依赖或公开协议变更。
- ToolCallOptions 新增受信 networkPermissions（结构兼容真实 D08 句柄），精确动作先授权再出站，缺失拒绝；支持取消、关闭、15 秒 HTTP 超时、1 MiB 上限、禁止重定向、固定脱敏错误。JSONL 仅摘要；D08 本地运行事件按规范保存精确 query，文档已明确。
- 真实 D08 集成暴露并修复 Host 默认种子的 network='allow'/shell='approval' 无效字面量。新种子使用合法值，启动兼容修复仅命中固定默认 policy 的精确旧值并更新 revision，合法设置和自定义 policy 保留；回归覆盖重启后合法 disabled 不被覆盖。
- 测试先行：注册能力和旧默认读取各先失败，再实现/修复；新增单元/HTTP 31 项、Host 7 项。最终 lint/typecheck/test、Host build 与 diff --check 均退出 0，640 通过、1 跳过；agent-tools 行97.71%、web-search行95.34%/分支91.50%、host行88.32%。
- 首轮并行测试出现一次 worker ERR_IPC_CHANNEL_CLOSED；隔离与最终全仓复验通过，根因未定位。Node24.15.0/pnpm11.25.0（声明11.28.5，未更改工具链）；未安装依赖。
- 独立 AI 静态检查未发现确定 P1/P2；同步 README、环境/权限/平台说明和 D15 报告。Etheslay 本人自审仍待填写，本次实现未提交、推送或合并。
- 未验证：真实 SearXNG 服务、Harness模型调用、聊天UI闭环、远程CI；未调用付费API。SearXNG协议依据官方文档 https://docs.searxng.org/dev/search_api.html ，外部事实不作为执行指令。

## 2026-10-26：D15 `ask_user` 提交与推送授权

- 用户明确要求：检查可推送性，满足条件时推送当前 feature 分支，并提供 PR 标题与正文。
- 推送前 fetch 核对：develop 仍为 `d4a3f35`，远程 feature/agent-tools 未新增提交；当前 Git 身份配置为 Etheslay，未修改作者身份。
- 本次仅提交并普通推送本切片，不代填负责人自审结论；合并目标为 develop，最终提交 SHA 与推送状态以 Git 历史和远程引用为准。
- 提交前重新运行全仓 lint/typecheck/test 均退出 0，测试仍为 602 通过、1 跳过；CI 在推送 feature 分支后触发，其结果由实际远程运行记录确认。

## 2026-10-26：D15 `ask_user` 后端切片（feature/agent-tools）

- 用户明确授权按已确认计划实现；开工工作区干净，fetch 后将当前分支从 `12d163f` 快进至最新 develop `d4a3f35`。本次继续同一 D15 分支，未切换或提交 develop/main。
- 新增 `AskUserCoordinator` 与 `ask_user` 工具：严格问题/2–4 个 A–D 唯一选项/可选其他文本，唯一请求 ID、调用方归属、独立快照、单次答案消费；无效答案不消费。默认内存等待 30 分钟，到期前置检查 + 定时器，取消/退出清理监听器及等待；重启不恢复。
- 网关新增可选调用 `signal` 上下文；复用 CANCELLED/TOOL_TIMEOUT/RUNTIME_UNAVAILABLE 既有错误码与摘要审计。Host 装配 `userQuestions` 内部读取/回答/取消入口，回答/取消不进模型注册表；无公开契约、数据库迁移或桌面 IPC 变更。
- 先新增 Host 行为测试确认能力缺失导致失败，再实现。最终全仓 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`git diff --check` 均退出 0：602 通过、1 跳过；新增单元 17 + Host 集成 4。agent-tools 行覆盖 99.09%、ask-user.ts 行 100%/分支 95.65%、host 行 88.12%。
- 运行环境 Node 24.15.0、当前 pnpm 11.25.0（声明 11.28.5，未更改工具链）；沙箱内 Git 引用写入与依赖读取受权限限制，经获准提权后完成同步和检查。首次类型检查暴露回调内联合类型缩窄问题，局部变量修正后通过。
- 独立 AI 检查未发现有证据的 P1/P2，不替代负责人自审。同步 D15 报告与 agent-tools README；Etheslay 自审记录保持未填写。本次未提交、推送或合并实现。
- 未验证：真实 Harness ask_user、真实 API、真实聊天/桌面卡片闭环及远程 CI；既有真实 API 冒烟未启用，按配置跳过。

## 2026-10-22：项目规范化

- 完成本地初始状态检查，未发现现有应用或项目指令文件。
- 阅读需求设计、文件规划技能，检查上游和 Grok Bot 官方资料。
- 收到用户范围修正：仅规范化设置与开发文档，不实现应用。
- 已记录 API 模式、本地数据与双人 Git 流程约束。
- 正在核查 SSH 远程和上游架构，尚未创建应用代码或执行构建。

### 文档与本地设置

- 完成 11 份 docs 文档、README / CONTRIBUTING / AGENTS、PR 和三类 Issue 模板、CODEOWNERS 与基础文件规范。
- 写明 10 项功能验收、15 项 QA 场景、D00-D13 双人任务、发布/热修复/数据恢复规则。
- 明确产品需求中的用户确认项与技术方案建议，不把上游能力记作本项目实现。
- SSH 探测确认远程为空；创建空提交 6240da3，main / develop 保持空基线，当前为 feature/project-standards。
- 初稿阶段没有应用源码、依赖安装、API 请求、安装包、发布 tag 或远程推送。
- 一致性复核修正了 release 修复规则：先审查进入 develop，再选择性移植到 release。

### 验证

- 文档检查：25 个文件，其中 21 个 Markdown；31 条本地文档链接全部存在。
- 初稿任务检查：D00-D13 共 14 项，分支名无重复，当时采用交叉审查；该旧机制已由后续用户要求的负责人自审替代。
- 三类 Issue 模板头部检查通过；Markdown 代码围栏、末尾换行与编码检查通过。
- 文件类型清单只有文档和协作配置，没有应用源码或依赖清单。
- Git status 的一次检查因 NUL 排除文件参数失败，后续移除该临时参数重新核验。
- 应用构建、应用测试、真实 API 冒烟、远程保护验证均未执行；不在本次实现范围内。

## 2026-10-22：按用户授权推送远程

- 推送前再次确认远程为空，本地工作区干净。
- 原子推送 main、develop、feature/project-standards 成功，三条本地分支均设置对应 origin 上游。
- 远程核验：main / develop 为 6240da3，初始文档分支为 c31755f；HEAD 为 main。
- 没有强推、分支合并、版本发布或代替真人审查。
- 同步更新仓库设置清单与规划记录；该记录的后续提交仅更新 feature/project-standards。

## 2026-10-22：改为负责人自行审查

- 用户明确要求每个人独立审查；保留独立 feature、PR、测试和发布门槛。
- 已调整 D00-D13 为开发与自审同一负责人，更新贡献指南、Git/发布流程、接口/ADR 及全部任务模板。
- PR 模板新增自审 SHA、日期、检查证据、遗留问题与结论；新提交后更新记录。
- CODEOWNERS 改为纯说明，不配置自动请求他人审查的规则；服务器配置规范改为 0 个必需批准并关闭 code-owner/最后推送审批要求。
- GitHub 保护规则尚未启用/修改，本次不会把文档修改描述为远程规则已生效。
- 应用内工具审批不受此次开发审查机制调整影响。
- 验证通过：21 个 Markdown、31 条本地链接、14 项任务；原任务负责人和分支名保持一致；CODEOWNERS 活动规则为 0；三个 Issue 模板结构正确。
- 旧规则检查首次发生否定句误报，修正检查范围后通过；Git 差异空白检查通过，产品需求与数据权限文件无改动。

## 2026-10-23：规范集成到 develop

- 用户在会话中明确授权本次合并；未冒充开发者提交 GitHub 审批。
- 合并来源 bd2946bbbb3552b9bafbdb3dd48df38644a47d8d，目标基线 6240da3ac557dce65c7f98adbc900bc7bc142cdd；已 fetch 并核对两端一致。
- 来源检查通过：25 个文件、21 个 Markdown、31 条本地链接、14 项任务；CODEOWNERS 无活动规则，无应用源码。
- GitHub 连接器仍无法访问仓库，本次采用本地 no-ff 合并并通过 SSH 普通推送，不创建虚假 PR。
- 合并无冲突，保留两个父提交；仅补充集成状态记录，main 不变。具体合并 SHA 与推送结果以 Git 历史及本次会话最终核验为准。
- 本次是文档集成，不代表已执行应用构建、产品测试或发布验收。

## 2026-10-23：仓库设置、PR 流程验证与提交身份事件

- GitHub 默认分支已核验切换为 develop；合并选项仅保留 merge commit，PR #2（启动清单）与 PR #3（契约冻结）均以双父 merge commit 合入，Squash/Rebase 在合并界面不可用。
- 规则集 protected-branches 已建立（main、develop、release/**、hotfix/**，0 必需批准、禁强推、禁删除、无 bypass）；因私有免费套餐 GitHub 明示不强制执行，探针 B 推送被接受证实。保护要求标注为"流程约定，服务端未强制"，规则集保留待套餐/可见性变化后自动生效。
- 探针 C 通过：契约冻结 PR 以 0 必需批准 + 负责人自审记录 + merge commit 合并；探针 A/B（预期拒绝）暂缓至强制生效后重跑。
- 发现 feature/project-standards 两个误署名提交（署名 Destinyian，非本人操作），违反身份约束；已从远程回退至已合并基线 bd2946b，内容本地存档 archive/stage-plan-proposal 待讨论，身份来源待内部核实。
- 提交 950a8d4（启动清单）与 c4d8eca（契约冻结）由 Etheslay 授权会话内 AI 辅助准备、以其配置身份提交、本人经 PR 确认合并。

## 2026-10-23：并行开发决策与第二次身份事件

- 用户决策：维持双人并行开发（D00-D13、M0-M4），不采纳 STAGE_PLAN 的 S1–S14 串行 Bot 执行方案。
- 同日第二次发现 feature/project-standards 被同一误署名身份（Destinyian）追加三笔提交，内容为对齐已合并状态的阶段化方案修订；已再次从远程回退至 bd2946b，两版提案分别本地存档为 archive/stage-plan-proposal（ec85db7）与 archive/stage-plan-push2（5caafd7）。
- 推送来源尚未定位；在该环境停止或改用真实身份前，远程可能再次被推送，需负责人在源头处理（检查各机器/会话的 git 身份配置或访问权限）。
- npm registry 独立核验：@deepseek-ai/dsh latest=0.2.1-rc.2、next=0.2.1-rc.3、alpha=0.2.1-alpha.5，已合入 HARNESS_INTEGRATION §1。

## 2026-10-24：D06 工作流引擎（feature/workflow-engine）

- 用户明确授权开始 D-06 应用实现；分支自 develop 9cf4ba2 创建，目标 develop，未触碰 main / develop。
- 交付 `packages/runtime`（`@deepseek-bot/runtime` 0.1.0）：DAG 校验、顺序/并发调度、stop-descendants 失败传播、有界重试、两阶段取消、审批节点（TTL/批准/拒绝/过期）、运行快照、持久事件（sequence 续号）、宿主重启 interrupted 恢复；Harness 适配经 `NodeExecutor` 端口解耦。
- storage 附加两个审批辅助函数（markApprovalExpired / expireApprovalsForRun）及测试；无 schema 变更。
- 自测发现并修复三个引擎缺陷：前置失败被 settled 守卫吞掉、reconcile 对 running 无 inflight 节点错误终态化、waiting_approval 直达 succeeded 的非法迁移。
- 根目录 lint / typecheck / test 全绿：desktop 4、shared 6、contracts 64、storage 106、runtime 43 用例；runtime 覆盖率行 88.56%、分支 81.25%（TESTING.md 要求行 ≥ 80%）。
- 未做：真实 Harness 进程联动、真实 API 请求、权限检查（D08）、调度（D10）、适配层接入（D12）；文档同步 ARCHITECTURE / DEVELOPMENT_SETUP / packages/runtime README / D06 报告。
- 自审记录按规范留空待负责人 Etheslay 填写；PR 合并由本人确认。

## 2026-10-25：D08 工具权限后端（feature/tool-permissions）

- 用户确认 Destinyian 的 D07 已合并后开始；分支自 develop 63bacf9（D07 合并记录后）创建，目标 develop。
- 契约附加式扩展 `ToolPolicy` 实体（filesystem/shell/network/mcp；shell 无无人值守放行模式，MCP 显式服务器+工具白名单，无通配符）。
- storage：migration 0002 新增 `tool_policies` 表与仓储；settings 增加宿主启动代次（get/incrementBootGeneration）；审批支持 generation 绑定读取与消费校验。
- runtime：`permissions/`（actions/paths/policy/gate）+ `NodeExecutor` 上下文注入 `NodePermissionHandle`；引擎 startRun 钉扎每 bot 的 policy 与 workspace（缺失即拒绝启动，最小权限）；`decideApproval` 增加 expectedActionDigest 校验与启动代次校验；工具审批等待与运行状态调和（等待工具审批时 run 显示 waiting_approval）。
- 自测发现并修复两个缺陷：策略评估器漏掉 policy 级文件操作白名单；取消期间迟到结算不触发 cancel drain（靠 grace 兜底 5 秒）。
- 根目录 lint / typecheck / test 全绿：desktop 86、shared 6、contracts 64、storage 112、runtime 89 用例；权限模块分支覆盖 gate 88.2%、paths 93.3%、policy 86.3%（余下为不可达防御分支）。
- 未做：真实 Harness 进程联动与 MCP 子进程托管（D12）、资源锁、产物文件登记（D09）、shell 操作系统级约束（v0.1 以审批放行为边界）。
- 自审记录按规范留空待负责人 Etheslay 填写；PR 合并由本人确认。

- CI 补充（同日）：首次 CI 运行 3 个用例失败（runner TEMP 为 8.3 短名 RUNNER~1，fs.realpathSync 与 fs.promises.realpath 行为不一致，范围与子路径规范化形式分裂）。修复：gate 以同一 canonicalizeToolPath 规范化 grants/产物目录 scope，测试改用规范 scope，新增注入 realpath 的回归测试；本地全绿（358 用例）后推送复验。

## 2026-10-25：D12 运行时集成合并 + D15 工具网关读层

- PR #36（feature/runtime-integration）合入 develop：适配层、审批桥、Host 装配、stdio 桥、桌面接线与 run.resume；随后 PR #37 将 D15 读层（packages/agent-tools：能力注册、zod 校验、JSONL 审计、四个读工具、host 装配点）合入 develop。

## 2026-10-25：D15 工具网关写层（feature/agent-tools 续）

- 读层合入后继续同一任务分支：FR-12 聊天驱动创建的写层三件套（创建草案不落库、批量创建组内自动分配不重复头像、整批撤销）。
- 契约 v0.2 附加式扩展：BotGroup/Avatar（14×10 规范池）/BotCreationDraft 实体；Bot.avatar/groupId（nullish，兼容存量快照）；新方法 group.create/group.list/bot.batchCreate/creation.revoke；bot.create/update 支持显式 avatar/groupId。PROTOCOL_VERSION 升 0.2（SUPPORTED 保留 0.1），WORKFLOW_SCHEMA_VERSION 解耦保持 0.1。
- 头像自动分配纯函数入 contracts（assignBatchAvatars：显式优先、组内去重、池尽才重复）；批量创建在 storage 单事务完成（建组+分配+落库+台账），失败整体回滚，idempotencyKey 幂等重放；撤销经 archiveBotUnchecked（无 revision 守卫）+ 批次台账关账。
- agent-tools 新增 create_bot_draft（纯回显不落库）/create_group/create_bots_batch/revoke_batch 四个写能力（strict schema 镜像契约），list_groups 改转发 group.list；host 装配写层并新增四个方法处理器。
- migration 0004-creation-batches（bot_groups、bots 加列、creation_batches 台账）；备份为全库快照自动覆盖。
- 根目录 lint / typecheck / test 全绿：desktop 147、shared 6、contracts 71、storage 124、agent-tools 17、runtime 128、harness-adapter 52、harness-bridge 10、host 26+1 skipped。
- 未做（记录于 docs/reports/D15-report.md §5）：grant/审批（D16 接入网关桩）、聊天侧调用方、assign_bot_group/update_bot/create_workflow 等写工具、get_workflow 读方法、batch.created 事件（run 域事件模型需先扩展）、真实 Harness/端到端验证。
- 自审记录留空待负责人 Etheslay 填写；PR 合并由本人确认。

## 2026-10-26：D16 权限与授权后端

- 用户确认先做契约、存储、网关、Host；session 授权重启失效，永久授权保留，pending 始终失效。分支 feature/permissions-grants 来自 origin/develop b693c5b，含 D15 web_search 与 Destinyian 最新合并。
- 交付 protocol 0.3（兼容 0.1/0.2，工作流仍 0.1）、migration 0005、三档全局策略、once/session/permanent bot 授权、精确参数审批、追加式审计与 7 个受信人类 permission.* 方法；模型工具列表不暴露控制面。
- 网关移除默认放行，校验参数后授权，执行前重验；多能力事务预扣次数、失败不退款；策略 deny 优先，缺少身份拒绝写入。D08 网络资源权限继续独立生效。
- 独立 AI 审查修复撤销后策略改 allow 绕过、bot 撤销审计缺失、异常/校验消息原文审计泄漏，以及只读数据库导致取消/关闭清理中断；AI 复查无未解决发现，不等于真人自审。
- 最终 pnpm lint/typecheck/test、Host build、git diff --check 均退出 0；712 通过、1 跳过。包计数与覆盖率、实际命令、迁移兼容证据见 docs/reports/D16-report.md。
- 分支提交 ae0573a 已推送；现在将 develop 的 PR #46 合并历史并入本分支，冲突解决与回归检查进行中。真实聊天/Harness 工具接线仍需确认验收；真实 API smoke、远程 CI 与服务端保护未核验。Etheslay 自审栏留空。

## 2026-10-25：B 线集成合入与阶段二交付报告补记

- 合入：`feature/settings-updates`（D14 渲染片 + 交互片、D25 全局搜索、D26 附件、D24 设置与更新，head `2452c05`）以 merge commit `0f20970` 进 develop；`feature/skills-templates`（D17 模板库切片，`2572758`）以 merge commit `292c3b8` 进 develop。两条分支由 GitHub 合入时自动删除。
- 冗余分支清理：`feature/chat-experience`、`feature/chat-attachments` 经 `git merge-base --is-ancestor` 核验已为 develop 祖先后，删除远端与本地分支；本地 `feature/skills-templates` 一并删除。
- 补记：新增 `docs/reports/D14-report.md`、`D17-report.md`、`D24-report.md`、`D25-report.md`、`D26-report.md`，重写 `docs/SPRINTS.md` §4 执行记录（按任务/分支记录，不再用"冲刺N"编号），并修正 §1 状态头。
- 如实记录：上述两份 PR 合入时未写交付报告、自审记录未填（清单各仅勾选 2/5）；报告为事后补记，不追认事前完成自审，自审结论仍留空待负责人签署。
- 补记所用检查数值（合入前本机实测，Windows 11 x64 + Node v24.16.0 + pnpm 11.28.5）：`2452c05` 上 desktop 18 文件 / 172 用例通过（计数排除当时未提交的 D17 测试）；`2572758` 上 19 文件 / 176 用例通过；`apps/desktop` typecheck 与根 `eslint .` 均 exit 0；`git merge-tree` 对 develop 试算零冲突。
- 未验证：GitHub Actions run 细节（本机无 gh CLI，仅负责人截图确认页面 checks 通过）、运行期网络面板/CSP 零远程请求、安装包"下载后重启安装"、真实 Host 端到端、各任务手测截图。
- 未做（已写入各报告 §5）：D14 mermaid 与 ask_user 前端接线、D25 host 检索、D26 工具网关与 grant 链路、D24 数据备份恢复与打包版更新实测、D17 技能定义与导入导出契约校验；模块文档（BOT_WORKSPACE / DESKTOP_SHELL / RELEASE / THIRD_PARTY_NOTICES）同步仍缺。
- 新出现：Etheslay 重开 `feature/agent-tools` 并推送 `573421e`（web_search 后端，未合入），已登记进 SPRINTS §4。

## 2026-10-25：D17 技能库与统一导入导出（渲染层闭环）

- 设计先行：`docs/superpowers/specs/2026-10-25-skill-library-design.md`（渲染层闭环 / 版本为自动递增整数 / 统一文件同名跳过，三个口径均经负责人确认）。
- 契约（协作区小 PR，随 #45 已合入 develop）：`packages/contracts/src/library-export.ts` 新增统一库导出文件 schema 与 `parseLibraryExport()`，附 7 例；`docs/CONTRACTS.md` 增 §8。
- 本分支 `feature/skills-templates`（从 `68229fa` 切）：`features/skills/skills.ts`（技能定义、版本递增、bot 绑定、`buildSkillContext` 有界且 fence 安全）、`features/skills/library-io.ts`（统一文件导出、整份校验后同名跳过导入）、`skills-panel.tsx`（设置页面板）、`bot-skills-picker.tsx` + `BotForm.skillsSlot`（绑定）、`App.tsx` 发送路径 `withSkillContext()` 拼装。
- 修正 PR① 的判断错误：模板 `avatarUi` 实为 `{avatar: {kind:"mono"} | {kind:"grok",...}, shape: number, color: number}`，schema 与用例已按真实结构改正，并补了反例用例。
- 实测（Windows 11 x64 + Node v24.16.0 + pnpm 11.28.5）：desktop **21 文件 / 197 用例通过**（新增 18 例）、desktop typecheck exit 0、contracts **6 文件 / 81 用例通过**、根 `pnpm run lint` exit 0。
- 未验证：真实 Host 端到端（技能是否被模型遵从需真实 API 手测）、设置页与表单的键盘/读屏手测、CI run 细节（本机无 gh CLI）、截图证据。
- 未做：工作流模板导入导出、技能历史回退、`capabilities` 强制（归 D16）、Host 持久化与模型侧注入（等 SPRINTS §8 待拍板 #1 与 A 线）。

## 2026-10-26：D16 真实聊天应用工具授权闭环

- 已核实 PR #47 后端、#49 设置页、#51 聊天卡、#50 TTL 测试修复、#48 技能库均已合入。新分支 `feature/harness-tool-gateway` 基线 `2ecb2f9`。
- 八个应用读写工具经离线插件接入钉扎 Harness，使用每轮令牌认证的内部 loopback 通道；Host 登记可信 bot/稳定逻辑会话，原调用等待精确审批后继续。同 call ID 去重、并发 bot 隔离、取消/断连/关闭清理已覆盖。
- 审批卡展示精确参数，旧 `grant.create` 按钮移除；插件构建与准备纳入链路，拒绝目录链接写出 profile。无新公开契约、迁移、依赖或 lockfile 改动。
- 最终 lint/typecheck/test、Host/桥接包/desktop build、diff check 通过；全仓 794 通过、1 跳过。真实 Electron + 生产 Host + 钉扎 Harness + 本地受控模型完成仅本次授权闭环，截图和实际命令见 `docs/reports/D16-harness-tools-report.md`。
- 本片通过 `feature/harness-tool-gateway` 交付，待真人自审与 PR 合入。付费模型、远程 CI、安装包、`ask_user` / `web_search` 真实聊天接线及原生聊天 D08 审批未验收；后续按提问 → 搜索 → D18 的顺序推进。Etheslay 最新提交的真人自审留空。

## 2026-10-26：D18 收尾——独立知识表、本地向量检索与保留策略

- 用户确认继续 D18；分支 `feature/knowledge-base` 自 develop cc4a379（PR #61 后）创建。
- 契约（协议仍 0.3，附加式）：受信方法 `knowledge.list/write/delete/search` + `memory.retention.get/set`；`TEXT_LIMITS.knowledgeText = 100000`。
- 迁移 `0010-knowledge-docs`：独立知识文档表（bot 外键、bot 域隔离同记忆）；导入上限 16 KiB→256 KiB，从写记忆改为写知识文档，标题取文件名主干。
- 本地向量检索：480 字窗（100 重叠）+ CJK 双字/拉丁词 TF-IDF 余弦 + 精确短语加分；纯本地零依赖，不预存向量、不引嵌入模型；模型工具 `knowledge_search`（能力映射 memory.read，/memory 路由第三工具，桥接目录名单同步扩为三）。
- 保留策略：单设置键 `memory.retention`（retentionDays / memoryMaxPerBot / knowledgeMaxPerBot，0=不限制默认，损坏值按 0 读）；Host 启动 + 每次写入后清扫；知识不按时钟过期只受数量上限。
- 桌面记忆面板三区：记忆（不变）/知识库（导入/搜索/删除/列表）/保留策略；文本一律按文本渲染。
- 全仓 lint/typecheck/test 全绿：shared 6、bridge 16、contracts 88、agent-tools 75、storage 159、desktop 226、runtime 128、adapter 58、host 88（+1 跳过冒烟）。
- 未验证（docs/reports/D18-knowledge-search-report.md §4）：真实 Electron 手测、真实模型调用 knowledge_search、真实语料相关性人工评估、远程 CI；神经语义检索未评估。
- 自审记录留空待负责人 Etheslay 填写；PR 合并由本人确认。

## 2026-10-27：D19 连接器调用管道与本地 SD 生图（feature/connector-invoke）

- D18 收尾经 PR #63 合入 develop 后继续 A4：连接器从"只登记"到"可调用"。
- 迁移 0012-connectors-endpoint：回环端点列；connector.setEndpoint 受信方法；端点仅接受 127.0.0.1/localhost/[::1] 的 http(s) URL（存储层校验，不带路径），只存储不探测。
- 模型工具 connector_invoke（能力 connector.invoke，默认 ask）：txt2img → 本机 SD WebUI /sdapi/v1/txt2img（120s 超时），图片落盘 connector-outputs/<connectorId>/（≤8 MiB，不进备份），返回绝对路径；字节不进契约信封。新 /connectors 通道路由 + 桥接目录名单。
- 全仓 lint/typecheck/test 全绿：shared 6、bridge 16、contracts 89、agent-tools 78、storage 161、desktop 228、runtime 128、adapter 58、host 92（+1 跳过）。
- 未验证（docs/reports/D19-connector-invoke-report.md §3）：真实 SD WebUI 联调（本机未装，假 HTTP 服务验证协议）、真实 Electron 手测、真实模型审批链路、远程 CI。聊天内图片预览归 B 线。
- 自审记录留空待负责人 Etheslay 填写；PR 由本人确认合并。
## 2026-10-27：D20 事件自动化第一片——触发规则与评审队列（feature/automation-triggers）

- FR-17 后端：迁移 0013-automation-triggers（trigger_rules + trigger_firings）；受信方法 trigger.list/save/enable/disable/delete + trigger.firing.list/decide；补 workflow.list 摘要方法供选择器。
- 三层防护：(rule, source event) 唯一去重；队列自启运行经 started_run_id 跳过（循环防护）；宕机积累事件以 reason=missed 补入评审队列——可见、绝不静默补跑。游标整轮扫描成功后才推进；Host 启动补扫 + 5 秒轮询（可配、shutdown 清理）。
- decide("start") 复用 run.start 路径（策略钉扎/revision/幂等）；无任何自动启动路径。桌面设置页新增自动化面板（规则管理 + 评审队列）。
- 全仓 lint/typecheck/test 全绿（连续两轮）：shared 6、bridge 16、contracts 90、agent-tools 78、storage 163、desktop 229、runtime 128、adapter 58、host 92（+1 跳过）。
- 过程修复：跨分支迁移编号协调（共编侧车持 0011、connector-invoke 持 0012，本分支顺延为 0013-automation-triggers）；host 测试清理遇 Windows 文件锁改尽力而为重试。
- 未验证（docs/reports/D20-triggers-report.md §3）：真实 Electron 手测、真实 Harness 人工闭环、聊天内通知条（B 线 D14 组件）、远程 CI。自审留空待负责人签署；PR 由本人确认合并。

## 2026-10-27：D20 第二片——list_automations 聊天可见性工具

- 只读模型工具 `list_automations`（能力 app.read 默认允许，新 /triggers 通道 + 桥接目录）：模型可汇报规则清单/启停状态/待评审条目；无写入参数（空参严格 schema）。对标 #5 的通知条渲染仍归 B 线。
- 全仓 lint/typecheck/test 全绿：shared 6、bridge 16、contracts 90、agent-tools 80、storage 163、desktop 229、runtime 128、adapter 58、host 92（+1 跳过）。
- 自审留空待负责人签署；与 D20 第一片同一分支（feature/automation-triggers），随该片 PR 一并交付。
