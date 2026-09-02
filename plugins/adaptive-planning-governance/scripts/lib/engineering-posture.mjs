import { asArray, cloneJson, isObject, stableHash } from './io-utils.mjs';

export const POSTURE_SCHEMA_VERSION = '2.1';
export const POSTURE_KINDS = new Set(['spike', 'experiment', 'reusable_internal', 'production']);
export const PROVENANCE_KINDS = new Set([
  'requirement',
  'approved_design',
  'approved_contract',
  'observed_failure',
  'safety_floor',
]);

export const MANDATORY_SAFETY_FLOOR = Object.freeze([
  'fail_loud_on_invalid_results',
  'prevent_credential_exposure',
  'prevent_destructive_data_loss',
  'bound_runaway_resource_cost',
]);

const PROFILE_DEFINITIONS = Object.freeze({
  spike: {
    objective: 'Answer one bounded technical question with disposable implementation.',
    required_evidence: ['question_answered', 'result_validity'],
  },
  experiment: {
    objective: 'Evaluate a stated hypothesis with valid and reproducible measurements.',
    required_evidence: ['hypothesis', 'measurement_validity', 'reproduction_instructions'],
  },
  reusable_internal: {
    objective: 'Provide a stable local contract for repeated use inside the project.',
    required_evidence: ['stable_local_contract', 'compatibility_evidence', 'integration_tests'],
  },
  production: {
    objective: 'Operate an owned public capability under explicit reliability and change controls.',
    required_evidence: ['operational_ownership', 'security_assessment', 'migration_and_rollback', 'reliability_evidence'],
  },
});

function strings(value) {
  return [...new Set(asArray(value).map((item) => String(item).trim()).filter(Boolean))].sort();
}

function normalizedSource(value = {}) {
  return {
    ...(isObject(value) ? cloneJson(value) : {}),
    kind: String(value?.kind ?? ''),
    ref: String(value?.ref ?? ''),
  };
}

export function postureContent(posture = {}) {
  return {
    schema_version: POSTURE_SCHEMA_VERSION,
    kind: String(posture.kind ?? ''),
    source: normalizedSource(posture.source),
    objective: String(posture.objective ?? '').trim(),
    required_evidence: strings(posture.required_evidence),
    allowed_capabilities: strings(posture.allowed_capabilities ?? posture.required_capabilities),
    excluded_capabilities: strings(posture.excluded_capabilities),
    safety_floor: strings(posture.safety_floor),
    promotion_policy: String(posture.promotion_policy ?? '').trim(),
  };
}

export function postureContentHash(posture) {
  return stableHash(postureContent(posture));
}

export function normalizeEngineeringPosture(input, options = {}) {
  if (!isObject(input) || input.status === 'unknown_legacy' || !POSTURE_KINDS.has(input.kind)) {
    return {
      schema_version: POSTURE_SCHEMA_VERSION,
      status: 'unknown_legacy',
      kind: null,
      posture_hash: null,
      source: {
        kind: 'legacy_artifact',
        ref: String(options.legacyRef ?? input?.source?.ref ?? 'unidentified-legacy-artifact'),
      },
    };
  }
  const content = postureContent(input);
  return { ...content, posture_hash: stableHash(content) };
}

export function createEngineeringPosture(kind, input = {}) {
  if (!POSTURE_KINDS.has(kind)) throw new TypeError(`unknown engineering posture: ${kind}`);
  const definition = PROFILE_DEFINITIONS[kind];
  return normalizeEngineeringPosture({
    kind,
    source: input.source,
    objective: input.objective ?? definition.objective,
    required_evidence: input.required_evidence ?? definition.required_evidence,
    allowed_capabilities: input.allowed_capabilities ?? input.required_capabilities,
    excluded_capabilities: input.excluded_capabilities,
    safety_floor: input.safety_floor ?? MANDATORY_SAFETY_FLOOR,
    promotion_policy: input.promotion_policy
      ?? 'Promotion requires explicit user approval and re-enters design and architecture synchronization.',
  });
}

