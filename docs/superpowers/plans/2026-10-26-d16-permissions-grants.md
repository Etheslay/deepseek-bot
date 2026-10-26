# D16 Permissions and Grants Implementation Plan

> For agentic workers: execute in this session with test-driven development and independent review. Human owner: Etheslay; AI checks never replace the owner's review.

**Goal:** Replace the D15 Host's default-allow checkpoint with persistent capability policies, scoped grants and exact-action approvals.

**Architecture:** contracts define the human control surface; storage owns transactional grant/approval/audit state; the Host resolves trusted caller identity and waits for human decisions; the generic gateway validates parameters before authorization and checks authorization again immediately before dispatch. D08 filesystem/network/shell checks remain mandatory.

**Tech stack:** existing TypeScript/zod, Node24 SQLite, Vitest; no new dependencies. Branch: feature/permissions-grants from develop b693c5b.

## Locked decisions

- Backend only this round: no settings page, chat UI, real model caller or desktop rendering work.
- Capability catalog includes app.read/create_group/create_bot/update_bot/create_workflow/start_run/cancel_run/revoke_creation, interaction.ask_user, network.search, fs.read/write, exec.shell, screen.capture, connector.invoke.
- app.read and interaction.ask_user default allow; screen.capture default deny; other capabilities default ask. app.start_run is always ask; exec.shell and screen.capture cannot be set to allow. Future capabilities in the catalog do not create tools.
- Policies are global per capability. Policy and issued grants share permission_grants; scope=policy represents settings defaults. Policy deny overrides every grant. Grants bind to an active bot; session scope also binds to the exact session and current Host generation. A trusted caller supplies botId/sessionId; never parse caller.id or accept identity from model tool params.
- All model application writes require identity and authorization. Reads and ask_user can retain anonymous callers unless their policy is changed to ask/deny. Unknown tool/capability and missing checkpoints deny.
- Approval digest binds caller/bot/session, tool, validated exact params, capability set and Host generation. Approval TTL 10 minutes. create_bots_batch with newGroup requires both create_bot and create_group.
- Once grants are bound to one approval and consumed once; session defaults to 5 uses/2h (human may choose 1–100 uses and 1–1440 minutes); permanent grants have no expiry/count limit. Per-action-only capabilities cannot receive session/permanent grants.
- Consumption is atomic across capabilities and occurs before handler execution; failure does not refund a use. A fresh synchronous revalidation before dispatch rejects revoked grants or changed policies without charging twice.
- Session/once grants and pending approvals become invalid on Host restart; permanent grants and default policies survive. Shutdown/caller cancellation release pending waits. Deny/expiry/cancel never executes the tool.
- Human-only permission.* methods list/set policies, list/revoke grants, list/decide approvals and query audit. They never appear in the model tool registry. Direct human application methods retain their current semantics.
- Persistent permission audit stores identity, capabilities, digest, grant IDs, approval ID and decision, not raw tool params. Pending approval stores exact params for human preview; JSONL audit keeps digests and adds authorization metadata. No model write/delete audit capability.
- Add protocol 0.3 while accepting 0.1/0.2; workflow schema remains 0.1. Add migration 0005; do not edit earlier migrations/checksums.

## Tasks

- [x] Contract tests first: policy restrictions, scope validation, strict decision schemas, new method whitelist and backward protocol compatibility. Implement permissions.ts, method mappings/exports and version fixture.
- [x] Storage tests first: fresh/old DB migration; atomic multi-capability consumption; limit/expiry/session/generation checks; deny precedence; exact approval decisions; persistent audit; restart expiration. Implement permission repository and append migration 0005.
- [x] Gateway/Host tests first: default-deny fallback, schema validation before grants, metadata audit, exact write approval, once/session/permanent, deny, revoke, cancellation, restart and web_search's retained D08 gate. Implement Host coordinator and human handlers.
- [x] Update permissions/contracts/package docs and D16 report with exact verified commands, compatibility and unfinished UI/real model integration. Keep human self-review blank.
- [x] Run package checks, full lint/typecheck/test and Host build, independently review diff, fix substantive findings, report uncommitted result.

## Verification commands

`pnpm --filter @deepseek-bot/contracts test`

`pnpm --filter @deepseek-bot/storage test`

`pnpm --filter @deepseek-bot/agent-tools test`

`pnpm --filter @deepseek-bot/host test`

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @deepseek-bot/host build`, `git diff --check`.
