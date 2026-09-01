# Engineering Foundations Implementation Plan

**Map node:** `N-001` in `2026-08-28-engineering-posture-scope-control`

**Design ref:** `engineering-posture-scope-control@2`, approved content hash `7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716`

**Posture:** `reusable_internal`. Build stable local contracts, compatibility, and tests. Do not add telemetry, deployment automation, remote policy, automatic promotion, automatic provider installation, or speculative production hardening.

## Scope

Establish the contracts that later map nodes consume: distinct engineering posture profiles, hash-bound posture references, scope provenance and behavior budgets, provider composition state, and exact-content design approval. This leaf defines Design Ledger v2.1 schema and hashing foundations but does not implement recursive threads, generated design views, architecture memory, posture CLI commands, or execution orchestration.

The repository already contains uncommitted work from earlier planning phases. The commit boundaries below identify atomic ownership, but execution must not create commits that accidentally include inherited changes.

## Task 1: Define posture, provenance, and behavior-budget contracts

**Files:**

- Create `schemas/engineering-posture.schema.json`.
- Create `schemas/scope-provenance.schema.json`.
- Create `scripts/lib/engineering-posture.mjs`.
- Create `tests/engineering_posture.test.mjs`.

Implement four unordered intent profiles: `spike`, `experiment`, `reusable_internal`, and `production`. Normalize canonical content before hashing; reject a stale `PostureRef`; preserve legacy posture as `unknown_legacy`; and validate that executable behaviors trace to approved requirements/design/contracts, observed failures, or mandatory safety floors. Keep deferred candidates outside the executable budget.

Validation: `node --test tests/engineering_posture.test.mjs`

Commit: `feat: add engineering posture and scope provenance contracts`

## Task 2: Make provider discovery composition-aware

**Files:**

- Modify `schemas/provider-registry.schema.json`.
- Modify `scripts/lib/provider-registry.mjs`.
- Modify `skills/adaptive-writing-plans/references/design-provider-catalog.json` only if an existing catalog entry lacks the composition metadata required by the approved design.
- Modify `tests/provider_registry.test.mjs`.

Traverse symlink-installed skill directories without loops. When a discovered provider has empty frontmatter design arrays, use matching non-empty catalog metadata. Keep discovery, dependency readiness, invocation, and persistence verification as separate states. Record source plus version or digest, catalog match, mutability, expected outputs, and fallback without invoking or installing providers.

Validation: `node --test tests/provider_registry.test.mjs tests/design_engine.test.mjs`

Commit: `fix: preserve provider composition and symlink discovery state`

## Task 3: Separate design content identity from mutable state

**Files:**

- Modify `schemas/design.schema.json` to describe readable v2.0 revisions and the v2.1 Design Ledger envelope.
- Create `scripts/lib/design-hashing.mjs` if separation keeps the hash contract independent; otherwise keep the minimal primitives in `scripts/lib/design-engine.mjs`.
- Modify `scripts/lib/design-engine.mjs`.
- Modify `tests/design_engine.test.mjs`.

Define an exact `content_hash` over reviewable decision content and a separate `state_hash` over lifecycle state. Preserve `design_hash` as a compatibility alias where v2.0 callers require it. Approval must bind `approval.expected_content_hash` to the hash the user reviewed, must not normalize or otherwise mutate reviewable content during approval, and must leave `content_hash` unchanged when only approval state changes. Add read-only version classification and migration-preview primitives; opening v2.0 must not rewrite it or invent thread parents, posture, or approval.

Regression: reproduce the prior approval mutation in which expected hash `eed775b98ef522b5c549fc8f5ea9894c5fbad58e616903e2d5a837aee3dcb4de` became `7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716`, and prove approval either preserves the reviewed content hash or rejects normalization before writing.

Validation: `node --test tests/design_engine.test.mjs`

Commit: `fix: bind design approval to immutable content hashes`

## Task 4: Record N-001 evidence and release only affected dependents

**Files:**

- Update the selected map's `map.json`, generated `MAP.md`, `nodes/*.md`, and `events.jsonl` through protocol helpers where available.
- Update the N-001 leaf link and evidence only; do not make unrelated stale nodes ready.

Run the focused tests together, validate schemas through the repository's test surfaces, and run strict map validation. Mark N-001 `awaiting_validation` before the combined check and `done` only after evidence is recorded. Revalidate N-002 and N-003 against the new posture/provider contracts; release each only if its own design refs, contract inputs, and blockers are current. Preserve N-004 through N-007 as stale until their dependencies and child designs are resolved.

Validation: `node --test tests/engineering_posture.test.mjs tests/provider_registry.test.mjs tests/design_engine.test.mjs && node scripts/validate-plan.mjs --root docs/superpowers/plans/2026-08-28-engineering-posture-scope-control --strict`

Commit: `chore: record verified N-001 planning foundations`

## Quality Gate

- Every accepted behavior has scope provenance and lies inside the `reusable_internal` budget.
- Equal normalized posture content hashes equally; material changes make old refs stale.
- v1/v2.0 inputs remain readable and unknown rather than being silently upgraded.
- Provider state never collapses installation, readiness, invocation, and persistence into one boolean.
- Approval is exact-content and terminal-friendly; artifact files remain audit records rather than an approval UI.
- No later-node feature is pulled into this leaf merely because it could be useful.
