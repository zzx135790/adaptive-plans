import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assessBehaviorCandidates,
  assessNodeReadiness,
  ingestProviderResult,
  invalidateFromEvidence,
  addNode,
  routePlanning,
  triageTask,
} from '../scripts/lib/planning-engine.mjs';
import {
  createEngineeringPosture,
  postureRef,
} from '../scripts/lib/engineering-posture.mjs';

test('triageTask routes blocking ambiguity to guide and high uncertainty to progressive map', () => {
  assert.equal(triageTask({ goal_clarity: 'low', phase_count: 4 }).mode, 'guide');
  assert.equal(triageTask({ goal_clarity: 'high', node_ready: true, phase_count: 2 }).mode, 'plan');
  const result = triageTask({
    goal_clarity: 'high',
    scope_clarity: 'medium',
    technical_risk: 'high',
    dependency_unknown: 'high',
    domain_familiarity: 'high',
    requirement_stability: 'medium',
    phase_count: 4,
  });
  assert.equal(result.mode, 'map');
  assert.equal(result.strategy, 'progressive');
});

test('routePlanning keeps direct work cheap and routes map phases through visible providers', () => {
  const direct = routePlanning({
    goal_clarity: 'high',
    scope_clarity: 'low',
    technical_risk: 'low',
    dependency_unknown: 'low',
    domain_familiarity: 'low',
    requirement_stability: 'low',
    phase_count: 1,
  });
  assert.equal(direct.mode, 'direct');
  assert.deepEqual(direct.routes, []);
  assert.deepEqual(direct.planning_artifacts, []);

  const routed = routePlanning({
    goal_clarity: 'high', phase_count: 3,
    visible_providers: {
      providers: [{ id: 'session-explorer', capabilities: ['explore'], roles: ['explorer'], visible: true }],
    },
  });
  assert.equal(routed.mode, 'map');
  assert.equal(routed.routes.find((route) => route.capability === 'explore').provider, 'session-explorer');
  const decomposition = routed.routes.find((route) => route.capability === 'decompose');
  assert.equal(decomposition.status, 'unavailable');
  assert.ok(decomposition.fallback);
  assert.ok(decomposition.acceptance);
  assert.ok(decomposition.verification.length > 0);
  assert.deepEqual(routed.planning_artifacts, ['map-proposal']);
});

test('assessNodeReadiness reports blocking questions and stale dependencies', () => {
  const map = {
    nodes: [
      { id: 'N-001', status: 'stale', depends_on: [], title: 'Dependency' },
      {
        id: 'N-002',
        status: 'idea',
        title: 'Consumer',
        depends_on: ['N-001'],
        inputs: ['schema'],
        outputs: ['adapter'],
        acceptance: ['test passes'],
        blocking_questions: [],
      },
    ],
  };
  const result = assessNodeReadiness(map, 'N-002');
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === 'stale_dependency'));
});

test('v2 node readiness requires a current posture ref, provenance, and budget', () => {
  const posture = createEngineeringPosture('experiment', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['measurement'],
    excluded_capabilities: ['deployment'],
  });
  const node = {
    id: 'N-001',
    status: 'idea',
    title: 'Measure',
    depends_on: [],
    inputs: ['data'],
    outputs: ['measurement'],
    acceptance: ['measurement recorded'],
    blocking_questions: [],
  };
  const map = {
    schema_version: '2.0',
    engineering_posture: posture,
    nodes: [node],
  };
  const missing = assessNodeReadiness(map, 'N-001');
  assert.equal(missing.ready, false);
  assert.ok(missing.blockers.some((blocker) => blocker.code === 'missing_posture_ref'));

  Object.assign(node, {
    posture_ref: postureRef(posture),
    scope_provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'measurement' }],
    behavior_budget: { required: ['measurement'], excluded: ['deployment'], deferred_candidates: [] },
    deferred_candidates: [],
  });
  assert.equal(assessNodeReadiness(map, 'N-001').ready, true);
  node.posture_ref.posture_hash = '0'.repeat(64);
  assert.ok(assessNodeReadiness(map, 'N-001').blockers.some((blocker) => blocker.code === 'stale_posture_ref'));
});

