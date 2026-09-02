import fs from 'node:fs/promises';
import path from 'node:path';

import {
  appendEvent,
  buildHandoff,
  getNextNodes,
  loadMap,
  makeEventId,
  markDescendantsStale,
  normalizeProviderResult,
  withMapLock,
  writeNodeBrief,
  writeMap,
} from './plan-protocol.mjs';
import { triageDesign } from './design-engine.mjs';
import { currentThreadRevision } from './design-ledger.mjs';
import { validateArchitectureImpact } from './architecture-impact.mjs';
import {
  partitionBehaviorCandidates,
  postureRef,
  validateEngineeringPosture,
  validateScopeControl,
} from './engineering-posture.mjs';
import { selectVisibleProvider } from './provider-registry.mjs';

const HIGH = new Set(['high', 'critical']);
const LOW = new Set(['low']);
const MATERIAL_UNCERTAINTY_KEYS = ['technical_risk', 'dependency_unknown'];
const SUPPORTING_UNCERTAINTY_KEYS = ['domain_familiarity', 'requirement_stability'];

export function triageTask(signals = {}) {
  const goalClarity = signals.goal_clarity ?? 'medium';
  const highCount = MATERIAL_UNCERTAINTY_KEYS.filter((key) => HIGH.has(signals[key])).length;
  const supportingUncertainty = SUPPORTING_UNCERTAINTY_KEYS.filter((key) => LOW.has(signals[key])).length;
  const uncertaintyReduction = SUPPORTING_UNCERTAINTY_KEYS.filter((key) => HIGH.has(signals[key])).length;
  const uncertaintyScore = Math.max(0, highCount + supportingUncertainty - uncertaintyReduction);
  const phaseCount = Number(signals.phase_count ?? 1);
  const reasons = [];
  const design = triageDesign(signals);

  const result = (mode, strategy, uncertainty, extraReasons = []) => ({
    mode,
    work_shape: mode === 'guide' ? 'undetermined' : mode,
    stage: mode === 'guide' ? 'guiding' : design.required ? 'designing' : mode === 'map' ? 'mapping' : mode === 'plan' ? 'leaf_planning' : 'intake',
    strategy,
    uncertainty,
    high_count: highCount,
    reasons: extraReasons,
    design,
    gates: {
      intent: { status: mode === 'guide' ? 'pending' : 'approved' },
      design: { status: design.required ? 'required' : 'not_required' },
      architecture_sync: { status: mode === 'direct' ? 'not_required' : 'pending' },
    },
  });

  if (goalClarity === 'low' || signals.scope_clarity === 'low'
    || signals.success_criteria_clarity === 'low' || signals.now_later_boundary === 'low') {
    reasons.push('roadmap-blocking ambiguity');
    return result('guide', null, 'high', reasons);
  }
  if ((signals.node_ready === true || signals.leaf_ready === true || signals.mode === 'plan') && highCount === 0 && !design.required) {
    reasons.push('leaf node gates are explicit');
    return {
      ...result('plan', 'leaf', 'low', reasons),
      next_skill: 'writing-plans',
    };
  }
  const coordinationNeedsMap = (phaseCount > 1 || signals.long_running === true) && uncertaintyScore > 0;
  if (coordinationNeedsMap || highCount >= 1 || signals.cross_subsystem === true) {
    const strategy = highCount >= 2 || uncertaintyScore >= 3 ? 'progressive' : 'direct';
    reasons.push(
      coordinationNeedsMap && phaseCount > 1 ? 'multiple phases with uncertainty'
        : coordinationNeedsMap && signals.long_running === true ? 'long-running work with uncertainty'
          : signals.cross_subsystem === true ? 'cross-subsystem coordination'
            : 'material uncertainty',
    );
    return result('map', strategy, uncertaintyScore >= 3 ? 'high' : 'medium', reasons);
  }
  if (design.required) {
    reasons.push('design gate required before leaf planning');
    return result('plan', 'design-first', design.risk === 'critical' ? 'high' : 'medium', reasons);
  }
  reasons.push('no explicit planning trigger');
  return result('direct', 'direct', uncertaintyScore > 0 ? 'medium' : 'low', reasons);
}

