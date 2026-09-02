# Plan Folder Protocol

Use this reference when creating, migrating, updating, invalidating, or
completing an adaptive map.

## Canonical identity

The default map folder is `docs/superpowers/plans/<date>-<slug>/`:

```text
GUIDE.md                 approved intent view
map.json                 canonical topology, gates, refs, and artifact links
MAP.md                   generated navigation view
DESIGN.md                generated current design view when required
design.json              canonical design revisions when required
nodes/*.md               generated/current node briefs
plans/                   non-canonical local notes only
decisions/*.md           durable decision records
changes/*.json           architecture impact/delta artifacts
provider-results/*       raw provider evidence
events.jsonl             append-only audit facts
```

Project architecture is not stored here. `map.json` links a project-owned
`architecture_snapshot`; design refs name exact revisions/hashes; node contract
refs name module contract hashes. Standard `writing-plans` leaves stay at
`docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` and appear in `artifacts`.

`map.json`, `design.json`, and project `architecture.json` are independent
canonical states. Markdown files are views and may be regenerated. Audit events
do not become state merely because they were appended.

## Human-visible map

`MAP.md` and `adaptive-plan overview --root <folder>` must expose:

- stage, work shape, gates, architecture snapshot, and design refs;
- the full ASCII DAG, edges, node statuses, and blocking reasons;
- the full-map `Skill routing` summary and flat `skill_routes` overview for
  every recorded substantive behavior;
- every node brief and linked artifact path.

Never hand off only `MAP.md` or one leaf filename. Inline the overview DAG and
complete artifact index so a user can verify that a multi-file map exists and
navigate every part of it.

## N-000 bootstrap

Every adaptive map reserves `N-000` as a control node. It creates or verifies
the protocol artifacts needed by later nodes: `GUIDE.md`, `map.json`, `MAP.md`,
`nodes/`, `events.jsonl`, the project architecture snapshot, the authoritative
posture, and required design state. It is complete only when the overview can
show the whole DAG and every expected artifact with an existence result.

Keep `N-000` in the canonical topology after bootstrap. It is evidence that
the map protocol ran, not a disposable setup note. Product nodes may depend on
it, but its control status exempts it from product behavior budgets.

## Node lifecycle

Valid statuses are `idea`, `blocked`, `ready`, `in_progress`,
`awaiting_validation`, `done`, `stale`, `deferred`, and `cancelled`.

A node may be `ready` only when it has a stable objective/non-goals, declared
inputs/outputs, current dependencies, requirement IDs, module contract refs,
required design refs, testable acceptance/verification, and no blocking
question. Hooks and providers can propose but cannot apply a transition.

Newly authored substantive behavior routes use optional node
`skill_bindings`. Each binding has unique `behavior` and positive
`execution_order` values, purpose and selection rationale, exactly one visible
`selected_skill` or named `ada_fallback`, and at most two alternatives with
non-selection reasons. Node briefs render every field, including an
`override_reason` when execution replaces a route. Legacy v1 or v2 maps without
the field remain readable, and unknown map or node extensions remain intact.
Do not create bindings for control-node bookkeeping or other non-behavioral
map maintenance.

## Replanning

When evidence invalidates a dependency, contract, or design:

1. append evidence with source and provenance;
2. record the alternatives and selected response;
3. mark the affected node and reachable descendants stale;
4. preserve completed work but require revalidation;
5. regenerate only affected briefs and leaf plans.

Never silently edit a dependency and leave descendants looking current.

## Completion

Completion validation requires schema v2, an authoritative posture and all of
that profile's `required_evidence`, approved intent, design status
`approved`, `waived`, or `not_required`, architecture sync status `satisfied`
or `not_required`, and every non-cancelled node current and `done`. A v1 map
must be explicitly migrated before it can pass this gate.

## v1 compatibility

Opening a v1 map is read-only compatible. `adaptive-plan migrate --root
<folder>` returns a read-only proposal with source/target map hashes, changed
paths, a complete artifact preservation manifest, and `writes: false`.

Apply only with the exact returned proposal hash:

```text
adaptive-plan migrate --root <folder> --apply --expected-hash <proposal-hash>
```

Before any canonical write, apply stores byte-exact recovery material under
`.adaptive-migrations/<migration-id>/recovery.json`. Recovery requires both the
migration ID and the exact current target map hash:

```text
adaptive-plan migrate --root <folder> --recover <migration-id> --expected-current-hash <map-hash>
```

Use `--include-design` only when flat design history must be converted. It
requires `--posture-ref` or `--posture-ref-file` with an authoritative
PostureRef, creates only one root design thread, preserves every raw legacy
revision, invents no child or verified contract, and makes historical approval
stale for a fresh inline brief. Migration preserves nodes and uncertainty;
resolve `unknown_legacy` gates from evidence rather than fabricating approval.
