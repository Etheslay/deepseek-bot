# 开放缺陷收口任务书

- 任务：对照 `develop` `030c54d` 收口已坐实的行为缺口，并修正会把人带偏的台账
- 基线：`origin/develop` = `030c54db0253eac4742c06bddf00785838c38139`（PR #199，2026-11-01 15:45 +0800，即太平洋时间 2026-10-31 23:45）
- 证据来源：该提交上的源码与 `docs/CONTRACTS.md`、`docs/TASK_B3P_VISION_INPUT.md`、`docs/TASK_CONTEXT_METER.md`、`docs/MANUAL_ACCEPTANCE.md`、`docs/GAP_AUDIT.md`、`docs/SPRINTS.md`、`progress.md` 的静态对照
- 本文件性质：任务书。写它的时候没有改产品代码，没有复跑桌面，没有调用 DeepSeek API
- 负责人：Etheslay 与 Destinyian 中的一位认领；AI 不代签自审

## 0. 结论

已坐实、还开着的代码缺口是 **3 项**。其中 1 项动工前要负责人选方案。侧栏死循环已经由 PR #199 修好，本任务不重做。

`docs/MANUAL_ACCEPTANCE.md` 整本仍是「未执行」。那些条目是验收债，不是已失败的缺陷。本任务不把它们改成代码修复。

## 1. 不要重开

### 1.1 侧栏会话子列表死循环（PR #199 已合入）

`useBots` 曾在每次渲染返回新的 `bots.filter(...)` 数组。`App.tsx` 的会话加载 effect 依赖这个数组，每轮先 `setHistorySessions(null)` 再请求 `chat.session.list`，子列表在隐藏和显示之间翻转，点击被吞掉。

现状：`packages` 之外的修复在 `apps/desktop/src/renderer/src/features/bots/use-bots.ts`，`visible` 用 `useMemo(..., [bots])` 稳住引用。回归在 `apps/desktop/tests/features/use-bots-stability.test.ts`：无状态变化时引用不变；`hide()` 之后长度变短且引用更新。

本任务不重写这段。bot 列表的 state 真的变了（新建、隐藏、重排）时，effect 仍会先清空再拉一次。那一次刷新由下一节 2.3 收口，不要把它再描述成死循环。

## 2. 要修的缺陷

### 2.1 视觉能力标志被收成一个布尔值

**现象（静态阅读，本会话未跑 UI）**

- `packages/host/src/vision-capability.ts` 的 `visionCapabilityFor` 只认 `deepseek-flash`。`visionKnown` 与 `visionAvailable` 都等于「模型名在这个集合里」。
- Host 种子模型是 `deepseek-chat` 与 `deepseek-reasoner`（`packages/host/src/host.ts` 的 `seedDefaults`）。这两个名字不在集合里，所以两个标志都是 false。
- `apps/desktop/src/renderer/src/App.tsx` 的 `sendWithAttachments` 只读 `visionAvailable`。为 false 时不调用 `prepareVisionImage`，不往 `chat.send.images` 放块。
- `apps/desktop/src/renderer/src/features/chat/attachments.ts` 的 `composeAttachmentBlocks` 在这时写入模型提示：「当前模型暂不支持视觉理解，无法看图。」图片仍上传到工作区并保留路径。

**和已写契约的冲突**

`docs/CONTRACTS.md` 的 v0.14 视觉段，以及 `docs/TASK_B3P_VISION_INPUT.md` 第二步，写的是：目录外模型 `visionKnown=false`，界面保持中性，发送时由上游按模型门控；像素要么作为图像块送达，要么由上游投影成占位文本，不静默丢弃。

代码把「不在这一条视觉目录里」实现成「已知不支持，并且不附图像块」。`deepseek-chat` / `deepseek-reasoner` 按钉扎目录本来就不是视觉模型，不给它们附图像块本身说得通。冲突点是：任何目录外 id（含种子模型，也含以后换上去的未知模型）都无法和「已知纯文本」区分，桌面也不会把图像块交给 Harness 去门控。

**动工前由负责人选一个方案，执行人不得自行挑选：**

