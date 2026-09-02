# Adaptive Writing Plans

Adaptive Writing Plans is a lean, direct-first planning and execution core. It
keeps stable work in the current session, uses skills visible to the current
host when more structure is justified, and falls back to named Ada behavior
when no matching skill is visible.

Skill routing is behavior-level and includes only substantive work. The host
selects from currently visible skill names and descriptions without asking the
user to enumerate them. Each binding records one final skill or named Ada
fallback, its purpose and selection reason, execution order, and no more than
two alternatives. Only the final selected skill is read. Direct work displays
the single-line route before starting, and any execution override records a
non-empty reason.

Escalation beyond direct requires concrete ambiguity, an uncertain dependency,
cross-subsystem coordination, or design evidence. Multi-step or long-running
work alone stays direct and creates no planning artifact.

Maps are portable JSON DAGs. The reader validates schema v1 and v2 without
auto-migration and preserves unknown extension fields. The scope contract is a
behavior budget with `required`, `excluded`, and `deferred_candidates`. Every
budget retains these safety floors:

- `bound_runaway_resource_cost`
- `fail_loud_on_invalid_results`
- `prevent_credential_exposure`
- `prevent_destructive_data_loss`

These entries reserve capacity rather than automatically admitting a wrapper
or repeated check. A new candidate claiming a floor capability needs a complete
`safety_case`: threat, non-empty evidence, impact, smaller control, non-empty
verification, reversibility, and cost. Missing cases are deferred with
`missing_safety_case`.

Standard libraries, mature packages, and repository-verified operations are
trusted by default. Validation belongs at task inputs, integration results, and
acceptance criteria. Wrappers, guards, self-built substitutes, and duplicate
checks require an observed failure, a version or contract conflict, or an
explicit security boundary.

Execution is fast by default. Dependency-ready nodes with disjoint owned paths
and no shared mutable unpartitioned resource run in the same subwave. Conflicts
move deterministically to later subwaves; token cost is never a dispatch gate.
The main model coordinates and integrates while delegated workers own leaf work.

```text
adaptive-plan route
adaptive-plan init --root <folder> --id <id>
adaptive-plan add --root <folder> --id <node> --title <title> --skill-bindings '<json-array>'
adaptive-plan validate --root <folder>
adaptive-plan overview --root <folder>
adaptive-plan waves --root <folder> [--statuses '{"N-001":"done"}']
```