const PHASE_ROUTES = {
  guide: [{ capability: 'clarify', role: 'clarifier' }],
  map: [{ capability: 'explore', role: 'explorer' }, { capability: 'decompose', role: 'mapper' }],
  plan: [{ capability: 'decompose', role: 'planner' }, { capability: 'review', role: 'reviewer' }],
};

/** Route planning phases through the host-visible provider envelope only. */
export function routePlanning(signals = {}, visibleProviders = signals.visible_providers) {
  const triage = triageTask(signals);
  if (triage.mode === 'direct') {
    return {
      ...triage,
      routes: [],
      planning_artifacts: [],
      reason: 'direct work is stable and does not require full planning provider invocation',
    };
  }
  const routes = (PHASE_ROUTES[triage.mode] ?? []).map(({ capability, role }) =>
    selectVisibleProvider({ capability, role, visibleProviders }));
  return {
    ...triage,
    routes,
    provider: routes.find((route) => route.status === 'ready_to_invoke')?.provider ?? null,
    fallback: routes.filter((route) => route.status === 'unavailable').map((route) => route.fallback),
    planning_artifacts: triage.mode === 'map' ? ['map-proposal'] : ['leaf-plan-proposal'],
  };
}

export function assessNodeReadiness(map, nodeId) {
  const node = map?.nodes?.find((candidate) => candidate.id === nodeId);
  if (!node) return { ready: false, blockers: [{ code: 'unknown_node', message: `Unknown node ${nodeId}` }] };
  const byId = new Map((map.nodes ?? []).map((candidate) => [candidate.id, candidate]));
  const blockers = [];
  const productWork = node.kind !== 'control' && node.id !== 'N-000';
  if (map.schema_version === '2.0' && productWork) {
    const postureValidation = validateEngineeringPosture(map.engineering_posture);
    if (!postureValidation.valid || map.engineering_posture?.status === 'unknown_legacy') {
      blockers.push({ code: 'missing_map_posture', message: 'v2 product work requires an authoritative map posture' });
    } else {
      blockers.push(...validateScopeControl(node, map.engineering_posture).errors);
      if (!Array.isArray(node.deferred_candidates)) {
        blockers.push({ code: 'invalid_deferred_candidates', message: 'deferred_candidates must be an array' });
      }
    }
  }
  if (!node.title) blockers.push({ code: 'missing_title', message: 'title is required' });
  if (!Array.isArray(node.inputs) || node.inputs.length === 0) blockers.push({ code: 'missing_inputs', message: 'inputs are required' });
  if (!Array.isArray(node.outputs) || node.outputs.length === 0) blockers.push({ code: 'missing_outputs', message: 'outputs are required' });
  if (!Array.isArray(node.acceptance) || node.acceptance.length === 0) blockers.push({ code: 'missing_acceptance', message: 'acceptance criteria are required' });
  if (node.design_required === true && (!Array.isArray(node.design_refs) || node.design_refs.length === 0)) blockers.push({ code: 'missing_design_ref', message: 'an approved design revision is required' });
  if (Array.isArray(node.impacted_modules) && node.impacted_modules.length > 0 && (!Array.isArray(node.contract_refs) || node.contract_refs.length === 0)) blockers.push({ code: 'missing_contract_refs', message: 'impacted modules require contract references' });
  if (node.blocking_questions !== undefined && !Array.isArray(node.blocking_questions)) {
    blockers.push({ code: 'invalid_blocking_questions', message: 'blocking_questions must be an array' });
  }
  for (const question of Array.isArray(node.blocking_questions) ? node.blocking_questions : []) {
    blockers.push({ code: 'blocking_question', message: question });
  }
  if (node.revalidation_required === true) {
    blockers.push({ code: 'revalidation_required', message: 'node requires revalidation after dependency evidence changed' });
  }
  for (const dependency of Array.isArray(node.depends_on) ? node.depends_on : []) {
    const upstream = byId.get(dependency);
    if (!upstream) blockers.push({ code: 'unknown_dependency', message: dependency });
    else if (upstream.status === 'stale') blockers.push({ code: 'stale_dependency', message: dependency });
    else if (upstream.revalidation_required === true) blockers.push({ code: 'dependency_revalidation_required', message: dependency });
    else if (upstream.status !== 'done') blockers.push({ code: 'dependency_not_done', message: dependency });
  }
  if (['stale', 'cancelled', 'deferred'].includes(node.status)) {
    blockers.push({ code: 'status_not_ready', message: node.status });
  }
  return { ready: blockers.length === 0, blockers, node_id: nodeId };
}