| 方案 | 行为 | 代价 |
| --- | --- | --- |
| 甲 | 目录外：`visionKnown=false`，仍附图像块，交给 Harness 投影或看图。提示改成中性说明，不再写「无法看图」 | 默认 chat/reasoner 发图会走上游投影，可能产生视觉 token 或占位回合。要改发送路径和文案，并补测试。真实看图仍不在本任务里调用 API |
| 乙 | 维持不附图像块。拆开两个标志：目录内纯文本才是 `visionAvailable=false` 且文案写「无法看图」；目录外是 `visionKnown=false`，文案写「未登记视觉能力，本次不附图像块」 | 与现行 CONTRACTS / TASK_B3P「上游门控仍是权威」字面相反。选乙必须先改这两处句子，再改代码 |
| 丙 | 保持只给 `deepseek-flash` 附图像块。把契约和 TASK_B3P 改成「本地目录是准入，不是上游权威」 | 代码改动最小。默认模型看图仍要求用户把模型换成 flash。E4 真实往返仍未执行 |

选甲或乙时，`vision.status` 的响应字段保持 `{ model, visionAvailable, visionKnown }`，不升协议版本：两个布尔的组合变了，字段名和缺省 `images` 形状不变。选丙只改文档。

**验收（方案确定后才写代码）**

- 单测钉住所选方案的三行：`deepseek-flash`、`deepseek-chat`、一个目录外假模型名。三行的 `visionKnown` / `visionAvailable` 与是否产生 `images` 块必须不同，不能再是同一个布尔。
- `composeAttachmentBlocks` 的提示与所选方案一致，并有对应用例。
- 不调用真实 API。不把 E4 写成已通过。

### 2.2 `deepseek-flash` 没有上下文窗口

**现象**

`packages/host/src/context-window.ts` 的 `MODEL_CONTEXT_WINDOWS` 只有：

- `deepseek-chat` → 128000
- `deepseek-reasoner` → 128000

注释写明数字来自 DeepSeek-V3.1 的 128K 说明，未知模型名落到 `fallbackTokens`（默认 65536），禁止猜测。`deepseek-flash` 是视觉目录里的唯一模型，却不在这张表里。用户把 bot 切到 flash 后，`chat.contextUsage` 的分母是 65536，80% 压缩会按这个偏小的窗口触发。

**做法**

1. 只采用供应商文档里写明的窗口。能引用到公开文档的具体数字时，把 `deepseek-flash` 加进 `MODEL_CONTEXT_WINDOWS`，并在注释里写来源和查阅日期。
2. 文档没写、或写了但和本仓库已引用的 api-docs 对不上：不要填 128000，不要填别的整数。保持回落 65536，在 `context-window.ts` 注释和本任务报告里写「flash 窗口未在供应商文档载明，继续回落」。
3. 补一条测试：flash 在「已登记」和「继续回落」两种结果里只断言实际采用的那一种。

**验收**

- 测试不读网络。
- 报告里摘录所引用文档的原句；没有原句就明确写未登记，不得把回落说成 128K。

### 2.3 同一 bot 下会话子列表被无关列表更新清空

**现象**

`App.tsx` 会话加载 effect 的依赖是 `[selectedBot, bots, desktop]`。函数体一开始就 `setHistorySessions(null)`。`bots` 是 `useBots` 返回的可见列表。2.1 节的死循环修掉之后，只要 bot 列表 state 换了新数组（新建、隐藏、`applyPersistedOrder`），选中的 bot 没变，子列表仍会先变成空再重新请求。

切换 bot 时先清空是对的：注释写了不能把上一个 bot 的会话闪在新 bot 下面。

**做法**

- 选中 bot 的 id 变了：立刻清空，再拉新列表。
- 选中 bot 的 id 没变，只是 `bots` 数组换了引用：保留当前子列表，请求返回后再替换。失败时保持原列表，不要把已有列表覆盖成空数组。
- 把「要不要清空」收成可单测的纯函数，避免为了这条去挂整棵 `App`。

**验收**

- 纯函数：同一 bot id → 不清空；bot id 变化 → 清空。
- desktop 现有 `use-bots-stability` 仍过。
- 本任务不要求真机点击。真机复核写进报告的未验证项。

## 3. 已知取舍，默认不改

`docs/TASK_CONTEXT_METER.md` 已记录：`compressTurn` 不占每 bot 忙锁，压缩和用户发送可以同时跑。摘要是覆盖写，水位取压缩前快照，数据行不被写坏。风险是供应商限流，以及 `usage_events` 交错时 `chat.contextUsage` 取到最近一行。

