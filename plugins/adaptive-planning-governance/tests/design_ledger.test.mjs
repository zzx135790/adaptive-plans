import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  addDesignThread,
  approveDesignThread,
  assessDesignThread,
  createDesignLedger,
  convertLegacyDesignToLedger,
  currentThreadRevision,
  designThreadReadiness,
  ledgerApprovalBrief,
  loadDesignLedger,
  recordContractEvidence,
  recordDesignThreadProviderResult,
  reenterDesignThreads,
  reviseDesignThread,
  validateDesignLedger,
  writeDesignLedger,
} from '../scripts/lib/design-ledger.mjs';

const postureRef = {
  kind: 'reusable_internal',
  posture_hash: 'a'.repeat(64),
  source_ref: 'GUIDE.md#posture',
};

test('flat design migration preserves raw history but stales old approval authority', () => {
  const legacy = {
    schema_version: '2.0',
    design_id: 'legacy-design',
    current_revision: 2,
    updated_at: '2026-08-28T00:00:00.000Z',
    revisions: [{
      revision: 1, status: 'stale', design_hash: 'b'.repeat(64), requirements: ['R-1'],
    }, {
      revision: 2, status: 'approved', design_hash: 'c'.repeat(64), requirements: ['R-2'],
      selected_option: { id: 'local' }, approval: { source: 'user', expected_content_hash: 'c'.repeat(64) },
    }],
  };
  assert.throws(() => convertLegacyDesignToLedger(legacy), /PostureRef/);
  const ledger = convertLegacyDesignToLedger(legacy, { postureRef });
  assert.equal(ledger.threads.length, 1);
  assert.equal(ledger.threads[0].thread_id, 'root');
  assert.equal(ledger.threads[0].revisions.length, 2);
  const current = currentThreadRevision(ledger.threads[0]);
  assert.equal(current.decision_status, 'stale');
  assert.equal(current.approval, null);
  assert.deepEqual(current.legacy_approval, legacy.revisions[1].approval);
  assert.deepEqual(current.migration_evidence.raw_revision, legacy.revisions[1]);
  assert.deepEqual(current.contracts, []);
  assert.equal(ledger.migration_evidence.child_threads_created, false);
  assert.equal(validateDesignLedger(ledger, { verifyHashes: true }).valid, true);
  assert.deepEqual(legacy.revisions[1].status, 'approved');
});

test('v2.1 ledger keeps one active thread per subject and hashes every state layer', () => {
  let ledger = createDesignLedger({
    design_id: 'sample',
    posture_ref: postureRef,
    requirements: ['R-ROOT'],
  });
  const rootThreadHash = ledger.threads[0].thread_state_hash;
  assert.equal(validateDesignLedger(ledger, { verifyHashes: true }).valid, true);
  ledger = addDesignThread(ledger, {
    kind: 'module',
    subject_ref: 'module:parser',
    purpose: 'implementation',
    parent_refs: [{ thread_id: 'root' }],
    posture_ref: postureRef,
    requirements: ['R-PARSER'],
  }, { expectedDocumentStateHash: ledger.document_state_hash });
  assert.equal(ledger.threads.length, 2);
  assert.equal(ledger.threads[0].thread_state_hash, rootThreadHash);
  assert.equal(validateDesignLedger(ledger, { verifyHashes: true }).valid, true);
  assert.throws(() => addDesignThread(ledger, {
    kind: 'module',
    subject_ref: 'module:parser',
    purpose: 'implementation',
    posture_ref: postureRef,
  }, { expectedDocumentStateHash: ledger.document_state_hash }), /already exists/i);
});

test('design assessment keeps private choices inline and requires explicit root coverage', () => {
  assert.equal(assessDesignThread({
    subject_ref: 'module:parser',
    triggers: ['helper_choice'],
    contract_preserving: true,
  }).outcome, 'inline');
  assert.equal(assessDesignThread({
    subject_ref: 'module:parser',
    triggers: ['public_api'],
    design_refs: [{ thread_id: 'root', content_hash: 'a'.repeat(64) }],
  }).outcome, 'thread_required');
  assert.equal(assessDesignThread({
    subject_ref: 'module:parser',
    triggers: ['public_api'],
    covered_triggers: ['public_api'],
    coverage_confirmed: true,
    design_refs: [{ thread_id: 'root', content_hash: 'a'.repeat(64) }],
  }).outcome, 'covered_by');
  const invalid = createDesignLedger({
    design_id: 'invalid-assessment',
    posture_ref: postureRef,
    assessments: [{ outcome: 'automatic', design_refs: [], triggers: [], rationale: '' }],
  });
  assert.equal(validateDesignLedger(invalid).errors.some((error) => error.code === 'invalid_design_assessment'), true);
});

