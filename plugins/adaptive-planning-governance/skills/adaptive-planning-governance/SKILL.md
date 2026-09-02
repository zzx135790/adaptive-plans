---
name: adaptive-planning-governance
description: Use when a project explicitly needs optional advanced planning governance such as persistent architecture memory, re-entrant design approval, engineering-posture controls, recoverable migration, or strict completion gates. Do not use for ordinary implementation planning or one-off task plans.
---

# Adaptive Planning Governance

Apply an optional governance layer to projects whose planning risks justify
persistent architecture, design, posture, migration, or completion state. Use
installed leaf plan generators (such as `writing-plans`) for ordinary plans;
this skill governs when those leaves are ready without replacing them.

## Operating model

Keep these dimensions separate:

- `stage` says where the workflow is: intake, guiding, designing, mapping,
  leaf planning, executing, validating, or complete.
- `work_shape` says how the work is organized: undetermined, direct, plan, or
  map. The compatible route labels are guide, direct, plan, and map.
- `design` is a re-entrant gate, not a fifth route. Guide, map, and plan work
  can enter it when a design trigger appears and resume afterward.

At planning entry and after material new evidence:

1. Establish the project root and read repository rules, supplied handoffs,
   active artifacts, and the project architecture baseline when present.
2. Resolve only intent ambiguity that blocks routing. An unresolved goal,
   boundary, constraint, or success criterion keeps the work in `guide`.
3. Establish the engineering posture from approved intent and carry its exact
   `PostureRef`, behavior budget, scope provenance, and deferred candidates.
   Unknown legacy posture blocks executable work instead of being inferred.
4. Run DesignProfile triage before fixing the work shape. If design is
   required, enter the Design Gate, preserve the pending route, and resume only
   after the exact design revision is approved or explicitly waived.
5. Route the ready work to `direct`, `plan`, or `map` using the rules below.
6. Re-enter design or replan when evidence changes a contract, dependency,
   failure model, migration, security boundary, data model, or key assumption.

Read [architecture-memory.md](references/architecture-memory.md) when a task
touches an existing project or module boundary. Read
[design-gate.md](references/design-gate.md) whenever DesignProfile triage is
required or design becomes stale. For high-impact designs requiring multiple
options, use an installed decision analysis skill (such as `meta-decision-analysis`)
to structure alternatives; for risk assessment, use an installed risk analysis
skill (such as `risk-assessment` or `meta-scenario-planning`).

## Route selection

- `guide`: intent is not yet approved. Maintain Goal, Scope, Constraints, and
  Success Criteria in `GUIDE.md`. Use an installed intent clarification skill
  (such as `planning-clarification` or `ask-plan-questions`) for structured
  requirements gathering; ask only questions whose answers cannot be established
  from the codebase or existing artifacts.
- `map`: multiple phases, cross-subsystem work, uncertain dependencies, or a
  long-running effort. Use an installed code exploration skill (such as `explore`
  or `codebase-analyzer`) when repository evidence is needed. Start with visible
  bootstrap node `N-000`, then create a complete DAG and node briefs; do not
  flatten it into one document.
- `plan`: one bounded phase has stable inputs, outputs, contracts, design refs,
  acceptance criteria, verification, and a current posture-bound leaf handoff.
  Use an installed leaf plan generator (such as `writing-plans`) for that leaf,
  then use an installed plan review skill (such as `finalise-plan`) to verify
  the persisted artifact before execution.
- `direct`: a small task can finish in one session, touches at most one or two
  components, has no uncertain dependency, and does not require design.

Use progressive waves when map dependencies remain uncertain and topological
waves when they are established. A titled node is not ready until its inputs,
outputs, dependency gates, contract/design refs, acceptance, and blocking
questions are explicit.

## Artifact boundary

For `map`, initialize the adaptive folder with `scripts/init-plan.mjs` under
`docs/superpowers/plans/<date>-<slug>/` unless the user selected another root.
Do not use `--force` over an existing `map.json`. For `guide` and `direct`, do
not create an adaptive planning folder merely because the project is new.

