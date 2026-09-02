# Adaptive Plans

Adaptive Plans is a planning workflow for work whose dependencies, evidence, and scope become clearer as it proceeds.

`adaptive-writing-plans` is the lean core. It routes clear, bounded work directly to execution; uses guide, map, and plan only when their coordination value is justified; and dispatches two or more safe independent nodes in parallel. It selects visible host skills first and uses a bounded Ada fallback only when no suitable visible skill exists.

`adaptive-planning-governance` is an independent, optional plugin for teams that need governance controls. Installing the core does not install governance.

All work preserves four non-negotiable safety floors: bound runaway resource cost, fail loudly on invalid results, prevent credential exposure, and prevent destructive data loss. Lifecycle hooks are disabled by default.

## Install

### Claude Code

```bash
claude plugin marketplace add https://github.com/zzx135790/adaptive-plans.git
claude plugin install adaptive-writing-plans@adaptive-plans-local
# Optional; install separately when governance controls are needed.
claude plugin install adaptive-planning-governance@adaptive-plans-local
```

Update the marketplace and either installed plugin with:

```bash
claude plugin marketplace update adaptive-plans-local
claude plugin update adaptive-writing-plans@adaptive-plans-local
claude plugin update adaptive-planning-governance@adaptive-plans-local
```

### Codex

```bash
codex plugin marketplace add https://github.com/zzx135790/adaptive-plans.git --ref v0.5.0
codex plugin add adaptive-writing-plans@adaptive-plans-local
# Optional; install separately when governance controls are needed.
codex plugin add adaptive-planning-governance@adaptive-plans-local
```

Refresh the Git marketplace with:

```bash
codex plugin marketplace upgrade adaptive-plans-local
```

Start a new Claude Code or Codex session after installing or updating a plugin so its skills and configuration are loaded.

## Use

Invoke `adaptive-writing-plans` for implementation planning. It begins with direct execution for small, clear work, records a map only when multiple dependent phases need coordination, and makes parallel dispatch explicit whenever two safe independent nodes exist.

Plans use the skill names and descriptions visible in the current session to bind each substantive behavior that changes the execution method or deliverable, for example `diagnose failure -> systematic-debugging` or `review paper -> academic-paper-review`. A missing match is shown as a named Ada fallback; hidden skills are not scanned, installed, or guessed. Direct tasks show one binding line before work and create no plan artifact.

Standard libraries, mature dependencies, and repository operations with existing verification evidence are trusted by default. Add a local check only for an observed failure, version or contract conflict, or concrete security boundary; otherwise do not introduce wrappers, guards, replacement implementations, or duplicate validation.

## License

MIT