test('critical contract evidence blocks and invalidates only exact consumers', () => {
  let ledger = createDesignLedger({
    design_id: 'contracts',
    posture_ref: postureRef,
    contracts: [{
      contract_id: 'parser-output',
      owner_ref: 'module:parser',
      envelope: { output: 'Ast' },
      criticality: 'critical',
      consumer_refs: ['module:renderer:implementation'],
    }],
  });
  ledger = addDesignThread(ledger, {
    thread_id: 'module:renderer:implementation',
    kind: 'module',
    subject_ref: 'module:renderer',
    purpose: 'implementation',
    parent_refs: [{ thread_id: 'root' }],
    posture_ref: postureRef,
  }, { expectedDocumentStateHash: ledger.document_state_hash });
  ledger = addDesignThread(ledger, {
    thread_id: 'module:unrelated:implementation',
    kind: 'module',
    subject_ref: 'module:unrelated',
    purpose: 'implementation',
    parent_refs: [{ thread_id: 'root' }],
    posture_ref: postureRef,
  }, { expectedDocumentStateHash: ledger.document_state_hash });

  assert.equal(designThreadReadiness(ledger, 'module:renderer:implementation').ready, false);
  assert.equal(designThreadReadiness(ledger, 'module:unrelated:implementation').ready, true);
  const originalContentHash = currentThreadRevision(ledger.threads[0]).content_hash;
  const verified = recordContractEvidence(ledger, {
    thread_id: 'root',
    contract_id: 'parser-output',
    verification_status: 'verified',
    evidence_refs: ['test:parser-output'],
  }, {
    expectedDocumentStateHash: ledger.document_state_hash,
    expectedThreadStateHash: ledger.threads[0].thread_state_hash,
  });
  ledger = verified.document;
  assert.equal(verified.impact.classification, 'contract_verified');
  assert.equal(currentThreadRevision(ledger.threads[0]).content_hash, originalContentHash);
  assert.equal(designThreadReadiness(ledger, 'module:renderer:implementation').ready, true);

  const failed = recordContractEvidence(ledger, {
    thread_id: 'root',
    contract_id: 'parser-output',
    verification_status: 'failed',
    evidence_refs: ['test:parser-regression'],
    rationale: 'Parser output no longer satisfies the approved envelope.',
  }, {
    expectedDocumentStateHash: ledger.document_state_hash,
    expectedThreadStateHash: ledger.threads[0].thread_state_hash,
  });
  ledger = failed.document;
  assert.deepEqual(failed.impact.affected_thread_ids, ['module:renderer:implementation']);
  assert.equal(ledger.threads[0].current_revision, 2);
  assert.equal(currentThreadRevision(ledger.threads[1]).decision_status, 'stale');
  assert.notEqual(currentThreadRevision(ledger.threads[2]).decision_status, 'stale');
  assert.equal(validateDesignLedger(ledger, { verifyHashes: true }).valid, true);
});

test('thread re-entry is hash-bound and preserves prior revision content', () => {
  const ledger = createDesignLedger({ design_id: 'reentry', posture_ref: postureRef });
  assert.throws(() => reviseDesignThread(ledger, 'root', {}, {
    expectedDocumentStateHash: ledger.document_state_hash,
    expectedThreadStateHash: 'stale',
  }), /thread changed/i);
  const revised = reviseDesignThread(ledger, 'root', { requirements: ['R-NEW'] }, {
    expectedDocumentStateHash: ledger.document_state_hash,
    expectedThreadStateHash: ledger.threads[0].thread_state_hash,
    reason: 'new contract evidence',
  });
  assert.equal(revised.threads[0].revisions[0].decision_status, 'stale');
  assert.deepEqual(currentThreadRevision(revised.threads[0]).requirements, ['R-NEW']);
});

test('ledger approval briefs bind content and posture while approval changes state only', () => {
  let ledger = createDesignLedger({
    design_id: 'approval',
    posture_ref: postureRef,
    requirements: ['R-APPROVE'],
    selected_option: { id: 'bounded-ledger', summary: 'Use a bounded local ledger.' },
    behavior_budget: { required: ['ledger'], excluded: ['remote-policy'], deferred_candidates: [] },
    failure_modes: ['A stale hash must fail.'],
    provider_status: { status: 'ready', blocking_concerns: [], composition_blockers: [] },
  });
  const brief = ledgerApprovalBrief(ledger, 'root');
  const before = currentThreadRevision(ledger.threads[0]);
  assert.equal(brief.exact_content_hash, before.content_hash);
  assert.equal(brief.exact_posture_hash, postureRef.posture_hash);
  assert.equal(typeof brief.prompt, 'string');
  assert.throws(() => approveDesignThread(ledger, 'root', {
    expectedContentHash: before.content_hash,
    expectedPostureHash: 'b'.repeat(64),
    briefHash: brief.brief_hash,
    approval: { source: 'user' },
  }, {
    expectedDocumentStateHash: ledger.document_state_hash,
    expectedThreadStateHash: ledger.threads[0].thread_state_hash,
  }), /posture changed/i);
  ledger = approveDesignThread(ledger, 'root', {
    expectedContentHash: before.content_hash,
    expectedPostureHash: postureRef.posture_hash,
    briefHash: brief.brief_hash,
    approval: { source: 'user', statement: 'approved from inline brief' },
  }, {
    expectedDocumentStateHash: ledger.document_state_hash,
    expectedThreadStateHash: ledger.threads[0].thread_state_hash,
  });
  const after = currentThreadRevision(ledger.threads[0]);
  assert.equal(after.decision_status, 'approved');
  assert.equal(after.content_hash, before.content_hash);
  assert.notEqual(after.state_hash, before.state_hash);
  assert.equal(after.approval.approval_brief_hash, brief.brief_hash);
});

