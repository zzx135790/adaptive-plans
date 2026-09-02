import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { evaluateExecutionSafeWaves } from '../scripts/lib/execution-protocol.mjs';
import {
  loadMap,
  renderMapMarkdown,
  topologicalWaves,
  validateMap,
  writeMap,
  writeNodeBrief,
} from '../scripts/lib/plan-protocol.mjs';
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

test('design-first planning selects a visible design provider before decomposition and review', () => {
  const routed = routePlanning({
    public_api: true,
    visible_providers: { providers: [
      { id: 'design-options', kind: 'skill', visible: true, capabilities: ['design'], roles: ['designer'] },
    ] },
  });

  assert.deepEqual(routed.routes.map((route) => route.capability), ['design', 'decompose', 'review']);
  assert.equal(routed.routes[0].provider, 'design-options');
  assert.equal(routed.provider, 'design-options');
});

test('design-first planning names the Ada design fallback when no design provider is visible', () => {
  const routed = routePlanning({ public_api: true, visible_providers: { providers: [] } });

  assert.equal(routed.routes[0].capability, 'design');
  assert.equal(routed.routes[0].fallback, 'ada:compare-explicit-options');
  assert.deepEqual(routed.fallback, [
    'ada:compare-explicit-options',
    'ada:build-dag',
    'ada:validate-core-contracts',
  ]);
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
    {
      behavior_id: 'credentials',
      capability: 'prevent_credential_exposure',
      safety_case: {
        threat: 'A generated diagnostic could expose a credential.',
        evidence: ['The task handles an authenticated diagnostic payload.'],
        impact: 'A credential could be disclosed in output.',
        smaller_control: 'Redact only credential-bearing fields at the output boundary.',
        verification: ['Exercise the output path with a synthetic credential.'],
        reversibility: 'Remove the boundary redaction without migrating stored data.',
        cost: 'One focused boundary check.',
      },
    },
  ]);
  assert.deepEqual(result.required.map((item) => item.behavior_id), ['requested', 'credentials']);
  assert.deepEqual(result.excluded.map((item) => item.behavior_id), ['production-hardening']);
  assert.deepEqual(result.deferred_candidates.map((item) => item.behavior_id), ['later', 'speculative']);
});

test('new safety-floor candidates require a complete safety case', () => {
  const result = partitionBehaviorCandidates({}, [
    { behavior_id: 'missing', capability: 'prevent_credential_exposure' },
    {
      behavior_id: 'incomplete',
      capability: 'fail_loud_on_invalid_results',
      safety_case: {
        threat: 'Invalid output may be consumed.',
        evidence: [],
        impact: 'The caller may act on invalid output.',
        smaller_control: 'Validate the task output once at the integration boundary.',
        verification: ['Pass an invalid fixture.'],
        reversibility: 'Remove the boundary validation.',
        cost: 'One integration assertion.',
      },
    },
    {
      behavior_id: 'complete',
      capability: 'prevent_destructive_data_loss',
      safety_case: {
        threat: 'The requested operation can overwrite user data.',
        evidence: ['The target path already exists in the task fixture.'],
        impact: 'Existing user data could be lost.',
        smaller_control: 'Require an explicit overwrite decision for that target.',
        verification: ['Verify refusal without the decision.'],
        reversibility: 'The control is local to the overwrite branch.',
        cost: 'One conditional at the destructive boundary.',
      },
    },
  ]);

  assert.deepEqual(result.required.map((item) => item.behavior_id), ['complete']);
  assert.deepEqual(result.deferred_candidates.map((item) => ({
    behavior_id: item.behavior_id,
    reason: item.reason,
  })), [
    { behavior_id: 'missing', reason: 'missing_safety_case' },
    { behavior_id: 'incomplete', reason: 'missing_safety_case' },
  ]);
});

test('map validation accepts normalized arbitrary skill names and rejects invalid binding contracts', () => {
  const binding = {
    behavior: 'review a research paper',
    purpose: 'Assess the paper methodology.',
    selection_reason: 'The visible skill directly reviews one paper.',
    execution_order: 1,
    selected_skill: 'academic-paper-review',
    alternatives: [
      { skill: 'pdf', not_selected_reason: 'PDF parsing alone does not review methodology.' },
      { skill: 'plugin-creator', not_selected_reason: 'Plugin scaffolding is unrelated.' },
    ],
  };
  const makeMap = (skillBindings) => ({
    schema_version: '2.0',
    plan_id: 'skill-contract',
    nodes: [{ id: 'A', title: 'Review', depends_on: [], skill_bindings: skillBindings }],
  });

  assert.equal(validateMap(makeMap([binding])).valid, true);
  const invalidCases = [
    ['invalid_skill_bindings', null],
    ['missing_skill_route', [{ ...binding, selected_skill: undefined, ada_fallback: undefined }]],
    ['multiple_skill_routes', [{ ...binding, ada_fallback: 'ada:review-paper' }]],
    ['invalid_execution_order', [{ ...binding, execution_order: 0 }]],
    ['too_many_skill_alternatives', [{ ...binding, alternatives: [...binding.alternatives, { skill: 'other', not_selected_reason: 'Less specific.' }] }]],
    ['invalid_skill_alternative', [{ ...binding, alternatives: [{ skill: '', not_selected_reason: 'No name.' }] }]],
    ['invalid_override_reason', [{ ...binding, override_reason: '   ' }]],
    ['duplicate_skill_behavior', [binding, { ...binding, execution_order: 2, selected_skill: 'pdf' }]],
    ['duplicate_skill_execution_order', [binding, { ...binding, behavior: 'extract the PDF', selected_skill: 'pdf' }]],
  ];
  for (const [code, skillBindings] of invalidCases) {
    const validation = validateMap(makeMap(skillBindings));
    assert.equal(validation.valid, false, code);
    assert.equal(validation.errors.some((error) => error.code === code), true, code);
  }
});

