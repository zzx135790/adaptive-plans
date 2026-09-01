# Baseline Snapshot: adaptive-writing-plans 0.2.0

**Snapshot date**: 2026-09-01  
**Source**: `/mnt/data4/zhangzixing/plugins/adaptive-writing-plans`  
**Target**: `plugins/adaptive-writing-plans/`  
**Status**: dirty worktree with 82 uncommitted changes

## Source Git Status

**Last commit**: `bdf050a chore: refresh plugin cachebuster`

**Uncommitted changes**: 82 files
- 27 modified files (M)
- 55 untracked files (??)

### Key modified files
- `.codex-plugin/plugin.json`
- `.mcp.json`
- `mcp/server.mjs`
- `package.json`
- Core schemas: `handoff.schema.json`, `map.schema.json`, `provider-registry.schema.json`, `provider-result.schema.json`
- Core scripts: `add-node.mjs`, `doctor.mjs`, planning engine, provider registry
- Skill contract: `skills/adaptive-writing-plans/SKILL.md`
- Test suite: CLI, handoff, hooks, MCP, planning engine, portability tests

### Key untracked additions
- New schemas: architecture, design, engineering posture, scope provenance
- New scripts: adaptive plan, architecture bootstrap/check/delta, design workflow, migration, posture operations
- New libraries: architecture protocol, design engine, host adapter, execution protocol, IO utils
- New tests: architecture CI, design ledger, engineering posture, execution protocol, host adapter
- Documentation: architecture memory, CI integration, design gate, execution references

## Copy Actions

✓ Copied all source files to `plugins/adaptive-writing-plans/`  
✓ Excluded `.git` directory (no Git history in plugin tree)  
✓ Excluded `.adaptive-plan-progress.json` (local execution state)  
✓ Excluded `node_modules/` (will be installed via lockfile)  
✓ Excluded `*.log` files

## Directory Structure

```
plugins/adaptive-writing-plans/
├── .codex-plugin/          # Codex plugin manifest
├── .mcp.json               # Claude MCP configuration
├── assets/                 # Documentation assets
├── docs/                   # Plugin documentation
├── hooks/                  # Git hooks
├── mcp/                    # MCP server implementation
├── package.json            # Node.js manifest
├── README.md               # Plugin README
├── schemas/                # JSON schemas (map, design, architecture, provider, etc.)
├── scripts/                # CLI and planning engine
│   ├── lib/                # Core libraries (planning, design, architecture, host adapter)
│   └── *.mjs               # Command scripts
├── skills/                 # Skill definitions
│   └── adaptive-writing-plans/
│       ├── SKILL.md
│       ├── agents/
│       └── references/
└── tests/                  # Test suite
    └── fixtures/
```

## Excluded from Public Tree

- `.git/` - Git history (managed separately)
- `.adaptive-plan-progress.json` - Session-specific execution state
- `node_modules/` - Will be installed from lockfile
- `*.log` - Local runtime logs

## Baseline Validation

- [x] Source worktree unchanged (read-only copy)
- [x] No .git directory in target
- [x] No local progress state in target
- [x] Directory structure preserved
- [x] All skill, schema, script, and test files copied

## Next Steps (N-002)

Refactor MCP to SDK-backed context-scoped service:
- Remove process-global project state
- Add request-scoped context validation
- Implement safe path checking (traversal, symlinks, absolute containment)
