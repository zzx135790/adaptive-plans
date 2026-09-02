import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildPlanOverview,
  createPlanManifest,
  migrateMapV1,
  renderMapMarkdown,
  validatePlanCompletion,
  writeMap,
} from '../scripts/lib/plan-protocol.mjs';
import { createEngineeringPosture, postureRef } from '../scripts/lib/engineering-posture.mjs';
import { createDesignDocument } from '../scripts/lib/design-engine.mjs';

test('v2 map overview exposes topology, gates, architecture, design, and every node artifact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-overview-'));
  const map = await createPlanManifest(root, { planId: 'p', title: 'P', goal: 'G' });
  map.architecture_snapshot = { project_id: 'project', revision: 2, architecture_hash: 'abc123' };
  map.design_refs = [{ design_id: 'd', revision: 1, status: 'approved' }];
  map.nodes = [
    { id: 'N-001', title: 'Design API', status: 'done', depends_on: [], inputs: ['x'], outputs: ['y'], acceptance: ['z'], blocking_questions: [] },
    { id: 'N-002', title: 'Implement API', status: 'blocked', depends_on: ['N-001'], inputs: ['x'], outputs: ['y'], acceptance: ['z'], blocking_questions: ['contract missing'] },
  ];
  map.artifacts = [{ path: '../../2026-08-28-api-leaf.md', format: 'superpowers-writing-plans', id: 'leaf-api' }];
  map.engineering_posture = createEngineeringPosture('reusable_internal', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['api'], excluded_capabilities: ['deployment'],
  });
  map.nodes[0].posture_ref = postureRef(map.engineering_posture);
  map.nodes[0].scope_provenance = [{ kind: 'requirement', ref: 'R-DESIGN', behavior_id: 'design-api' }];
  map.nodes[0].behavior_budget = { required: ['design-api'], excluded: [], deferred_candidates: [] };
  map.nodes[0].deferred_candidates = [];
  map.nodes[1].posture_ref = postureRef(map.engineering_posture);
  map.nodes[1].scope_provenance = [{ kind: 'requirement', ref: 'R-IMPLEMENT', behavior_id: 'implement-api' }];
  map.nodes[1].behavior_budget = { required: ['implement-api'], excluded: [], deferred_candidates: [] };
  map.nodes[1].deferred_candidates = [];
  await writeMap(root, map);
  await fs.writeFile(path.join(root, 'decisions', 'D-001.md'), '# Decision\n');
  await fs.writeFile(path.join(root, 'provider-results', 'review.json'), '{}\n');
  const markdown = renderMapMarkdown(map);
  assert.match(markdown, /Wave 1:/);
  assert.match(markdown, /N-001 -> N-002/);
  assert.match(markdown, /Architecture:/);
  assert.match(markdown, /Artifact Index/);
  assert.match(markdown, /nodes\/N-002\.md/);
  const overview = await buildPlanOverview(root);
  assert.equal(overview.status_counts.blocked, 1);
  assert.ok(overview.artifacts.includes('nodes/N-002.md'));
  assert.ok(overview.artifacts.includes('decisions/D-001.md'));
  assert.ok(overview.artifacts.includes('provider-results/review.json'));
  assert.ok(overview.artifacts.includes('../../2026-08-28-api-leaf.md'));
  assert.equal(overview.artifact_index.find((artifact) => artifact.path === 'nodes/N-002.md').exists_in_plan_folder, true);
  assert.equal(overview.artifact_index.find((artifact) => artifact.id === 'leaf-api').exists_in_plan_folder, false);
  assert.equal(typeof overview.artifact_index.find((artifact) => artifact.id === 'leaf-api').exists, 'boolean');
  assert.equal(overview.engineering_posture.kind, 'reusable_internal');
  assert.ok(overview.node_scope.find((node) => node.node_id === 'N-002').readiness.blockers.some((blocker) => blocker.code === 'dependency_not_done') === false);
  assert.equal(overview.binding.plan_state, 'loaded');
  assert.equal(overview.flow_receipt.workflow, 'adaptive-planning-governance');
});

