import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngineeringPosture, postureRef } from '../scripts/lib/engineering-posture.mjs';
import { assessEngineeringPosture, checkPostureMap } from '../scripts/lib/posture-operations.mjs';
import { applyPosturePromotion, previewPosturePromotion } from '../scripts/lib/posture-operations.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlanManifest, writeMap } from '../scripts/lib/plan-protocol.mjs';

const source = { kind: 'approved_guide', ref: 'GUIDE.md#posture' };

function mapWith(node = {}) {
  const posture = createEngineeringPosture('experiment', {
    source,
    allowed_capabilities: ['measurement'],
    excluded_capabilities: ['deployment'],
  });
  return {
    schema_version: '2.0',
    engineering_posture: posture,
    gates: { design: { status: 'not_required' } },
    nodes: [{
      id: 'N-001', title: 'Measure', status: 'ready', depends_on: [],
      posture_ref: postureRef(posture),
      scope_provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'run-measurement' }],
      behavior_budget: { required: ['run-measurement'], excluded: ['deploy-service'], deferred_candidates: [] },
      deferred_candidates: [],
      ...node,
    }],
  };
}

test('posture assessment is pure and reports evidence gaps', () => {
  const input = {
    kind: 'experiment',
    source,
    allowed_capabilities: ['measurement'],
    excluded_capabilities: ['deployment'],
    evidence: ['hypothesis'],
  };
  const before = structuredClone(input);
  const result = assessEngineeringPosture(input);
  assert.deepEqual(input, before);
  assert.equal(result.candidate_posture.kind, 'experiment');
  assert.equal(result.posture_ref.posture_hash, result.candidate_posture.posture_hash);
  assert.deepEqual(result.evidence_gaps, ['measurement_validity', 'reproduction_instructions']);
  assert.equal(result.ready_for_adoption, false);
  assert.equal(result.writes, false);
});

test('posture check reports stable scope and stale ref errors without mutation', () => {
  const map = mapWith({
    posture_ref: { kind: 'experiment', posture_hash: '0'.repeat(64), source_ref: source.ref },
    scope_provenance: [],
    behavior_budget: {
      required: ['run-measurement', 'deferred-work'],
      excluded: ['run-measurement'],
      deferred_candidates: ['deferred-work'],
    },
  });
  const before = structuredClone(map);
  const result = checkPostureMap(map);
  assert.deepEqual(map, before);
  assert.equal(result.valid, false);
  for (const code of ['stale_posture_ref', 'required_behavior_excluded', 'deferred_behavior_executable', 'missing_scope_provenance']) {
    assert.ok(result.errors.some((error) => error.code === code), code);
  }
  assert.equal(result.writes, false);
});

test('posture check uses explicit capability-bearing candidates for ceiling checks', () => {
  const result = checkPostureMap(mapWith(), {
    behaviorCandidates: [
      { node_id: 'N-001', behavior_id: 'deploy-service', capability: 'deployment' },
      { node_id: 'N-001', behavior_id: 'mystery-only' },
    ],
  });
  assert.ok(result.errors.some((error) => error.code === 'capability_excluded_by_posture'));
  assert.equal(result.errors.some((error) => error.behavior_id === 'mystery-only'), false);
});

test('posture check reports stale design refs and explicit provider blockers', () => {
  const map = mapWith({
    design_required: true,
    design_refs: [{ design_id: 'module', revision: 1, design_hash: 'a'.repeat(64), status: 'approved' }],
  });
  const designDocument = {
    design_id: 'module',
    current_revision: 1,
    revisions: [{
      revision: 1,
      status: 'in_progress',
      design_hash: 'b'.repeat(64),
      provider_selection: {
        blocking_concerns: ['security'],
        composition_blockers: ['reviewer'],
        selected: [],
      },
    }],
  };
  const result = checkPostureMap(map, { designDocument });
  for (const code of ['stale_design_ref', 'stale_design_status', 'critical_provider_coverage_gap', 'provider_composition_blocked']) {
    assert.ok(result.errors.some((error) => error.code === code), code);
  }
});

