# Decision 002: Reusable-internal release boundary

## Posture

This packaging effort is `reusable_internal`, identified by posture hash
`51dde14f6265696222e5f6b0581730d7783408d80da403b00a40852c2962bc10`.

## Included

- Stable local CLI/MCP contracts and compatibility behavior.
- SDK-backed stdio framing, path safety, and concurrent context isolation.
- Dual-host manifests/catalogs, deterministic bundling, tests, and rollback
  evidence.

## Excluded

- Hosted MCP, OAuth, telemetry, production deployment, npm publication, and
  automatic provider installation or invocation.
- Any claim that a discovered provider is available, persisted, or equivalent
  without the corresponding evidence.

## Release gate

Canary and local verification precede external GitHub publication and local
installation cutover. The old standalone skill and MCP configuration are
archived as recoverable material before a quiet-window switch.
