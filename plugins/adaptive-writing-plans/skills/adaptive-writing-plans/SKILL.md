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

For an escalated capability, select only currently visible skills. Match
capability first and role second, explain the choice, and let the owning host
invoke it. When none matches, use the named Ada fallback for that capability;
do not scan for hidden providers or install one.

## Scope admission

Record `required`, `excluded`, and `deferred_candidates` in the behavior budget.
Admit behavior only when it is required or one of these four safety floors:

- `bound_runaway_resource_cost`
- `fail_loud_on_invalid_results`
- `prevent_credential_exposure`
- `prevent_destructive_data_loss`

Keep explicit exclusions excluded. Put any other proposed extension in
`deferred_candidates`; possible future reuse is not admission evidence.

## Maps and execution

Create a v2 JSON DAG only for the map route. Read and validate existing v1 and
v2 maps without auto-migration, and preserve unknown extension fields.

Partition each dependency wave deterministically. Put dependency-ready nodes in
the same subwave when they have disjoint owned paths and no shared mutable
unpartitioned resource. Move conflicts to later subwaves. Token cost is never a
gate. The main model coordinates and integrates; delegate leaf work, then review
and combine its results.

Use `adaptive-plan route|init|add|validate|overview|waves` for the deterministic
core. Pass `waves --statuses <json>` when live node status differs from the map;
the command evaluates that snapshot without rewriting the plan.
