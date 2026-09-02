---
name: adaptive-writing-plans
description: Use when implementation requirements, dependencies, subsystem boundaries, or design choices may affect how work should be organized.
---

# Adaptive Writing Plans

Choose the lightest safe route, preserve scope explicitly, and expose parallel
work as soon as dependencies allow it.

## Direct-first routing

Default to `direct`. Stable multi-step work and long-running work alone stays
direct; do not create a planning artifact for it. Escalate only on evidence:

- concrete ambiguity -> ask one bounded question;
- an uncertain dependency or cross-subsystem coordination -> create a DAG map;
- concrete design evidence -> use a bounded leaf plan after resolving it.

## Behavior-level skill routing

Map only substantive behaviors whose execution benefits from a specialized
workflow. Select from the skill names and descriptions currently visible to the
host; do not ask the user to enumerate skills, scan for hidden providers, or
install one. Record the purpose, selection reason, execution order, and at most
two considered alternatives. Choose exactly one visible skill per behavior, or
a named Ada fallback when none matches. Read only the final selected skill, not
the alternatives.

For direct work, show `Skill route: behavior -> selected/fallback (reason)` as
one line before starting. Do not invent a route when no binding was selected.
An execution-time override must record a non-empty reason.

## Scope admission

Record `required`, `excluded`, and `deferred_candidates` in the behavior budget.
Admit behavior only when it is required or one of these four safety floors:

- `bound_runaway_resource_cost`
- `fail_loud_on_invalid_results`
- `prevent_credential_exposure`
- `prevent_destructive_data_loss`

Keep explicit exclusions excluded. Put any other proposed extension in
`deferred_candidates`; possible future reuse is not admission evidence.

The four floor entries reserve behavior-budget capacity; they do not admit new
wrappers or duplicate checks. A new candidate claiming a floor capability must
include a safety case with a threat, non-empty evidence, impact, the smaller
control considered, non-empty verification, reversibility, and cost. Otherwise
defer it as `missing_safety_case`.

## Dependency trust

Trust standard libraries, mature packages, and repository-verified operations
by default. Validate task inputs, integration results, and acceptance criteria.
Do not add wrappers, guards, self-built substitutes, or repeated checks unless
there is an observed failure, a version or contract conflict, or an explicit
security boundary.

## Maps and execution

Create a v2 JSON DAG only for the map route. Read and validate existing v1 and
v2 maps without auto-migration, and preserve unknown extension fields.

Partition each dependency wave deterministically. Put dependency-ready nodes in
the same subwave when they have disjoint owned paths and no shared mutable
unpartitioned resource. Move conflicts to later subwaves. Token cost is never a
gate. The main model coordinates and integrates; delegate leaf work, then review
and combine its results.

Use `adaptive-plan route|init|add|validate|overview|waves` for the deterministic
core. Pass `add --skill-bindings '<json-array>'` for each new node. Pass
`waves --statuses <json>` when live node status differs from the map; the
command evaluates that snapshot without rewriting the plan.
