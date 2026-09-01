# Execution Map: Fix Plugin Installation via Official Commands

**Status:** planning  
**Stage:** mapping  
**Current Node:** N-001 (ready)

---

## Goal

Make adaptive-writing-plans v0.3.0 installable via `claude plugin install` and `codex plugin install` commands.

---

## Node Dependency Graph

```
N-000 (Research Schema) ✅
  ↓
N-001 (Fix marketplace.json) → Ready
  ↓
N-002 (Test Claude Code) → Blocked
  ↓
N-003 (Fix Codex) → Blocked
  ↓
N-004 (Update Docs) → Blocked
```

---

## Nodes

### ✅ N-000: Research correct marketplace.json schema
**Status:** completed  
**Kind:** exploration

**Evidence:**
- Read official marketplace examples (superpowers-zh, claude-plugins-official)
- Required fields: `name`, `description`, `owner{name}`, `plugins[]`
- Plugin source can be relative path or `{source: 'url', url, sha}`

---

### 🟢 N-001: Fix marketplace.json with correct schema
**Status:** ready  
**Kind:** implementation  
**Depends on:** N-000

**Inputs:**
- Schema requirements from N-000
- Current catalog.json structure

**Outputs:**
- Valid marketplace.json at `.agents/plugins/.claude-plugin/`

**Acceptance:**
- `claude plugin marketplace add` succeeds without errors

---

### ⏸️ N-002: Test Claude Code installation end-to-end
**Status:** blocked (waiting for N-001)  
**Kind:** verification

**Acceptance:**
- `claude plugin marketplace add <path>` succeeds
- `claude plugin install adaptive-writing-plans@adaptive-plans-local` succeeds
- `/skills` shows adaptive-writing-plans

---

### ⏸️ N-003: Research and fix Codex installation
**Status:** blocked (waiting for N-002)  
**Kind:** exploration

**Blocking Questions:**
- Does Codex use the same marketplace.json format?
- What is the Codex equivalent of `claude plugin install`?

---

### ⏸️ N-004: Update documentation with installation instructions
**Status:** blocked (waiting for N-003)  
**Kind:** documentation

**Outputs:**
- Updated README.md with installation section
- Both official command and manual symlink methods documented

---

## Next Action

Execute N-001: Fix marketplace.json with correct schema structure.