test('provider evidence clears only explicitly covered unresolved concerns', () => {
  let ledger = createDesignLedger({
    design_id: 'provider-reconciliation',
    posture_ref: postureRef,
    selected_option: { id: 'bounded' },
    provider_status: {
      status: 'blocked',
      blocking_concerns: ['security', 'failure_semantics'],
      composition_blockers: [],
    },
  });

  const record = (result) => {
    const thread = ledger.threads[0];
    const revision = currentThreadRevision(thread);
    ledger = recordDesignThreadProviderResult(ledger, 'root', result, {
      expectedDocumentStateHash: ledger.document_state_hash,
      expectedThreadStateHash: thread.thread_state_hash,
      expectedContentHash: revision.content_hash,
    });
    return currentThreadRevision(ledger.threads[0]);
  };

  let revision = record({
    schema_version: '2.0',
    provider_id: 'failed-security-review',
    capability: 'design',
    status: 'error',
    covered_concerns: ['security'],
  });
  assert.deepEqual(revision.provider_status.blocking_concerns, ['security', 'failure_semantics']);
  assert.equal(revision.provider_status.status, 'blocked');

  revision = record({
    schema_version: '2.0',
    provider_id: 'security-review',
    capability: 'design',
    status: 'partial',
    covered_concerns: ['security'],
  });
  assert.deepEqual(revision.provider_status.blocking_concerns, ['failure_semantics']);
  assert.equal(revision.provider_status.status, 'blocked');

  let brief = ledgerApprovalBrief(ledger, 'root');
  assert.throws(() => approveDesignThread(ledger, 'root', {
    expectedContentHash: revision.content_hash,
    expectedPostureHash: postureRef.posture_hash,
    briefHash: brief.brief_hash,
    approval: { source: 'user', statement: 'approve without a waiver' },
  }, {
    expectedDocumentStateHash: ledger.document_state_hash,
    expectedThreadStateHash: ledger.threads[0].thread_state_hash,
  }), /requires an explicit waiver/i);

  revision = record({
    schema_version: '2.0',
    provider_id: 'failure-review',
    capability: 'design',
    status: 'ok',
    extensions: { covered_concerns: ['failure_semantics'] },
  });
  assert.deepEqual(revision.provider_status.blocking_concerns, []);
  assert.equal(revision.provider_status.status, 'ready');
  brief = ledgerApprovalBrief(ledger, 'root');
  ledger = approveDesignThread(ledger, 'root', {
    expectedContentHash: revision.content_hash,
    expectedPostureHash: postureRef.posture_hash,
    briefHash: brief.brief_hash,
    approval: { source: 'user', statement: 'approve reconciled evidence' },
  }, {
    expectedDocumentStateHash: ledger.document_state_hash,
    expectedThreadStateHash: ledger.threads[0].thread_state_hash,
  });
  assert.equal(currentThreadRevision(ledger.threads[0]).decision_status, 'approved');

  let compositionBlocked = createDesignLedger({
    design_id: 'composition-blocked',
    posture_ref: postureRef,
    selected_option: { id: 'bounded' },
    provider_status: {
      status: 'blocked',
      blocking_concerns: ['security'],
      composition_blockers: ['security-provider'],
    },
  });
  const compositionThread = compositionBlocked.threads[0];
  compositionBlocked = recordDesignThreadProviderResult(compositionBlocked, 'root', {
    schema_version: '2.0',
    provider_id: 'independent-security-review',
    capability: 'design',
    status: 'ok',
    covered_concerns: ['security'],
  }, {
    expectedDocumentStateHash: compositionBlocked.document_state_hash,
    expectedThreadStateHash: compositionThread.thread_state_hash,
    expectedContentHash: currentThreadRevision(compositionThread).content_hash,
  });
  const compositionRevision = currentThreadRevision(compositionBlocked.threads[0]);
  assert.deepEqual(compositionRevision.provider_status.blocking_concerns, []);
  assert.deepEqual(compositionRevision.provider_status.composition_blockers, ['security-provider']);
  assert.equal(compositionRevision.provider_status.status, 'blocked');

  const staleStatus = createDesignLedger({
    design_id: 'stale-provider-status',
    posture_ref: postureRef,
    selected_option: { id: 'bounded' },
    provider_status: { status: 'blocked', blocking_concerns: [], composition_blockers: [] },
  });
  const staleStatusRevision = currentThreadRevision(staleStatus.threads[0]);
  const staleStatusBrief = ledgerApprovalBrief(staleStatus, 'root');
  const approvedStaleStatus = approveDesignThread(staleStatus, 'root', {
    expectedContentHash: staleStatusRevision.content_hash,
    expectedPostureHash: postureRef.posture_hash,
    briefHash: staleStatusBrief.brief_hash,
    approval: { source: 'user', statement: 'approve without unresolved blockers' },
  }, {
    expectedDocumentStateHash: staleStatus.document_state_hash,
    expectedThreadStateHash: staleStatus.threads[0].thread_state_hash,
  });
  assert.equal(currentThreadRevision(approvedStaleStatus.threads[0]).decision_status, 'approved');
});

