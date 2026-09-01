# Installation Fix Guide

## Goal

Make adaptive-writing-plans v0.3.0 installable via official `claude plugin install` and `codex plugin install` commands by fixing marketplace configuration and catalog structure.

## Scope

### Included
- [ ] Research correct marketplace.json schema for Claude Code
- [ ] Research correct marketplace.json schema for Codex
- [ ] Fix marketplace.json to pass validation
- [ ] Verify catalog.json structure matches official requirements
- [ ] Test `claude plugin marketplace add` command
- [ ] Test `claude plugin install adaptive-writing-plans@<marketplace>` command
- [ ] Document installation instructions for both hosts
- [ ] Update repository README with correct installation steps

### Excluded
- [ ] Changing core plugin functionality
- [ ] Modifying MCP server implementation
- [ ] Altering skill contracts or tool interfaces
- [ ] Publishing to public marketplace (user approval required separately)
- [ ] Automated marketplace updates or CI/CD integration

## Constraints

- **Schema Compliance**: Must match official Claude Code and Codex marketplace schemas exactly
- **Backward Compatibility**: Existing manual installation (symlink) must still work
- **No Breaking Changes**: Plugin code and contracts remain unchanged (v0.3.0)
- **Local Testing Required**: Must verify end-to-end installation flow before declaring success
- **Documentation Standard**: Installation docs must be clear enough for first-time users

## Success Criteria

1. ✅ `claude plugin marketplace add <path>` succeeds without validation errors
2. ✅ `claude plugin install adaptive-writing-plans@<marketplace-name>` successfully installs the plugin
3. ✅ Installed plugin loads correctly in Claude Code (`/skills` shows adaptive-writing-plans)
4. ✅ (If applicable) Codex installation command succeeds
5. ✅ README.md contains accurate installation instructions for both hosts