这是审查后的书面取舍（PR #165），不是本任务的缺陷。要改锁必须另开任务，并写明用户会在压缩期间看到 `RATE_LIMITED`。

## 4. 未验收，不是缺陷

下列条目在 `docs/MANUAL_ACCEPTANCE.md` 的结果栏是「未执行」。本任务不改它们对应的功能，不把「未执行」写成失败，也不写成通过。

| 节 | 内容 |
| --- | --- |
| A | 工作流主路径 12 步 |
| B | 重启后的 bot 顺序、选中、分组、折叠 |
| C | whisper 路径、按住说话、朗读 |
| D | 启动日志里不再出现 `entry did not activate` |
| E | 真实 SearXNG、原生工具审批、账单模型名、flash 看图往返（E4） |
| F | 设备点击（可选，不阻塞 D23） |

D13 性能预算和 D23 平台验收仍按 `docs/GAP_AUDIT.md` §8 排在真机手册之后。打包工作流缺少 `--publish never` 已由 PR #198 改过；`quality` 工作流在账单恢复后有没有重新跑绿，台账写的是待下次实跑，本任务不补跑、不代填结果。

## 5. 台账修正

与第 2 节分开提交。只改失实句子，不重写第九次缺口审计。

| 位置 | 失实内容 | 改成 |
| --- | --- | --- |
| `docs/TASK_G12_MULTI_SESSION.md` 契约节与迁移节 | 协议 v0.12，迁移 0024 | 协议 v0.14；迁移是 `0026-chat-sessions`（0025 已被附件解析占用）。文件头保留「语义决定」的历史说明，用一段勘误指出集成后的真实版本，不要假装当初就是 0.14 |
| `README.md`「当前阶段」 | 停在 D16 工具授权闭环 | 改成指向 `docs/GAP_AUDIT.md` 与 `docs/SPRINTS.md` §4 的现状句：运行时与桌面已集成到协议 v0.14，发布验收未完成。不逐条罗列已交付功能 |
| `docs/SPRINTS.md` §4 最后一行 | 侧栏闪烁修复仍写「本 PR」 | 改为已合入 PR #199，SHA `030c54d` |

`docs/GAP_AUDIT.md` 第九次刷新的基线行停在 `3110004`。#197–#199 只在 §7 第 11 条和 `progress.md` 有补记。本任务不展开第十次刷新。状态行已经指向本文件，不要再改那一行的结论。

## 6. 明确不做

- 不重做 PR #199 的 `useMemo`。
- 不调用 DeepSeek API，不替 E4 做真实看图。
- 不猜 `deepseek-flash` 的上下文长度。
- 不改 `compressTurn` 的锁。
- 不补写 #189–#195 的交付报告，除非负责人另外指定某一份，并提供当时的检查记录。没有记录就保持「无报告」。
- 不改协议字段名，不新增迁移，不改 Electron、Harness 适配或数据库结构。
- 不填写负责人自审记录。

## 7. 实施顺序

1. 第 5 节台账修正可以先做，不依赖第 2.1 节的方案。
2. 第 2.2、2.3 节可以并行，互不改同一文件。
3. 第 2.1 节等负责人在 PR 里写明甲、乙或丙之后再改。没写明就只交台账和第 2.2、2.3 节，并在报告里把 2.1 标成阻塞。

分支从最新 `origin/develop` 拉。建议按意图拆提交：

- `docs: correct the v0.14 ledger drift`
- `fix(host): record the flash context window`
- `fix(desktop): keep the session sublist while the bot list identity changes`
- `fix(host): split vision known from vision available`（仅在方案确定后）

## 8. 完成定义

- 第 2.2、2.3 节有测试，根目录 `pnpm lint`、`pnpm typecheck`、`pnpm test` 实际跑过并记入报告。
- 第 2.1 节要么按已选方案验收，要么在报告里标阻塞并附负责人尚未选择的事实。
- 第 5 节三处失实句子已改，相对链接仍指向存在的文件。
- 报告路径：`docs/reports/open-defects-report.md`。写明基线 SHA、本分支 SHA、所选视觉方案、flash 窗口的文档原句或「未登记」、未跑的真机项。自审栏留空。
