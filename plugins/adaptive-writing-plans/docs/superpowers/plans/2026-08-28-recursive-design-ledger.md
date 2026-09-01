# Recursive Posture-Aware Design Ledger Plan

**Map node:** `N-004` in `2026-08-28-engineering-posture-scope-control`

**Design assessment:** `covered_by` Root Design revision 2 at `7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716`.

**Posture:** `reusable_internal`. Build deterministic local design contracts, views, compatibility, and integration tests. Do not add provider authority, automatic waiver, remote registries, or provider popularity ranking.

## Task 1: Implement the v2.1 Design Ledger core

**Files:** `scripts/lib/design-ledger.mjs`, `schemas/design.schema.json`, `tests/design_ledger.test.mjs`.

Implement one canonical document with root/module/relation/task DesignThreads, revision history, content/state/thread/document hashes, optimistic writes, and one active thread per subject/purpose. Keep v2.0 legacy documents read-only compatible; creating or writing v2.1 must not silently migrate them.

Validation: `node --test tests/design_ledger.test.mjs tests/design_engine.test.mjs`

Commit: `feat: add recursive v2.1 design ledger core`

## Task 2: Add assessments, contracts, evidence, and generated views

**Files:** `scripts/lib/design-ledger.mjs`, `tests/design_ledger.test.mjs`.

Implement `covered_by|inline|thread_required` assessment, contract claims with candidate/verified/failed evidence, exact consumer invalidation, revision re-entry, and generated `DESIGN.md`, `designs/root.md`, `designs/modules/*.md`, `designs/relations/*.md`, and `designs/tasks/*.md`. A failed critical contract blocks consumers; private contract-preserving choices stay inline.

Validation: `node --test tests/design_ledger.test.mjs`

Commit: `feat: add recursive design assessment and contract evidence`

## Task 3: Make profiles and provider composition posture-aware

**Files:** `scripts/lib/design-engine.mjs`, `scripts/lib/plan-protocol.mjs`, `schemas/handoff.schema.json`, `schemas/provider-result.schema.json`, `tests/design_engine.test.mjs`, `tests/handoff_validation.test.mjs`.

Carry PostureRef, behavior budget, scope provenance, deferred candidates, provider identity/dependency/mutability/invocation/persistence state, and CompositionContracts through DesignProfile and PlanningHandoff. Classify provider behavior proposals subtractively; raw provider output is stored once and referenced. Do not let provider evidence approve or mutate design.

Validation: `node --test tests/design_engine.test.mjs tests/handoff_validation.test.mjs tests/provider_registry.test.mjs`

Commit: `feat: bind design providers to posture and composition contracts`

## Task 4: Generate exact inline ApprovalBriefs and re-entry evidence

**Files:** `scripts/lib/design-ledger.mjs`, `scripts/lib/design-engine.mjs`, `skills/adaptive-writing-plans/references/design-gate.md`, `skills/adaptive-writing-plans/references/provider-contract.md`, `tests/design_ledger.test.mjs`, `tests/design_engine.test.mjs`.

Generate a bounded ApprovalBrief containing subject, exact content/posture hashes, decision summary, included/excluded scope, material risks, provider status, downstream effect, waiver request, and one confirmation prompt. Approval changes state hash only. Posture or contract changes create successor revisions and exact impact records.

Validation: `node --test tests/design_ledger.test.mjs tests/design_engine.test.mjs tests/handoff_validation.test.mjs`; `npm test`; `git diff --check`

Commit: `feat: add terminal approval briefs and design re-entry`

## Task 5: Record N-004 evidence and release direct dependents

Update the selected map only after focused/full verification and strict validation. Mark N-004 done; revalidate N-005 and N-006 independently. Do not release N-007.

Validation: `node scripts/validate-plan.mjs --root docs/superpowers/plans/2026-08-28-engineering-posture-scope-control --strict`

Commit: `chore: record verified N-004 recursive design evidence`
