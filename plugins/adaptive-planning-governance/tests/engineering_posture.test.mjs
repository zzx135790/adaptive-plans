import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MANDATORY_SAFETY_FLOOR,
  createEngineeringPosture,
  normalizeEngineeringPosture,
  partitionBehaviorCandidates,
  postureContentHash,
  postureRef,
  validateEngineeringPosture,
  validatePostureRef,
  validateScopeControl,
} from '../scripts/lib/engineering-posture.mjs';

const source = { kind: 'approved_guide', ref: 'GUIDE.md#constraints' };

test('posture profiles are distinct definitions of done rather than an ordered ladder', () => {
  const profiles = ['spike', 'experiment', 'reusable_internal', 'production']
    .map((kind) => createEngineeringPosture(kind, { source }));
  assert.deepEqual(profiles.map((item) => item.kind), ['spike', 'experiment', 'reusable_internal', 'production']);
  assert.equal(new Set(profiles.map((item) => item.posture_hash)).size, 4);
  assert.ok(profiles.every((item) => validateEngineeringPosture(item).valid));
  assert.ok(profiles.find((item) => item.kind === 'experiment').required_evidence.includes('measurement_validity'));
  assert.ok(profiles.find((item) => item.kind === 'reusable_internal').required_evidence.includes('stable_local_contract'));
  assert.ok(profiles.every((item) => MANDATORY_SAFETY_FLOOR.every((floor) => item.safety_floor.includes(floor))));
});

test('canonical posture hashing ignores set order and rejects stale references', () => {
  const first = createEngineeringPosture('experiment', {
    source,
    allowed_capabilities: ['local-report', 'reproducible-run'],
    excluded_capabilities: ['deployment', 'telemetry'],
  });
  const reordered = createEngineeringPosture('experiment', {
    source,
    allowed_capabilities: ['reproducible-run', 'local-report'],
    excluded_capabilities: ['telemetry', 'deployment'],
    safety_floor: [...MANDATORY_SAFETY_FLOOR].reverse(),
  });
  assert.equal(first.posture_hash, reordered.posture_hash);
  assert.equal(postureContentHash(first), first.posture_hash);
  assert.equal(validatePostureRef(postureRef(first), reordered).valid, true);

  const changed = createEngineeringPosture('experiment', {
    source,
    allowed_capabilities: ['local-report', 'reproducible-run', 'shared-api'],
    excluded_capabilities: ['deployment', 'telemetry'],
  });
  const stale = validatePostureRef(postureRef(first), changed);
  assert.equal(stale.valid, false);
  assert.ok(stale.errors.some((error) => error.code === 'stale_posture_ref'));
});

test('legacy posture remains unknown until explicit assessment', () => {
  const legacy = normalizeEngineeringPosture({ schema_version: '2.0' }, { legacyRef: 'map.json@2.0' });
  assert.deepEqual(legacy, {
    schema_version: '2.1',
    status: 'unknown_legacy',
    kind: null,
    posture_hash: null,
    source: { kind: 'legacy_artifact', ref: 'map.json@2.0' },
  });
  assert.throws(() => postureRef(legacy), /cannot produce/i);
  const invented = { ...legacy, kind: 'production' };
  assert.ok(validateEngineeringPosture(invented).errors.some((error) => error.code === 'invented_legacy_posture'));
});

test('explicit assessment preserves the v2.0 required_capabilities alias', () => {
  const assessed = createEngineeringPosture('reusable_internal', {
    source,
    required_capabilities: ['local-contracts', 'integration-tests'],
  });
  assert.deepEqual(assessed.allowed_capabilities, ['integration-tests', 'local-contracts']);
});

test('scope control rejects missing provenance and deferred executable work', () => {
  const posture = createEngineeringPosture('spike', {
    source,
    allowed_capabilities: ['one-run-script'],
    excluded_capabilities: ['public-api'],
  });
  const valid = validateScopeControl({
    posture_ref: postureRef(posture),
    scope_provenance: [
      { kind: 'requirement', ref: 'R-QUESTION', behavior_id: 'one-run-script' },
    ],
    behavior_budget: {
      required: ['one-run-script'],
      excluded: ['public-api'],
      deferred_candidates: ['retry-framework'],
    },
  }, posture);
  assert.equal(valid.valid, true);

  const invalid = validateScopeControl({
    posture_ref: postureRef(posture),
    scope_provenance: [],
    behavior_budget: {
      required: ['one-run-script', 'retry-framework'],
      excluded: ['public-api'],
      deferred_candidates: ['retry-framework'],
    },
  }, posture);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.code === 'missing_scope_provenance'));
  assert.ok(invalid.errors.some((error) => error.code === 'deferred_behavior_executable'));
});

test('mandatory safety candidates need a complete safety case without bypassing scope', () => {
  const posture = createEngineeringPosture('spike', {
    source,
    allowed_capabilities: ['probe'],
  });
  const provenance = [{
    kind: 'safety_floor',
    ref: 'mandatory:resource-cost',
    behavior_id: 'cost-bound',
  }];
  const candidate = {
    behavior_id: 'cost-bound',
    capability: 'bound_runaway_resource_cost',
    provenance,
  };
  const missing = partitionBehaviorCandidates(posture, [candidate]);
  assert.deepEqual(missing.required, []);
  assert.equal(missing.deferred_candidates[0].reason, 'missing_safety_case');

  const safetyCase = {
    threat: 'An unbounded probe can exhaust shared compute capacity',
    evidence: ['The probe accepts an unconstrained iteration count'],
    impact: 'Other workloads can be starved',
    smaller_control: 'Cap this probe at the approved iteration count',
    verification: ['Run the boundary test and observe termination at the cap'],
    reversibility: 'Remove the local cap with the probe code',
    cost: 'One boundary check in the probe loop',
  };
  const admitted = partitionBehaviorCandidates(posture, [{ ...candidate, safety_case: safetyCase }]);
  assert.deepEqual(admitted.required, ['cost-bound']);
  assert.equal(admitted.deferred_candidates.length, 0);

  const emptyEvidence = partitionBehaviorCandidates(posture, [{
    ...candidate,
    safety_case: { ...safetyCase, evidence: [''] },
  }]);
  assert.deepEqual(emptyEvidence.required, []);
  assert.equal(emptyEvidence.deferred_candidates[0].reason, 'missing_safety_case');

  const unscoped = partitionBehaviorCandidates(posture, [{ ...candidate, provenance: [], safety_case: safetyCase }]);
  assert.deepEqual(unscoped.required, []);
  assert.equal(unscoped.deferred_candidates[0].reason, 'missing_provenance');
});