export function assessBehaviorCandidates(map, nodeId, candidates) {
  const node = map?.nodes?.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown node ${nodeId}`);
  const assessment = partitionBehaviorCandidates(map.engineering_posture, candidates);
  return {
    node_id: nodeId,
    current_behavior_budget: structuredClone(node.behavior_budget ?? {
      required: [],
      excluded: [],
      deferred_candidates: [],
    }),
    ...assessment,
    mutates_map: false,
  };
}

export async function ingestProviderResult(root, input, defaults = {}) {
  const normalized = normalizeProviderResult(input, defaults);
  const stableRaw = normalized.raw && typeof normalized.raw === 'object' && !Array.isArray(normalized.raw)
    ? { ...normalized.raw, observed_at: undefined }
    : normalized.raw;
  const event = {
    // Receipt time is metadata, not identity: replaying the same provider
    // payload must remain idempotent even when it is ingested later.
    event_id: makeEventId('provider', {
      provider_id: normalized.provider_id,
      capability: normalized.capability,
      status: normalized.status,
      source: normalized.raw?.source ?? input?.source ?? defaults.source ?? null,
      raw: stableRaw,
      questions: normalized.questions,
      assumptions: normalized.assumptions,
      findings: normalized.findings,
      options: normalized.options,
      risks: normalized.risks,
      evidence: normalized.evidence,
    }),
    type: 'provider_result',
    provider_id: normalized.provider_id,
    capability: normalized.capability,
    status: normalized.status,
    source: input?.source ?? defaults.source ?? null,
    observed_at: normalized.observed_at,
    result: normalized,
  };
  await appendEvent(root, event);
  return normalized;
}

export async function addNode(root, input = {}) {
  return withMapLock(root, async () => {
    const map = await loadMap(root);
    if (!input.id || !input.title) throw new Error('node id and title are required');
    if (input.status === 'done') throw new Error('addNode cannot mark a new node done; use an explicit completion transition');
    if (map.nodes.some((node) => node.id === input.id)) throw new Error(`Node ${input.id} already exists`);
    let inheritedPostureRef = input.posture_ref;
    if (!inheritedPostureRef && map.engineering_posture
      && validateEngineeringPosture(map.engineering_posture).valid
      && map.engineering_posture.status !== 'unknown_legacy') {
      inheritedPostureRef = postureRef(map.engineering_posture);
    }
    const node = {
      ...input,
      id: input.id,
      title: input.title,
      status: input.status ?? 'idea',
      depends_on: Array.isArray(input.depends_on) ? input.depends_on : [],
      inputs: Array.isArray(input.inputs) ? input.inputs : [],
      outputs: Array.isArray(input.outputs) ? input.outputs : [],
      acceptance: Array.isArray(input.acceptance) ? input.acceptance : [],
      blocking_questions: Array.isArray(input.blocking_questions) ? input.blocking_questions : [],
      requirement_ids: Array.isArray(input.requirement_ids) ? input.requirement_ids : [],
      contract_refs: Array.isArray(input.contract_refs) ? input.contract_refs : [],
      design_refs: Array.isArray(input.design_refs) ? input.design_refs : [],
      interaction_refs: Array.isArray(input.interaction_refs) ? input.interaction_refs : [],
      impacted_modules: Array.isArray(input.impacted_modules) ? input.impacted_modules : [],
      posture_ref: inheritedPostureRef,
      scope_provenance: Array.isArray(input.scope_provenance) ? input.scope_provenance : [],
      behavior_budget: input.behavior_budget,
      deferred_candidates: Array.isArray(input.deferred_candidates) ? input.deferred_candidates : [],
      parallelization: input.parallelization ?? {
        candidate: false, wave: 'serial', owned_paths: [], shared_resources: [], independent_verification: [], reason: 'not assessed',
      },
    };
    const readiness = assessNodeReadiness({ ...map, nodes: [...map.nodes, node] }, node.id);
    node.status = readiness.ready ? (input.status ?? 'ready') : 'blocked';
    node.readiness = readiness;
    map.nodes.push(node);
    const nextMap = await writeMap(root, map);
    await writeNodeBrief(root, nextMap.nodes.find((candidate) => candidate.id === node.id));
    await appendEvent(root, {
      event_id: makeEventId('node', node),
      type: 'node_added',
      node_id: node.id,
      node,
      readiness,
    });
    return { map: nextMap, node };
  });
}

export async function invalidateFromEvidence(root, nodeId, details = {}) {
  return withMapLock(root, async () => {
    const map = await loadMap(root);
  const sourceNode = map.nodes?.find((node) => node.id === nodeId);
  if (!sourceNode) throw new Error(`Unknown node ${nodeId}`);
  if (sourceNode.status === 'done') {
    sourceNode.status = 'done';
    sourceNode.revalidation_required = true;
  } else {
    sourceNode.status = 'stale';
  }
  sourceNode.stale_reason = details.message ?? 'dependency evidence changed';
  const propagated = markDescendantsStale(map, nodeId, sourceNode.stale_reason);
  const evidenceEvent = {
    event_id: makeEventId('evidence', { nodeId, details }),
    type: 'evidence',
    node_id: nodeId,
    source: details.source ?? 'unknown',
    message: details.message ?? '',
    affected_nodes: propagated.affected,
  };
  let decisionEvent = null;
  if (details.decision) {
    decisionEvent = {
      event_id: makeEventId('decision', { nodeId, evidence_event_id: evidenceEvent.event_id, decision: details.decision }),
      type: 'decision',
      node_id: nodeId,
      decision: details.decision,
      alternatives: details.alternatives ?? [],
      affected_nodes: propagated.affected,
    };
    const decisionId = decisionEvent.event_id;
    const decisionDir = path.join(path.resolve(root), 'decisions');
    await fs.mkdir(decisionDir, { recursive: true });
    await fs.writeFile(
      path.join(decisionDir, `${decisionId}.md`),
      `# Decision ${decisionId}\n\n- Node: ${nodeId}\n- Evidence: ${details.message ?? ''}\n- Chosen: ${details.decision}\n- Affected nodes: ${propagated.affected.join(', ') || 'none'}\n`,
      'utf8',
    );
  }
  const nextMap = await writeMap(root, propagated.map);
  await appendEvent(root, evidenceEvent);
  if (decisionEvent) await appendEvent(root, decisionEvent);
  for (const id of [nodeId, ...propagated.affected]) {
    await writeNodeBrief(root, nextMap.nodes.find((node) => node.id === id));
  }
    return { map: nextMap, affected: propagated.affected, next: getNextNodes(nextMap) };
  });
}

