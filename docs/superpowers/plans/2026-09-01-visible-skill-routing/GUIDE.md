# Route plans through visible skills with bounded fallbacks

## Goal

Make Ada plan from the skills visible in the current Codex session and use explicit minimal fallbacks when no matching skill is available.

## Scope

- In scope: make Ada consume the skills visible in the current Codex session when routing planning work.
- In scope: choose a bounded Ada fallback when no visible skill matches a capability.
- In scope: bind planned phases to provider capability, acceptance, and verification evidence.
- In scope: distinguish dependency waves from execution-safe parallel waves.
- In scope: keep the coordinator responsible only for intent, cross-node integration, conflicts, and necessary final verification.
- Out of scope: scanning or auto-installing hidden providers; direct Claude-specific compatibility logic.
- Out of scope: a general-purpose dispatcher, telemetry, HA, deployment, rollback framework, or production hardening.

## Constraints

- The visible skill list supplied by the Codex host is the provider selection boundary.
- A missing visible skill uses the explicit Ada fallback table; it must not be simulated as an invoked provider.
- Every safety action must identify a concrete threat, evidence, impact, smaller control, verification, reversibility, and cost.
- The minimum safety floor remains: fail loudly on invalid results, prevent credential exposure, prevent destructive data loss, and bound runaway resource cost.
- Provider and wave metadata must be machine-readable and must not mutate canonical intent without an explicit transition.

## Success Criteria

- The plan route and four-node DAG are visible and validate without unknown dependencies.
- A route supplied with visible providers selects matching skills and records why each was selected.
- A route with no matching provider returns a named Ada fallback and does not attempt installation or hidden discovery.
- Parallel candidates are rejected when owned paths, shared resources, dependency gates, or independent verification are unsafe or missing.
- Focused tests prove direct tasks stay cheap and the main coordinator is not assigned local work without evidence.