test('addNode inherits only the exact map posture ref and does not invent scope evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-node-posture-'));
  const { createPlanManifest, loadMap, writeMap } = await import('../scripts/lib/plan-protocol.mjs');
  const posture = createEngineeringPosture('spike', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['probe'],
    excluded_capabilities: ['deployment'],
  });
  const map = await createPlanManifest(root, { planId: 'p', title: 'P', goal: 'G' });
  map.engineering_posture = posture;
  await writeMap(root, map);

  const admitted = await addNode(root, {
    id: 'N-001',
    title: 'Probe',
    inputs: ['question'],
    outputs: ['answer'],
    acceptance: ['answer recorded'],
    scope_provenance: [{ kind: 'requirement', ref: 'R-PROBE', behavior_id: 'probe' }],
    behavior_budget: { required: ['probe'], excluded: ['deployment'], deferred_candidates: [] },
    deferred_candidates: [],
  });
  assert.deepEqual(admitted.node.posture_ref, postureRef(posture));
  assert.equal(admitted.node.status, 'ready');

  const blocked = await addNode(root, {
    id: 'N-002',
    title: 'Unproven behavior',
    inputs: ['question'],
    outputs: ['answer'],
    acceptance: ['answer recorded'],
    behavior_budget: { required: ['probe'], excluded: [], deferred_candidates: [] },
    deferred_candidates: [],
  });
  assert.equal(blocked.node.status, 'blocked');
  assert.deepEqual((await loadMap(root)).nodes.map((item) => item.id), ['N-001', 'N-002']);
});

test('behavior candidate assessment is subtractive and never mutates the map', () => {
  const posture = createEngineeringPosture('experiment', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['measurement'],
    excluded_capabilities: ['deployment'],
  });
  const node = {
    id: 'N-001',
    behavior_budget: { required: ['existing'], excluded: ['deployment'], deferred_candidates: [] },
  };
  const map = { engineering_posture: posture, nodes: [node] };
  const before = structuredClone(map);
  const assessment = assessBehaviorCandidates(map, 'N-001', [
    {
      behavior_id: 'measure',
      capability: 'measurement',
      provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'measure' }],
    },
    {
      behavior_id: 'deploy',
      capability: 'deployment',
      provenance: [{ kind: 'requirement', ref: 'R-DEPLOY', behavior_id: 'deploy' }],
    },
    {
      behavior_id: 'retry-framework',
      capability: 'retries',
      provenance: [{ kind: 'observed_failure', ref: 'F-RETRY', behavior_id: 'retry-framework' }],
    },
  ]);
  assert.deepEqual(assessment.required, ['measure']);
  assert.deepEqual(
    assessment.deferred_candidates.map((candidate) => candidate.reason),
    ['excluded_by_posture', 'not_allowed_by_posture'],
  );
  assert.equal(assessment.mutates_map, false);
  assert.deepEqual(map, before);
});

test('provider candidates require structured persisted evidence and safety floors remain admitted', () => {
  const posture = createEngineeringPosture('spike', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['probe'],
    excluded_capabilities: ['deployment'],
  });
  const map = { engineering_posture: posture, nodes: [{ id: 'N-001' }] };
  const providerProvenance = [{ kind: 'requirement', ref: 'R-REPORT', behavior_id: 'provider-report' }];
  const assessment = assessBehaviorCandidates(map, 'N-001', [
    {
      behavior_id: 'provider-report',
      capability: 'probe',
      provenance: providerProvenance,
      source: { kind: 'provider', status: 'ok', evidence_ref: 'provider-results/p.json', persistence: 'not_verified' },
    },
    {
      behavior_id: 'provider-report',
      capability: 'probe',
      provenance: providerProvenance,
      source: { kind: 'provider', status: 'ok', evidence_ref: 'provider-results/p.json', persistence: 'verified' },
    },
    {
      behavior_id: 'cost-guard',
      capability: 'bound_runaway_resource_cost',
      provenance: [{ kind: 'safety_floor', ref: 'mandatory:cost', behavior_id: 'cost-guard' }],
    },
  ]);
  assert.deepEqual(assessment.required, ['provider-report', 'cost-guard']);
  assert.equal(assessment.deferred_candidates[0].reason, 'provider_not_persisted');
});

test('addNode refuses to claim a new node is already done', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-node-status-'));
  const { createPlanManifest } = await import('../scripts/lib/plan-protocol.mjs');
  await createPlanManifest(root, { planId: 'p', title: 'P', goal: 'G' });
  await assert.rejects(
    () => addNode(root, {
      id: 'N-001', title: 'Premature completion', status: 'done',
      inputs: ['x'], outputs: ['y'], acceptance: ['z'],
    }),
    /cannot mark.*done/i,
  );
});

