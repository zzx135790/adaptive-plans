import {
  asArray,
  cloneJson,
  isObject,
  stableHash,
} from './io-utils.mjs';
import {
  partitionBehaviorCandidates,
  validateEngineeringPosture,
  validatePostureRef,
  validateScopeControl,
} from './engineering-posture.mjs';
import { assessNodeReadiness } from './planning-engine.mjs';

export const EXECUTION_PROTOCOL_SCHEMA_VERSION = '2.1';

const EXECUTION_READY_STATUSES = new Set(['ready', 'in_progress', 'awaiting_validation']);

function dependencyWaves(map) {
  const nodes = asArray(map?.nodes).filter((node) => isObject(node) && typeof node.id === 'string');
  const ids = new Set(nodes.map((node) => node.id));
  const remaining = new Map(nodes.map((node) => [node.id, node]));
  const satisfied = new Set(nodes.filter((node) => node.status === 'done').map((node) => node.id));
  const waves = [];
  const blocked = new Map();
  for (const node of nodes) {
    const unknown = asArray(node.depends_on).filter((id) => !ids.has(id));
    if (unknown.length > 0) blocked.set(node.id, `unknown dependency: ${unknown.join(', ')}`);
  }
  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter((node) => !blocked.has(node.id)
      && asArray(node.depends_on).every((id) => satisfied.has(id)));
    if (wave.length === 0) {
      for (const node of remaining.values()) {
        if (!blocked.has(node.id)) blocked.set(node.id, 'dependency cycle or unresolved dependency');
      }
      break;
    }
    wave.sort((a, b) => a.id.localeCompare(b.id));
    waves.push(wave);
    for (const node of wave) {
      satisfied.add(node.id);
      remaining.delete(node.id);
    }
  }
  return { waves, blocked };
}

function pathOverlaps(left, right) {
  const a = String(left).replaceAll('\\', '/');
  const b = String(right).replaceAll('\\', '/');
  if (a === b) return true;
  if (!a.includes('*') && !b.includes('*')) return false;
  const prefix = (value) => value.split('*')[0];
  const aPrefix = prefix(a);
  const bPrefix = prefix(b);
  return aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix);
}

function resourceInfo(resource) {
  if (isObject(resource)) return { name: resource.name ?? resource.resource ?? resource.id, partition: resource.partition ?? resource.partition_key ?? null };
  const value = String(resource);
  const match = value.match(/^([^:]+):partition[:=](.+)$/);
  return { name: match?.[1] ?? value, partition: match?.[2] ?? null };
}

function assessNodeExecutionSafety(node) {
  const metadata = node?.parallelization ?? {};
  const reasons = [];
  if (!EXECUTION_READY_STATUSES.has(node.status)) reasons.push(`node status ${node.status} is not executable`);
  if (asArray(metadata.owned_paths).length === 0) reasons.push('missing owned_paths');
  if (asArray(metadata.independent_verification).length === 0) reasons.push('missing independent_verification');
  const shared = asArray(metadata.shared_resources).map(resourceInfo);
  if (shared.some((resource) => !resource.name || !resource.partition)) reasons.push('shared_resources are not empty or partitioned');
  return reasons;
}

function nodesConflict(leftNode, rightNode) {
  const left = leftNode.parallelization ?? {};
  const right = rightNode.parallelization ?? {};
  for (const leftPath of asArray(left.owned_paths)) {
    for (const rightPath of asArray(right.owned_paths)) {
      if (pathOverlaps(leftPath, rightPath)) return true;
    }
  }
  for (const leftResource of asArray(left.shared_resources).map(resourceInfo)) {
    for (const rightResource of asArray(right.shared_resources).map(resourceInfo)) {
      if (leftResource.name === rightResource.name && leftResource.partition === rightResource.partition) return true;
    }
  }
  return false;
}

function partitionConflictGraph(nodes) {
  const remaining = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  const batches = [];
  while (remaining.length > 0) {
    const batch = [];
    for (let index = 0; index < remaining.length;) {
      const node = remaining[index];
      if (batch.every((peer) => !nodesConflict(node, peer))) {
        batch.push(node);
        remaining.splice(index, 1);
      } else {
        index += 1;
      }
    }
    batches.push(batch);
  }
  return batches;
}

function executionResult(node, dependencyWave, executionWave, parallel, reason) {
  return {
    node_id: node.id,
    dependency_wave: dependencyWave,
    execution_wave: executionWave,
    parallel,
    reason,
  };
}

