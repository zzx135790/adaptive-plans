# Adaptive Writing Plans

Adaptive planning workflow for multi-phase uncertain work — turns discussions, approved designs, and specifications into implementation plans with durable project state.

## Features

- **Adaptive planning folder**: Separates stable direction from details discovered later
- **Multi-phase mapping**: DAG topology for uncertain dependencies and progressive waves
- **Context-scoped MCP**: Concurrent multi-project serving without global state
- **Host-neutral**: Portable plugin for both Codex and Claude Code
- **Provider composition**: Validates workflow outcomes, never auto-installs

## Installation

### Claude Code

```bash
# Install the plugin
git clone <repository-url>
cd adaptive-writing-plans

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

### Codex

```bash
# Install the plugin
git clone <repository-url>
cd adaptive-writing-plans

# Link to Codex
ln -s "$(pwd)/plugins/adaptive-writing-plans" ~/.agents/plugins/adaptive-writing-plans
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