export async function invalidateFromDesignRevision(root, designRef, details = {}) {
  return withMapLock(root, async () => {
    const map = await loadMap(root);
    const directlyAffected = map.nodes
      .filter((node) => (node.design_refs ?? []).some((ref) => {
        if (typeof ref === 'string') {
          return (!designRef.thread_id || designRef.thread_id === 'root') && ref === designRef.design_id;
        }
        if (ref.design_id !== designRef.design_id || ref.revision !== designRef.revision) return false;
        return !designRef.thread_id || (ref.thread_id ?? 'root') === designRef.thread_id;
      }))
      .map((node) => node.id);
    const affected = new Set();
    for (const nodeId of directlyAffected) {
      const node = map.nodes.find((candidate) => candidate.id === nodeId);
      if (node.status === 'done') node.revalidation_required = true;
      else node.status = 'stale';
      node.stale_reason = details.reason ?? `design ${designRef.design_id}@${designRef.revision} became stale`;
      affected.add(nodeId);
      const propagated = markDescendantsStale(map, nodeId, node.stale_reason);
      Object.assign(map, propagated.map);
      for (const id of propagated.affected) affected.add(id);
    }
    if (!designRef.thread_id || designRef.thread_id === 'root') {
      map.gates = map.gates ?? {};
      map.gates.design = { status: 'stale', design_ref: designRef };
    }
    const nextMap = await writeMap(root, map);
    await appendEvent(root, {
      event_id: makeEventId('design-stale', { designRef, reason: details.reason, affected: [...affected] }),
      type: 'design_invalidated',
      design_ref: designRef,
      affected_nodes: [...affected],
      message: details.reason ?? '',
    });
    return { map: nextMap, affected: [...affected] };
  });
}

