# 剩余缺陷：中文字体缺失时拒绝写出文稿

- 任务书：`docs/TASK_REMAINING_DEFECTS.md`（PR #248，写报告时尚未合入）
- 基线：`origin/develop` = `6dc4107`（PR #247 已合入；其父提交含 PR #246）
- 实现提交：`96f9913`
- 执行：AI 会话辅助。自审栏留空

## 已合入的前两件

| PR | 状态 | 依据 |
| --- | --- | --- |
| #246 语义简报 | 已合并 | `gh pr view`：`mergedAt` 2026-11-10 12:56 UTC（太平洋时间 04:56）。`write_presentation` 的说明要求模型交语义简报，处理函数不把脚本当排版参数传给 Host |
| #247 运行时超时 | 已合并 | `mergedAt` 2026-11-10 12:56 UTC（太平洋时间 04:56）。当前 `develop` 尖端就是这次合并 |

这两次的 `quality` 以合并当时的 GitHub 记录为准。本报告不把它们改写成新的一次检查。

## 第 3 节

`cjkEmbeddingRefusal(text, cjkEmbedded)` 在 `packages/host/src/presentation-font.ts`。文稿文本含汉字、假名或韩文，且没有嵌入成功的中文脸时，返回一条失败说明，列出已经查找的路径：微软雅黑、Noto Sans CJK、Droid Sans Fallback、文泉驿微米黑。`buildPptx` 在组包之前抛出这条说明，工作区里不出现 pptx。失败说明不写「已嵌入微软雅黑」。

只有英文、数字和标点时，即使没有中文脸，函数返回空，沿用原来的西文嵌入。已经嵌入中文脸时，含汉字也可以写。

本机查找顺序里，Droid Sans Fallback 存在，所以既有「嵌入了真实中文脸」的用例仍然写出字体部件。没有把整套中文字体打进仓库。

## 第 4 节

未执行。这个环境没有 PowerPoint，不能代填打开、汉字、图片、淡入或数字出处的现象。

## 第 7 节

台账三处指向在 PR #248（`cursor/remaining-defects-brief-bfc4`）。写本报告时该 PR 仍开着，`quality` 运行 `42820172014` 当时是 pending，不能写成已通过。

## 验证

| 检查 | 提交 / 环境 | 命令 | 结果 |
| --- | --- | --- | --- |
| 相关测试 | `96f9913`，本机 Linux，Node 24 | `pnpm --filter @deepseek-bot/host exec vitest run src/presentation-font.test.ts src/presentation-write.test.ts` | 2 个文件、14 个用例通过。含纯函数三行，以及既有的中文嵌入与 PDF 用例 |
| `pnpm lint` | 同上 | `pnpm lint` | 通过，无输出 |
| `pnpm typecheck` | 同上 | `pnpm typecheck` | 10 个包通过 |
| PowerPoint | 不适用 | 未安装 | 未执行 |

未跑根目录 `pnpm test` 全量。没有调用 DeepSeek API。

## 负责人自审（留空待填）

- 自审人 / 日期：
- 最新提交 SHA 与差异检查结论：
- 测试证据核对：
- 遗留问题与结论：
