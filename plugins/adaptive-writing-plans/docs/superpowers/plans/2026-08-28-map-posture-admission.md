# Map Posture Admission and Scope Budget Plan

**Map node:** `N-003` in `2026-08-28-engineering-posture-scope-control`

**Design assessment:** `covered_by` Root Design revision 2 at `7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716`.

**Posture:** `reusable_internal`. Enforce stable local admission contracts and compatibility; do not add remote policy, maturity scores, automatic scope expansion, or production inference.

## Scope

Carry an authoritative map posture into executable nodes through hash-bound PostureRefs. Require scope provenance for each required observable behavior. Subtract capabilities outside the selected posture or supported provider evidence from execution and retain them as structured deferred candidates.

## Task 1: Extend map and node contracts

**Files:** `schemas/map.schema.json`, `scripts/lib/plan-protocol.mjs`, `tests/plan_protocol.test.mjs`.

Add map `engineering_posture`; node `posture_ref`, `scope_provenance`, `behavior_budget`, and structured `deferred_candidates`. Legacy maps remain readable with unknown posture warnings. An authoritative posture map validates its hash and rejects ready/executing/done work nodes that omit the new contracts; N-000 control nodes are exempt.

Validation: `node --test tests/plan_protocol.test.mjs`

Commit: `feat: add posture-bound map and node contracts`

## Task 2: Enforce readiness and inherited refs

**Files:** `scripts/lib/planning-engine.mjs`, `scripts/add-node.mjs`, `tests/planning_engine.test.mjs`.

Use N-001 validation primitives during node readiness. Reject stale/missing PostureRefs, missing required behavior provenance, executable deferred behaviors, and scope entries outside the required budget. `addNode` may inherit the exact current map PostureRef but cannot fabricate provenance or budget.

Validation: `node --test tests/planning_engine.test.mjs tests/plan_protocol.test.mjs`

Commit: `feat: gate node readiness on posture and provenance`

## Task 3: Partition behavior candidates subtractively

**Files:** `scripts/lib/engineering-posture.mjs`, `scripts/lib/planning-engine.mjs`, `tests/planning_engine.test.mjs`.

Admit candidates only when their capability is explicitly allowed or a mandatory safety floor and they carry valid provenance. Provider candidates additionally require normalized status, an evidence ref, and verified persistence. Preserve every rejected candidate with stable reason/evidence; never create a map node automatically.

Validation: `node --test tests/engineering_posture.test.mjs tests/planning_engine.test.mjs`

Commit: `feat: defer unsupported behavior candidates with evidence`

## Task 4: Reconcile current map and record N-003 evidence

**Files:** current map artifacts and affected protocol references only if behavior needs clarification.

Bind current non-control nodes to the approved `reusable_internal` posture and their existing approved provenance/budgets. Run focused suites, full regression, strict map validation, and diff checks. Mark N-003 done; revalidate N-004 only. Leave N-005 through N-007 stale until their direct dependencies are current.

Validation: `node --test tests/engineering_posture.test.mjs tests/plan_protocol.test.mjs tests/planning_engine.test.mjs`; `npm test`; `node scripts/validate-plan.mjs --root docs/superpowers/plans/2026-08-28-engineering-posture-scope-control --strict`; `git diff --check`

Commit: `chore: record verified N-003 map admission evidence`

## Quality Gate

- Profiles remain unordered definitions of done.
- Provider prose, unverified persistence, and conversation-only output cannot authorize executable behavior.
- Deferred candidates stay visible and non-executable.
- Legacy artifacts are not silently upgraded.
- N-000 remains a control node and does not need product scope provenance.