test('invalidateFromEvidence records provenance and marks descendants stale', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-invalidate-'));
  const map = {
    schema_version: '1.0',
    plan_id: 'p',
    nodes: [
      { id: 'N-001', title: 'Dependency', status: 'in_progress', depends_on: [] },
      { id: 'N-002', title: 'Consumer', status: 'ready', depends_on: ['N-001'] },
      { id: 'N-003', title: 'Done report', status: 'done', depends_on: ['N-002'] },
    ],
  };
  await (await import('../scripts/lib/plan-protocol.mjs')).writeMap(root, map);
  const result = await invalidateFromEvidence(root, 'N-001', {
    source: 'repo-scan',
    message: 'v3 is not supported',
    decision: 'evaluate v2 adapter',
  });
  assert.deepEqual(result.affected, ['N-002', 'N-003']);
  assert.equal(result.map.nodes.find((node) => node.id === 'N-002').status, 'stale');
  assert.equal(result.map.nodes.find((node) => node.id === 'N-003').revalidation_required, true);
  assert.equal(assessNodeReadiness(result.map, 'N-003').ready, false);
  const events = await readFile(path.join(root, 'events.jsonl'), 'utf8');
  assert.match(events, /v3 is not supported/);
  assert.match(events, /evaluate v2 adapter/);
});

test('ingestProviderResult preserves raw plain text in an event', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-provider-'));
  const result = await ingestProviderResult(root, {
    provider_id: 'qa',
    capability: 'clarify',
    output: 'Ask infra about retention.',
    source: 'skill://qa/1',
  });
  assert.equal(result.status, 'unstructured');
  const events = await readFile(path.join(root, 'events.jsonl'), 'utf8');
  assert.match(events, /Ask infra about retention/);
  assert.match(events, /skill:\/\/qa\/1/);
});

test('ingestProviderResult is idempotent for the same provider payload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-provider-idempotent-'));
  await ingestProviderResult(root, {
    provider_id: 'qa',
    capability: 'clarify',
    output: 'Ask infra about retention.',
    source: 'skill://qa/1',
  });
  await ingestProviderResult(root, {
    provider_id: 'qa',
    capability: 'clarify',
    output: 'Ask infra about retention.',
    source: 'skill://qa/1',
  });
  const events = (await readFile(path.join(root, 'events.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(events.length, 1);
});

test('addNode keeps a new map node blocked until its gate fields exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-node-'));
  const { createPlanManifest } = await import('../scripts/lib/plan-protocol.mjs');
  await createPlanManifest(root, { planId: 'p', title: 'P', goal: 'G' });
  const result = await addNode(root, {
    id: 'N-001',
    title: 'Explore unknown dependency',
    depends_on: [],
    blocking_questions: ['Which legacy version is supported?'],
  });
  assert.equal(result.node.status, 'blocked');
  assert.equal(result.node.readiness.ready, false);
  await access(path.join(root, 'nodes', 'N-001.md'));
  assert.match(await readFile(path.join(root, 'nodes', 'N-001.md'), 'utf8'), /Which legacy version is supported/);
});

test('concurrent addNode calls preserve all nodes in the map', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-node-concurrent-'));
  const { createPlanManifest, loadMap } = await import('../scripts/lib/plan-protocol.mjs');
  await createPlanManifest(root, { planId: 'p', title: 'P', goal: 'G' });
  const nodes = Array.from({ length: 4 }, (_, index) => ({
    id: `N-${String(index + 1).padStart(3, '0')}`,
    title: `Node ${index + 1}`,
    inputs: ['input'], outputs: ['output'], acceptance: ['verified'], depends_on: [],
  }));
  await Promise.all(nodes.map((node) => addNode(root, node)));
  assert.deepEqual((await loadMap(root)).nodes.map((node) => node.id).sort(), nodes.map((node) => node.id).sort());
});

test('repeated decisions after new evidence keep separate decision events', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-decision-history-'));
  const { createPlanManifest, writeMap } = await import('../scripts/lib/plan-protocol.mjs');
  await createPlanManifest(root, { planId: 'p', title: 'P', goal: 'G' });
  await writeMap(root, { schema_version: '1.0', plan_id: 'p', nodes: [
    { id: 'N-001', title: 'Dependency', status: 'ready', depends_on: [], inputs: ['x'], outputs: ['y'], acceptance: ['z'] },
  ] });
  await invalidateFromEvidence(root, 'N-001', { source: 'scan', message: 'first', decision: 'use v1' });
  await invalidateFromEvidence(root, 'N-001', { source: 'scan', message: 'second', decision: 'use v1' });
  const events = (await readFile(path.join(root, 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.type === 'decision').length, 2);
});
