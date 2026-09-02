import {
  MANDATORY_SAFETY_FLOOR,
  POSTURE_KINDS,
  createEngineeringPosture,
  postureRef,
  validateEngineeringPosture,
  validatePostureRef,
  validateScopeControl,
} from './engineering-posture.mjs';
import { asArray, cloneJson, isObject, stableHash } from './io-utils.mjs';
import { validateCompositionContract } from './design-engine.mjs';
import { appendEvent, loadMap, withMapLock, writeMap } from './plan-protocol.mjs';

const EXECUTABLE_STATUSES = new Set(['ready', 'in_progress', 'awaiting_validation', 'done']);

function strings(value) {
  return [...new Set(asArray(value).map((item) => String(item).trim()).filter(Boolean))].sort();
}

function evidenceIds(value) {
  return new Set(asArray(value).flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (!isObject(entry)) return [];
    return [entry.id, entry.kind, entry.evidence_id].filter((item) => typeof item === 'string');
  }));
}

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

function currentRevision(designDocument) {
  if (!isObject(designDocument)) return null;
  return asArray(designDocument.revisions)
    .find((revision) => revision?.revision === designDocument.current_revision) ?? null;
}

function checkDesignRef(ref, designDocument, details = {}) {
  if (!isObject(ref)) return [issue('invalid_design_ref', 'design reference must be an object', details)];
  if (!isObject(designDocument)) return [];
  if (ref.design_id !== designDocument.design_id) {
    return [issue('design_ref_document_mismatch', `design ref ${ref.design_id ?? '(missing)'} does not match ${designDocument.design_id}`, details)];
  }
  const revision = asArray(designDocument.revisions).find((candidate) => candidate?.revision === ref.revision);
  if (!revision) return [issue('design_revision_missing', `design revision ${ref.revision ?? '(missing)'} does not exist`, details)];
  const errors = [];
  if (ref.design_hash !== revision.design_hash) {
    errors.push(issue('stale_design_ref', `design ref revision ${ref.revision} has a stale hash`, details));
  }
  if (ref.status && ref.status !== revision.status) {
    errors.push(issue('stale_design_status', `design ref revision ${ref.revision} has status ${ref.status}, current record is ${revision.status}`, details));
  }
  return errors;
}

function providerIssues(designDocument) {
  const revision = currentRevision(designDocument);
  if (!revision) return [];
  const errors = [];
  const selection = revision.provider_selection ?? {};
  for (const concern of asArray(selection.blocking_concerns)) {
    errors.push(issue('critical_provider_coverage_gap', `critical design concern lacks provider coverage: ${concern}`, {
      concern,
      design_revision: revision.revision,
    }));
  }
  for (const providerId of asArray(selection.composition_blockers)) {
    errors.push(issue('provider_composition_blocked', `provider composition is blocked: ${providerId}`, {
      provider_id: providerId,
      design_revision: revision.revision,
    }));
  }
  for (const provider of asArray(selection.selected)) {
    if (!provider?.composition_contract) continue;
    const validation = validateCompositionContract(provider.composition_contract);
    for (const error of validation.errors) {
      errors.push(issue('invalid_provider_composition_contract', `${provider.id ?? 'unknown provider'}: ${error.message}`, {
        provider_id: provider.id ?? null,
        composition_code: error.code,
        design_revision: revision.revision,
      }));
    }
  }
  return errors;
}

function candidateIssues(posture, candidates, nodeId = null) {
  if (!posture || posture.status === 'unknown_legacy') return [];
  const allowed = new Set(asArray(posture.allowed_capabilities));
  const excluded = new Set(asArray(posture.excluded_capabilities));
  const safety = new Set(asArray(posture.safety_floor));
  const errors = [];
  for (const candidate of asArray(candidates)) {
    if (!isObject(candidate) || typeof candidate.capability !== 'string' || candidate.capability.trim().length === 0) continue;
    const capability = candidate.capability.trim();
    const details = {
      node_id: candidate.node_id ?? nodeId,
      behavior_id: candidate.behavior_id ?? null,
      capability,
    };
    if (excluded.has(capability)) {
      errors.push(issue('capability_excluded_by_posture', `capability is explicitly excluded by posture: ${capability}`, details));
    } else if (!allowed.has(capability) && !safety.has(capability)) {
      errors.push(issue('capability_outside_posture_ceiling', `capability is outside the posture ceiling: ${capability}`, details));
    }
  }
  return errors;
}

