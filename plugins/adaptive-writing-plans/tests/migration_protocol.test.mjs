import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { applyPlanMigration, previewPlanMigration, recoverPlanMigration } from '../scripts/lib/migration-protocol.mjs';
import { createEngineeringPosture, postureRef } from '../scripts/lib/engineering-posture.mjs';
import { createPlanManifest, writeMap } from '../scripts/lib/plan-protocol.mjs';

async function legacyFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-migration-'));
  const files = {
    'map.json': `${JSON.stringify({
      schema_version: '1.0', plan_id: 'legacy', title: 'Legacy', mode: 'map', current_node: null,
      artifacts: [{ path: '../leaf.md' }],
      nodes: [{ id: 'N-001', title: 'Legacy node', status: 'ready', depends_on: [], inputs: ['x'], outputs: ['y'], acceptance: ['z'], blocking_questions: [] }],
    }, null, 2)}\n`,
    'MAP.md': '# Hand edited legacy map\n',
    'nodes/N-001.md': '# Hand edited node\n',
    'decisions/D-001.md': '# Keep this decision byte-for-byte\n',
    'provider-results/review.json': '{"status":"partial"}\n',
    'events.jsonl': '{"event_id":"legacy","type":"fact"}\n',
  };
  for (const [relative, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), content);
  }
  return { root, files };
}

test('migration preview is pure and preserves a complete plan artifact manifest', async () => {
  const { root, files } = await legacyFixture();
  const before = await fs.readFile(path.join(root, 'map.json'), 'utf8');
  const proposal = await previewPlanMigration(root);
  assert.equal(proposal.status, 'preview');
  assert.equal(proposal.writes, false);
  assert.equal(proposal.target_map.schema_version, '2.0');
  assert.equal(proposal.target_map.engineering_posture.status, 'unknown_legacy');
  assert.equal(proposal.preservation_manifest.length, Object.keys(files).length);
  assert.ok(proposal.changed_paths.includes('map.json'));
  assert.equal(await fs.readFile(path.join(root, 'map.json'), 'utf8'), before);
  await assert.rejects(fs.access(path.join(root, '.adaptive-migrations')));
});

test('migration apply is hash-bound and recovery restores exact overwritten bytes', async () => {
  const { root, files } = await legacyFixture();
  const proposal = await previewPlanMigration(root);
  await assert.rejects(() => applyPlanMigration(root, proposal, { expectedProposalHash: '0'.repeat(64) }), /explicitly confirmed/i);
  const applied = await applyPlanMigration(root, proposal, { expectedProposalHash: proposal.proposal_hash });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.map.engineering_posture.status, 'unknown_legacy');
  assert.equal(await fs.readFile(path.join(root, 'decisions', 'D-001.md'), 'utf8'), files['decisions/D-001.md']);
  assert.equal(await fs.readFile(path.join(root, 'provider-results', 'review.json'), 'utf8'), files['provider-results/review.json']);
  await assert.doesNotReject(fs.access(path.join(root, applied.recovery_ref)));
  await assert.rejects(() => recoverPlanMigration(root, applied.migration_id, { expectedCurrentMapHash: '0'.repeat(64) }), /explicitly confirmed/i);
  const recovered = await recoverPlanMigration(root, applied.migration_id, { expectedCurrentMapHash: applied.map_hash });
  assert.equal(recovered.status, 'recovered');
  for (const relative of ['map.json', 'MAP.md', 'nodes/N-001.md']) {
    assert.equal(await fs.readFile(path.join(root, relative), 'utf8'), files[relative], relative);
  }
  assert.match(await fs.readFile(path.join(root, 'events.jsonl'), 'utf8'), /plan_migration_recovered/);
});

test('authoritative current maps do not create migration recovery state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-migration-current-'));
  const map = await createPlanManifest(root, { planId: 'current', title: 'Current', goal: 'Stay current' });
  map.engineering_posture = createEngineeringPosture('reusable_internal', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' }, allowed_capabilities: ['local'], excluded_capabilities: ['deployment'],
  });
  await writeMap(root, map);
  const proposal = await previewPlanMigration(root);
  assert.equal(proposal.status, 'not_required');
  const result = await applyPlanMigration(root, proposal, { expectedProposalHash: proposal.proposal_hash });
  assert.equal(result.writes, false);
  await assert.rejects(fs.access(path.join(root, '.adaptive-migrations')));
});

test('design migration blocks without posture and recovers flat history exactly', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-design-migration-'));
  const map = await createPlanManifest(root, { planId: 'design-migration', title: 'Design migration', goal: 'Preserve design' });
  const posture = createEngineeringPosture('reusable_internal', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' }, allowed_capabilities: ['local'], excluded_capabilities: ['deployment'],
  });
  map.engineering_posture = posture;
  map.gates.design = { status: 'approved' };
  await writeMap(root, map);
  const legacyDesign = {
    schema_version: '2.0', design_id: 'legacy', current_revision: 1, updated_at: '2026-08-28T00:00:00.000Z',
    revisions: [{ revision: 1, status: 'approved', design_hash: 'd'.repeat(64), requirements: ['R-LEGACY'], approval: { source: 'user' } }],
  };
  const legacyView = '# Legacy design view\n';
  await fs.writeFile(path.join(root, 'design.json'), `${JSON.stringify(legacyDesign, null, 2)}\n`);
  await fs.writeFile(path.join(root, 'DESIGN.md'), legacyView);
  const blocked = await previewPlanMigration(root, { includeDesign: true });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.design_migration.blockers[0].code, 'missing_posture_ref');
  await assert.rejects(() => applyPlanMigration(root, blocked, { expectedProposalHash: blocked.proposal_hash }), /blocked/i);

  const proposal = await previewPlanMigration(root, { includeDesign: true, postureRef: postureRef(posture) });
  assert.equal(proposal.status, 'preview');
  assert.equal(proposal.design_migration.preserved_revision_count, 1);
  assert.ok(proposal.changed_paths.includes('designs/root.md'));
  assert.equal(proposal.target_map.gates.design.status, 'stale');
  const applied = await applyPlanMigration(root, proposal, { expectedProposalHash: proposal.proposal_hash });
  assert.equal(applied.design.schema_version, '2.1');
  assert.equal(applied.design.threads.length, 1);
  assert.equal(applied.design.threads[0].revisions[0].decision_status, 'stale');
  assert.deepEqual(applied.design.threads[0].revisions[0].migration_evidence.raw_revision, legacyDesign.revisions[0]);
  const recovered = await recoverPlanMigration(root, applied.migration_id, { expectedCurrentMapHash: applied.map_hash });
  assert.equal(recovered.status, 'recovered');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'design.json'), 'utf8')), legacyDesign);
  assert.equal(await fs.readFile(path.join(root, 'DESIGN.md'), 'utf8'), legacyView);
  await assert.rejects(fs.access(path.join(root, 'designs', 'root.md')));
});