export function postureRef(posture) {
  const normalized = normalizeEngineeringPosture(posture);
  if (normalized.status === 'unknown_legacy') throw new Error('unknown legacy posture cannot produce an authoritative PostureRef');
  return {
    kind: normalized.kind,
    posture_hash: normalized.posture_hash,
    source_ref: normalized.source.ref,
  };
}

export function validateEngineeringPosture(posture) {
  const errors = [];
  if (!isObject(posture)) return { valid: false, errors: [{ code: 'not_object', message: 'engineering posture must be an object' }] };
  if (posture.status === 'unknown_legacy') {
    if (posture.kind !== null || posture.posture_hash !== null) {
      errors.push({ code: 'invented_legacy_posture', message: 'unknown legacy posture cannot assert a kind or hash' });
    }
    return { valid: errors.length === 0, errors };
  }
  if (posture.schema_version !== POSTURE_SCHEMA_VERSION) errors.push({ code: 'unsupported_schema_version', message: 'posture schema_version must be 2.1' });
  if (!POSTURE_KINDS.has(posture.kind)) errors.push({ code: 'invalid_posture_kind', message: 'posture kind is invalid' });
  if (!posture.source?.kind || !posture.source?.ref) errors.push({ code: 'missing_posture_source', message: 'posture source kind and ref are required' });
  for (const field of ['objective', 'promotion_policy']) {
    if (typeof posture[field] !== 'string' || posture[field].trim().length === 0) errors.push({ code: `missing_${field}`, message: `${field} is required` });
  }
  for (const field of ['required_evidence', 'allowed_capabilities', 'excluded_capabilities', 'safety_floor']) {
    if (!Array.isArray(posture[field])) errors.push({ code: `invalid_${field}`, message: `${field} must be an array` });
  }
  const allowed = new Set(asArray(posture.allowed_capabilities));
  const overlap = asArray(posture.excluded_capabilities).filter((item) => allowed.has(item));
  if (overlap.length > 0) errors.push({ code: 'capability_budget_conflict', message: `capabilities cannot be both allowed and excluded: ${overlap.join(', ')}` });
  const safety = new Set(asArray(posture.safety_floor));
  const missingSafety = MANDATORY_SAFETY_FLOOR.filter((item) => !safety.has(item));
  if (missingSafety.length > 0) errors.push({ code: 'missing_safety_floor', message: `mandatory safety floor is missing: ${missingSafety.join(', ')}` });
  const expectedHash = postureContentHash(posture);
  if (posture.posture_hash !== expectedHash) errors.push({ code: 'posture_hash_mismatch', message: 'posture hash does not match normalized content' });
  return { valid: errors.length === 0, errors };
}

