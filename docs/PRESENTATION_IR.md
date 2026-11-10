# 演示文稿生成合同

这份合同把「输入任务简报，输出可编辑 PPTX」收成当前 bot 能执行的规则。模型只提交语义，Host 排版。不能写成检查的愿望不算规则。

## 模型提交什么

`write_presentation` 的 `ir`：

- `brief`：`topic`、`audience`、`goal`、`slide_budget`（2 到 16）、`lang`。可选 `must_keep`、`must_avoid`、`evidence`、`style.keywords`。
- `evidence` 每一条有 `id`、`claim`、`value`、`source`。
- `slides` 第一页是 `cover`，最后一页是 `end`。页数与 `slide_budget` 相差不超过 1。页数达到 8 时必须有一页 `section`。

每一页有 `id`、`layout`、结论式 `title`，以及最多 5 个 block。block 只有 `bullets`、`table`、`chart`、`image`、`callout`、`kv`。

## 版式

| layout | Host 怎么摆 | 容量 |
| --- | --- | --- |
| `cover` | 深色封面 | 标题 ≤ 18 字 |
| `section` | 深色章节页 | 标题 ≤ 12 字 |
| `statement` | 一句结论 | ≤ 28 字 |
| `statement_plus_3cols` | 卡片 | 2 到 4 点，每点 ≤ 22 字 |
| `bullets_left_image_right` | 左文右图 | 3 到 5 条，一张 png 或 jpeg |
| `two_col_compare` | 左右对比 | 两栏，每栏 ≤ 4 条 |
| `table_full` | 表格 | 最多 4 列、6 行 |
| `chart_plus_note` | 柱状图加一句注 | 分类与序列等长 |
| `timeline` | 步骤 | 3 或 4 个标签，每个 ≤ 10 字 |
| `quote` | 引文 | ≤ 40 字 |
| `end` | 深色收束 | 1 到 5 条 |

选版也要和内容一致：有图就用 `chart_plus_note`；超过 3 列的表用 `table_full`；又有图又有要点用 `bullets_left_image_right`；只有一条 callout 用 `statement` 或 `quote`。同一种版式最多用 4 次。

## 拒绝生成的情况

- 标题超过该版式的字数。
- 除四位年份外，页面上的数字没有出现在本页 `evidence_refs` 指向的 `value` 里。
- 图表里的数值对不上台账。
- `must_keep` 没有出现，或 `must_avoid` 出现了。
- 口播 `notes` 超过 120 字，或超过 `budget_sec × 4` 个字。

这些失败发生在写文件之前。Host 不接受坐标、字号或脚本。

配色只从 `style.keywords` 选一套已有色板：深蓝或科技用 harbor，其余用 ink、grove、clay、dusk、tide。单页不能自己写颜色。
