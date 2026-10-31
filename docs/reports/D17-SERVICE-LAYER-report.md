# D17' 服务层收敛（审查 §2.3 备忘处置）——App.tsx 直调收进 DesktopService.skills

日期：2026-10-31（Asia/Shanghai）。负责人：Etheslay。分支：`feature/d17-service-layer`，目标 `develop`。基线：`c54a3b7`（`origin/develop`，PR #185 合入后）。本文只记本分支的交付与实际跑过的检查，不代表真人自审或合并结论。

范围：[PREMERGE-REVIEW](PREMERGE-REVIEW-2026-10-29.md) §2.3 登记的层一致性备忘（GAP_AUDIT 台账多处以「d17 §2.3 备忘」跟踪）——D17' 技能库在 App.tsx 里的三处 `window.deepseekBot.host.call` 直调（boot 读取、迁移回写、更新保存），绕过服务层并内联 `METHOD_CONTRACTS` 响应解析。行为等价重构，不改契约/Host/存储。

## 1. 交付行为

- `DesktopService` 新增 `skills.getLibrary/saveLibrary`：host 实现转发 `skillLibrary.get/save` 并用契约 schema 解析响应（与原内联解析同一校验权威）；fixture 实现为会话内存态（与夹具其余状态同生命周期）。
- App.tsx 三处直调全部改走 `desktop.skills`：boot 效果、`migrateLegacyLibrary` 的 `saveLibrary` 回调、`updateLibrary`。失败路径与 toast 文案不变（`skills.hostDegraded`/`skills.migrateFailed`/`skills.hostSaveFailed`）。
- **已知边界（如实）**：fixture（浏览器离线预览）模式下技能库从「localStorage 直读」变为「会话内存态」——首次启动仍会把 legacy localStorage 迁移进会话，但迁移标记随后写入 localStorage，下次刷新不再重迁、库回到空态（与夹具「会话状态、刷新即失」的定位一致；此前的直调路径在无桥环境下保存本来也会失败，不跨刷新）。
- App.tsx 其余 `METHOD_CONTRACTS` 用法（question.answer / voice.status）不在本备忘范围，保持现状。

## 2. 实际检查

环境：Windows 11，Node v24.15.0，pnpm 11.28.5。工作树 `D:\deepseek-bot`，自基线建出。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm typecheck`（10 包） | 退出 0 |
| `pnpm --filter @deepseek-bot/desktop exec vitest run --config vitest.config.ts tests/services/host-service.test.ts tests/services/fixture-service.test.ts` | 退出 0。2 文件 64 通过（新增：host 技能库 round-trip 经假桥 1 例、fixture 会话内存 1 例） |
| `pnpm --filter @deepseek-bot/desktop test` | 退出 0。78 文件 701 通过 |
| `pnpm --filter @deepseek-bot/desktop build` | 退出 0（electron-vite build，非安装包） |
| `pnpm lint` / `git diff --check` | 均退出 0 |

## 3. 未验证与已知边界

- 真机 Electron 未跑：技能库的实机路径（Host 读取、legacy 迁移、导入导出、编辑保存）行为无变化，但本重构无真机复核（与其它真机项同清单）。
- fixture 预览模式的技能库持久化语义变化见 §1（离线预览专用，不影响真实 Host 路径）。
- 未跑 GitHub Actions（分钟额度已用尽）。

## 4. 恢复与许可

无新增依赖、迁移。回退：`git revert -m 1 <merge-sha>` 即回到直调实现。

## 5. Etheslay 本人自审

自审人：＿＿＿＿　最新提交 SHA：＿＿＿＿　日期：＿＿＿＿

- [ ] 最新差异、失败路径与 fixture 语义变化：＿＿＿＿
- [ ] 自动化检查与未验证项：＿＿＿＿
- [ ] 自审结论：＿＿＿＿
