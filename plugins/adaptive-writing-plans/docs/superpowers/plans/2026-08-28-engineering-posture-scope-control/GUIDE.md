# Engineering Posture and Scope Control

## Goal

Keep experimental work rigorous without silently promoting it to production
maturity, while preserving full engineering gates for reusable and production
modules.

## Scope

- In scope: named intent profiles for spike, experiment, reusable-internal, and
  production work.
- In scope: a hash-bound posture carried by maps, nodes, designs, handoffs, and
  compact-safe execution context.
- In scope: scope provenance and behavior-budget checks that prevent
  unrequested capabilities from entering an executable DAG.
- In scope: project/module defaults, lightweight experimental zones, and an
  explicit promotion workflow into full module contracts.
- In scope: profile-aware design, provider, planning, testing, review, and
  completion gates.
- In scope: a fixed N-000 control node and terminal Flow Receipt for every map,
  including an explicit pending state when the host forbids persistence.
- In scope: recursive root/module/relation/task design with one canonical ledger
  and generated per-subject views only for material decisions.
- In scope: candidate contracts, verified evidence, and contract-level
  invalidation so leaf discoveries update only affected ancestors and consumers.
- In scope: read compatibility and explicit migration for existing plan
  artifacts.
- Out of scope: a separate canonical posture database or remote policy service.
- Out of scope: numeric maturity scoring, telemetry, automatic promotion, and
  automatic provider installation.
- Out of scope: modifying third-party skills; integration is through versioned
  handoffs and orchestration rules.
- Out of scope: production deployment, release management, or organization-wide
  governance unrelated to this local plugin.

## Constraints

- Preserve `architecture.json`, `design.json`, and `map.json` as the only
  canonical project/design/map states.
- Treat intent profiles as different definitions of done, not a quality ladder.
- Production posture must never be inferred merely from hypothetical future
  reuse.
- Safety floors remain mandatory for silent experimental invalidity,
  destructive data loss, credential exposure, and runaway resource cost.
- Existing v1/v2 artifacts remain readable and are never silently rewritten.
- Map work cannot begin until N-000 validates the selected plan root and required
  artifact roles; N-000 never substitutes for intent or design approval.
- Evidence may propose posture promotion, but only explicit user approval can
  apply it.
- This plugin change uses `reusable_internal` posture: stable local contracts
  and compatibility tests are required; production operations are excluded.

## Success Criteria

- Every executable node and newly implemented behavior traces to an approved
  requirement, design, architecture contract, observed failure, or mandatory
  safety floor.
- Spike and experiment profiles reject speculative compatibility, HA,
  generalized extension, recovery, deployment, and operability work unless a
  concrete trigger is approved.
- Experiment plans still require testable hypotheses, trustworthy measurement,
  reproducibility, and fail-loud invalid-result handling.
- Posture and its exclusions survive handoff and compact through a stable hash;
  stale or conflicting references block execution.
- Promotion is a separate, auditable change that re-enters design and updates
  architecture only when required.
- Existing supported artifacts pass compatibility tests, and the new CLI/MCP
  surfaces expose posture, provenance, and blocking reasons.
- A terminal user can verify the selected plugin, route, plan root, complete
  artifact index, unpersisted discussion state, and next action without opening
  a planning file.
- A project with several modules creates child design threads only for material
  contract decisions; private reversible leaf decisions stay inline.