test('overview distinguishes external artifact existence and renders pending design approval inline', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-overview-external-'));
  const root = path.join(base, 'map');
  const map = await createPlanManifest(root, { planId: 'pending', title: 'Pending', goal: 'Approve design' });
  const leafPath = path.join(base, 'leaf.md');
  await fs.writeFile(leafPath, '# Leaf\n');
  map.artifacts = [{ path: '../leaf.md', id: 'leaf' }];
  map.gates.design = { status: 'in_progress' };
  map.gates.bootstrap = {
    status: 'validated', workflow: 'adaptive-planning-governance', plugin_version: 'test',
    project_ref: '.', plan_ref: 'map', persistence_status: 'validated', control_surface: 'cli_fallback',
    mcp_binding: 'mismatch', next_action: 'Ask for approval',
  };
  await writeMap(root, map);
  const document = createDesignDocument({
    design_id: 'pending-design',
    profile: { required: true, scope: 'root', concerns: [], triggers: [], impacted_modules: [], behavior_budget: { required: ['choose'], excluded: [] } },
    provider_selection: { selected: [], blocking_concerns: [] },
    requirements: ['Choose one option'],
  });
  await fs.writeFile(path.join(root, 'design.json'), `${JSON.stringify(document, null, 2)}\n`);
  const overview = await buildPlanOverview(root, { projectRoot: base, mcpPlanRoot: path.join(base, 'wrong') });
  const leaf = overview.artifact_index.find((artifact) => artifact.id === 'leaf');
  assert.equal(leaf.exists_in_plan_folder, false);
  assert.equal(leaf.exists, true);
  assert.equal(overview.binding.status, 'mismatch');
  assert.equal(overview.binding.plan_state, 'loaded');
  assert.equal(overview.approval_brief.subject.design_id, 'pending-design');
  assert.match(overview.approval_brief.prompt, /Approve pending-design/);
  assert.equal(overview.flow_receipt.next_action, 'Ask for approval');
});

test('v1 migration preserves uncertainty instead of fabricating design approval', () => {
  const migrated = migrateMapV1({ schema_version: '1.0', plan_id: 'legacy', nodes: [], mode: 'map' });
  assert.equal(migrated.schema_version, '2.0');
  assert.equal(migrated.gates.design.status, 'unknown_legacy');
  assert.equal(migrated.gates.architecture_sync.status, 'unknown_legacy');
  assert.equal(migrated.engineering_posture.status, 'unknown_legacy');
  assert.equal(validatePlanCompletion(migrated).valid, false);
});

test('completion gate permits explicitly cancelled nodes but not deferred work', () => {
  const posture = createEngineeringPosture('spike', {
    source: { kind: 'explicit_assessment', ref: 'test://completion-posture' },
    allowed_capabilities: ['answer-question'],
    excluded_capabilities: ['deployment'],
  });
  const base = {
    schema_version: '2.0',
    plan_id: 'completion-statuses',
    stage: 'complete',
    work_shape: 'map',
    gates: {
      intent: { status: 'approved' },
      design: { status: 'not_required' },
      architecture_sync: { status: 'not_required' },
    },
    engineering_posture: posture,
    posture_evidence: ['question_answered', 'result_validity'],
    nodes: [
      {
        id: 'N-001', title: 'Answer question', status: 'done', depends_on: [],
        posture_ref: postureRef(posture),
        scope_provenance: [{ kind: 'requirement', ref: 'R-ANSWER', behavior_id: 'answer' }],
        behavior_budget: { required: ['answer'], excluded: ['deploy'], deferred_candidates: [] },
        deferred_candidates: [],
      },
      { id: 'N-002', title: 'Cancelled extension', status: 'cancelled', depends_on: ['N-001'] },
    ],
  };
  assert.equal(validatePlanCompletion(base).valid, true);
  base.nodes[1].status = 'deferred';
  assert.equal(validatePlanCompletion(base).valid, false);
});
