# Package adaptive-writing-plans for Codex and Claude Code

## Goal

Publish the current `adaptive-writing-plans` workflow as a portable, maintainable plugin that can be installed by both Codex and Claude Code while keeping one planning protocol and one MCP implementation.

## Scope

- [ ] Snapshot the existing `0.2.x` maintenance source without changing its dirty worktree.
- [ ] Package the source under a marketplace-root repository with a single plugin at `plugins/adaptive-writing-plans/`.
- [ ] Make MCP requests project- and plan-context scoped, with safe path validation and no process-global project state.
- [ ] Keep existing map, design, architecture, migration, provider, and CLI contracts readable where compatibility is promised.
- [ ] Provide Codex and Claude manifests/catalogs, reproducible dependencies, a bundled MCP entrypoint, and portable verification.
- [ ] Define a canary, rollback, and release procedure for the old standalone installation.
- [ ] Do not publish, replace the local installation, or alter the source worktree during map authoring.

## Constraints

- Release target is `0.3.0`; the context-scoped MCP contract and removal of host-sync are explicit breaking changes.
- Required runtime is Node.js `>=20`; dependency versions are exact: `@modelcontextprotocol/sdk@1.30.0`, `zod@4.5.4`, and `esbuild@0.28.2`.
- The repository root is the marketplace root; the installable plugin is `plugins/adaptive-writing-plans`.
- Claude uses the plugin-local `.mcp.json`; Codex receives an equivalent inline MCP declaration in its manifest. Both launch the same bundled server.
- MCP requests carry `{ context: { project_root, plan_path } }`; project roots are existing absolute directories and plan paths are project-relative, with traversal and symlink escapes rejected.
- The long-lived MCP process must serve multiple projects concurrently without sharing mutable project state. Fixed URI resources are not part of the contract.
- The maintained source at `/mnt/data4/zhangzixing/plugins/adaptive-writing-plans` is a dirty user worktree and is read-only for this effort.
- No hosted MCP, OAuth, telemetry, automatic provider installation/invocation, npm publication, production deployment, or unrelated governance is in scope.
- External GitHub creation/push and local installation cutover are release-gated side effects and occur only after local verification and explicit release approval.

## Success Criteria

- The new repository contains a complete, navigable map and a portable plugin layout with matching Codex/Claude identity and version metadata.
- A clean checkout can install exact dependencies, build a deterministic self-contained MCP bundle, and pass the full test/portability/manifest validation suite.
- Representative MCP requests complete the protocol handshake, list the same tools across contexts, reject unsafe paths, and isolate two projects served by one process.
- Provider discovery remains observational and host-neutral; duplicate canonical locations are diagnosed and no provider is installed or invoked automatically.
- A documented canary and rollback rehearsal can preserve the old standalone skill and MCP configuration while switching to or restoring the `0.3.0` plugin.
- The final release process can verify both hosts in a fresh session before any public remote or local cutover is attempted.