export async function linkArchitectureSnapshot(root, architecture) {
  if (architecture?.status !== 'approved' || !architecture.architecture_hash) throw new Error('an approved architecture baseline is required');
  return withMapLock(root, async () => {
    const map = await loadMap(root);
    if (map.schema_version !== '2.0') throw new Error('migrate the map to v2 before linking architecture memory');
    const previousSnapshot = map.architecture_snapshot;
    const nextSnapshot = {
      project_id: architecture.project_id,
      revision: architecture.revision,
      architecture_hash: architecture.architecture_hash,
      modules: architecture.modules.map((module) => ({ module_id: module.id, contract_hash: module.contract_hash })),
    };
    const changed = previousSnapshot?.architecture_hash !== nextSnapshot.architecture_hash;
    const affected = new Set();
    if (previousSnapshot && changed) {
      const contractHashes = new Map(nextSnapshot.modules.map((module) => [module.module_id, module.contract_hash]));
      const directlyAffected = [];
      for (const node of map.nodes ?? []) {
        const staleRefs = (node.contract_refs ?? []).filter((ref) =>
          ref && typeof ref === 'object'
          && (!contractHashes.has(ref.module_id) || contractHashes.get(ref.module_id) !== ref.contract_hash));
        if (staleRefs.length === 0) continue;
        if (node.status === 'done') node.revalidation_required = true;
        else node.status = 'stale';
        node.stale_reason = `architecture contracts changed: ${staleRefs.map((ref) => ref.module_id).join(', ')}`;
        affected.add(node.id);
        directlyAffected.push(node.id);
      }
      for (const nodeId of directlyAffected) {
        const node = map.nodes.find((candidate) => candidate.id === nodeId);
        const propagated = markDescendantsStale(map, node.id, node.stale_reason);
        Object.assign(map, propagated.map);
        for (const id of propagated.affected) affected.add(id);
      }
    }
    map.architecture_snapshot = nextSnapshot;
    if (changed) map.gates.architecture_sync = { status: 'pending', architecture_hash: architecture.architecture_hash };
    const next = await writeMap(root, map);
    await appendEvent(root, {
      event_id: makeEventId('architecture-linked', nextSnapshot),
      type: 'architecture_linked',
      architecture_snapshot: nextSnapshot,
      previous_architecture_hash: previousSnapshot?.architecture_hash ?? null,
      affected_nodes: [...affected],
    });
    return next;
  });
}

