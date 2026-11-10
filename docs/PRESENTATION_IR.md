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

## Host 先补齐，再写文件

模型交来的简报经常缺封面、缺收束、标题超长，或页上的数字没有台账。这些不再整份退回。Host 在写文件前补齐：

- 第一页不是 `cover` 就补一页封面，最后一页不是 `end` 就补一页收束。满 8 页还没有 `section` 时，在封面后补一页章节。`slide_budget` 改成补齐后的页数。
- 标题按版式裁到上限。内容和版式对不上时，改成对得上的版式，正文留下来。同一种版式超过 4 次时，把多出来的页改成另一种还能放下正文的版式。
- 除四位年份外，页上的数字和图表里的数值补进本页引用的 `evidence`，`source` 记为「本页内容」。
- `must_keep` 没出现时，补进收束页。`must_avoid` 从正文里去掉。口播长了就裁短。

补齐之后仍然对不上合同的简报才会拒绝，并且一次返回全部原因。路径不是 `.pptx`、简报不是两页以上的语义结构、或这一轮没有 bot 身份时，仍然不写文件。

Host 不接受坐标、字号或脚本。

配色只从 `style.keywords` 选一套已有色板：深蓝或科技用 harbor，其余用 ink、grove、clay、dusk、tide。单页不能自己写颜色。
