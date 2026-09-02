import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  approveDesign,
  createDesignDocument,
  currentDesignRevision,
  designApprovalBrief,
  triageDesign,
  updateDesignRevision,
  writeDesign,
} from '../scripts/lib/design-engine.mjs';
import { createEngineeringPosture, postureRef } from '../scripts/lib/engineering-posture.mjs';
import {
  createCompactExecutionHandoff,
  createExecutionCheckpoint,
  createLeafPlanningHandoff,
  validateExecutionCheckpoint,
} from '../scripts/lib/execution-protocol.mjs';
import { verifyProviderWorkflowOutcome } from '../scripts/lib/provider-composition.mjs';
import {
  buildHandoff,
  validateMap,
  validatePlanCompletion,
  writeMap,
} from '../scripts/lib/plan-protocol.mjs';
import { applyPosturePromotion, previewPosturePromotion } from '../scripts/lib/posture-operations.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repositoryRoot, 'tests', 'fixtures', 'posture');
const profileNames = ['spike', 'experiment', 'reusable-internal', 'production'];

async function readProfile(name) {
  return JSON.parse(await fs.readFile(path.join(fixtureRoot, name, 'map.json'), 'utf8'));
}

function compositionContract(input = {}) {
  return {
    capability: 'design',
    provider_id: input.provider_id ?? 'grill-with-docs',
    source_ref: input.source_ref ?? 'skill://grill-with-docs',
    version_or_digest: input.version_or_digest ?? 'digest:v1',
    dependency_refs: input.dependency_refs ?? [],
    input_refs: ['map:N-001'],
    posture_ref: null,
    mutability: input.mutability ?? 'read_only',
    invocation: {
      policy: input.policy ?? 'automatic',
      state: 'completed',
      dependency_readiness: input.dependency_readiness ?? 'ready',
    },
    persistence: {
      expectations: input.persistence_expectations ?? 'return structured design evidence',
      state: input.persistence_state ?? 'not_verified',
    },
    expected_outputs: input.expected_outputs ?? ['design-review'],
    verification: { status: 'pending', evidence_refs: [] },
    fallback: input.fallback ?? 'builtin-design-driver',
  };
}

function providerReceipt(contract, input = {}) {
  const artifacts = input.artifacts ?? [];
  return {
    provider_id: contract.provider_id,
    invocation_state: input.invocation_state ?? 'completed',
    persistence_state: input.persistence_state ?? 'conversation_only',
    expected_version_or_digest: input.expected_version_or_digest ?? contract.version_or_digest,
    composition_contract: contract,
    handoff: buildHandoff({
      source: contract.provider_id,
      mode: 'plan',
      artifacts,
      composition_contracts: [contract],
    }),
    expected_artifact_refs: input.expected_artifact_refs ?? [],
    observed_artifact_refs: input.observed_artifact_refs ?? [],
  };
}

test('all four posture profiles have distinct definitions of done and complete independently', async () => {
  const requiredEvidence = new Map();
  for (const name of profileNames) {
    const map = await readProfile(name);
    const validation = validateMap(map, { strict: true });
    assert.equal(validation.valid, true, `${name}: ${JSON.stringify(validation.errors)}`);
    const completion = validatePlanCompletion(map);
    assert.equal(completion.valid, true, `${name}: ${JSON.stringify(completion.errors)}`);
    requiredEvidence.set(name, [...map.engineering_posture.required_evidence].sort());
  }

  assert.equal(new Set([...requiredEvidence.values()].map((value) => JSON.stringify(value))).size, 4);
  for (const name of ['spike', 'experiment', 'reusable-internal']) {
    assert.equal(requiredEvidence.get(name).includes('operational_ownership'), false);
    assert.equal(requiredEvidence.get(name).includes('security_assessment'), false);
  }
});

