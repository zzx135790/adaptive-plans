# Adaptive Writing Plans

Adaptive planning workflow for multi-phase uncertain work — turns discussions, approved designs, and specifications into implementation plans with durable project state.

## Features

- **Adaptive planning folder**: Separates stable direction from details discovered later
- **Multi-phase mapping**: DAG topology for uncertain dependencies and progressive waves
- **Context-scoped MCP**: Concurrent multi-project serving without global state
- **Host-neutral**: Portable plugin for both Codex and Claude Code
- **Provider composition**: Validates workflow outcomes, never auto-installs
- **Automatic event hooks**: Records tool completions, context compaction, and turn endings to audit trail

## Installation

### Option 1: Official Plugin Commands (Recommended)

#### Claude Code

```bash
# Add the marketplace
claude plugin marketplace add https://github.com/zzx135790/adaptive-plans.git

# Install the plugin
claude plugin install adaptive-writing-plans@adaptive-plans-local
```

The plugin will be installed to `~/.claude/plugins/` with MCP server automatically configured.

#### Codex

The plugin is available in the `personal` marketplace if your home directory contains `.agents/plugins/marketplace.json`:

```bash
# Install the plugin
codex plugin add adaptive-writing-plans@personal
```

Alternatively, add to your personal marketplace manually by editing `~/.agents/plugins/marketplace.json`:

```json
{
  "name": "personal",
  "plugins": [
    {
      "name": "adaptive-writing-plans",
      "source": {
        "source": "local",
        "path": "./plugins/adaptive-writing-plans"
      },
      "category": "Productivity"
    }
  ]
}
```

Then clone this repository to `~/plugins/adaptive-writing-plans`.

### Option 2: Manual Installation (Symlink)

#### Claude Code

```bash
# Clone the repository
git clone https://github.com/zzx135790/adaptive-plans.git
cd adaptive-plans

# Link to Claude Code
ln -s "$(pwd)/plugins/adaptive-writing-plans" ~/.claude/plugins/adaptive-writing-plans
```

Add MCP server to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "adaptive-planning": {
      "command": "node",
      "args": ["~/.claude/plugins/adaptive-writing-plans/mcp/server-sdk.mjs"],
      "tool_timeout_sec": 120
    }
  }
}
```

#### Codex

```bash
# Clone the repository
git clone https://github.com/zzx135790/adaptive-plans.git
cd adaptive-plans

# Link to Codex
ln -s "$(pwd)/plugins/adaptive-writing-plans" ~/.codex/plugins/adaptive-writing-plans
```

Codex discovers MCP metadata automatically from the plugin directory.

## Usage

Invoke the skill via `/adaptive-writing-plans` when you need to:

- Turn requirements discussion into an implementation plan
- Map multi-phase work with uncertain dependencies
- Maintain stable project direction while discovering details iteratively

The skill routes to:
- **guide**: clarify goals, scope, constraints when requirements are blocking
- **map**: create DAG topology for multi-phase or long-running work
- **plan**: generate leaf plan for a single ready node
- **direct**: proceed immediately for small, clear tasks

## Event Hooks

The plugin automatically records events to `events.jsonl` for audit trails and cross-session recovery:

- **Claude Code**: Hooks are automatically configured via `hooks/hooks.json` (no setup needed)
- **Codex**: Requires manual configuration in `~/.codex/config.toml`

**Recorded events**:
- Tool completions (success/failure)
- Context compaction
- Turn endings

See [hooks/README.md](plugins/adaptive-writing-plans/hooks/README.md) for detailed configuration and troubleshooting.

Hook failures never block the main workflow.

## Migration from 0.2.x

**Breaking Changes in 0.3.0:**

1. **MCP is now context-scoped**: Each tool call requires `context: { project_root, plan_path }`. Global env vars `ADAPTIVE_PLAN_ROOT`, `ADAPTIVE_PROJECT_ROOT` are no longer used.

2. **Host-sync adapter removed**: `planHostAdapter`, `syncHostAdapter`, `HOST_PROFILES`, and `npm run host:sync` are removed. Use plugin installation commands instead.

3. **Provider composition**: `verifyProviderWorkflowOutcome` moved from `host-adapter.mjs` to `provider-composition.mjs`. Import path changes required.

**Migration Steps:**

```bash
# Uninstall 0.2.x
rm -rf ~/.claude/skills/adaptive-writing-plans
rm -rf ~/.agents/skills/adaptive-writing-plans

# Install 0.3.0 following instructions above

# Update MCP configuration to use context-scoped server
# See Installation section for new .mcp.json format
```

## License

MIT

## Version

0.3.0 — Context-scoped MCP, host-neutral packaging, provider composition
