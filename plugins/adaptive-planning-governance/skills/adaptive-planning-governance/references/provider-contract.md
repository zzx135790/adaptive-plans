# Provider Contract

Use this reference at a skill/MCP boundary. External providers may return an
object, Markdown, or plain text. Preserve the raw value and normalize only
fields supported by evidence.

## PlanningHandoff v2

```json
{
  "schema_version": "2.0",
  "source": "skill-or-mcp-id",
  "mode": "guide|map|plan|direct",
  "stage": "guiding|designing|mapping|leaf_planning|executing|validating|complete",
  "work_shape": "undetermined|direct|plan|map",
  "gates": {},
  "architecture_snapshot": null,
  "design_refs": [],
  "posture_ref": null,
  "behavior_budget": {"required": [], "excluded": [], "deferred_candidates": []},
  "scope_provenance": [],
  "deferred_candidates": [],
  "composition_contracts": [],
  "summary": "",
  "artifacts": [],
  "questions": [],
  "assumptions": [],
  "findings": [],
  "decisions": [],
  "provider_results": [],
  "next_skill": null,
  "extensions": {}
}
```

Schema v1 handoffs remain readable. Normalizing to v2 must leave design and
architecture gates unknown unless explicit evidence is supplied.

## VisibleProviderSet v1

The host supplies the provider candidates visible in the current session. This
envelope is the routing boundary; filesystem discovery is diagnostic evidence
only and must never enlarge the candidate set implicitly.

```json
{
  "schema_version": "1.0",
  "source": "codex-session",
  "providers": [
    {
      "id": "skill-id",
      "capabilities": ["explore"],
      "roles": ["explorer"],
      "visible": true,
      "invocation": "host-selected",
      "verification": ["focused command or acceptance check"]
    }
  ],
  "fallbacks": {
    "explore": "repository-search-and-evidence-event"
  }
}
```

Selection precedence is explicit: an exact capability and role match wins;
an explicit capability without a role is next; name or description inference is
only a conservative hint and can never promote a provider to execution. A
provider is selectable only when `visible` is true. An empty or missing set
uses the named Ada fallback and records `status: "unavailable"`; it does not
search hidden roots, install a provider, or pretend that one was invoked.

Every selected provider or fallback must carry a reason, acceptance condition,
and verification command. The coordinator may use the result only after the
declared evidence is observed and persisted according to the provider contract.

## ProviderResult v2

```json
{
  "schema_version": "2.0",
  "provider_id": "provider-id",
  "capability": "design",
  "status": "ok|partial|unavailable|error|unstructured",
  "covered_concerns": [],
  "questions": [],
  "assumptions": [],
  "findings": [],
  "options": [],
  "risks": [],
  "confidence": {"score": 0.0, "basis": ""},
  "evidence": [],
  "raw": null,
  "raw_ref": "provider-results/provider-id.json",
  "composition_contract": {},
  "lifecycle": {"invocation": "observed", "persistence": "verified"},
  "observed_at": "2026-08-28T00:00:00.000Z",
  "extensions": {}
}
```

Never invent `confidence.score`. Unknown fields remain in `extensions` and the
single persisted raw record. When `raw_ref` is present, `raw` must be null so a
handoff cannot duplicate provider output. Plain text is `unstructured`;
conditional suggestions remain findings or questions, not decisions.

For design evidence, `covered_concerns` names the exact current
`provider_status.blocking_concerns` addressed by the result. Only an `ok` or
`partial` result clears its named matches. Unmatched concerns and every
`composition_blocker` remain blocking; unavailable, error, and unstructured
results clear nothing. A normalizer may preserve this field under
`extensions.covered_concerns`, which the ledger treats equivalently. Approval
needs a provider waiver only while either unresolved blocker list is non-empty.

## CompositionContract

Each selected provider carries:

```json
{
  "capability": "design",
  "provider_id": "provider-id",
  "source_ref": "skill://provider-id",
  "version_or_digest": "version:1.0",
  "dependency_refs": [],
  "input_refs": [],
  "posture_ref": null,
  "mutability": "read_only",
  "invocation": {"policy": "automatic", "state": "not_invoked", "dependency_readiness": "ready"},
  "persistence": {"expectations": "persist result before use", "state": "not_verified"},
  "expected_outputs": [],
  "verification": {"status": "pending", "evidence_refs": []},
  "fallback": "builtin-design-driver"
}
```

Direct reuse requires an installed catalog match, ready dependencies, and
allowed mutability. A thin adapter may change only input/output envelopes and
verify persistence. Missing dependencies, version drift, failed invocation, or
missing expected output remain visible blockers or use the declared bounded
fallback; they never justify an automatic rewrite.

## Discovery and invocation

`scripts/discover-providers.mjs` reads installed skill metadata, plugin
manifests, and `.mcp.json` without starting commands. Registry entries retain
source, location, capabilities, design metadata, and
`execution: "not-invoked"`; installation is `never-automatic`.

The Design Router intersects a DesignProfile with the maintained provider
catalog. It returns selected driver/reference/reviewer providers, selection
reasons, missing and blocking concerns, required confirmations, and policy.
Only an installed, catalogued, read-only provider is eligible for automatic
invocation. Invoke through its owning host, then normalize the result and append
it as evidence. It cannot mutate the design, architecture, map, or progress.

When no provider is available, record `status: "unavailable"` and use the
registry's narrow fallback for non-critical work. Critical design concerns
block until a provider result or explicit user waiver exists.

Run provider behavior proposals through the same subtractive posture admission
used for map work. Unstructured, unpersisted, unprovenanced, excluded, or
above-ceiling proposals remain deferred evidence; they cannot become design
requirements, decisions, nodes, or implementation tasks automatically.