test('completion reports missing evidence, stale posture refs, and executable deferred behavior stably', async () => {
  const missingEvidence = await readProfile('experiment');
  missingEvidence.posture_evidence = missingEvidence.posture_evidence.filter((id) => id !== 'measurement_validity');
  const first = validatePlanCompletion(missingEvidence);
  const second = validatePlanCompletion(missingEvidence);
  assert.deepEqual(second, first);
  assert.ok(first.errors.some((error) => error.code === 'missing_posture_evidence' && error.evidence_id === 'measurement_validity'));

  const staleRef = await readProfile('reusable-internal');
  staleRef.nodes[0].posture_ref.posture_hash = '0'.repeat(64);
  assert.ok(validatePlanCompletion(staleRef).errors.some((error) => error.code === 'node_stale_posture_ref'));

  const deferred = await readProfile('spike');
  deferred.nodes[0].behavior_budget.required.push('general-api');
  assert.ok(validatePlanCompletion(deferred).errors.some((error) => error.code === 'node_deferred_behavior_executable'));
});

test('explicit posture promotion is hash-bound, reopens gates, and writes audit evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-integration-promotion-'));
  await fs.mkdir(path.join(root, 'nodes'), { recursive: true });
  const source = await readProfile('experiment');
  await writeMap(root, source, { preserveUpdatedAt: true });
  await fs.writeFile(path.join(root, 'events.jsonl'), '', 'utf8');

  const proposal = previewPosturePromotion(source, {
    kind: 'reusable_internal',
    source: { kind: 'explicit_assessment', ref: 'decision://integration-promotion' },
    allowed_capabilities: ['local-contract'],
    excluded_capabilities: ['deployment-automation'],
    evidence: ['stable_local_contract', 'compatibility_evidence', 'integration_tests'],
  });
  assert.equal(proposal.writes, false);
  await assert.rejects(() => applyPosturePromotion(root, proposal, {
    expectedProposalHash: proposal.proposal_hash,
    expectedBasePostureHash: proposal.base_posture_hash,
    briefHash: '0'.repeat(64),
    approval: 'approve',
  }), /brief hash/i);

  const applied = await applyPosturePromotion(root, proposal, {
    expectedProposalHash: proposal.proposal_hash,
    expectedBasePostureHash: proposal.base_posture_hash,
    briefHash: proposal.approval_brief.brief_hash,
    approval: 'Promote this exact experiment to reusable internal work.',
  });
  assert.equal(applied.map.engineering_posture.kind, 'reusable_internal');
  assert.equal(applied.map.nodes[0].revalidation_required, true);
  assert.equal(applied.map.gates.design.status, 'stale');
  assert.equal(applied.map.gates.architecture_sync.status, 'pending');
  const events = (await fs.readFile(path.join(root, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(events.some((event) => event.type === 'posture_promotion_applied'
    && event.proposal_hash === proposal.proposal_hash
    && event.approval_brief_hash === proposal.approval_brief.brief_hash));
});

test('compact recovery preserves scope but forces approval regeneration and stops on drift', async () => {
  const map = await readProfile('experiment');
  map.status = 'executing';
  map.stage = 'executing';
  map.nodes[0].status = 'ready';
  const leaf = createLeafPlanningHandoff(map, 'N-001', { plan_ref: 'fixtures/experiment' });
  const checkpoint = createExecutionCheckpoint(leaf, { leaf_plan_ref: 'experiment-leaf.md', task_id: 'T-001' });
  const compact = createCompactExecutionHandoff(checkpoint, {
    pending_approval: {
      subject: { design_id: 'experiment-design' },
      exact_content_hash: 'a'.repeat(64),
      exact_posture_hash: map.engineering_posture.posture_hash,
      brief_hash: 'must-not-cross-compact',
    },
  });
  assert.deepEqual(compact.behavior_budget, map.nodes[0].behavior_budget);
  assert.equal(compact.pending_approval.requires_regeneration, true);
  assert.equal(Object.hasOwn(compact.pending_approval, 'brief_hash'), false);
  assert.equal(validateExecutionCheckpoint(map, compact).valid, true);

  const drifted = structuredClone(map);
  drifted.engineering_posture = createEngineeringPosture('experiment', {
    source: { kind: 'explicit_assessment', ref: 'decision://changed-experiment' },
    allowed_capabilities: ['measurement'],
  });
  const recovery = validateExecutionCheckpoint(drifted, compact);
  assert.equal(recovery.action, 'stop_and_recover');
  assert.ok(recovery.stale_fields.includes('posture_ref'));
  assert.match(recovery.recovery_action, /regenerate.*leaf handoff.*checkpoint/i);
});

test('the terminal approval brief is sufficient to approve the exact design revision', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-integration-inline-approval-'));
  const posture = createEngineeringPosture('experiment', {
    source: { kind: 'explicit_assessment', ref: 'decision://inline-approval' },
    allowed_capabilities: ['measurement'],
  });
  const profile = triageDesign({
    user_requested: true,
    posture_ref: postureRef(posture),
    behavior_budget: { required: ['measure'], excluded: ['deploy'], deferred_candidates: [] },
    scope_provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'measure' }],
  });
  let document = await writeDesign(root, createDesignDocument({
    design_id: 'inline-design',
    profile,
    provider_selection: { selected: [], blocking_concerns: [] },
    requirements: ['Choose the bounded measurement interface.'],
  }));
  document = await updateDesignRevision(root, {
    options: [{ id: 'bounded', summary: 'Keep the measurement interface local.' }],
    selected_option: { id: 'bounded', summary: 'Keep the measurement interface local.' },
  }, { expectedHash: currentDesignRevision(document).content_hash });
  const brief = designApprovalBrief(document);
  assert.match(brief.prompt, /Approve inline-design revision 1/);
  assert.deepEqual(brief.included_scope, ['measure']);
  assert.deepEqual(brief.excluded_scope, ['deploy']);
  const approved = await approveDesign(root, {
    expectedHash: brief.exact_content_hash,
    expectedPostureHash: brief.exact_posture_hash,
    briefHash: brief.brief_hash,
    approval: { source: 'terminal', statement: 'Approved from the inline summary.' },
  });
  assert.equal(currentDesignRevision(approved).status, 'approved');
});

