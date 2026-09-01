# Posture Migration, Fixtures, Completion, and Portable Release Plan

**Map node:** `N-007` in `2026-08-28-engineering-posture-scope-control`

**Design assessment:** `covered_by` Root Design revision 2 at `7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716`.

**Posture:** `reusable_internal`. Finish the local file-backed protocol with exact migration recovery, representative integration fixtures, completion enforcement, and portable plugin verification. Do not add production deployment, telemetry, organization policy, automatic promotion, automatic provider installation, or external marketplace publication.

**Provider receipt:** `writing-plans` is not installed. The active `adaptive-writing-plans` orchestrator generated this compatible Superpowers leaf; installed `finalise-plan` reviewed and repaired it in place. No missing provider is reported as invoked or installed.

## Task 1: Add hash-bound map migration preview, apply, and exact recovery

**Files:** `scripts/lib/migration-protocol.mjs`, `scripts/migrate-plan.mjs`, `scripts/adaptive-plan.mjs`, `scripts/lib/plan-protocol.mjs`, `tests/migration_protocol.test.mjs`, `tests/cli.test.mjs`.

Replace the current direct-write migration with a deterministic preview containing source/target hashes, changed paths, a full preservation manifest, and `writes: false`. Applying requires the exact preview hash, stores byte-exact recovery material before any canonical write, preserves all unrelated plan artifacts and audit history, adds an `unknown_legacy` posture rather than guessing intent, and appends a migration event. Recovery requires the exact migration ID and current map hash before restoring overwritten bytes. Reopening an already current map is read-only and does not create recovery state.

Validation: `node --test tests/migration_protocol.test.mjs tests/cli.test.mjs tests/overview_v2.test.mjs`

Commit: `feat: add recoverable posture map migration`

## Task 2: Convert flat design history to a single v2.1 root thread without invented evidence

**Files:** `scripts/lib/design-ledger.mjs`, `scripts/lib/migration-protocol.mjs`, `schemas/design.schema.json`, `tests/design_ledger.test.mjs`, `tests/migration_protocol.test.mjs`.

Add a pure flat-design conversion that requires an explicit authoritative `PostureRef`, maps every legacy revision into the one root thread, embeds each raw legacy revision and its old hash as preservation evidence, creates no child threads or verified contract claims, and marks carried approvals stale for exact-hash reapproval. Include the design conversion in the same preview/apply/recovery transaction only when explicitly requested. A missing posture ref remains a visible migration blocker, and v2.1 ledgers are never rewritten as if they were legacy.

Validation: `node --test tests/design_ledger.test.mjs tests/migration_protocol.test.mjs tests/design_engine.test.mjs`

Commit: `feat: migrate flat design history into the v2.1 ledger`

## Task 3: Add all-posture, composition, compact, promotion, and completion fixtures

**Files:** `tests/fixtures/posture/`, `tests/integration_posture.test.mjs`, `scripts/lib/plan-protocol.mjs`, `scripts/completion-check.mjs`, `tests/overview_v2.test.mjs`, `tests/mcp_server.test.mjs`.

Create minimal fixtures for spike, experiment, reusable-internal, and production definitions of done. Add integration cases for explicit promotion, stale evidence, compact/resume recovery, inline approval without opening an artifact, direct provider reuse, thin-adapter composition, missing dependency, version/digest drift, provider failure, and expected artifact not written. Strengthen completion so it runs map/posture/scope validation, rejects stale design refs and executable deferred work, and reports stable errors; do not require production-only capabilities from non-production fixtures.

Validation: `node --test tests/integration_posture.test.mjs tests/overview_v2.test.mjs tests/mcp_server.test.mjs`; `node scripts/validate-plan.mjs --root tests/fixtures/posture/reusable-internal --strict`; `node scripts/completion-check.mjs --root tests/fixtures/posture/reusable-internal`

Commit: `test: cover posture definitions and completion gates end to end`

## Task 4: Document the project-scoped lifecycle and portable recovery workflow

**Files:** `README.md`, `skills/adaptive-writing-plans/SKILL.md`, `skills/adaptive-writing-plans/references/plan-folder-protocol.md`, `skills/adaptive-writing-plans/references/architecture-memory.md`, `skills/adaptive-writing-plans/references/ci-integration.md`, `skills/adaptive-writing-plans/references/compatibility.md`, `scripts/doctor.mjs`, `package.json`, `.codex-plugin/plugin.json`, `tests/skill_contract.test.mjs`, `tests/portability.test.mjs`.

Document architecture memory as project-owned state refreshed by diff evidence, root-versus-child design, N-000/map visibility, terminal-inline approvals, posture-specific stopping rules, migration preview/apply/recover, compact recovery, and composition outcomes. Keep detailed procedures in references rather than expanding the skill entrypoint. Doctor and package metadata must list only implemented relative commands and must not embed workstation paths.

Validation: `node --test tests/skill_contract.test.mjs tests/portability.test.mjs`; `node scripts/doctor.mjs --root .`; skill and plugin validators

Commit: `docs: explain posture bounded planning and recovery`

## Task 5: Record release evidence and refresh the installed local plugin

Run the full suite, all profile completion checks, CLI/MCP smoke coverage, JSON/schema validation, strict map validation, portability scan, validators, and `git diff --check`. Read the installed marketplace name with the plugin-creator helper, update the cachebuster with its helper rather than editing marketplace metadata, reinstall the plugin, and verify the new version plus posture/binding tools in a new Codex thread. Record append-only evidence and mark N-007/map complete only after every required check and pickup test passes.

Validation: `npm test`; profile validation/completion loop; `node scripts/doctor.mjs --root .`; skill/plugin validators; `node scripts/validate-plan.mjs --root docs/superpowers/plans/2026-08-28-engineering-posture-scope-control --strict`; `git diff --check`; new-thread installed-plugin smoke

Commit: `chore: verify and refresh adaptive writing plans`

## Finalise-plan review

Reviewed and repaired in place with installed `finalise-plan`. Map recovery precedes design conversion; design migration requires explicit posture evidence and does not retain reusable approval authority under a new content hash; profile fixtures precede completion claims; documentation follows implemented behavior; marketplace mutation is limited to the existing local plugin update helper and occurs only after repository verification. Each task has an independent validation and commit boundary. The remaining operational risk is new-thread plugin pickup, which is an explicit final gate rather than an assumed result.