export function validatePostureRef(ref, posture) {
  const errors = [];
  const validation = validateEngineeringPosture(posture);
  if (!validation.valid) errors.push(...validation.errors);
  if (!isObject(ref)) {
    errors.push({ code: 'missing_posture_ref', message: 'PostureRef is required' });
  } else if (posture?.status === 'unknown_legacy') {
    errors.push({ code: 'unknown_legacy_posture', message: 'legacy posture must be explicitly assessed before use' });
  } else {
    if (ref.kind !== posture.kind) errors.push({ code: 'posture_kind_mismatch', message: 'PostureRef kind is stale' });
    if (ref.posture_hash !== postureContentHash(posture)) errors.push({ code: 'stale_posture_ref', message: 'PostureRef hash is stale' });
    if (ref.source_ref !== posture.source?.ref) errors.push({ code: 'posture_source_mismatch', message: 'PostureRef source does not match' });
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeBehaviorBudget(input = {}) {
  return {
    required: strings(input.required),
    excluded: strings(input.excluded),
    deferred_candidates: strings(input.deferred_candidates),
  };
}

export function validateScopeControl(input = {}, posture) {
  const errors = [...validatePostureRef(input.posture_ref, posture).errors];
  const budget = normalizeBehaviorBudget(input.behavior_budget);
  const provenance = asArray(input.scope_provenance);
  const required = new Set(budget.required);
  const excluded = new Set(budget.excluded);
  const deferred = new Set(budget.deferred_candidates);

  for (const behavior of required) {
    if (excluded.has(behavior)) errors.push({ code: 'required_behavior_excluded', message: `${behavior} is both required and excluded` });
    if (deferred.has(behavior)) errors.push({ code: 'deferred_behavior_executable', message: `${behavior} is deferred and cannot be executable` });
    const sources = provenance.filter((entry) => entry?.behavior_id === behavior);
    if (sources.length === 0) errors.push({ code: 'missing_scope_provenance', message: `${behavior} has no approved provenance` });
  }
  for (const entry of provenance) {
    if (!isObject(entry) || !PROVENANCE_KINDS.has(entry.kind) || !entry.ref || !entry.behavior_id) {
      errors.push({ code: 'invalid_scope_provenance', message: 'provenance needs kind, ref, and behavior_id' });
    } else if (!required.has(entry.behavior_id)) {
      errors.push({ code: 'provenance_outside_budget', message: `${entry.behavior_id} is not an executable required behavior` });
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      schema_version: POSTURE_SCHEMA_VERSION,
      posture_ref: cloneJson(input.posture_ref),
      scope_provenance: cloneJson(provenance),
      behavior_budget: budget,
    },
  };
}

function deferredCandidate(candidate, reason, posture) {
  return {
    ...cloneJson(candidate),
    behavior_id: String(candidate?.behavior_id ?? ''),
    capability: String(candidate?.capability ?? ''),
    reason,
    evidence: [
      ...asArray(candidate?.evidence),
      { kind: 'posture_ref', posture_hash: posture.posture_hash },
    ],
  };
}

export function partitionBehaviorCandidates(posture, candidates = []) {
  const validation = validateEngineeringPosture(posture);
  if (!validation.valid || posture?.status === 'unknown_legacy') {
    throw new Error('behavior admission requires an authoritative engineering posture');
  }
  const allowed = new Set(asArray(posture.allowed_capabilities));
  const excluded = new Set(asArray(posture.excluded_capabilities));
  const safety = new Set(asArray(posture.safety_floor));
  const admitted = [];
  const deferred = [];

  for (const candidate of asArray(candidates)) {
    const behaviorId = String(candidate?.behavior_id ?? '');
    const capability = String(candidate?.capability ?? '');
    const provenance = asArray(candidate?.provenance);
    const hasProvenance = behaviorId.length > 0
      && provenance.some((entry) => isObject(entry)
        && PROVENANCE_KINDS.has(entry.kind)
        && entry.behavior_id === behaviorId
        && typeof entry.ref === 'string'
        && entry.ref.length > 0);
    if (!hasProvenance) {
      deferred.push(deferredCandidate(candidate, 'missing_provenance', posture));
      continue;
    }

    if (candidate?.source?.kind === 'provider') {
      if (!['ok', 'partial'].includes(candidate.source.status) || !candidate.source.evidence_ref) {
        deferred.push(deferredCandidate(candidate, 'provider_not_structured', posture));
        continue;
      }
      if (candidate.source.persistence !== 'verified') {
        deferred.push(deferredCandidate(candidate, 'provider_not_persisted', posture));
        continue;
      }
    }

    const safetyFloor = safety.has(capability)
      && provenance.some((entry) => entry.kind === 'safety_floor');
    if (safetyFloor || allowed.has(capability)) {
      admitted.push(cloneJson(candidate));
    } else if (excluded.has(capability)) {
      deferred.push(deferredCandidate(candidate, 'excluded_by_posture', posture));
    } else {
      deferred.push(deferredCandidate(candidate, 'not_allowed_by_posture', posture));
    }
  }
  return {
    posture_ref: postureRef(posture),
    admitted_candidates: admitted,
    required: admitted.map((candidate) => candidate.behavior_id),
    deferred_candidates: deferred,
  };
}