For `plan`, use the installed leaf plan generator (such as `writing-plans`) and
preserve its output at `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`.
Link it to its map node with an append-only `artifact_linked` event; do not copy
it into a second canonical format. Consume upstream specs and handoffs in place.

`map.json` is the topology source of truth and `MAP.md` is its generated view.
At every map handoff, final response, or status report, show both:

1. the complete ASCII DAG returned by `adaptive-plan overview`; and
2. the complete artifact index, including every node brief and linked leaf.

`N-000` establishes and verifies the plan folder, views, event log,
architecture link, posture, and required design state. Keep it in the visible
DAG even after completion so a resumed conversation can verify which protocol
artifacts exist before adopting executable work.

Read [plan-folder-protocol.md](references/plan-folder-protocol.md) before
creating, migrating, invalidating, or completing an adaptive plan folder.

## Provider boundary

Discover providers by capability, including `design`; do not hard-code an
external repository. Select only installed providers, expose why each provider
was selected, and invoke it through the host that owns it. Automatic invocation
is limited to catalogued read-only providers. Never auto-install a discovered
provider or let provider prose change canonical state.

Preserve raw output, source, time, confidence, and unknown extensions. Plain
text is `unstructured`, not a decision. Hooks and providers may append audit
facts but must not silently change intent, design, architecture, topology, or
completion. Read [provider-contract.md](references/provider-contract.md) when
normalizing or invoking a provider and [compatibility.md](references/compatibility.md)
when adapting another planning host.

Provider invocation remains owned by its host. Treat its result as durable only
when the normalized handoff, CompositionContract, and expected artifacts verify
as `persisted`; otherwise report `conversation_only` or
`unverified_persistence`. Never duplicate the provider's workflow to hide an
unavailable provider.

## Execution and completion

Planning does not start execution. Skills that name `TodoWrite` map it to Codex `update_plan`.
Only after the user explicitly asks to execute or continue a
specific plan, use it and keep exactly one executable task `in_progress`. A new
conversation must not discover and resume an old plan merely because its files
exist. Mark an item complete only after its verification succeeds.

Before source edits and after every resume/compact boundary, re-read canonical
state and validate the execution checkpoint against exact posture, design, and
architecture refs. Stop and replan on material evidence. Finalisation is
subtractive first: remove unsupported or above-budget behavior before checking
the remaining approved behavior for completeness. A hypothetical future reuse
case never authorizes production hardening.

Treat posture profiles as distinct definitions of done, never as an automatic
maturity ladder. A spike needs its bounded question and result validity; an
experiment needs hypothesis, measurement validity, and reproduction evidence;
reusable internal work needs a stable local contract, compatibility evidence,
and integration tests; production alone requires operational ownership,
security, migration/rollback, and reliability evidence. Stop when the active
profile's approved behaviors and evidence are complete.

Before declaring the workflow complete, require approved intent, an approved/
waived/not-required design gate, a satisfied/not-required architecture sync
gate, and current `done` nodes. A contract-changing implementation also needs
an approved architecture delta; a no-contract-change implementation needs
recorded evidence. Read [execution.md](references/execution.md) before executing
a leaf or parallel wave.

For parallel execution of independent nodes, use an installed parallel dispatch
skill (such as `dispatching-parallel-agents`) to dispatch subagents concurrently,
or use a subagent-driven development skill (such as `subagent-driven-development`)
when executing an implementation plan with independent tasks in the current session.
Never flatten parallel-capable nodes into a sequential plan without explicit
evidence that parallelization is unsafe.

## Compatibility

Read schema v1 maps and handoffs without inventing v2 design or architecture
state. `adaptive-plan migrate` is a read-only preview. Apply only the exact
proposal with `--apply --expected-hash`; recover only the exact migration with
`--recover` plus the current map hash. Design conversion additionally requires
an explicit authoritative PostureRef and makes historical approval stale.
Unknown legacy gates remain unknown until evidence resolves them. Never rewrite
a v1 artifact merely because it was opened.
