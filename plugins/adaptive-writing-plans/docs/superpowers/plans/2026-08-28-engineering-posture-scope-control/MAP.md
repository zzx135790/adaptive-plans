# Plan Map

> Generated from `map.json`; schema 2.0.

**Plan:** Engineering Posture and Scope Control
**Status:** complete
**Stage:** complete
**Work shape:** map
**Current node:** none
**Architecture:** not linked
**Design:** engineering-posture-scope-control@2 (approved)
**Node status:** done=8

## Topology

```text
Wave 1: [N-000 done] Bootstrap and attest the adaptive workflow
Wave 2: [N-001 done] Define posture, provenance, hashing, compatibility, and provider discovery foundations
Wave 3: [N-002 done] Integrate module defaults and experimental zones into project architecture memory | [N-003 done] Enforce scope provenance, maturity ceilings, and deferred candidates in the map engine
Wave 4: [N-004 done] Make the Design Gate and provider handoffs posture-aware
Wave 5: [N-005 done] Carry posture through leaf planning, execution, finalization, and compact handoffs | [N-006 done] Expose posture assessment, checking, promotion, and blockers through CLI, MCP, and overview
Wave 6: [N-007 done] Validate migration and all posture profiles end to end, then document the portable release
Edges: N-000 -> N-001, N-001 -> N-002, N-001 -> N-003, N-001 -> N-004, N-003 -> N-004, N-004 -> N-005, N-002 -> N-006, N-004 -> N-006, N-005 -> N-007, N-006 -> N-007
```

## Nodes

| Node | Status | Depends on | Requirements | Contracts | Title |
|---|---|---|---|---|---|
| [N-000](nodes/N-000.md) | done | - | R-BOOTSTRAP | - | Bootstrap and attest the adaptive workflow |
| [N-001](nodes/N-001.md) | done | N-000 | R-POSTURE, R-PERSIST, R-PROVENANCE, R-BUDGET, R-COMPAT, R-COMPOSE | - | Define posture, provenance, hashing, compatibility, and provider discovery foundations |
| [N-002](nodes/N-002.md) | done | N-001 | R-POSTURE, R-PERSIST, R-PROMOTION, R-COMPAT | - | Integrate module defaults and experimental zones into project architecture memory |
| [N-003](nodes/N-003.md) | done | N-001 | R-POSTURE, R-PERSIST, R-PROVENANCE, R-BUDGET, R-EXPERIMENT, R-COMPAT, R-COMPOSE | - | Enforce scope provenance, maturity ceilings, and deferred candidates in the map engine |
| [N-004](nodes/N-004.md) | done | N-001, N-003 | R-PERSIST, R-PROVENANCE, R-BUDGET, R-PROMOTION, R-COMPAT, R-APPROVAL-UX, R-COMPOSE | - | Make the Design Gate and provider handoffs posture-aware |
| [N-005](nodes/N-005.md) | done | N-004 | R-PERSIST, R-PROVENANCE, R-BUDGET, R-EXPERIMENT, R-PROMOTION, R-APPROVAL-UX, R-COMPOSE | - | Carry posture through leaf planning, execution, finalization, and compact handoffs |
| [N-006](nodes/N-006.md) | done | N-002, N-004 | R-PERSIST, R-PROVENANCE, R-BUDGET, R-PROMOTION, R-COMPAT, R-APPROVAL-UX, R-COMPOSE | - | Expose posture assessment, checking, promotion, and blockers through CLI, MCP, and overview |
| [N-007](nodes/N-007.md) | done | N-005, N-006 | R-POSTURE, R-PERSIST, R-PROVENANCE, R-BUDGET, R-EXPERIMENT, R-PROMOTION, R-COMPAT, R-APPROVAL-UX, R-COMPOSE | - | Validate migration and all posture profiles end to end, then document the portable release |

## Readiness notes

- No blocking questions recorded.

## Gates

- **bootstrap:** validated
- **intent:** approved
- **design:** approved
- **architecture_sync:** not_required

## Artifact Index

- [GUIDE.md](GUIDE.md) - goal, scope, constraints, and success criteria
- [MAP.md](MAP.md) - this navigation view
- [map.json](map.json) - canonical plan topology
- [DESIGN.md](DESIGN.md) - current design view
- [design.json](design.json) - canonical design revisions
- [nodes/N-000.md](nodes/N-000.md) - Bootstrap and attest the adaptive workflow
- [nodes/N-001.md](nodes/N-001.md) - Define posture, provenance, hashing, compatibility, and provider discovery foundations
- [nodes/N-002.md](nodes/N-002.md) - Integrate module defaults and experimental zones into project architecture memory
- [nodes/N-003.md](nodes/N-003.md) - Enforce scope provenance, maturity ceilings, and deferred candidates in the map engine
- [nodes/N-004.md](nodes/N-004.md) - Make the Design Gate and provider handoffs posture-aware
- [nodes/N-005.md](nodes/N-005.md) - Carry posture through leaf planning, execution, finalization, and compact handoffs
- [nodes/N-006.md](nodes/N-006.md) - Expose posture assessment, checking, promotion, and blockers through CLI, MCP, and overview
- [nodes/N-007.md](nodes/N-007.md) - Validate migration and all posture profiles end to end, then document the portable release
- [../2026-08-28-engineering-foundations.md](../2026-08-28-engineering-foundations.md) - writing-plan
- [../2026-08-28-architecture-posture-zones.md](../2026-08-28-architecture-posture-zones.md) - writing-plan
- [../2026-08-28-map-posture-admission.md](../2026-08-28-map-posture-admission.md) - writing-plan
- [../2026-08-28-recursive-design-ledger.md](../2026-08-28-recursive-design-ledger.md) - writing-plan
- [../2026-08-28-execution-posture-handoffs.md](../2026-08-28-execution-posture-handoffs.md) - writing-plan
- [../2026-08-28-posture-cli-mcp-surfaces.md](../2026-08-28-posture-cli-mcp-surfaces.md) - writing-plan
- [../2026-08-28-posture-migration-release.md](../2026-08-28-posture-migration-release.md) - writing-plan
