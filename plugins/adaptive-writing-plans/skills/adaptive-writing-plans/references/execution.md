# Execution and Parallel Waves

Read this reference only after the user explicitly starts or continues a
specific approved plan.

## Visible progress

Planning artifacts are durable project state; Codex `update_plan` is the live
execution view for the current conversation. Skills that say `TodoWrite` mean
`update_plan` on Codex.

Before the first implementation change:

1. Read and validate the selected leaf plan and its current architecture/design
   refs.
2. Expose concrete, independently verifiable tasks in plan order.
3. Keep exactly one executable task `in_progress`; blocked or deferred work is
   `pending` with its blocker stated.
4. Update progress at each start, verified completion, blocker, scope change,
   or replan. Completion requires the task's verification to succeed.

Context compaction does not authorize a different plan. A new conversation
must not infer continuation from plan files alone.

## Posture-bound leaf handoff

Before leaf generation, create a hash-bound handoff containing the selected
node, exact `PostureRef`, required/excluded/deferred behavior budget, scope
provenance, deferred candidates, approved design refs, and architecture
snapshot. Do not invoke the leaf provider when these refs are missing, stale,
or conflicting. Its output is not durable until the expected leaf artifact is
observed and linked.

The selected executor creates an execution checkpoint from that handoff and
leaf path. Before the first source edit, compare it with freshly read canonical
state. A mismatch returns `stop_and_recover`: reload the map, regenerate the
leaf handoff/checkpoint, and do not infer posture from plan prose.

## Resume, compact, and approval

A compact handoff preserves the exact profile, required/excluded/deferred
behaviors, provenance, design refs, architecture snapshot, selected leaf/task,
and checkpoint hash. It does not preserve approval authority. For a pending
gate it stores only the subject and expected content/posture hashes plus
`requires_regeneration: true`.

On resume, validate the compact/checkpoint hashes against current canonical
state. If a gate remains pending, regenerate the `ApprovalBrief` from the
current content and posture hashes, render it in the active conversation, and
ask its single confirmation question. Never reuse a pre-compact brief hash or
reconstruct approval from a transcript.

## Replan and finalisation

Contract, architecture, posture, or design evidence stops execution. Persist
the evidence, stale only the exact affected refs and work descendants, and
return through Design/Architecture gates before generating a successor leaf.
Execution cannot accept its own replan automatically.

Finalise each leaf in this order:

1. Run subtractive scope and provenance review. Defer behavior that lacks
   approved provenance, exceeds the leaf budget, or is excluded by posture.
2. Retain mandatory safety floors and posture-specific validity work such as
   experimental measurement/reproduction requirements.
3. Check completeness only for the remaining approved behaviors, then run the
   leaf verification commands.

Do not add telemetry, deployment, HA, compatibility layers, generalized APIs,
or defensive fallbacks merely because they could be useful in a future
production module. Promotion is a separate user-approved change and re-enters
design.

## Parallelization assessment

Every map node or leaf considered for parallel execution records:

- Candidate (`yes` or `no`) and wave/serial label;
- Owned paths;
- Shared resources;
- Independent verification;
- Reason the coordination is worthwhile and safe.

A node is parallel only when its dependency gates are satisfied, paths do not
overlap, shared mutable resources are absent or partitioned, and it has an
independent acceptance command. Missing evidence means serial execution.

## Coordinator contract

For a safe wave, create one wave-level `update_plan` item and keep it as the
single `in_progress` item. Dispatch one fresh subagent per node through the
host's execution workflow with the full brief, owned paths, resource limits,
and acceptance criteria. Subagents must not call `update_plan`, commit in a
shared worktree, or change canonical planning state.

Buffer each result in a coordinator-owned queue with node/agent IDs, status,
changed paths, verification output, and concerns. The coordinator serializes
results in stable map order, ignores duplicate IDs, runs specification and code
quality reviews, persists events, and owns the shared commit.

Only after every result passes review and verification may the coordinator mark
the wave complete and release dependents. A conflict, blocker, or unverifiable
result stops the wave and falls back to the original sequential workflow until
repaired or replanned.