function assessCandidate(node) {
  const reasons = assessNodeExecutionSafety(node);
  if (node.parallelization?.candidate !== true) reasons.unshift('parallelization candidate is not enabled');
  return reasons;
}

function serialResult(node, dependencyWave, reason) {
  return executionResult(node, dependencyWave, 'serial', false, reason);
}

function serialReasonForSingleton(dependencyWave) {
  return `no compatible executable peer in dependency wave ${dependencyWave}`;
}

function appendSerialCandidate(serial, node, dependencyWave, reasons) {
  if (reasons.length > 0) serial.push(serialResult(node, dependencyWave, reasons.join('; ')));
}

/** Evaluate dependency layers independently from execution-safe parallel waves. */
export function evaluateExecutionSafeWaves(map) {
  const input = cloneJson(map ?? {});
  const dependency = dependencyWaves(input);
  const safeWaves = [];
  const serial = [];
  const dispatchBatches = [];
  dependency.waves.forEach((wave, index) => {
    const dependencyWave = index + 1;
    const executable = [];
    for (const node of wave) {
      if (node.status === 'done') continue;
      const reasons = assessCandidate(node);
      if (reasons.length === 0) executable.push(node);
      else appendSerialCandidate(serial, node, dependencyWave, reasons);
    }
    const batches = partitionConflictGraph(executable);
    batches.forEach((batch, batchIndex) => {
      if (batch.length < 2) {
        const reason = batchIndex === 0
          ? serialReasonForSingleton(dependencyWave)
          : `conflicts with nodes in an earlier subwave of dependency wave ${dependencyWave}`;
        serial.push(serialResult(batch[0], dependencyWave, reason));
        dispatchBatches.push({
          dependency_wave: dependencyWave,
          subwave: batchIndex + 1,
          node_ids: batch.map((node) => node.id),
          mode: 'serial',
          reason,
        });
        return;
      }
      const results = batch.map((node) => executionResult(
        node,
        dependencyWave,
        `${dependencyWave}.${batchIndex + 1}`,
        true,
        'dependency satisfied and execution safety evidence is complete',
      ));
      safeWaves.push(results);
      dispatchBatches.push({
        dependency_wave: dependencyWave,
        subwave: batchIndex + 1,
        node_ids: batch.map((node) => node.id),
        mode: 'parallel',
      });
    });
  });
  for (const [nodeId, reason] of dependency.blocked) {
    serial.push({ node_id: nodeId, dependency_wave: null, execution_wave: 'serial', parallel: false, reason });
  }
  return {
    dependency_waves: dependency.waves.map((wave, index) => ({ wave: index + 1, node_ids: wave.map((node) => node.id) })),
    execution_safe_waves: safeWaves,
    dispatch_batches: dispatchBatches,
    serial,
    mutates_map: false,
  };
}

export const evaluateExecutionWaves = evaluateExecutionSafeWaves;

function withoutHash(value, field) {
  const next = cloneJson(value);
  delete next[field];
  return next;
}

function finalizeEnvelope(value, hashField) {
  const next = cloneJson(value);
  next[hashField] = stableHash(withoutHash(next, hashField));
  return next;
}

function hashValid(value, field) {
  return typeof value?.[field] === 'string'
    && value[field] === stableHash(withoutHash(value, field));
}

function currentDesignRefs(map, node) {
  const mapRefs = new Map(asArray(map.design_refs).map((ref) => [
    `${ref.design_id}:${ref.revision}:${ref.design_hash}`,
    ref,
  ]));
  return asArray(node.design_refs).every((ref) => {
    const current = mapRefs.get(`${ref.design_id}:${ref.revision}:${ref.design_hash}`);
    return current && ['approved', 'waived'].includes(current.status);
  });
}

function requireLeafInputs(map, nodeId) {
  const node = asArray(map?.nodes).find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`unknown map node ${nodeId}`);
  const readiness = assessNodeReadiness(map, nodeId);
  if (!readiness.ready) {
    throw Object.assign(new Error(`node ${nodeId} is not ready for a leaf handoff: ${readiness.blockers.map((item) => item.code).join(', ')}`), {
      code: 'LEAF_NOT_READY',
      readiness,
    });
  }
  const postureValidation = validateEngineeringPosture(map.engineering_posture);
  if (!postureValidation.valid || map.engineering_posture?.status === 'unknown_legacy') {
    throw new Error('leaf planning requires an authoritative engineering posture');
  }
  const scopeValidation = validateScopeControl(node, map.engineering_posture);
  if (!scopeValidation.valid) {
    throw Object.assign(new Error(`leaf scope control is invalid: ${scopeValidation.errors.map((item) => item.code).join(', ')}`), {
      code: 'INVALID_LEAF_SCOPE',
      validation: scopeValidation,
    });
  }
  if (node.design_required === true && !currentDesignRefs(map, node)) {
    throw Object.assign(new Error('leaf planning requires current approved design refs'), { code: 'STALE_DESIGN_REF' });
  }
  return node;
}

