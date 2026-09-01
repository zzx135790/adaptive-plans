# Decision 001: One protocol, two host packages

## Context

The current `adaptive-writing-plans` source is the maintained planning
workflow. Codex and Claude Code need to install it through their native plugin
catalogs without creating divergent planning semantics.

## Decision

Keep `adaptive-writing-plans` as the only skill and canonical protocol. Publish
one marketplace-root repository with one plugin subtree at
`plugins/adaptive-writing-plans/`. Both hosts consume the same skill files,
scripts, schemas, and bundled MCP server. Host-specific manifests may differ
in declaration syntax, but tool names, request contracts, and behavior remain
identical.

## Contract boundary

MCP calls carry an explicit request context:

```json
{
  "context": {
    "project_root": "/absolute/project/root",
    "plan_path": "docs/superpowers/plans/<date>-<slug>"
  }
}
```

The service resolves and validates this context per request. It does not infer
project state from its working directory, startup flags, environment variables,
or a process-global root.

## Consequences

- A long-lived server can safely serve more than one project.
- Existing data contracts stay readable while the host adapter surface is
  reduced to packaging metadata.
- `0.3.0` is a breaking release for startup/context behavior and host-sync
  removal; migration guidance must be explicit.
