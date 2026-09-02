# Re-entrant Design Gate

Use this reference at planning intake and whenever evidence changes a module
boundary, interface, dependency, data model, migration, security model,
performance budget, concurrency behavior, or failure semantics.

## Position in the workflow

Design is a gate, not a route. A workflow can enter `designing` from intake,
guide, map, leaf planning, execution, or replanning, then return to its pending
work shape. A task that requires design is not eligible for `direct`.

`design.json` is canonical for plan-scoped, revisioned design state and
`DESIGN.md` is its generated view. Root and node-scoped revisions are supported.
Architecture, design, and map remain separate canonical states connected by
hash-bound references.

## Triage

Create a DesignProfile containing:

- triggers and required engineering concerns;
- scope and affected modules/relations;
- risk and whether multiple alternatives are mandatory;
- the architecture hash used by the design;
- the exact `PostureRef`, behavior budget, scope provenance, deferred
  candidates, and input refs used by provider composition.

High-impact designs include cross-module changes, public APIs, new modules,
migrations, and critical security/data/distributed concerns. They require at
least two explicit options before approval.

## Provider routing

Use the deterministic installed-provider registry plus
`design-provider-catalog.json`. Build a visible bundle with roles:

- `driver`: structures options and decisions;
- `reference`: supplies codebase/domain evidence;
- `reviewer`: stress-tests risks and omissions.

For every selected provider, expose its role, matched concern/domain, source,
mutability, invocation policy, and reason. Catalogued read-only providers may
be invoked automatically. Providers with artifact or external mutations need
confirmation. Discovery never installs or invokes anything.

If a critical concern has no provider, block approval until a provider result
is available or the user records an explicit waiver. Missing non-critical
coverage stays visible but does not block unrelated design work. Provider
results are evidence only; they cannot approve or mutate the design.

Every selected provider exposes a `CompositionContract` with its source and
version/digest, dependencies and readiness, mutability, invocation policy and
state, persistence expectation and state, expected outputs, verification, and
fallback. A discovered provider is not ready merely because its name matches.
Store raw output once under `provider-results/`; handoffs carry `raw_ref`.

## Recursive design

Root Design fixes module responsibilities, dependency direction, contract
envelopes, posture, and critical scenarios. It does not pre-design private
leaf implementation. Assess each module, relation, or task:

- `covered_by` requires exact design refs and explicit coverage of every
  material trigger;
- `inline` is limited to private, contract-preserving choices;
- `thread_required` covers material contract, dependency, data, failure,
  security, performance, posture, or unresolved tradeoff decisions.

The v2.1 Design Ledger is canonical. `DESIGN.md` is its graph/index and
`designs/root.md`, `designs/modules/*.md`, `designs/relations/*.md`, and
`designs/tasks/*.md` are generated subject views. A critical contract remains
consumer-blocking until verified. Failure invalidates only its declared
consumers; wider invalidation needs explicit evidence.

Append a child with `adaptive-plan design add-thread` and the exact
`--expected-hash <document-state-hash>`, then pass its exact
`--thread <thread-id>` to update, record, brief, approve, and revise operations.
Link an approved child with `adaptive-plan plan link-design`,
`--thread <thread-id>`, and `--node <node-id>`. MCP clients use the corresponding
`thread_id` and `node_id` fields. Child links are node-scoped and do not replace
the root design gate. Revision invalidation matches the exact design, thread,
and revision, so sibling threads at the same revision remain current.

## Approval contract

An approvable revision includes requirements, alternatives when required, a
selected option, interfaces, invariants, failure modes, operating model,
migration approach, resolved blocking questions, provider results/waivers, and
any architecture delta.

Before asking for approval, generate a bounded `ApprovalBrief` from current
canonical state and render it in the active conversation. It contains the
subject, exact content and posture hashes, decision summary, included/excluded
scope, material risks, provider status, downstream effect, waiver request, and
one confirmation prompt. Artifact paths are optional audit references, never
the approval interface.

Approval names the exact content hash, posture hash, and brief hash the user
reviewed. Any mismatch fails and requires a freshly rendered brief. Provider
waivers are required only while blocking concerns or composition blockers
remain unresolved. Approval changes lifecycle state only; reviewed content
identity remains unchanged.
Architecture deltas remain separately human-approved even when their design
revision is approved.

For readable v2.0 revisions, the exact `design_hash` remains the compatibility
name for the reviewed content hash; it does not replace the posture and brief
bindings required by posture-aware v2.1 flows.

## Re-entry and staleness

New evidence never edits an approved revision in place. Mark it `stale`, record
the reason, create a new in-progress revision linked by `supersedes_hash`, and
invalidate map nodes that reference the old revision. The resumed route cannot
claim readiness until those nodes link the new approved/waived revision.

Record a `DesignImpact` with exact affected contract and thread IDs for
contract, architecture, or posture changes. Posture promotion creates successor
revisions and requires a new brief; do not reconstruct approval after compact.
