---
name: 发布验收
about: release 或 hotfix 合入 main 前的可发行证据
title: '[Release] v'
labels: ''
assignees: ''
---

## 候选信息

- 版本 / release 或 hotfix 分支：
- 候选提交 / 合并候选 SHA：
- 发布负责人 / 自审人（负责人本人）：
- 自审日期 / 最新候选 SHA / 结论：
- 平台 / Harness 版本：

## 门槛

按 docs/RELEASE.md 逐条附证据，不能只写“测试通过”。

- [ ] 静态、单元、契约、集成和最终包端到端结果。
- [ ] 真实 DeepSeek API 冒烟与 FR/QA 验收矩阵。
- [ ] 干净机安装/升级/卸载与数据迁移/回滚演练。
- [ ] 性能、签名、哈希、许可证和用户文档。
- [ ] 无 P0/P1；发布负责人记录 P2 已知问题及接受理由。
- [ ] 发布负责人完成最新候选自审，有对应验证证据，可构建且可发行。

## 产物与发布后

安装包 / 校验值 / 发布说明 / 证据链接：

- main PR：
- main 合并 SHA / tag：
- 回合 develop PR / 活跃 release PR：
- 回滚负责人和数据兼容说明：