test('posture re-entry creates successors and impact evidence only for exact threads', () => {
  let ledger = createDesignLedger({
    design_id: 'posture-reentry',
    posture_ref: postureRef,
    selected_option: { id: 'root' },
  });
  ledger = addDesignThread(ledger, {
    thread_id: 'module:stable:implementation',
    kind: 'module',
    subject_ref: 'module:stable',
    posture_ref: postureRef,
    selected_option: { id: 'stable' },
  }, { expectedDocumentStateHash: ledger.document_state_hash });
  const stableHash = ledger.threads[1].thread_state_hash;
  const nextPosture = { ...postureRef, kind: 'production', posture_hash: 'b'.repeat(64) };
  const reentered = reenterDesignThreads(ledger, {
    classification: 'posture_changed',
    source_ref: 'decision:PROMOTE-1',
    affected_thread_ids: ['root'],
    affected_contract_ids: [],
    evidence_refs: ['approval:PROMOTE-1'],
    posture_ref: nextPosture,
    rationale: 'The user approved promotion of the root contract.',
  }, {
    expectedDocumentStateHash: ledger.document_state_hash,
    expectedThreadStateHashes: { root: ledger.threads[0].thread_state_hash },
  });
  assert.deepEqual(reentered.impact.affected_thread_ids, ['root']);
  assert.equal(reentered.document.threads[0].current_revision, 2);
  assert.equal(currentThreadRevision(reentered.document.threads[0]).posture_ref.posture_hash, nextPosture.posture_hash);
  assert.equal(reentered.document.threads[1].thread_state_hash, stableHash);
  assert.equal(validateDesignLedger(reentered.document, { verifyHashes: true }).valid, true);
});

test('ledger writes are optimistic and never silently replace legacy design documents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-ledger-'));
  let ledger = createDesignLedger({ design_id: 'sample', posture_ref: postureRef });
  ledger = await writeDesignLedger(root, ledger);
  assert.deepEqual(await loadDesignLedger(root), ledger);
  await assert.rejects(() => writeDesignLedger(root, ledger), /expected document state hash/i);
  await assert.rejects(
    () => writeDesignLedger(root, ledger, { expectedDocumentStateHash: 'stale' }),
    /changed/i,
  );
  const updated = addDesignThread(ledger, {
    kind: 'task',
    subject_ref: 'N-001',
    posture_ref: postureRef,
  }, { expectedDocumentStateHash: ledger.document_state_hash });
  const written = await writeDesignLedger(root, updated, {
    expectedDocumentStateHash: ledger.document_state_hash,
  });
  assert.equal(written.threads.length, 2);
  assert.match(await fs.readFile(path.join(root, 'DESIGN.md'), 'utf8'), /Design Threads/);
  assert.match(await fs.readFile(path.join(root, 'designs', 'root.md'), 'utf8'), /Root Design/);
  assert.match(await fs.readFile(path.join(root, 'designs', 'tasks', 'n-001.md'), 'utf8'), /Task Design/);

  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-ledger-legacy-'));
  await fs.writeFile(path.join(legacyRoot, 'design.json'), JSON.stringify({
    schema_version: '2.0', design_id: 'legacy', current_revision: 1, revisions: [],
  }));
  await assert.rejects(() => writeDesignLedger(
    legacyRoot,
    createDesignLedger({ design_id: 'new', posture_ref: postureRef }),
  ), /explicit migration/i);
});
