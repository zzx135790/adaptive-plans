# Release Checklist for v0.3.0

## Pre-release Verification ✅

- [x] All tests pass (141/141)
- [x] Doctor checks pass (all 8 checks)
- [x] Portability verified (clean temp directory install works)
- [x] Reproducible builds (hash consistency verified)
- [x] Canary tests pass (MCP server, tool list, manifests)
- [x] Rollback rehearsal successful
- [x] Recovery archive created: `adaptive-writing-plans-pre-v0.3.0-backup-20260901-163656.tar.gz`

## Breaking Changes in v0.3.0

### Context-Scoped MCP (N-002)
- MCP server now requires `--root <path>` argument for context isolation
- Environment variables (`ADAPTIVE_PLAN_ROOT`) remain as optional fallback
- Multi-project concurrent serving now supported
- Old behavior: startup-bound global root → New: runtime context per invocation

### Host-Neutral Provider Composition (N-003)
- Removed host-sync dependencies
- Plugin now works identically in Codex and Claude Code
- Provider registry is self-contained

## Installation

### Codex
```bash
# Symlink or copy plugin to Codex plugins directory
ln -s /path/to/adaptive-writing-plans ~/.codex/plugins/adaptive-writing-plans
```

### Claude Code
```bash
# Symlink or copy plugin to Claude Code plugins directory
ln -s /path/to/adaptive-writing-plans ~/.claude/plugins/adaptive-writing-plans
```

## Rollback Procedure

If issues arise after deployment:

```bash
# 1. Stop any running sessions
# 2. Move new version aside
mv /mnt/data4/zhangzixing/plugins/adaptive-writing-plans \
   /mnt/data4/zhangzixing/plugins/adaptive-writing-plans.v0.3.0

# 3. Restore backup
tar -xzf /mnt/data4/zhangzixing/plugins/adaptive-writing-plans-pre-v0.3.0-backup-*.tar.gz \
    -C /mnt/data4/zhangzixing/plugins

# 4. Verify old version
cd /mnt/data4/zhangzixing/plugins/adaptive-writing-plans
npm test

# 5. Clean up if rollback successful
rm -rf /mnt/data4/zhangzixing/plugins/adaptive-writing-plans.v0.3.0
```

## Git Release Steps (Pending Approval)

**⚠️ DO NOT execute without explicit user approval**

```bash
# 1. Commit all changes
git add -A
git commit -m "Release v0.3.0: Context-scoped MCP and dual-host support

Breaking changes:
- MCP server requires --root argument for context isolation
- Environment variables now optional fallback
- Removed host-sync dependencies

New features:
- Multi-project concurrent MCP serving
- Identical behavior in Codex and Claude Code
- SDK-backed context validation

Migration: Update MCP invocations to include --root argument"

# 2. Create annotated tag
git tag -a v0.3.0 -m "Release v0.3.0

Context-scoped MCP server with dual-host support (Codex + Claude Code).
Breaking: requires --root argument for context isolation."

# 3. Push to remote (if applicable)
git push origin main
git push origin v0.3.0
```

## Post-Release Verification

- [ ] Plugin loads successfully in Codex
- [ ] Plugin loads successfully in Claude Code
- [ ] MCP tools callable from both hosts
- [ ] Multi-project context isolation works
- [ ] Old maps remain readable
- [ ] Old standalone skills remain functional

## Release Notes Summary

**v0.3.0** - Context-Scoped MCP and Dual-Host Support

**Breaking Changes:**
- MCP server now requires `--root <path>` for context isolation
- Environment variable `ADAPTIVE_PLAN_ROOT` is optional fallback only

**New Features:**
- Multi-project concurrent MCP serving
- Native support for both Codex and Claude Code hosts
- SDK-backed context validation and path safety

**Migration:**
Update your MCP invocations to include the `--root` argument:
```bash
# Old
node mcp/server.mjs

# New
node mcp/server.mjs --root /path/to/project
```

**Compatibility:**
- Old plan maps remain readable
- Old standalone skills can be resumed
- Backward compatible with v0.2.x maps