export function leafPlanningHandoffHash(handoff) {
  return stableHash(withoutHash(handoff, 'handoff_hash'));
}

export function createLeafPlanningHandoff(map, nodeId, input = {}) {
  const node = requireLeafInputs(map, nodeId);
  return finalizeEnvelope({
    schema_version: EXECUTION_PROTOCOL_SCHEMA_VERSION,
    kind: 'leaf_planning_handoff',
    plan_id: map.plan_id,
    plan_ref: String(input.plan_ref ?? map.plan_id),
    node_id: node.id,
    posture_ref: cloneJson(node.posture_ref),
    behavior_budget: cloneJson(node.behavior_budget),
    scope_provenance: cloneJson(node.scope_provenance),
    deferred_candidates: cloneJson(node.deferred_candidates),
    design_refs: cloneJson(node.design_refs),
    architecture_snapshot: cloneJson(map.architecture_snapshot ?? null),
    requirement_ids: cloneJson(node.requirement_ids),
    acceptance: cloneJson(node.acceptance),
    provider_receipt: cloneJson(input.provider_receipt ?? null),
  }, 'handoff_hash');
}

export function createExecutionCheckpoint(handoff, input = {}) {
  if (!hashValid(handoff, 'handoff_hash')) throw new Error('leaf handoff hash is invalid');
  if (!input.leaf_plan_ref) throw new Error('execution checkpoint requires leaf_plan_ref');
  if (!input.task_id) throw new Error('execution checkpoint requires task_id');
  return finalizeEnvelope({
    schema_version: EXECUTION_PROTOCOL_SCHEMA_VERSION,
    kind: 'execution_checkpoint',
    plan_id: handoff.plan_id,
    node_id: handoff.node_id,
    leaf_plan_ref: String(input.leaf_plan_ref),
    task_id: String(input.task_id),
    task_status: 'in_progress',
    leaf_handoff_hash: handoff.handoff_hash,
    posture_ref: cloneJson(handoff.posture_ref),
    behavior_budget: cloneJson(handoff.behavior_budget),
    scope_provenance: cloneJson(handoff.scope_provenance),
    deferred_candidates: cloneJson(handoff.deferred_candidates),
    design_refs: cloneJson(handoff.design_refs),
    architecture_snapshot: cloneJson(handoff.architecture_snapshot),
  }, 'checkpoint_hash');
}

export function createCompactExecutionHandoff(checkpoint, input = {}) {
  if (!hashValid(checkpoint, 'checkpoint_hash')) throw new Error('execution checkpoint hash is invalid');
  const pending = input.pending_approval;
  return finalizeEnvelope({
    schema_version: EXECUTION_PROTOCOL_SCHEMA_VERSION,
    kind: 'compact_execution_handoff',
    plan_id: checkpoint.plan_id,
    node_id: checkpoint.node_id,
    leaf_plan_ref: checkpoint.leaf_plan_ref,
    task_id: checkpoint.task_id,
    task_status: checkpoint.task_status,
    leaf_handoff_hash: checkpoint.leaf_handoff_hash,
    checkpoint_hash: checkpoint.checkpoint_hash,
    posture_ref: cloneJson(checkpoint.posture_ref),
    behavior_budget: cloneJson(checkpoint.behavior_budget),
    scope_provenance: cloneJson(checkpoint.scope_provenance),
    deferred_candidates: cloneJson(checkpoint.deferred_candidates),
    design_refs: cloneJson(checkpoint.design_refs),
    architecture_snapshot: cloneJson(checkpoint.architecture_snapshot),
    pending_approval: pending ? {
      subject: cloneJson(pending.subject),
      exact_content_hash: pending.exact_content_hash ?? null,
      exact_posture_hash: pending.exact_posture_hash ?? null,
      requires_regeneration: true,
    } : null,
  }, 'compact_hash');
}

function compareField(staleFields, field, left, right) {
  if (stableHash({ value: left }) !== stableHash({ value: right })) staleFields.push(field);
}