test('provider composition distinguishes reuse, adapters, dependencies, drift, failures, and missing writes', () => {
  const directContract = compositionContract();
  const direct = verifyProviderWorkflowOutcome(providerReceipt(directContract));
  assert.equal(direct.outcome, 'conversation_only');
  assert.deepEqual(direct.reasons, []);

  const adapterContract = compositionContract({
    provider_id: 'writing-plans-adapter',
    source_ref: 'adapter://writing-plans',
    mutability: 'artifact_write',
    policy: 'requires_confirmation',
    persistence_state: 'verified',
    persistence_expectations: 'write one linked Superpowers leaf plan',
    expected_outputs: ['writing-plan'],
  });
  const artifact = { path: 'docs/superpowers/plans/leaf.md' };
  const adapterReceipt = providerReceipt(adapterContract, {
    persistence_state: 'verified',
    artifacts: [artifact],
    expected_artifact_refs: [artifact.path],
    observed_artifact_refs: [artifact.path],
  });
  assert.equal(verifyProviderWorkflowOutcome(adapterReceipt).outcome, 'persisted');

  const dependency = verifyProviderWorkflowOutcome(providerReceipt({
    ...adapterContract,
    dependency_refs: ['skill://writing-plans'],
    invocation: { ...adapterContract.invocation, dependency_readiness: 'missing' },
  }, { ...adapterReceipt, composition_contract: undefined }));
  assert.ok(dependency.reasons.includes('dependency_not_ready'));

  const drift = verifyProviderWorkflowOutcome({
    ...adapterReceipt,
    expected_version_or_digest: 'digest:v2',
  });
  assert.ok(drift.reasons.includes('version_digest_drift'));

  const failed = verifyProviderWorkflowOutcome({ ...adapterReceipt, invocation_state: 'failed' });
  assert.ok(failed.reasons.includes('invocation_not_completed'));

  const missingWrite = verifyProviderWorkflowOutcome({ ...adapterReceipt, observed_artifact_refs: [] });
  assert.equal(missingWrite.outcome, 'unverified_persistence');
  assert.deepEqual(missingWrite.missing_artifact_refs, [artifact.path]);
  assert.ok(missingWrite.reasons.includes('expected_artifact_not_observed'));
});
