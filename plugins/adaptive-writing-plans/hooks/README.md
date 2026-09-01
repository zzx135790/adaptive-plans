# Hook Configuration

This plugin supports automatic event recording through hooks on both **Claude Code** and **Codex**.

## What Hooks Do

Hooks automatically record events to `events.jsonl` in your plan folder:
- **Tool completions**: When MCP tools succeed or fail
- **Context compaction**: When the conversation context is compressed
- **Turn completion**: When each conversation turn ends

These events provide an audit trail and help with cross-session recovery.

## Claude Code

### Automatic Configuration

Hooks are **automatically configured** when you install the plugin. No manual setup needed.

**Configuration file**: `hooks/hooks.json`

### Captured Events

| Event | Trigger | Recorded Data |
|-------|---------|---------------|
| `tool_completed` | After MCP tool succeeds | Tool name, context, status |
| `tool_failed` | After MCP tool fails | Tool name, error message, context |
| `context_compaction` | When context is compressed | Turn count, compaction type |
| `turn_ended` | When turn completes | Turn count |

### Verify Hooks Are Working

```bash
# View configured hooks
/hooks

# Check events.jsonl after using the plugin
cat docs/superpowers/plans/*/events.jsonl
```

### Disable Hooks

```bash
# Temporarily disable all hooks
claude-code --settings '{"disableAllHooks": true}'
```

Or add to your `~/.claude/settings.json`:
```json
{
  "disableAllHooks": true
}
```

## Codex

### Manual Configuration Required

Create or edit `~/.codex/config.toml`:

```toml
[hooks]
tool_completed = "node ~/.codex/plugins/adaptive-writing-plans/hooks/record-event.mjs --root <plan-root>"
context_compaction = "node ~/.codex/plugins/adaptive-writing-plans/hooks/record-event.mjs --root <plan-root>"
turn_ended = "node ~/.codex/plugins/adaptive-writing-plans/hooks/record-event.mjs --root <plan-root>"
```

**Reference configuration**: See `hooks/events.example.json` for the full schema.

### Verify Hooks Are Working

```bash
# Check Codex hook configuration
cat ~/.codex/config.toml

# Verify events are recorded
cat docs/superpowers/plans/*/events.jsonl
```

## Hook Script

Both platforms use the same hook script: **`hooks/record-event.mjs`**

### Features

- ✅ Platform-neutral (Node.js)
- ✅ Receives events via stdin as JSON
- ✅ Appends to `events.jsonl` atomically
- ✅ **Never blocks** on failure (graceful degradation)
- ✅ Auto-generates event IDs

### Manual Event Recording

You can manually record events:

```bash
echo '{"type":"checkpoint","message":"Completed phase 1"}' | \
  node hooks/record-event.mjs --root docs/superpowers/plans/2026-09-01-my-plan
```

## Troubleshooting

### Events Not Appearing

1. **Check hook configuration**
   - Claude Code: `/hooks` command
   - Codex: `cat ~/.codex/config.toml`

2. **Verify plan root path**
   ```bash
   # Hook expects absolute or relative path to plan folder
   ls docs/superpowers/plans/*/events.jsonl
   ```

3. **Check hook script**
   ```bash
   # Test the hook script directly
   echo '{"type":"test","message":"hello"}' | \
     node hooks/record-event.mjs --root /path/to/plan
   ```

### Hook Failures Are Safe

Hook failures **never block** the main workflow:
- Script exits with code 0 on any error
- `ignoreFailure: true` in Claude Code config
- Errors logged to stderr but don't propagate

### Performance Impact

Hooks are lightweight:
- Average execution: < 50ms
- Timeout: 5 seconds
- No network requests
- Atomic file append only

## Event Schema

Events in `events.jsonl` follow this structure:

```json
{
  "event_id": "E-001",
  "type": "tool_completed|tool_failed|context_compaction|turn_ended",
  "source": "claude-code-hook|codex-hook",
  "message": "Human-readable description",
  "payload": {
    "tool": "plan_add_node",
    "status": "success",
    "context": { ... }
  },
  "timestamp": "2026-09-01T10:30:00.000Z"
}
```

## Platform Comparison

| Feature | Claude Code | Codex |
|---------|-------------|-------|
| **Configuration** | Automatic (hooks.json) | Manual (config.toml) |
| **Tool events** | ✅ PostToolUse | ✅ tool_completed |
| **Compaction** | ✅ PostCompact | ✅ context_compaction |
| **Turn end** | ✅ Stop | ✅ turn_ended |
| **Failure mode** | ✅ Graceful | ✅ Graceful |
| **Performance** | < 50ms | < 50ms |

---

**Both platforms provide equivalent functionality.** Choose based on your workflow automation needs.
