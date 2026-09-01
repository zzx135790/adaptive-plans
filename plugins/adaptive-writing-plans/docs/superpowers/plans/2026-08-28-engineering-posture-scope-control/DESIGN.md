# Design engineering-posture-scope-control

**Revision:** 2
**Scope:** root
**Status:** approved
**Design hash:** `7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716`

## Design profile

- Triggers: cross_module, data_model, failure_semantics, migration, public_api, user_requested
- Concerns: alternatives, api, boundaries, compatibility, data, dependencies, integrity, migration, operability, reliability, security, testing, tradeoffs
- Risk: critical

## Skill routing

- **driver: builtin-design-driver** - Normalizes evidence, alternatives, approvals, and architecture deltas. (automatic)
- **reviewer: risk-assessment** - The recorded review covers the critical data, integrity, migration, and security failure modes for this local file-backed protocol. (automatic)

## Options

- {"id":"recursive-ledger-v2.1","summary":"Use one plan-local Design Ledger with generated root/module/relation/task views, a reserved N-000 control node, posture-bounded recursive design, and contract-level evidence convergence.","tradeoffs":["Keeps canonical state consistent and compact-safe.","Requires explicit v2.1 migration and new readiness semantics."]}
- {"id":"independent-design-files","summary":"Store each module or task design as an independent canonical JSON document.","tradeoffs":["Individual files are directly visible.","Cross-thread transactions, history, concurrency, and invalidation become substantially more complex."]}
- {"id":"single-root-design","summary":"Keep one global design revision and express all child decisions in the root document.","tradeoffs":["Smallest storage change.","Cannot represent recursive design, local approval, parallel discovery, or precise invalidation."]}

## Selected option

{
  "id": "recursive-ledger-v2.1",
  "rationale": "It makes workflow use visible through N-000, keeps one canonical Design Ledger with bounded generated views, and allows leaf implementation evidence to refine only affected module and relation contracts without production-oriented scope drift."
}

## Interfaces and invariants

- FlowReceipt { workflow, plugin_source, plugin_version, route, route_rationale, project_ref, plan_ref, persistence_status, artifact_manifest, architecture_status, design_status, control_surface, mcp_binding, next_action }
- BootstrapManifest { node_id: N-000, artifact_roles, validation, created_with, control_surface }
- EngineeringPosture { kind, source, objective, required_evidence, allowed_capabilities, excluded_capabilities, safety_floor, promotion_policy, posture_hash }
- DesignLedger { design_id, threads, document_state_hash }
- DesignThread { thread_id, kind, subject_ref, parent_refs, current_revision, revisions, thread_state_hash }
- DesignRevision { revision, decision_status, content_hash, resolved_items, contracts, posture_ref, provider_refs, approval }
- DesignAssessment { outcome: covered_by|inline|thread_required, design_refs, rationale, triggers }
- ContractClaim { contract_id, owner_ref, envelope, content_hash, criticality, verification_status: candidate|verified|failed, evidence_refs }
- DesignImpact { impact_id, classification: no_contract_change|contract_verified|contract_changed|architecture_changed|posture_changed, source_ref, affected_contract_ids, affected_thread_ids, evidence_refs, rationale }
- ResolvedItem { item_id, type, statement, provenance, status, persistence }
- CompositionContract { capability, provider_id, source_ref, version_or_digest, dependency_refs, input_refs, posture_ref, mutability, expected_outputs, persistence_expectations, verification, fallback }
- ApprovalBrief { subject, exact_content_hash, decision_summary, included_scope, excluded_scope, material_risks, provider_status, downstream_effect, prompt }
- N-000 is a real control node for map routes, appears once per map, and never substitutes for intent or design approval.
- Direct and standalone plan routes emit a Flow Receipt without fabricating a map.
- Plan Mode reports pending persistence; it never implies that conversation decisions have already changed repository artifacts.
- map.json, design.json, and project architecture.json remain the only canonical map, design, and architecture states; Markdown files are generated views.
- Root Design fixes module responsibilities, dependency direction, contract envelopes, posture, and critical scenarios without pre-designing private implementation structure.
- Every leaf receives a DesignAssessment, but an independent DesignThread exists only for material contract, dependency, failure, or tradeoff decisions.
- A subject has at most one active thread per plan purpose; revision history stays inline in design.json.
- A producer may implement an approved candidate contract; a consumer requiring a critical contract waits for verified evidence.
- Private contract-preserving implementation choices are autonomous; observable contract, data, migration, failure, security, performance, scope, or posture changes re-enter design.
- Contract changes invalidate only exact consumers and their work descendants unless evidence proves that a parent envelope also changed.
- Architecture memory belongs to the project and changes only through approved deltas; diff checks guarantee freshness without automatic semantic inference.
- Intent profiles are different definitions of done, and production posture is never inferred from hypothetical reuse.
- Experiments keep mandatory safety floors for silent invalidity, destructive loss, credentials, and runaway cost while rejecting speculative production hardening.
- Provider discovery, dependency readiness, invocation, and persistence verification are separate observable states.
- All human approvals are shown inline and bind the exact content hash; file paths are supplementary evidence only.
- Provider raw output is stored once and referenced; full conversation transcripts are never persisted as design state.

## Failure, operations, and migration

- A missing, duplicated, mutable, or invalid N-000 blocks every work node while leaving design and intent statuses unchanged.
- An MCP plan-root mismatch is reported explicitly and uses the bounded repository CLI fallback rather than accepting arbitrary runtime paths.
- A child thread is not created for a helper, directory split, or hypothetical seam without an independent contract and verification surface.
- A failed critical contract blocks consumers and creates a successor design revision; it cannot be converted into a silent fallback.
- A stale thread write fails its expected thread-state hash; changes to independent threads merge only after reloading under the document lock.
- A provider recommendation outside the behavior budget remains a deferred candidate and cannot become a map node automatically.
- A compact or resume operation with missing exact refs blocks instead of reconstructing posture or design depth from prose.
- A syntactically valid migration that loses topology, history, evidence, artifact links, or legacy bytes fails preservation validation and retains its recovery source.
- The workflow prints a Flow Receipt at intake, status, handoff, resume, and final map reports.
- For the current plan, N-000 reconciliation is the first mutation and source edits remain blocked until Root Design approval and a finalised N-001 leaf plan.
- DESIGN.md is a generated design graph and index; designs/root.md and material module/relation/task views show current thread revisions.
- Module graphs and task DAGs remain separate; strongly connected module groups use a bounded relation design or tracer while the Work DAG remains acyclic.
- The first implementation wave validates one narrow end-to-end tracer before broadening module work.
- Finalisation performs a subtractive posture and provenance review before adding completeness work.
- Composition order is direct provider, thin adapter, bounded fallback, then evidence-backed approved rewrite.
- This plugin uses reusable_internal posture: stable local contracts, migration, compatibility, and integration tests are required; remote policy, telemetry, HA, and deployment automation remain excluded.
- Read v1 and v2.0 artifacts without inventing N-000, posture, thread parents, or design approval.
- Migration preview partitions legacy design revisions by root or node subject, preserves legacy hashes as provenance, and blocks ambiguous parent links.
- Explicit apply creates N-000, rewrites map design refs to thread/content refs, writes generated views, and preserves a recovery copy of the exact prior bytes.
- Strict schema, hash, DAG, artifact, history, and preservation-manifest validation must succeed before migrated state becomes authoritative.
- Plugin refresh preserves the 0.2.0 base version and replaces only the Codex cachebuster suffix.

## Blocking questions

- None recorded

## Architecture delta

None proposed.
