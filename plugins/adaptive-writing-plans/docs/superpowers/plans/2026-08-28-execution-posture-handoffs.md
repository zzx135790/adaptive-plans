# Posture-Bound Execution and Compact Handoffs Plan

**Map node:** `N-005` in `2026-08-28-engineering-posture-scope-control`

**Design assessment:** `covered_by` Root Design revision 2 at `7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716`.

**Posture:** `reusable_internal`. Implement stable local envelopes and validation with focused fixtures. Do not add a new executor, cross-host scheduler, automatic resume, automatic replan acceptance, or edits to third-party skills.

**Provider receipt:** `writing-plans` and `executing-plans` were not installed. The active `adaptive-writing-plans` orchestrator generated this compatible leaf artifact; installed `finalise-plan` reviews it before execution. Provider absence remains visible and does not authorize installation or duplicated provider workflow logic.

## Task 1: Add the posture-bound leaf and execution checkpoint protocol

**Files:** `scripts/lib/execution-protocol.mjs`, `tests/execution_protocol.test.mjs`.

Create pure local contracts for leaf-planning handoff, execution checkpoint, compact handoff, resume validation, evidence-triggered stop/replan, and subtractive finalisation. Bind every envelope to the exact node `PostureRef`, behavior budget, scope provenance, deferred candidates, design refs, architecture snapshot, and stable handoff hash. A compact handoff records only a pending approval identity and `requires_regeneration`; it never carries reusable approval authority. Validation returns a concrete recovery action and must run before source edits.

Reuse `validateScopeControl`, `partitionBehaviorCandidates`, and existing hash utilities. Do not infer posture from prose, mutate the map, or implement an executor.

Acceptance at this boundary: a current checkpoint validates without changing its input; a missing or changed posture/design/architecture ref returns `stop_and_recover` with the exact stale field; compact round-trip preserves profile, required/excluded/deferred behaviors, and provenance; pending approval always returns `regenerate_approval_brief`; unsupported production hardening is deferred while approved safety/experiment behavior remains admitted.

Validation: `node --test tests/execution_protocol.test.mjs tests/engineering_posture.test.mjs`

Commit: `feat: add posture-bound execution and compact handoffs`

## Task 2: Verify provider-owned workflow outcomes through a thin adapter

**Files:** `scripts/lib/host-adapter.mjs`, `tests/host_adapter.test.mjs`.

Add a pure outcome verifier for a host-owned provider invocation receipt. It validates the normalized handoff and CompositionContract, compares expected and observed artifact refs, and reports exactly one of `persisted`, `conversation_only`, or `unverified_persistence`. It must not launch providers, rewrite their workflow, accept provider prose as canonical state, or treat a claimed artifact as persisted without observation.

Acceptance at this boundary: a verified expected artifact is `persisted`; a provider that declares no durable artifact is `conversation_only`; a missing expected artifact, invalid handoff, or unverified persistence claim is `unverified_persistence` with explicit reasons. Input receipts remain unchanged.

Validation: `node --test tests/host_adapter.test.mjs tests/handoff_validation.test.mjs`

Commit: `feat: verify provider workflow persistence outcomes`

## Task 3: Make the Skill orchestration contract compact-safe and subtractive

**Files:** `skills/adaptive-writing-plans/SKILL.md`, `skills/adaptive-writing-plans/references/execution.md`, `skills/adaptive-writing-plans/references/compatibility.md`, `tests/skill_contract.test.mjs`.

Require leaf planning to emit the exact posture/provenance/budget handoff and block on stale refs. Define explicit start, compact, resume, replan, and finalisation behavior: re-read hashes before edits, regenerate any pending ApprovalBrief, stop when material evidence changes, and run subtractive scope/provenance review before completeness review. Preserve mandatory safety floors and experiment validity while removing unsupported hardening. Document provider invocation as host-owned composition with verified persistence outcomes.

Keep the entrypoint concise and route detailed mechanics to `execution.md` and `compatibility.md`. Do not copy third-party skill procedures or turn provider absence into an installation request.

Validation: `node --test tests/skill_contract.test.mjs tests/execution_protocol.test.mjs tests/host_adapter.test.mjs`

Commit: `docs: bind planning execution to posture and compact refs`

## Task 4: Record N-005 evidence and revalidate N-007 without releasing it

Run focused and full verification, schema/skill/plugin validation relevant to changed files, strict map validation, and `git diff --check`. Record append-only verification and status events, mark N-005 done only after all checks pass, and revalidate N-007. N-007 must remain blocked until N-006 is done.

Validation: `npm test`; `python3 /mnt/data4/zhangzixing/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/adaptive-writing-plans`; `node scripts/validate-plan.mjs --root docs/superpowers/plans/2026-08-28-engineering-posture-scope-control --strict`; `git diff --check`

Commit: `chore: record verified N-005 execution handoff evidence`

## Finalise-plan review

Reviewed in place with installed `finalise-plan`. Execution is serial because the current session is the selected executor and no independent N-006 worker was authorized. The plan has no unresolved design or architecture question; the only provider gap is the explicitly recorded absence of `writing-plans`/`executing-plans`. Each task has a separate file boundary, acceptance surface, validation command, and commit boundary.