export function assessEngineeringPosture(input = {}) {
  if (!isObject(input)) throw new TypeError('posture assessment input must be an object');
  const kind = String(input.kind ?? '');
  if (!POSTURE_KINDS.has(kind)) {
    throw new TypeError('posture assessment requires kind: spike, experiment, reusable_internal, or production');
  }
  const source = isObject(input.source)
    ? input.source
    : { kind: 'explicit_assessment', ref: String(input.source_ref ?? 'conversation://posture-assessment') };
  const candidate = createEngineeringPosture(kind, {
    source,
    objective: input.objective,
    required_evidence: input.required_evidence,
    allowed_capabilities: input.allowed_capabilities,
    excluded_capabilities: input.excluded_capabilities,
    safety_floor: input.safety_floor ?? MANDATORY_SAFETY_FLOOR,
    promotion_policy: input.promotion_policy,
  });
  const providedEvidence = evidenceIds(input.evidence);
  const evidenceGaps = candidate.required_evidence.filter((required) => !providedEvidence.has(required));
  return {
    schema_version: '2.1',
    operation: 'posture_assess',
    candidate_posture: candidate,
    posture_ref: postureRef(candidate),
    evidence_gaps: evidenceGaps,
    ready_for_adoption: evidenceGaps.length === 0,
    writes: false,
  };
}

export function checkPostureMap(map, options = {}) {
  if (!isObject(map)) throw new TypeError('posture check requires a map object');
  const snapshot = cloneJson(map);
  const posture = map.engineering_posture;
  const errors = [];
  const warnings = [];
  const postureValidation = validateEngineeringPosture(posture);
  errors.push(...postureValidation.errors.map((error) => issue(error.code, error.message, { subject: 'map.engineering_posture' })));
  const authoritative = postureValidation.valid && posture?.status !== 'unknown_legacy' ? posture : null;
  const requestedNode = options.nodeId ?? options.node_id ?? null;
  const nodes = asArray(map.nodes).filter((node) => !requestedNode || node?.id === requestedNode);
  if (requestedNode && nodes.length === 0) errors.push(issue('node_not_found', `map node does not exist: ${requestedNode}`, { node_id: requestedNode }));

  for (const node of nodes) {
    if (!isObject(node) || node.kind === 'control' || node.id === 'N-000') continue;
    const hasScopeContract = node.posture_ref !== undefined
      || node.scope_provenance !== undefined
      || node.behavior_budget !== undefined
      || EXECUTABLE_STATUSES.has(node.status);
    if (authoritative && hasScopeContract) {
      const scope = validateScopeControl(node, authoritative);
      for (const error of scope.errors) errors.push(issue(error.code, error.message, { node_id: node.id }));
    } else if (!authoritative && node.posture_ref !== undefined) {
      const ref = validatePostureRef(node.posture_ref, posture);
      for (const error of ref.errors) errors.push(issue(error.code, error.message, { node_id: node.id }));
    }
    if (node.design_required === true && asArray(node.design_refs).length === 0) {
      errors.push(issue('missing_design_coverage', `${node.id} requires design coverage`, { node_id: node.id }));
    }
    for (const ref of asArray(node.design_refs)) errors.push(...checkDesignRef(ref, options.designDocument, { node_id: node.id }));
    errors.push(...candidateIssues(authoritative, asArray(options.behaviorCandidates).filter((candidate) => !candidate?.node_id || candidate.node_id === node.id), node.id));
  }

  const gateRef = map.gates?.design?.design_ref;
  if (gateRef) errors.push(...checkDesignRef(gateRef, options.designDocument, { subject: 'map.gates.design' }));
  errors.push(...providerIssues(options.designDocument));
  const unscopedCandidates = asArray(options.behaviorCandidates).filter((candidate) => candidate?.node_id
    && !nodes.some((node) => node?.id === candidate.node_id));
  for (const candidate of unscopedCandidates) {
    warnings.push(issue('behavior_candidate_node_not_selected', `behavior candidate node was not checked: ${candidate.node_id}`, {
      node_id: candidate.node_id,
      behavior_id: candidate.behavior_id ?? null,
    }));
  }
  if (JSON.stringify(map) !== JSON.stringify(snapshot)) throw new Error('posture check mutated its input');
  return {
    schema_version: '2.1',
    operation: 'posture_check',
    valid: errors.length === 0,
    posture_ref: authoritative ? postureRef(authoritative) : null,
    node_ids: nodes.map((node) => node?.id).filter(Boolean),
    errors,
    warnings,
    writes: false,
  };
}

