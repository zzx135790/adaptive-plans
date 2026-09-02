# Adaptive Writing Plans

Adaptive Writing Plans is a lean, direct-first planning and execution core. It
keeps stable work in the current session, uses skills visible to the current
host when more structure is justified, and falls back to named Ada behavior
when no matching skill is visible.

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

Execution is fast by default. Dependency-ready nodes with disjoint owned paths
and no shared mutable unpartitioned resource run in the same subwave. Conflicts
move deterministically to later subwaves; token cost is never a dispatch gate.
The main model coordinates and integrates while delegated workers own leaf work.

```text
adaptive-plan route
adaptive-plan init --root <folder> --id <id>
adaptive-plan add --root <folder> --id <node> --title <title>
adaptive-plan validate --root <folder>
adaptive-plan overview --root <folder>
adaptive-plan waves --root <folder> [--statuses '{"N-001":"done"}']
```
