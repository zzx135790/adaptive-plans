# Plan Map

> Generated from `map.json`; schema 2.0.

**Plan:** Route plans through visible skills with bounded fallbacks
**Status:** complete
**Stage:** complete
**Work shape:** map
**Current node:** none
**Architecture:** not linked
**Design:** not required or not linked
**Node status:** done=5, in_progress=0, blocked=0

## Topology

```text
Wave 1: [N-000 done] Bootstrap and validate the visible-skill routing plan
Wave 2: [N-001 done] Define the visible-provider input contract and Ada fallback table
Wave 3: [N-002 done] Route planning phases through visible providers with bounded Ada fallbacks | [N-003 done] Enforce execution-safe parallel waves separately from dependency waves
Wave 4: [N-004 done] Verify visible routing, fallbacks, wave safety, and coordinator boundaries
Edges: N-000 -> N-001, N-001 -> N-002, N-001 -> N-003, N-002 -> N-004, N-003 -> N-004
```

## Execution waves

Dependency waves: 1=[N-000] | 2=[N-001] | 3=[N-002, N-003] | 4=[N-004]
Execution-safe waves: none (evaluate before dispatch)
Serial fallback: none recorded

## Nodes

| Node | Status | Depends on | Requirements | Contracts | Title |
|---|---|---|---|---|---|
| [N-000](nodes/N-000.md) | done | - | R-PLAN-BOOTSTRAP | - | Bootstrap and validate the visible-skill routing plan |
| [N-001](nodes/N-001.md) | done | N-000 | R-VISIBLE-SKILLS, R-ADA-FALLBACK, R-SCOPE-BUDGET | - | Define the visible-provider input contract and Ada fallback table |
| [N-002](nodes/N-002.md) | done | N-001 | R-VISIBLE-SKILLS, R-ADA-FALLBACK, R-DIRECT-COST | - | Route planning phases through visible providers with bounded Ada fallbacks |
| [N-003](nodes/N-003.md) | done | N-001 | R-SAFE-WAVE, R-MAIN-COORDINATOR | - | Enforce execution-safe parallel waves separately from dependency waves |
| [N-004](nodes/N-004.md) | done | N-002, N-003 | R-REGRESSION, R-SCOPE-BUDGET | - | Verify visible routing, fallbacks, wave safety, and coordinator boundaries |

## Readiness notes

- No blocking questions recorded.

## Gates

- **intent:** approved
- **design:** not_required
- **architecture_sync:** not_required

## Artifact Index

- [GUIDE.md](GUIDE.md) - goal, scope, constraints, and success criteria
- [MAP.md](MAP.md) - this navigation view
- [map.json](map.json) - canonical plan topology
- [nodes/N-000.md](nodes/N-000.md) - Bootstrap and validate the visible-skill routing plan
- [nodes/N-001.md](nodes/N-001.md) - Define the visible-provider input contract and Ada fallback table
- [nodes/N-002.md](nodes/N-002.md) - Route planning phases through visible providers with bounded Ada fallbacks
- [nodes/N-003.md](nodes/N-003.md) - Enforce execution-safe parallel waves separately from dependency waves
- [nodes/N-004.md](nodes/N-004.md) - Verify visible routing, fallbacks, wave safety, and coordinator boundaries