function promotionProposalContent(proposal) {
  return {
    schema_version: proposal.schema_version,
    operation: proposal.operation,
    source_posture_ref: cloneJson(proposal.source_posture_ref),
    target_posture: cloneJson(proposal.target_posture),
    target_posture_ref: cloneJson(proposal.target_posture_ref),
    base_map_hash: proposal.base_map_hash,
    base_posture_hash: proposal.base_posture_hash,
    affected_node_ids: strings(proposal.affected_node_ids),
    behavior_conflicts: cloneJson(asArray(proposal.behavior_conflicts)),
    evidence_gaps: strings(proposal.evidence_gaps),
    gate_effects: cloneJson(proposal.gate_effects),
  };
}

export function posturePromotionProposalHash(proposal) {
  return stableHash(promotionProposalContent(proposal));
}

function promotionApprovalBrief(proposal) {
  const brief = {
    subject: 'engineering_posture_promotion',
    revision: `${proposal.source_posture_ref.kind}->${proposal.target_posture_ref.kind}`,
    exact_hash: proposal.proposal_hash,
    exact_posture_hash: proposal.target_posture_ref.posture_hash,
    decision_summary: `Replace ${proposal.source_posture_ref.kind} posture with explicitly assessed ${proposal.target_posture_ref.kind} posture.`,
    included_scope: proposal.affected_node_ids,
    excluded_scope: ['automatic production inference', 'automatic provider installation', 'automatic design or architecture approval'],
    material_risks: [
      ...proposal.behavior_conflicts.map((conflict) => conflict.message),
      ...proposal.evidence_gaps.map((gap) => `target posture evidence is not yet recorded: ${gap}`),
    ],
    waiver_request: null,
    downstream_effect: 'Stop current execution, require completed nodes to revalidate, stale other affected nodes, and re-enter design plus architecture synchronization.',
    prompt: `Apply posture proposal ${proposal.proposal_hash.slice(0, 12)} targeting ${proposal.target_posture_ref.kind} at ${proposal.target_posture_ref.posture_hash.slice(0, 12)}?`,
  };
  return { ...brief, brief_hash: stableHash(brief) };
}

export function previewPosturePromotion(map, input = {}) {
  if (!isObject(map)) throw new TypeError('posture promotion preview requires a map object');
  if (!isObject(input)) throw new TypeError('posture promotion target must be an object');
  const sourceValidation = validateEngineeringPosture(map.engineering_posture);
  if (!sourceValidation.valid || map.engineering_posture?.status === 'unknown_legacy') {
    throw Object.assign(new Error('posture promotion requires an authoritative source posture'), { code: 'POSTURE_SOURCE_INVALID' });
  }
  if (!Object.hasOwn(input, 'kind')) {
    throw Object.assign(new Error('target posture kind must be explicit; production is never inferred from reuse'), { code: 'POSTURE_TARGET_REQUIRED' });
  }
  const assessment = assessEngineeringPosture(input);
  const target = assessment.candidate_posture;
  if (target.posture_hash === map.engineering_posture.posture_hash) {
    throw Object.assign(new Error('target posture is identical to the current posture'), { code: 'POSTURE_NO_CHANGE' });
  }
  const affectedNodeIds = asArray(map.nodes)
    .filter((node) => isObject(node) && node.kind !== 'control' && node.id !== 'N-000' && node.status !== 'cancelled')
    .map((node) => node.id)
    .filter(Boolean);
  const behaviorConflicts = candidateIssues(target, input.behavior_candidates ?? input.behaviorCandidates)
    .map((conflict) => ({ ...conflict, severity: 'blocking_until_replanned' }));
  const proposal = {
    schema_version: '2.1',
    operation: 'posture_promotion_preview',
    source_posture_ref: postureRef(map.engineering_posture),
    target_posture: target,
    target_posture_ref: postureRef(target),
    base_map_hash: stableHash(map),
    base_posture_hash: map.engineering_posture.posture_hash,
    affected_node_ids: affectedNodeIds,
    behavior_conflicts: behaviorConflicts,
    evidence_gaps: assessment.evidence_gaps,
    gate_effects: {
      design: 'stale',
      architecture_sync: 'pending',
      execution: 'stopped',
    },
  };
  proposal.proposal_hash = posturePromotionProposalHash(proposal);
  proposal.approval_brief = promotionApprovalBrief(proposal);
  proposal.writes = false;
  return proposal;
}