test('promotion preview is pure, explicit, hash-bound, and capability-aware', () => {
  const map = mapWith();
  const before = structuredClone(map);
  const proposal = previewPosturePromotion(map, {
    kind: 'reusable_internal',
    source: { kind: 'explicit_assessment', ref: 'decision://promote' },
    allowed_capabilities: ['local-contract'],
    excluded_capabilities: ['deployment'],
    evidence: ['stable_local_contract'],
    behavior_candidates: [{ node_id: 'N-001', behavior_id: 'deploy', capability: 'deployment' }],
  });
  assert.deepEqual(map, before);
  assert.equal(proposal.source_posture_ref.kind, 'experiment');
  assert.equal(proposal.target_posture_ref.kind, 'reusable_internal');
  assert.deepEqual(proposal.affected_node_ids, ['N-001']);
  assert.equal(proposal.behavior_conflicts[0].code, 'capability_excluded_by_posture');
  assert.equal(proposal.approval_brief.exact_hash, proposal.proposal_hash);
  assert.equal(proposal.writes, false);
  assert.throws(() => previewPosturePromotion(map, { reuse_expected: true }), /kind must be explicit/i);
});

test('promotion apply requires exact approval hashes and re-enters gates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-posture-promotion-'));
  const map = await createPlanManifest(root, { planId: 'promotion', title: 'Promotion', goal: 'Change posture' });
  const sourcePosture = createEngineeringPosture('experiment', {
    source,
    allowed_capabilities: ['measurement'],
    excluded_capabilities: ['deployment'],
  });
  map.engineering_posture = sourcePosture;
  map.gates.intent = { status: 'approved' };
  map.gates.design = { status: 'approved' };
  map.nodes = [{
    id: 'N-001', title: 'Measured', status: 'done', depends_on: [],
    posture_ref: postureRef(sourcePosture),
    scope_provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'measure' }],
    behavior_budget: { required: ['measure'], excluded: ['deploy'], deferred_candidates: [] },
    deferred_candidates: [],
  }, {
    id: 'N-002', title: 'Reuse', status: 'ready', depends_on: ['N-001'],
    posture_ref: postureRef(sourcePosture),
    scope_provenance: [{ kind: 'requirement', ref: 'R-REUSE', behavior_id: 'reuse' }],
    behavior_budget: { required: ['reuse'], excluded: ['deploy'], deferred_candidates: [] },
    deferred_candidates: [],
  }];
  await writeMap(root, map);
  const current = JSON.parse(await fs.readFile(path.join(root, 'map.json'), 'utf8'));
  const proposal = previewPosturePromotion(current, {
    kind: 'reusable_internal',
    source: { kind: 'explicit_assessment', ref: 'decision://promote' },
    allowed_capabilities: ['local-contract'],
    excluded_capabilities: ['deployment'],
    evidence: ['stable_local_contract', 'compatibility_evidence', 'integration_tests'],
  });
  await assert.rejects(() => applyPosturePromotion(root, proposal, {
    expectedProposalHash: proposal.proposal_hash,
    expectedBasePostureHash: proposal.base_posture_hash,
    briefHash: '0'.repeat(64),
    approval: 'approve',
  }), /brief hash/i);
  const result = await applyPosturePromotion(root, proposal, {
    expectedProposalHash: proposal.proposal_hash,
    expectedBasePostureHash: proposal.base_posture_hash,
    briefHash: proposal.approval_brief.brief_hash,
    approval: 'Approve explicit internal reuse posture',
  });
  assert.equal(result.writes, true);
  assert.equal(result.map.engineering_posture.kind, 'reusable_internal');
  assert.equal(result.map.nodes[0].revalidation_required, true);
  assert.equal(result.map.nodes[1].status, 'stale');
  assert.equal(result.map.gates.design.status, 'stale');
  assert.equal(result.map.gates.architecture_sync.status, 'pending');
  assert.equal(result.map.stage, 'designing');
});
