# Release Complete: adaptive-writing-plans v0.3.0

**Date:** 2026-09-01  
**Status:** ✅ RELEASED (Local)  
**Commit:** 0dad7e6  
**Tag:** v0.3.0

---

## Release Summary

Successfully released **adaptive-writing-plans v0.3.0** as a portable dual-host plugin with context-scoped MCP architecture.

### Git Operations Completed ✅

```bash
✅ git init                    # Initialized repository
✅ git add .                   # Staged 3551 files (360446 insertions)
✅ git commit                  # Created root commit 0dad7e6
✅ git tag -a v0.3.0          # Created annotated release tag
```

### Commit Details

**Commit Hash:** `0dad7e6`  
**Branch:** `master`  
**Files Changed:** 3,551 files  
**Lines Added:** 360,446 lines

**Commit Message:**
```
feat: adaptive-writing-plans v0.3.0 - context-scoped MCP plugin

- Context-scoped MCP architecture with --root parameter
- Host-neutral provider composition (Codex + Claude Code)
- Locked dependencies and reproducible builds
- 141 tests passing, all quality gates verified
- Recovery archive and rollback procedures tested

BREAKING CHANGE: MCP invocation changed from global ADAPTIVE_PLAN_ROOT 
environment variable to --root parameter. See MIGRATION.md for details.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

## What's Released

### Plugin Package
- **Location:** `plugins/adaptive-writing-plans/`
- **Version:** 0.3.0
- **Tests:** 141 passing
- **Status:** Production-ready

### Key Features
1. **Context-Scoped MCP** - Supports `--root` parameter for multi-project serving
2. **Host-Neutral Design** - Works on both Codex and Claude Code
3. **Reproducible Builds** - Locked dependencies, verified builds
4. **Comprehensive Testing** - Unit, portability, doctor checks all passing
5. **Complete Documentation** - README, MIGRATION, ARCHITECTURE guides

### Breaking Changes
- MCP invocation: `ADAPTIVE_PLAN_ROOT` env var → `--root <path>` parameter
- Host-sync code removed (unified core provider)
- See `MIGRATION.md` for upgrade guide

---

## Distribution Options

### Option A: Push to Remote Repository (Recommended)

To make this release public, add a remote and push:

```bash
cd /mnt/data4/zhangzixing/code/adaptive-writing-plans

# Add your GitHub/GitLab remote
git remote add origin https://github.com/<username>/<repo>.git

# Push main branch
git push -u origin master

# Push release tag
git push origin v0.3.0
```

### Option B: Local Distribution

The release is ready for local use:
- Install via: `cp -r plugins/adaptive-writing-plans /path/to/plugins/`
- Load in Codex: Add to `.codex-plugin/catalog.json`
- Load in Claude Code: Add to `.claude-plugin/catalog.json`

### Option C: GitHub Release

After pushing to remote, create a GitHub release:

1. Go to your repository on GitHub
2. Navigate to "Releases" → "Create a new release"
3. Select tag: `v0.3.0`
4. Title: "v0.3.0 - Context-Scoped MCP Plugin"
5. Description: Copy from `COMPLETION-REPORT.md`
6. Attach recovery archive (optional)
7. Publish release

---

## Verification Commands

```bash
# Verify git state
git status                    # Should show clean working tree
git log --oneline --decorate  # Should show v0.3.0 tag at HEAD
git tag -l -n1                # Should list v0.3.0

# Verify plugin
cd plugins/adaptive-writing-plans
npm test                      # Should pass 141 tests
npm run doctor -- --root .    # Should pass all checks
```

---

## Next Steps

### Immediate
- [ ] Decide on remote repository URL
- [ ] Push to remote (if publishing)
- [ ] Create GitHub release (if publishing)
- [ ] Announce in team channels

### Post-Release
- [ ] Monitor canary installations
- [ ] Collect user feedback on context-scoped MCP
- [ ] Update documentation based on usage patterns
- [ ] Plan v0.4.0 features

---

## Rollback Procedure

If issues are discovered:

1. **Recovery archive available:**
   - `adaptive-writing-plans-pre-v0.3.0-backup-20260901-163656.tar.gz`
   - Location: `plugins/adaptive-writing-plans/`

2. **Rollback commands:**
   ```bash
   cd plugins/adaptive-writing-plans
   bash rollback-rehearsal.sh
   ```

3. **Git rollback (if needed):**
   ```bash
   git tag -d v0.3.0              # Delete local tag
   git push origin :refs/tags/v0.3.0  # Delete remote tag
   git reset --hard HEAD~1        # Revert commit (use with caution)
   ```

---

## Documentation References

- **Completion Report:** `docs/superpowers/plans/2026-09-01-adaptive-writing-plans-plugin/COMPLETION-REPORT.md`
- **Execution Map:** `docs/superpowers/plans/2026-09-01-adaptive-writing-plans-plugin/MAP.md`
- **Plugin README:** `plugins/adaptive-writing-plans/README.md`
- **Migration Guide:** `plugins/adaptive-writing-plans/MIGRATION.md`
- **Architecture Doc:** `plugins/adaptive-writing-plans/ARCHITECTURE.md`

---

## Sign-Off

✅ All 7 nodes executed successfully  
✅ All quality gates passed  
✅ Git repository initialized  
✅ Initial commit created (0dad7e6)  
✅ Release tag v0.3.0 created  
✅ Documentation complete  
✅ Rollback procedures tested

**Release Status:** Ready for distribution

---

_Released: 2026-09-01 10:20:00 UTC_  
_Map ID: 2026-09-01-adaptive-writing-plans-plugin_
