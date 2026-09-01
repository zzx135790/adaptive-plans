import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  approveDesign,
  assessDesignProviderProposals,
  classifyDesignRepresentation,
  createDesignDocument,
  currentDesignRevision,
  designApprovalBrief,
  loadDesign,
  previewDesignLedgerMigration,
  reviseDesign,
  selectDesignProviders,
  triageDesign,
  updateDesignRevision,
  writeDesign,
} from '../scripts/lib/design-engine.mjs';
import { createEngineeringPosture } from '../scripts/lib/engineering-posture.mjs';

test('design triage selects different concern profiles and prevents design work from being direct', () => {
  const api = triageDesign({ public_api: true });
  const migration = triageDesign({ data_model: true, migration: true });
  const rename = triageDesign({ description: 'Rename an internal local variable' });
  assert.equal(api.required, true);
  assert.ok(api.concerns.includes('api'));
  assert.ok(migration.concerns.includes('data'));
  assert.ok(migration.concerns.includes('migration'));
  assert.equal(rename.required, false);
});

test('design provider routing exposes reasons, permissions, and critical gaps', async () => {
  const profile = triageDesign({ data_model: true });
  const registry = { providers: [
    {
      id: 'codebase-analyzer', source: 'skill://codebase-analyzer', availability: 'discovered', capabilities: ['explore'], metadata: {},
    },
    {
      id: 'risk-assessment', source: 'skill://risk-assessment', availability: 'discovered', capabilities: ['scenario'], metadata: {},
    },
  ] };
  const selection = await selectDesignProviders(profile, registry);
  assert.equal(selection.status, 'awaiting_confirmation');
  assert.ok(selection.confirmation_required.includes('codebase-analyzer'));
  assert.ok(selection.selected.every((provider) => provider.reason));
  const blocked = await selectDesignProviders(triageDesign({ data_model: true, migration: true }), { providers: [] });
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.blocking_concerns.includes('data'));
});

test('design profiles and composition contracts expose posture and provider lifecycle', async () => {
  const posture = createEngineeringPosture('experiment', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['measure'],
  });
  const profile = triageDesign({
    data_model: true,
    posture_ref: { kind: posture.kind, posture_hash: posture.posture_hash, source_ref: posture.source.ref },
    behavior_budget: { required: ['measure'], excluded: ['deploy'], deferred_candidates: ['dashboard'] },
    scope_provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'measure' }],
    input_refs: ['map:N-004'],
  });
  const selection = await selectDesignProviders(profile, { providers: [{
    id: 'reviewer',
    source: 'skill://reviewer',
    availability: 'discovered',
    capabilities: ['design'],
    identity: { version_or_digest: 'version:1.2.3' },
    lifecycle: { dependency_readiness: 'ready', invocation: 'not_invoked', persistence: 'not_verified' },
    metadata: {
      design: { roles: ['reviewer'], domains: ['architecture'], concerns: ['data'], mutability: 'read_only' },
      composition: {
        catalog_match: true,
        dependency_refs: ['skill:dependency'],
        expected_outputs: ['review-report'],
        persistence_expectations: 'persist review evidence',
        fallback: 'builtin-review',
      },
    },
  }] }, { catalog: { providers: [] } });
  const contract = selection.selected.find((provider) => provider.id === 'reviewer').composition_contract;
  assert.equal(profile.posture_ref.posture_hash, posture.posture_hash);
  assert.deepEqual(profile.behavior_budget.required, ['measure']);
  assert.equal(contract.version_or_digest, 'version:1.2.3');
  assert.deepEqual(contract.dependency_refs, ['skill:dependency']);
  assert.equal(contract.invocation.dependency_readiness, 'ready');
  assert.equal(contract.persistence.state, 'not_verified');
  assert.deepEqual(contract.expected_outputs, ['review-report']);
  assert.equal(contract.fallback, 'builtin-review');
});

