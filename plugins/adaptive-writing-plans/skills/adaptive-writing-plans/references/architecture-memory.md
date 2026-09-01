# Project Architecture Memory

Use this reference when planning or validating work against an existing
project, when defining a module, or when changed code may affect module
contracts.

## Ownership and location

Architecture memory belongs to the project, not a plan or conversation. Its
default root is:

```text
docs/architecture/adaptive/
|-- architecture.json     canonical approved baseline
|-- ARCHITECTURE.md        generated project view
|-- modules/*.md           generated module contract views
|-- changes/               proposed architecture deltas
`-- events.jsonl           append-only audit facts
```

`architecture.json` is the only canonical architecture baseline. A plan stores
an `architecture_snapshot` with the project ID, revision, architecture hash,
and referenced module contract hashes. It does not copy or own the baseline.

## Module contract

Every approved module has a Core Contract:

- stable ID, purpose, non-goals, and owners;
- owned path patterns and explicit public boundary paths;
- invariants and module dependencies;
- source references and a derived contract hash.

Add only the Concern Packs triggered by the module or change. Supported packs
cover API, data, distributed behavior, security, performance, operability,
migration, UX, and testing. An active pack must contain all of its required
fields; feature prose alone is not an engineering contract.

Relations between modules are typed (`calls`, `reads`, `writes`, `emits`,
`owns`, `extends`, or `migrates`) and record interface, failure propagation,
compatibility, and evidence status. An approved baseline cannot contain a
relation whose evidence is missing.

## Posture defaults and experimental zones

An assessed project may store a hash-bound project `posture_default`; a stable
module may override it with its own PostureRef. Resolution is deterministic:
project, module, matching experimental zone, then task override. A differing
task override needs an approved decision bound to the inherited posture hash.
Profiles are not ranked, and inheritance never implies promotion.

Use `experimental_zones` for bounded spike or experiment paths that do not yet
need a full Core Contract. A zone records only an ID, objective, owned paths,
spike/experiment PostureRef, provenance, and active status. It is not an
incomplete production module. Zone-only changes are mapped to the zone; when a
zone overlaps a stable module, module ownership remains visible, and a stable
public-boundary change still requires the normal architecture delta.

Promotion is proposal-only. The proposed baseline removes the zone and adds or
updates a complete module Core Contract. Applying that baseline uses the
existing hash-bound architecture delta and explicit human approval.

A legacy baseline without posture fields remains readable and reports
`unknown_legacy`. It cannot supply an authoritative PostureRef until an
explicit assessment writes a new approved baseline.

## Bootstrap and approval

If no baseline exists, run `adaptive-plan architecture bootstrap` to scan only
for a proposal. Scanning may infer folders and owned paths, but it must not
infer purpose, owner, public contract, or semantic relations. An engineer must
complete the proposal and explicitly approve it before it becomes the project
baseline.

Every write is optimistic: it is bound to the architecture hash the caller
read. A stale hash fails rather than overwriting a newer baseline.

## Keeping memory current

At planning start, link the approved architecture snapshot to the plan and add
module contract refs to affected nodes. During and after implementation:

1. Compute changed paths from the real diff.
2. Classify every non-ignored path against module ownership.
3. Block unmapped or multiply-owned paths until the baseline is corrected.
4. For internal changes, record an `ArchitectureImpact` classified
   `no_contract_change` with verification evidence.
5. For public boundaries or semantic contract changes, create a hash-bound
   architecture delta that includes affected modules/relations, rationale,
   compatibility, migration, and the approved design ref.
6. Apply the delta only with explicit human approval, then relink the plan to
   the new architecture hash and revalidate affected nodes.

Hooks may append evidence but never classify or apply a delta. The required CI
check runs `adaptive-plan architecture check --base <base> --head <head>
--impact <artifact>` and fails when changed paths, baseline hash, approval, or
impact evidence do not match. This makes architecture freshness a workflow
gate rather than a promise that a model will remember to edit documentation.
Read [ci-integration.md](ci-integration.md) when installing the required check.

## Invalidation

When an approved architecture hash or referenced module contract hash changes,
mark dependent design revisions and map nodes stale. Preserve their previous
content as evidence, record the cause, and revalidate only affected descendants.
