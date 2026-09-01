# Decision: Keep stdio compatibility local to the command boundary

## Threat

Spawned Node 24 commands can lose buffered stdin data and stdout/stderr writes
when the host maps descriptors to sockets. This can make a valid CLI or MCP
request exit successfully without a response or event.

## Evidence

- `mcp_server.test.mjs` reproduced exit 0 with empty stdout before the boundary
  fix.
- `hooks.test.mjs`, `architecture_ci.test.mjs`, and `cli.test.mjs` reproduced
  missing input or output under the same spawn shape.
- `fs.createReadStream(null, { fd: 0 })` and `fs.writeSync` reproduced the
  expected bytes without changing plan semantics.

## Impact And Smaller Control

The impact is limited to host-to-command I/O and blocks verification and real
host invocation. The smaller control is one shared `scripts/lib/stdio.mjs`
helper used only at command boundaries; it does not add retries, daemons,
installation, telemetry, scheduling, or deployment behavior.

## Verification

`npm test --prefix plugins/adaptive-writing-plans` passes 147 tests, including
MCP framing, newline batching, CLI lifecycle, hooks, and architecture checks.

## Reversibility And Cost

The change is fully revertible by removing the helper and its imports. It adds
one tiny utility and boundary-only imports; no persistent state or runtime
service is introduced.