test('provider behavior proposals reuse subtractive posture admission', () => {
  const posture = createEngineeringPosture('experiment', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['measure'],
    excluded_capabilities: ['deploy'],
  });
  const provenance = [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'metric' }];
  const admitted = assessDesignProviderProposals(posture, {
    provider_id: 'reviewer', status: 'ok', raw_ref: 'provider-results/reviewer.json', persistence_state: 'verified',
  }, [{ behavior_id: 'metric', capability: 'measure', provenance }]);
  assert.deepEqual(admitted.required, ['metric']);
  const deferred = assessDesignProviderProposals(posture, {
    provider_id: 'reviewer', status: 'unstructured', raw_ref: null, persistence_state: 'not_verified',
  }, [{ behavior_id: 'metric', capability: 'measure', provenance }]);
  assert.equal(deferred.deferred_candidates[0].reason, 'provider_not_structured');
});

test('high-impact designs require alternatives, exact-hash approval, and preserve stale revisions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-design-'));
  const profile = triageDesign({ public_api: true });
  let document = createDesignDocument({ design_id: 'api-design', profile, provider_selection: { selected: [], blocking_concerns: [] } });
  document = await writeDesign(root, document);
  await assert.rejects(() => writeDesign(root, createDesignDocument({ design_id: 'replacement', profile })), /already exists/i);
  await assert.rejects(
    () => updateDesignRevision(root, { provider_selection: { selected: [] } }, { expectedHash: currentDesignRevision(document).design_hash }),
    /protected fields/i,
  );
  await assert.rejects(() => approveDesign(root, {
    expectedHash: currentDesignRevision(document).design_hash,
    approval: { source: 'user' },
  }), /option/i);
  document = await updateDesignRevision(root, {
    options: [{ id: 'a', summary: 'REST' }, { id: 'b', summary: 'GraphQL' }],
    selected_option: { id: 'a' },
    interfaces: ['GET /items'],
  }, { expectedHash: currentDesignRevision(document).design_hash });
  await assert.rejects(
    () => approveDesign(root, { approval: { source: 'user' } }),
    /expected design hash/i,
  );
  await assert.rejects(() => approveDesign(root, { expectedHash: 'stale', approval: { source: 'user' } }), /changed/i);
  document = await approveDesign(root, {
    expectedHash: currentDesignRevision(document).content_hash,
    approval: { source: 'user', statement: 'approved' },
    waiver: { reason: 'No installed security design reviewer' },
  });
  assert.equal(currentDesignRevision(document).status, 'waived');
  assert.equal(
    currentDesignRevision(document).approval.expected_content_hash,
    currentDesignRevision(document).content_hash,
  );
  document = await reviseDesign(root, { reason: 'API constraint changed', blocking_questions: ['Keep pagination cursor?'] });
  assert.equal(document.current_revision, 2);
  assert.equal(document.revisions[0].status, 'stale');
  assert.equal(currentDesignRevision(document).status, 'in_progress');
  assert.deepEqual(currentDesignRevision(document).options, []);
  assert.deepEqual(currentDesignRevision(document).interfaces, []);
  assert.deepEqual(currentDesignRevision(document).provider_results, []);
});

test('approval preserves reviewed content identity while changing lifecycle state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-design-content-hash-'));
  const profile = triageDesign({ user_requested: true });
  let document = createDesignDocument({
    design_id: 'content-identity',
    profile,
    provider_selection: { selected: [], blocking_concerns: [] },
  });
  document = await writeDesign(root, document);
  document = await updateDesignRevision(root, {
    options: [{ id: 'a' }, { id: 'b' }],
    selected_option: { id: 'a' },
  }, { expectedHash: currentDesignRevision(document).design_hash });
  const before = currentDesignRevision(document);
  const reviewed = before.content_hash;
  const stateBefore = before.state_hash;

  document = await approveDesign(root, {
    expectedHash: reviewed,
    approval: { source: 'user', statement: 'approved in terminal' },
  });
  const after = currentDesignRevision(document);
  assert.equal(after.status, 'approved');
  assert.equal(after.content_hash, reviewed);
  assert.equal(after.design_hash, reviewed);
  assert.notEqual(after.state_hash, stateBefore);
  assert.equal(after.approval.expected_content_hash, reviewed);
});

