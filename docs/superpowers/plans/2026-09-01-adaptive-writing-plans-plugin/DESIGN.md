# Packaging Design Boundary

This map records the design boundary needed to turn the current
`adaptive-writing-plans` source into a dual-host plugin. It is not an
implementation or an approval record.

## Identity

- Plugin name: `adaptive-writing-plans`
- Release: `0.3.0`
- Repository layout: marketplace root plus
  `plugins/adaptive-writing-plans/`
- Runtime: Node.js `>=20`

## Host surfaces

Codex and Claude Code receive native manifests and catalogs, but both launch
the same `dist/mcp-server.mjs`. Claude reads a plugin-local `.mcp.json`; Codex
uses an inline MCP declaration in its manifest. No host-specific adapter owns
planning behavior.

## MCP boundary

Every path-bearing call supplies `context.project_root` and, when a plan is
needed, a project-relative `context.plan_path`. The server validates absolute
root existence, relative containment, traversal, and symlink escape on every
request. Architecture state is rooted at
`<project_root>/docs/architecture/adaptive`.

## Compatibility and breaking changes

Map, design, architecture, migration, provider, and CLI payloads from the
current `0.2.x` source remain readable. Startup-root inference and the
`host:sync`/host-adapter surface are intentionally removed in `0.3.0`.

## Approval boundary

Read-only operations return proposals or diagnostics. Any canonical posture,
design, architecture, installation, or remote change requires an explicit
approval and a fresh hash check. Provider discovery remains observational.