export function validateExecutionCheckpoint(map, checkpoint) {
  const hashField = checkpoint?.kind === 'compact_execution_handoff' ? 'compact_hash' : 'checkpoint_hash';
  const staleFields = [];
  if (!isObject(checkpoint) || checkpoint.schema_version !== EXECUTION_PROTOCOL_SCHEMA_VERSION) staleFields.push('schema_version');
  if (!hashValid(checkpoint, hashField)) staleFields.push(hashField);
  const node = asArray(map?.nodes).find((candidate) => candidate.id === checkpoint?.node_id);
  if (!node) staleFields.push('node_id');
  if (node) {
    const postureValidation = validatePostureRef(checkpoint.posture_ref, map.engineering_posture);
    if (!postureValidation.valid) staleFields.push('posture_ref');
    compareField(staleFields, 'behavior_budget', checkpoint.behavior_budget, node.behavior_budget);
    compareField(staleFields, 'scope_provenance', checkpoint.scope_provenance, node.scope_provenance);
    compareField(staleFields, 'deferred_candidates', checkpoint.deferred_candidates, node.deferred_candidates);
    compareField(staleFields, 'design_refs', checkpoint.design_refs, node.design_refs);
    compareField(staleFields, 'architecture_snapshot', checkpoint.architecture_snapshot, map.architecture_snapshot ?? null);
    if (!['ready', 'in_progress', 'awaiting_validation'].includes(node.status)) staleFields.push('node_status');
    if (!currentDesignRefs(map, node)) staleFields.push('design_refs');
  }
  const uniqueStaleFields = [...new Set(staleFields)];
  return {
    valid: uniqueStaleFields.length === 0,
    action: uniqueStaleFields.length === 0 ? 'continue' : 'stop_and_recover',
    stale_fields: uniqueStaleFields,
    recovery_action: uniqueStaleFields.length === 0
      ? null
      : `Reload map.json and regenerate the ${checkpoint?.node_id ?? 'selected node'} leaf handoff and execution checkpoint before editing source files.`,
    approval_action: checkpoint?.pending_approval ? 'regenerate_approval_brief' : 'none',
  };
}

export function evaluateExecutionContinuation(map, checkpoint, evidence = {}) {
  const validation = validateExecutionCheckpoint(map, checkpoint);
  if (!validation.valid) return validation;
  const material = asArray(evidence.classifications).filter((classification) => [
    'contract_changed',
    'architecture_changed',
    'posture_changed',
    'design_changed',
  ].includes(classification));
  if (material.length === 0) return validation;
  return {
    valid: false,
    action: 'stop_and_replan',
    stale_fields: material,
    evidence_refs: cloneJson(asArray(evidence.evidence_refs)),
    recovery_action: 'Persist the evidence, stale exact affected refs and descendants, then regenerate design and the selected leaf before resuming.',
    approval_action: checkpoint?.pending_approval ? 'regenerate_approval_brief' : 'none',
  };
}

export function reviewLeafForFinalisation(posture, handoff, candidates = []) {
  if (!hashValid(handoff, 'handoff_hash')) throw new Error('leaf handoff hash is invalid');
  const scopeValidation = validateScopeControl(handoff, posture);
  if (!scopeValidation.valid) throw new Error(`leaf handoff scope is invalid: ${scopeValidation.errors.map((item) => item.code).join(', ')}`);
  const postureAssessment = partitionBehaviorCandidates(posture, candidates);
  const leafRequired = new Set(asArray(handoff.behavior_budget?.required));
  const kept = [];
  const outsideLeaf = [];
  for (const candidate of postureAssessment.admitted_candidates) {
    const safetyFloor = asArray(candidate.provenance).some((entry) => entry.kind === 'safety_floor');
    if (leafRequired.has(candidate.behavior_id) || safetyFloor) kept.push(candidate);
    else outsideLeaf.push({ ...cloneJson(candidate), reason: 'outside_leaf_budget' });
  }
  const keptIds = new Set(kept.map((candidate) => candidate.behavior_id));
  return {
    review_order: ['subtractive_scope_and_provenance', 'completeness'],
    posture_ref: cloneJson(handoff.posture_ref),
    kept_candidates: kept,
    required: kept.map((candidate) => candidate.behavior_id),
    deferred_candidates: [...postureAssessment.deferred_candidates, ...outsideLeaf],
    completeness_gaps: [...leafRequired].filter((behaviorId) => !keptIds.has(behaviorId)),
    mutates_leaf: false,
  };
}