function validatePromotionProposal(proposal) {
  if (!isObject(proposal)) throw Object.assign(new Error('posture promotion proposal must be an object'), { code: 'POSTURE_PROPOSAL_INVALID' });
  if (proposal.proposal_hash !== posturePromotionProposalHash(proposal)) {
    throw Object.assign(new Error('posture promotion proposal hash does not match its content'), { code: 'POSTURE_PROPOSAL_HASH_MISMATCH' });
  }
  const expectedBrief = promotionApprovalBrief(proposal);
  if (proposal.approval_brief?.brief_hash !== expectedBrief.brief_hash) {
    throw Object.assign(new Error('posture promotion approval brief is stale'), { code: 'APPROVAL_BRIEF_CONFLICT' });
  }
  const targetValidation = validateEngineeringPosture(proposal.target_posture);
  if (!targetValidation.valid || proposal.target_posture?.posture_hash !== proposal.target_posture_ref?.posture_hash) {
    throw Object.assign(new Error('posture promotion target is invalid'), { code: 'POSTURE_TARGET_INVALID' });
  }
  return expectedBrief;
}

export async function applyPosturePromotion(root, proposal, options = {}) {
  const expectedBrief = validatePromotionProposal(proposal);
  if (options.expectedProposalHash !== proposal.proposal_hash) {
    throw Object.assign(new Error('posture promotion proposal hash was not explicitly confirmed'), { code: 'POSTURE_PROPOSAL_CONFLICT' });
  }
  if (options.expectedBasePostureHash !== proposal.base_posture_hash) {
    throw Object.assign(new Error('base posture hash was not explicitly confirmed'), { code: 'POSTURE_BASE_CONFLICT' });
  }
  if (options.briefHash !== expectedBrief.brief_hash) {
    throw Object.assign(new Error('approval brief hash was not explicitly confirmed'), { code: 'APPROVAL_BRIEF_CONFLICT' });
  }
  if (!(typeof options.approval === 'string' && options.approval.trim()) && !isObject(options.approval)) {
    throw Object.assign(new Error('posture promotion requires explicit approval'), { code: 'POSTURE_APPROVAL_REQUIRED' });
  }

  return withMapLock(root, async () => {
    const current = await loadMap(root);
    if (stableHash(current) !== proposal.base_map_hash) {
      throw Object.assign(new Error('map changed after posture promotion preview'), { code: 'POSTURE_MAP_CONFLICT' });
    }
    if (current.engineering_posture?.posture_hash !== proposal.base_posture_hash
      || current.engineering_posture?.posture_hash !== options.expectedBasePostureHash) {
      throw Object.assign(new Error('engineering posture changed after preview'), { code: 'POSTURE_BASE_CONFLICT' });
    }
    const next = cloneJson(current);
    const targetRef = postureRef(proposal.target_posture);
    const affected = new Set(proposal.affected_node_ids);
    next.engineering_posture = cloneJson(proposal.target_posture);
    for (const node of asArray(next.nodes)) {
      if (!affected.has(node?.id)) continue;
      node.posture_ref = cloneJson(targetRef);
      if (node.status === 'done') {
        node.revalidation_required = true;
      } else if (node.status !== 'cancelled') {
        node.status = 'stale';
        node.stale_reason = `engineering posture changed by proposal ${proposal.proposal_hash}`;
      }
    }
    next.stage = 'designing';
    next.current_node = null;
    next.gates = next.gates ?? {};
    next.gates.design = {
      ...(next.gates.design ?? {}),
      status: 'stale',
      reason: `engineering posture changed to ${targetRef.kind}; design must be reviewed against ${targetRef.posture_hash}`,
    };
    next.gates.architecture_sync = {
      ...(next.gates.architecture_sync ?? {}),
      status: 'pending',
      reason: `engineering posture changed to ${targetRef.kind}; architecture impact must be assessed without fabricating a delta`,
    };
    next.posture_promotion = {
      proposal_hash: proposal.proposal_hash,
      approval_brief_hash: expectedBrief.brief_hash,
      source_posture_ref: cloneJson(proposal.source_posture_ref),
      target_posture_ref: cloneJson(targetRef),
      approval: cloneJson(options.approval),
      status: 'applied_gates_pending',
    };
    const written = await writeMap(root, next);
    await appendEvent(root, {
      event_id: `posture-promotion-${proposal.proposal_hash}`,
      type: 'posture_promotion_applied',
      proposal_hash: proposal.proposal_hash,
      approval_brief_hash: expectedBrief.brief_hash,
      source_posture_ref: proposal.source_posture_ref,
      target_posture_ref: targetRef,
      affected_node_ids: proposal.affected_node_ids,
      approval: cloneJson(options.approval),
    });
    return {
      schema_version: '2.1',
      operation: 'posture_promotion_apply',
      proposal_hash: proposal.proposal_hash,
      approval_brief_hash: expectedBrief.brief_hash,
      posture_ref: targetRef,
      affected_node_ids: cloneJson(proposal.affected_node_ids),
      gates: cloneJson(written.gates),
      writes: true,
      map: written,
    };
  });
}