export async function linkApprovedDesign(root, designDocument, options = {}) {
  const legacy = Array.isArray(designDocument?.revisions);
  const threadId = options.threadId ?? 'root';
  if (legacy && threadId !== 'root') throw new Error('legacy design documents do not have child threads');
  const thread = legacy ? null : designDocument?.threads?.find((candidate) => candidate.thread_id === threadId);
  if (!legacy && !thread) throw new Error(`unknown design thread ${threadId}`);
  const revision = legacy
    ? designDocument.revisions.find((item) => item.revision === designDocument.current_revision)
    : currentThreadRevision(thread);
  const status = legacy ? revision?.status : revision?.decision_status;
  if (!revision || !['approved', 'waived'].includes(status)) throw new Error('an approved or explicitly waived design revision is required');
  const childThread = !legacy && thread.thread_id !== 'root';
  if (childThread && !options.nodeId) throw new Error('a child design thread requires an intended node');
  return withMapLock(root, async () => {
    const map = await loadMap(root);
    if (map.schema_version !== '2.0') throw new Error('migrate the map to v2 before linking a design');
    const ref = legacy
      ? { design_id: designDocument.design_id, revision: revision.revision, design_hash: revision.design_hash, status, scope: revision.scope, node_id: revision.node_id ?? null }
      : {
        design_id: designDocument.design_id,
        thread_id: thread.thread_id,
        revision: revision.revision,
        design_hash: revision.content_hash,
        content_hash: revision.content_hash,
        status,
        scope: childThread ? 'node' : 'root',
        node_id: childThread ? options.nodeId : null,
      };
    map.design_refs = [...(map.design_refs ?? []).filter((item) => legacy
      ? !(item.design_id === ref.design_id && item.scope === ref.scope && item.node_id === ref.node_id)
      : !(item.design_id === ref.design_id && (item.thread_id ?? 'root') === ref.thread_id)), ref];
    if (ref.scope === 'node') {
      const node = map.nodes.find((candidate) => candidate.id === ref.node_id);
      if (!node) throw new Error(`unknown design node ${ref.node_id}`);
      for (const candidate of map.nodes) {
        candidate.design_refs = (candidate.design_refs ?? []).filter((item) => (
          typeof item === 'string'
            ? true
            : !(item.design_id === ref.design_id && (item.thread_id ?? 'root') === ref.thread_id)
        ));
      }
      node.design_refs.push(ref);
    } else {
      map.gates.design = { status, design_ref: ref };
      map.stage = map.work_shape === 'map' ? 'mapping' : map.work_shape === 'plan' ? 'leaf_planning' : 'intake';
    }
    const next = await writeMap(root, map);
    await appendEvent(root, { event_id: makeEventId('design-linked', ref), type: 'design_linked', design_ref: ref });
    return next;
  });
}

export async function recordArchitectureImpact(root, impact, artifactPath = null) {
  return withMapLock(root, async () => {
    const map = await loadMap(root);
    if (map.schema_version !== '2.0') throw new Error('migrate the map to v2 before recording architecture impact');
    if (map.architecture_snapshot?.architecture_hash !== impact.architecture_hash) throw new Error('impact references a different architecture baseline');
    const validation = validateArchitectureImpact(impact, {
      architecture_hash: map.architecture_snapshot.architecture_hash,
    });
    if (!validation.valid) {
      const error = new Error(`invalid architecture impact: ${validation.errors.map((item) => item.message).join('; ')}`);
      error.validation = validation;
      throw error;
    }
    map.gates.architecture_sync = { status: impact.status === 'satisfied' ? 'satisfied' : impact.status, impact_id: impact.impact_id, classification: impact.classification };
    if (artifactPath) {
      map.artifacts = [...(map.artifacts ?? []).filter((artifact) => artifact.path !== artifactPath), { path: artifactPath, format: 'architecture-impact', id: impact.impact_id }];
    }
    const next = await writeMap(root, map);
    await appendEvent(root, { event_id: makeEventId('architecture-impact', impact), type: 'architecture_impact_recorded', impact_id: impact.impact_id, status: impact.status, classification: impact.classification, artifact_path: artifactPath });
    return next;
  });
}

export function makePlanningHandoff(input) {
  return buildHandoff(input);
}
