# Posture CLI, MCP, Overview, and Approval Surfaces Plan

**Map node:** `N-006` in `2026-08-28-engineering-posture-scope-control`

**Design assessment:** `covered_by` Root Design revision 2 at `7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716`.

**Posture:** `reusable_internal`. Provide deterministic local JSON operations, CLI/MCP parity, portable wiring, and focused integration tests. Do not add remote policy, automatic provider installation, production deployment, or automatic posture promotion.

**Provider receipt:** `writing-plans` was not installed. The active `adaptive-writing-plans` orchestrator generated this compatible leaf artifact and installed `finalise-plan` reviewed it in place. No missing provider is reported as invoked or installed.

## Task 1: Add read-only posture assessment and checking operations

**Files:** `scripts/lib/posture-operations.mjs`, `scripts/posture-assess.mjs`, `scripts/posture-check.mjs`, `scripts/adaptive-plan.mjs`, `tests/posture_operations.test.mjs`, `tests/cli.test.mjs`.

Implement a pure assessment that returns one candidate EngineeringPosture, evidence gaps, and `writes: false`. Implement check against a map/node that reports stable error codes for invalid/stale PostureRefs, missing/out-of-budget provenance, deferred executable work, design coverage gaps, and provider composition/critical coverage blockers. CLI commands read JSON or a selected map and return the same structured contracts without mutation.

Validation: `node --test tests/posture_operations.test.mjs tests/cli.test.mjs`

Commit: `feat: add read-only posture assess and check commands`

## Task 2: Add hash-bound posture promotion preview and apply

**Files:** `scripts/lib/posture-operations.mjs`, `scripts/posture-promote.mjs`, `scripts/adaptive-plan.mjs`, `tests/posture_operations.test.mjs`, `tests/cli.test.mjs`.

Preview produces a bounded proposal with source/target PostureRefs, affected node IDs, behavior conflicts, base map/posture hashes, exact approval brief, and `writes: false`. Apply requires the exact proposal hash, base posture hash, and explicit approval; it updates the selected map posture, marks affected completed nodes for revalidation or other affected nodes stale, and re-enters design plus architecture synchronization. It must reject stale proposals and never infer production from reuse.

Validation: `node --test tests/posture_operations.test.mjs tests/cli.test.mjs tests/planning_engine.test.mjs`

Commit: `feat: add explicit posture promotion proposals`

## Task 3: Expand overview with FlowReceipt, posture, blockers, approval, and binding diagnostics

**Files:** `scripts/lib/plan-protocol.mjs`, `scripts/overview.mjs`, `scripts/design-brief.mjs`, `scripts/adaptive-plan.mjs`, `tests/overview_v2.test.mjs`, `tests/cli.test.mjs`.

Expose the complete posture summary, node provenance/budget/deferred summaries, exact readiness blockers, FlowReceipt, provider lifecycle/composition details, and a derived approval brief when a design gate is pending. Resolve linked leaf existence relative to the plan root while retaining `exists_in_plan_folder` as a distinct field. Diagnose MCP/project/plan root binding explicitly; do not treat a binding mismatch as missing plan state. `design brief` prints the terminal-ready brief before approval.

Validation: `node --test tests/overview_v2.test.mjs tests/cli.test.mjs tests/design_engine.test.mjs`

Commit: `feat: expose flow receipts and inline approval briefs`

## Task 4: Add MCP parity and portable command wiring

**Files:** `mcp/server.mjs`, `.mcp.json`, `.codex-plugin/plugin.json`, `package.json`, `scripts/doctor.mjs`, `tests/mcp_server.test.mjs`, `tests/portability.test.mjs`.

Expose MCP tools equivalent to posture assess/check/promotion preview/apply, design approval brief, and binding status. Pass exact content/posture/brief hashes to approval. Keep preview/read tools read-only and apply explicitly mutating. Ensure help, doctor, package, manifest, and MCP metadata expose only implemented commands and preserve environment-root configuration without embedding machine paths.

Validation: `node --test tests/mcp_server.test.mjs tests/portability.test.mjs tests/cli.test.mjs`

Commit: `feat: add posture and approval MCP surfaces`

## Task 5: Record N-006 evidence and release N-007 only after strict verification

Run focused and full tests, skill/plugin validators, strict map validation, CLI/MCP smoke coverage, portability checks, and `git diff --check`. Record append-only evidence and mark N-006 done only after every check passes. Revalidate N-007 against completed N-005/N-006 and current design revision 2; release it only if its own readiness evaluator has no blocker.

Validation: `npm test`; `node scripts/doctor.mjs --root .`; `/mnt/data4/zhangzixing/code/tokenmap/conda/tmap2/bin/python /mnt/data4/zhangzixing/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/adaptive-writing-plans`; `/mnt/data4/zhangzixing/code/tokenmap/conda/tmap2/bin/python /mnt/data4/zhangzixing/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .`; `node scripts/validate-plan.mjs --root docs/superpowers/plans/2026-08-28-engineering-posture-scope-control --strict`; `git diff --check`

Commit: `chore: record verified N-006 posture surface evidence`

## Finalise-plan review

Reviewed and repaired in place with installed `finalise-plan`. Read-only assessment/check precede mutation; promotion preview and apply are separate tasks; terminal overview and MCP parity have independent tests; artifact existence and binding mismatch are explicit acceptance cases. The plan assumes no approved project architecture baseline for the current repository map, so promotion re-opens the architecture gate without fabricating an architecture delta. No unresolved design question remains.