test('posture-aware approval requires the exact inline brief and posture hash', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-design-posture-approval-'));
  const posture = createEngineeringPosture('experiment', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['measure'],
  });
  const profile = triageDesign({
    public_api: true,
    posture_ref: { kind: posture.kind, posture_hash: posture.posture_hash, source_ref: posture.source.ref },
    behavior_budget: { required: ['measure'], excluded: ['deploy'], deferred_candidates: [] },
    scope_provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'measure' }],
  });
  let document = createDesignDocument({
    design_id: 'posture-approval',
    profile,
    provider_selection: { selected: [], blocking_concerns: [] },
  });
  document = await writeDesign(root, document);
  document = await updateDesignRevision(root, {
    options: [{ id: 'a' }, { id: 'b' }],
    selected_option: { id: 'a', summary: 'Keep the experiment bounded.' },
  }, { expectedHash: currentDesignRevision(document).content_hash });
  const brief = designApprovalBrief(document);
  assert.equal(brief.waiver_request?.required, true);
  await assert.rejects(() => approveDesign(root, {
    expectedHash: brief.exact_content_hash,
    expectedPostureHash: brief.exact_posture_hash,
    briefHash: 'stale',
    approval: { source: 'user' },
  }), /brief changed/i);
  const before = currentDesignRevision(document);
  document = await approveDesign(root, {
    expectedHash: brief.exact_content_hash,
    expectedPostureHash: brief.exact_posture_hash,
    briefHash: brief.brief_hash,
    approval: { source: 'user', statement: 'approved from inline brief' },
    waiver: { reason: 'No installed security reviewer for this bounded experiment.' },
  });
  const after = currentDesignRevision(document);
  assert.equal(after.content_hash, before.content_hash);
  assert.notEqual(after.state_hash, before.state_hash);
  assert.equal(after.approval.expected_posture_hash, posture.posture_hash);
  assert.equal(after.approval.approval_brief_hash, brief.brief_hash);
});

test('approval rejects provider normalization instead of changing reviewed content', async () => {
  const observedRegression = {
    expected_content_hash: 'eed775b98ef522b5c549fc8f5ea9894c5fbad58e616903e2d5a837aee3dcb4de',
    historical_written_hash: '7296ccafed769548304e549cc0a0a70ddb1276d82318dae336e1866753550716',
  };
  assert.notEqual(observedRegression.expected_content_hash, observedRegression.historical_written_hash);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-design-normalization-'));
  const profile = triageDesign({ user_requested: true });
  let document = createDesignDocument({
    design_id: 'normalization-regression',
    profile,
    provider_selection: { status: 'pending', selected: [] },
  });
  document = await writeDesign(root, document);
  document = await updateDesignRevision(root, {
    options: [{ id: 'a' }, { id: 'b' }],
    selected_option: { id: 'a' },
  }, { expectedHash: currentDesignRevision(document).design_hash });
  const reviewed = currentDesignRevision(document).content_hash;

  await assert.rejects(() => approveDesign(root, {
    expectedHash: reviewed,
    approval: { source: 'user' },
  }), /normalization would change reviewed content/i);
  const unchanged = currentDesignRevision(await loadDesign(root));
  assert.equal(unchanged.status, 'in_progress');
  assert.equal(unchanged.content_hash, reviewed);
});

test('v2.0 design migration is preview-only and does not invent v2.1 thread state', () => {
  const legacy = {
    schema_version: '2.0',
    design_id: 'legacy',
    current_revision: 1,
    revisions: [{ revision: 1, scope: 'root', status: 'approved' }],
  };
  assert.deepEqual(classifyDesignRepresentation(legacy), {
    readable: true,
    schema_version: '2.0',
    representation: 'legacy_revisions',
    migration_required: true,
  });
  const preview = previewDesignLedgerMigration(legacy);
  assert.equal(preview.status, 'preview');
  assert.equal(preview.writes, false);
  assert.equal(preview.requires_explicit_apply, true);
  assert.deepEqual(preview.unresolved, ['thread_parents', 'posture_ref']);
  assert.equal(Object.hasOwn(legacy, 'threads'), false);
});