test('direct routing echoes selected bindings as one skill route line without guessing when absent', () => {
  const bindings = [
    {
      behavior: 'inspect the PDF',
      purpose: 'Read the supplied artifact.',
      selection_reason: 'The host-visible PDF skill matches the artifact.',
      execution_order: 1,
      selected_skill: 'pdf',
    },
    {
      behavior: 'summarize unsupported metadata',
      purpose: 'Keep the direct task bounded.',
      selection_reason: 'No visible skill covers the remaining behavior.',
      execution_order: 2,
      ada_fallback: 'ada:summarize-metadata',
    },
  ];

  const routed = routePlanning({ skill_bindings: bindings });
  assert.deepEqual(routed.skill_bindings, [
    { ...bindings[0], alternatives: [] },
    { ...bindings[1], alternatives: [] },
  ]);
  assert.equal(routed.skill_route_line,
    'Skill route: inspect the PDF -> pdf (The host-visible PDF skill matches the artifact.); summarize unsupported metadata -> ada:summarize-metadata (No visible skill covers the remaining behavior.)');
  assert.equal(routed.skill_route_line.includes('\n'), false);

  const unbound = routePlanning({ phase_count: 2 });
  assert.equal('skill_bindings' in unbound, false);
  assert.equal('skill_route_line' in unbound, false);
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

test('node brief paths encode traversal ids and never write outside the plan root', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'ada-node-path-'));
  const planRoot = path.join(sandbox, 'plan');
  const node = { id: '../../escape', title: 'Stay contained', status: 'ready', depends_on: [] };

  await writeNodeBrief(planRoot, node);

  const encodedRelative = 'nodes/..%2F..%2Fescape.md';
  await assert.doesNotReject(fs.access(path.join(planRoot, encodedRelative)));
  await assert.rejects(fs.access(path.join(sandbox, 'escape.md')), { code: 'ENOENT' });
  assert.match(renderMapMarkdown({ schema_version: '2.0', plan_id: 'path-test', nodes: [node] }),
    /\[\.\.\/\.\.\/escape\]\(nodes\/\.\.%2F\.\.%2Fescape\.md\)/);
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

test('execution dispatches only nodes whose prerequisites are complete at runtime', () => {
  const parallelization = (ownedPath) => ({ owned_paths: [ownedPath] });
  const map = { nodes: [
    { id: 'A', title: 'A', status: 'ready', depends_on: [], parallelization: parallelization('src/a.js') },
    { id: 'B', title: 'B', status: 'ready', depends_on: ['A'], parallelization: parallelization('src/b.js') },
    { id: 'C', title: 'C', status: 'blocked', depends_on: [], parallelization: parallelization('src/c.js') },
    { id: 'D', title: 'D', status: 'ready', depends_on: ['C'], parallelization: parallelization('src/d.js') },
    { id: 'E', title: 'E', depends_on: [], parallelization: parallelization('src/e.js') },
    { id: 'F', title: 'F', status: 'ready', depends_on: ['E'], parallelization: parallelization('src/f.js') },
  ] };

  const result = evaluateExecutionSafeWaves(map);

  assert.deepEqual(result.dispatch_batches.map((batch) => batch.node_ids), [['A']]);
  assert.match(result.serial.find((node) => node.node_id === 'B').reason, /dependency not done: A/);
  assert.match(result.serial.find((node) => node.node_id === 'D').reason, /dependency not done: C/);
  assert.match(result.serial.find((node) => node.node_id === 'F').reason, /dependency not done: E/);
});

test('ancestor and descendant owned paths are placed in deterministic later subwaves', () => {
  for (const descendant of ['src/b.js', 'src/*', 'src/**']) {
    const map = { nodes: [
      { id: 'C', status: 'ready', depends_on: [], parallelization: { owned_paths: ['test'] } },
      { id: 'B', status: 'ready', depends_on: [], parallelization: { owned_paths: [descendant] } },
      { id: 'A', status: 'ready', depends_on: [], parallelization: { owned_paths: ['src'] } },
    ] };

    assert.deepEqual(evaluateExecutionSafeWaves(map).dispatch_batches.map((batch) => batch.node_ids), [
      ['A', 'C'],
      ['B'],
    ], descendant);
  }
});

test('transitive unknown-dependency blockage is not mislabeled as a cycle', () => {
  const result = topologicalWaves({ nodes: [
    { id: 'B', depends_on: ['A'] },
    { id: 'A', depends_on: ['missing'] },
  ] });

  assert.deepEqual(result.blocked, [
    { node_id: 'A', reason: 'unknown dependency: missing' },
    { node_id: 'B', reason: 'blocked dependency: A' },
  ]);
});
