# Architecture Posture Defaults and Experimental Zones Plan

**Map node:** `N-002` in `2026-08-28-engineering-posture-scope-control`

**Design assessment:** `covered_by` Root Design revision 2 at `7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716`.

**Posture:** `reusable_internal`. Keep the architecture protocol local, hash-bound, compatible, and testable. Do not add a policy service, organization hierarchy, automatic promotion, or deployment behavior.

## Scope

Add project and stable-module posture defaults plus lightweight experimental zones to project-scoped Architecture Memory. A zone is not a partial production module: it owns bounded paths, an objective, provenance, and a spike/experiment PostureRef. Stable public-boundary changes still require the existing architecture delta workflow.

## Task 1: Extend the Architecture Memory contract

**Files:** `schemas/architecture.schema.json`, `scripts/lib/architecture-protocol.mjs`, `tests/architecture_protocol.test.mjs`.

Add optional legacy-readable project/module PostureRefs and `experimental_zones`. Validate unique zone IDs, non-overlapping zone paths, spike/experiment-only zone posture, and hash inclusion. Render defaults and zones in generated architecture views. A baseline without posture remains readable as `unknown_legacy`; resolution must block until explicit assessment rather than invent a profile.

Validation: `node --test tests/architecture_protocol.test.mjs`

Commit: `feat: add architecture posture defaults and experimental zones`

## Task 2: Resolve inheritance and bounded overrides

**Files:** `scripts/lib/architecture-protocol.mjs`, `tests/architecture_protocol.test.mjs`.

Resolve project default, module default, experimental zone, then task override. A differing override requires a decision bound to the inherited posture hash. Return the selected ref and provenance chain; do not rank profiles or infer promotion.

Validation: `node --test tests/architecture_protocol.test.mjs`

Commit: `feat: resolve hash-bound architecture posture inheritance`

## Task 3: Classify zone changes and propose promotion

**Files:** `schemas/architecture-impact.schema.json`, `scripts/lib/architecture-impact.mjs`, `scripts/lib/architecture-protocol.mjs`, `tests/architecture_protocol.test.mjs`, `tests/architecture_ci.test.mjs`.

Treat a path owned only by an active zone as mapped experimental work. Preserve normal module classification when a zone overlaps a stable module; a matching public boundary remains `contract_delta`. Add `impacted_zones` evidence. Promotion creates a pending, hash-bound architecture delta that adds or updates a complete Core Contract and removes the zone only in the proposed baseline; existing explicit approval remains mandatory before apply.

Validation: `node --test tests/architecture_protocol.test.mjs tests/architecture_ci.test.mjs`

Commit: `feat: classify experimental zones and propose promotion`

## Task 4: Document and record verified N-002 evidence

**Files:** `skills/adaptive-writing-plans/references/architecture-memory.md` and the selected map artifacts.

Document default inheritance, zone boundaries, promotion, and legacy behavior. Run focused tests, full regression tests because architecture protocol is shared, strict map validation, and diff checks. Mark only N-002 done; revalidate N-006 but do not release it before N-004.

Validation: `node --test tests/architecture_protocol.test.mjs tests/architecture_ci.test.mjs`; `npm test`; `node scripts/validate-plan.mjs --root docs/superpowers/plans/2026-08-28-engineering-posture-scope-control --strict`; `git diff --check`

Commit: `chore: record verified N-002 architecture posture evidence`

## Quality Gate

- Experimental zones remain cheaper than Core Contracts and cannot acquire production-only concern packs by default.
- Public boundary, destructive-loss, credential, invalid-result, and runaway-cost safeguards remain active at every posture.
- No profile ordering, automatic promotion, or implicit semantic inference is introduced.
- Existing v2.0 architecture fixtures remain readable and unchanged unless explicitly written.
