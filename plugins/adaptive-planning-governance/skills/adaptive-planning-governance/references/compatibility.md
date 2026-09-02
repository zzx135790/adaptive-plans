# Host and Provider Compatibility

The protocol has one canonical artifact model and thin host adapters. Host
progress, provider invocation, and UI are projections; none is a second plan
database.

## Visible skill boundary

The current host-visible skill list is the only provider set used for routing.
The host should pass that list as `VisibleProviderSet`; Ada must not infer
additional executable providers by scanning an installation directory. A
discovered file that is not visible in the current session is diagnostic
evidence, not a selectable provider. This also means host-specific skills do
not need a separate compatibility blacklist: they are absent when they are not
visible.

Provider selection is capability-first and role-aware. Explicit metadata beats
keyword inference, and inference cannot grant execution authority. Each route
records the selected visible skill, the reason, an acceptance condition, and a
verification command. If no visible provider matches, use the bounded fallback
below and record the unavailable provider rather than retrying discovery.

| Capability | Preferred installed provider | Built-in fallback |
|---|---|---|
| Clarify intent | `planning-clarification`, `ask-plan-questions` | one bounded question |
| Explore code | `explore`, `codebase-analyzer` | repository evidence scan |
| Design options | `meta-decision-analysis` | explicit alternatives table |
| Design risk | `risk-assessment`, `meta-scenario-planning` | visible non-critical risk register |
| Decompose map | roadmap/task decomposition skill | progressive/topological DAG |
| Generate leaf | `writing-plans` | none |
| Review leaf | `finalise-plan` | schema/DAG checks only |
| Execute | `executing-plans`, `subagent-driven-development` | user-selected executor |
| Parallel execution | coordinator-owned subagent wave | sequential execution |

The fallback column is executable Ada behavior, not a request to install or
invoke another provider. For direct work, no planning provider is required:
the coordinator follows the normal single-session workflow and only records a
fallback when a requested capability is actually missing.

Discovery and invocation are separate. A missing provider becomes an
`unavailable` result; it is never an implicit installation request. Critical
design coverage follows the block-or-explicit-waiver rule.

Behavior-level routing in governance map nodes does not use or extend this
planning-provider catalog. The host model compares the current session's
injected skill names and descriptions with the substantive behavior, then
records exactly one `selected_skill` or a named `ada_fallback`, its purpose and
selection reason, a positive execution order, and no more than two alternatives
with non-selection reasons. Skill names are open strings because visibility is
session-owned; deterministic adapters validate, store, and render the decision
without scanning an installation, maintaining a persistent catalog, or
installing anything. Administrative map operations need no binding.

If execution replaces the recorded route, `override_reason` identifies the old
route, new route, and reason. Standard libraries, mature dependencies, and
repository-verified operations remain trusted unless task evidence justifies a
wrapper, guard, substitute implementation, or repeated verification.

Invocation is owned by the provider's host. The adapter validates the returned
PlanningHandoff and CompositionContract, then compares declared expected
artifact refs with host-observed refs:

- `persisted`: invocation completed, contracts validate, every expected
  artifact is observed, and persistence is verified;
- `conversation_only`: the valid provider workflow declares no durable
  artifact;
- `unverified_persistence`: identity/contracts are invalid, invocation failed,
  an expected artifact is missing, or persistence is not verified.

Only `persisted` output can satisfy a durable planning-artifact gate. The other
outcomes remain visible evidence and never trigger a built-in rewrite of the
provider's workflow.

Prefer direct reuse when an installed provider's catalog contract, dependency
readiness, mutability, and version/digest already match the requested role. Use
a thin adapter only to translate the input/output envelope or connect host
observation to persistence verification. An adapter must not reproduce the
provider's reasoning workflow.

Report composition failures distinctly: `dependency_not_ready` for unavailable
dependencies, `version_digest_drift` when the invoked identity differs from the
contract, `invocation_not_completed` for provider failure, and
`expected_artifact_not_observed` when an expected output was not written and
declared. Keep the declared bounded fallback visible; do not disguise one
failure as another.

## Superpowers artifact boundary

Only map routing bootstraps
`docs/superpowers/plans/<date>-<slug>/`. Stable plan routing invokes
`writing-plans`, and execution consumes its standard
`docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` Markdown file unchanged.
Link a leaf with an append-only `artifact_linked` event instead of copying it.

## Progress adapters

On Codex, execution state is projected through `update_plan`; on Claude Code it
may be projected through `TodoWrite`. The adapter mirrors only the current
conversation after explicit execution. It must not auto-resume a plan, update
canonical status, or let subagents write progress. For a parallel wave, the
coordinator serializes result persistence, review, verification, and the single
visible wave item.

Compact handoffs are host-neutral checkpoint projections, not a second plan
database. They preserve exact refs and pending gate identity but require a
fresh ApprovalBrief after resume.

The portable command bridge is:

```text
adaptive-plan overview|migrate
adaptive-plan posture assess|check|promote
adaptive-plan architecture bootstrap|check|propose|apply
adaptive-plan design start|add-thread|update|record|approve|revise|brief
adaptive-plan plan link-architecture|link-design|record-impact
adaptive-plan completion check
```

Design update, record, approve, revise, and brief commands accept
`--thread <thread-id>` and default to `root`. Link a child design with both
`--thread <thread-id>` and `--node <node-id>`; root linking remains
project-scoped.

## Version compatibility

The v2 reader accepts v1 maps and handoffs. Only explicit migration writes v2;
unknown design and architecture gates remain `unknown_legacy`. No adapter may
silently upgrade or rewrite canonical artifacts.
