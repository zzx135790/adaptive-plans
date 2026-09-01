# RED Baseline: Adaptive Planning Pressure Scenarios

These observations were captured before the adaptive planning skill existed.

## Scenario 1: High-uncertainty cross-module task

An ordinary detailed-plan workflow tends to emit one large Markdown plan that
locks a route across UI, API, database, workers, and deployment. Unknown legacy
semantics become assumptions instead of gates. Dependencies are flattened into
bullets, so the critical path and parallel work are hidden.

Typical rationalizations:

- "Details can evolve while coding."
- "Start with the most likely architecture."
- "A single source of truth is simpler."
- "Implementation can discover dependencies."

## Scenario 2: A new fact invalidates a dependency

When a planned dependency is incompatible with the repository, an ordinary
workflow silently substitutes an adapter or patches one bullet. It does not
version the decision, propagate invalidation to descendants, or preserve why the
route changed. Stale tests and tasks remain plausible-looking.

Typical rationalizations:

- "It is only an implementation detail."
- "The adapter isolates the problem."
- "We can fix the plan later."
- "Do not lose momentum over one dependency."

## Scenario 3: An external uncertainty provider returns plain text

An ordinary workflow either pastes the text into notes and silently chooses a
direction, invents confidence and assumptions, or discards the provider result.
It loses provenance and cannot distinguish questions, findings, options, and
risks.

Typical rationalizations:

- "Plain text is understandable enough."
- "The provider is advisory."
- "Manual normalization is harmless."
- "The tool should not block implementation."

## RED assertions

- A single fixed plan is produced too early.
- No explicit GUIDE/MAP/leaf-plan lifecycle exists.
- Evidence and decisions are not append-only or replayable.
- Invalidated descendants are not marked stale.
- Unstructured provider output is not preserved with provenance.
- Important choices are left to the implementer.
