import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { evaluateExecutionSafeWaves } from '../scripts/lib/execution-protocol.mjs';
import { loadMap, validateMap, writeMap } from '../scripts/lib/plan-protocol.mjs';
import { routePlanning, triageTask } from '../scripts/lib/planning-engine.mjs';
import { selectVisibleProvider } from '../scripts/lib/provider-registry.mjs';
import {
  SAFETY_FLOORS,
  normalizeBehaviorBudget,
  partitionBehaviorCandidates,
} from '../scripts/lib/scope-budget.mjs';

test('stable multi-step and long-running work stays direct without an escalation signal', () => {
  for (const signals of [
    { phase_count: 8 },
    { long_running: true },
    { phase_count: 8, long_running: true, technical_risk: 'high' },
    { leaf_ready: true, mode: 'plan' },
  ]) {
    const triage = triageTask(signals);
    assert.equal(triage.mode, 'direct');
    assert.deepEqual(routePlanning(signals).planning_artifacts, []);
  }
});

test('only concrete ambiguity, uncertain dependency, cross-subsystem, or design evidence escalates', () => {
  assert.equal(triageTask({ goal_clarity: 'low' }).mode, 'guide');
  assert.equal(triageTask({ dependency_unknown: 'high' }).mode, 'map');
  assert.equal(triageTask({ cross_subsystem: true }).mode, 'map');
  assert.equal(triageTask({ public_api: true }).mode, 'plan');
});

test('provider choice uses only visible skills and otherwise names the Ada fallback', () => {
  const selected = selectVisibleProvider({
    capability: 'decompose',
    role: 'planner',
    visibleProviders: { providers: [
      { id: 'hidden', kind: 'skill', visible: false, capabilities: ['decompose'], roles: ['planner'] },
      { id: 'writing-plans', kind: 'skill', visible: true, capabilities: ['decompose'], roles: ['planner'] },
    ] },
  });
  assert.equal(selected.provider, 'writing-plans');

  const fallback = selectVisibleProvider({ capability: 'review', visibleProviders: { providers: [] } });
  assert.equal(fallback.status, 'unavailable');
  assert.match(fallback.fallback, /^ada:/);
});

test('behavior budgets retain all four safety floors and defer excluded or unapproved work', () => {
  assert.deepEqual(SAFETY_FLOORS, [
    'bound_runaway_resource_cost',
    'fail_loud_on_invalid_results',
    'prevent_credential_exposure',
    'prevent_destructive_data_loss',
  ]);
  const budget = normalizeBehaviorBudget({
    required: ['requested'],
    excluded: ['production-hardening', 'prevent_credential_exposure'],
    deferred_candidates: [{ behavior_id: 'later', reason: 'not-now' }],
  });
  assert.deepEqual(budget.required, ['requested', ...SAFETY_FLOORS]);
  assert.deepEqual(budget.excluded, ['production-hardening']);
  assert.deepEqual(budget.deferred_candidates, [{ behavior_id: 'later', reason: 'not-now' }]);

  const result = partitionBehaviorCandidates(budget, [
    { behavior_id: 'requested' },
    { behavior_id: 'production-hardening' },
    { behavior_id: 'speculative' },
    { behavior_id: 'credentials', capability: 'prevent_credential_exposure' },
  ]);
  assert.deepEqual(result.required.map((item) => item.behavior_id), ['requested', 'credentials']);
  assert.deepEqual(result.excluded.map((item) => item.behavior_id), ['production-hardening']);
  assert.deepEqual(result.deferred_candidates.map((item) => item.behavior_id), ['later', 'speculative']);
});

test('v1 and v2 maps remain readable without rewriting unknown extension fields', async () => {
  for (const version of ['1.0', '2.0']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ada-map-'));
    const source = {
      schema_version: version,
      plan_id: `map-${version}`,
      title: 'Readable map',
      nodes: [{ id: 'A', title: 'A', status: 'ready', depends_on: [], vendor_node: { keep: true } }],
      vendor_root: { keep: true },
    };
    await fs.writeFile(path.join(root, 'map.json'), `${JSON.stringify(source, null, 2)}\n`);
    const loaded = await loadMap(root);
    assert.equal(validateMap(loaded).valid, true);
    assert.deepEqual(loaded, source);
    await writeMap(root, loaded);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'map.json'), 'utf8')), source);
  }
});

test('execution partitions path/resource conflicts deterministically and never gates on token cost', () => {
  const node = (id, ownedPaths, sharedResources = []) => ({
    id,
    status: 'ready',
    depends_on: [],
    parallelization: {
      candidate: true,
      owned_paths: ownedPaths,
      shared_resources: sharedResources,
      independent_verification: [`test ${id}`],
      token_cost: Number.MAX_SAFE_INTEGER,
    },
  });
  const map = { nodes: [
    node('D', ['d']),
    node('B', ['shared']),
    node('C', ['c'], [{ name: 'db', mutable: true, partition: 'two' }]),
    node('A', ['shared'], [{ name: 'db', mutable: true, partition: 'one' }]),
  ] };
  delete map.nodes[0].parallelization.candidate;
  delete map.nodes[0].parallelization.independent_verification;
  const result = evaluateExecutionSafeWaves(map);
  assert.deepEqual(result.dispatch_batches.map((batch) => batch.node_ids), [
    ['A', 'C', 'D'],
    ['B'],
  ]);
  assert.equal(result.coordinator, 'main_model');
  assert.equal(result.main_model_takes_leaf_work, false);
});
