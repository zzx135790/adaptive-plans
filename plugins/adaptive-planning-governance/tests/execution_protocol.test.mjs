import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCompactExecutionHandoff,
  createExecutionCheckpoint,
  createLeafPlanningHandoff,
  evaluateExecutionContinuation,
  evaluateExecutionSafeWaves,
  reviewLeafForFinalisation,
  validateExecutionCheckpoint,
} from '../scripts/lib/execution-protocol.mjs';
import {
  createEngineeringPosture,
  postureRef,
} from '../scripts/lib/engineering-posture.mjs';

function executionNode(id, ownedPath, overrides = {}) {
  return {
    id,
    status: 'ready',
    depends_on: [],
    parallelization: {
      candidate: true,
      owned_paths: [ownedPath],
      shared_resources: [],
      independent_verification: [`node --test tests/${id}.test.mjs`],
    },
    ...overrides,
  };
}

function fixture() {
  const posture = createEngineeringPosture('experiment', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['measure'],
    excluded_capabilities: ['deployment-automation'],
  });
  const designRef = {
    design_id: 'experiment-design',
    revision: 1,
    design_hash: 'd'.repeat(64),
    status: 'approved',
  };
  const node = {
    id: 'N-001',
    title: 'Run bounded experiment',
    status: 'ready',
    depends_on: [],
    inputs: ['approved hypothesis'],
    outputs: ['measurement'],
    acceptance: ['measurement is reproducible'],
    blocking_questions: [],
    requirement_ids: ['R-MEASURE'],
    contract_refs: [],
    design_refs: [designRef],
    interaction_refs: [],
    impacted_modules: [],
    design_required: true,
    posture_ref: postureRef(posture),
    behavior_budget: {
      required: ['metric'],
      excluded: ['deploy'],
      deferred_candidates: ['dashboard'],
    },
    scope_provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'metric' }],
    deferred_candidates: [{ behavior_id: 'dashboard', reason: 'outside experiment' }],
  };
  return {
    posture,
    map: {
      schema_version: '2.0',
      plan_id: 'experiment',
      stage: 'mapping',
      work_shape: 'map',
      gates: { design: { status: 'approved' } },
      engineering_posture: posture,
      architecture_snapshot: null,
      design_refs: [designRef],
      nodes: [node],
    },
  };
}

test('leaf, execution, and compact handoffs preserve exact scope across resume', () => {
  const { map } = fixture();
  const before = structuredClone(map);
  const leaf = createLeafPlanningHandoff(map, 'N-001', { plan_ref: 'docs/plans/experiment' });
  const checkpoint = createExecutionCheckpoint(leaf, {
    leaf_plan_ref: 'docs/plans/experiment-leaf.md',
    task_id: 'T1',
  });
  const compact = createCompactExecutionHandoff(checkpoint, {
    pending_approval: {
      subject: { design_id: 'experiment-design' },
      exact_content_hash: 'c'.repeat(64),
      exact_posture_hash: leaf.posture_ref.posture_hash,
      brief_hash: 'must-not-survive-compact',
    },
  });

  assert.deepEqual(compact.behavior_budget, leaf.behavior_budget);
  assert.deepEqual(compact.scope_provenance, leaf.scope_provenance);
  assert.deepEqual(compact.deferred_candidates, leaf.deferred_candidates);
  assert.equal(compact.pending_approval.requires_regeneration, true);
  assert.equal(Object.hasOwn(compact.pending_approval, 'brief_hash'), false);
  const validation = validateExecutionCheckpoint(map, compact);
  assert.equal(validation.valid, true);
  assert.equal(validation.approval_action, 'regenerate_approval_brief');
  assert.deepEqual(map, before);
});

test('resume stops with exact recovery when posture or design refs drift', () => {
  const { map } = fixture();
  const leaf = createLeafPlanningHandoff(map, 'N-001');
  const checkpoint = createExecutionCheckpoint(leaf, { leaf_plan_ref: 'leaf.md', task_id: 'T1' });
  const changed = structuredClone(map);
  changed.nodes[0].design_refs[0].design_hash = 'e'.repeat(64);
  const nextPosture = createEngineeringPosture('experiment', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture-v2' },
    allowed_capabilities: ['measure'],
  });
  changed.engineering_posture = nextPosture;
  changed.nodes[0].posture_ref = postureRef(nextPosture);

  const validation = validateExecutionCheckpoint(changed, checkpoint);
  assert.equal(validation.action, 'stop_and_recover');
  assert.ok(validation.stale_fields.includes('posture_ref'));
  assert.ok(validation.stale_fields.includes('design_refs'));
  assert.match(validation.recovery_action, /regenerate.*leaf handoff.*checkpoint/i);
});

test('material evidence stops execution without mutating canonical state', () => {
  const { map } = fixture();
  const leaf = createLeafPlanningHandoff(map, 'N-001');
  const checkpoint = createExecutionCheckpoint(leaf, { leaf_plan_ref: 'leaf.md', task_id: 'T1' });
  const before = structuredClone(map);
  const result = evaluateExecutionContinuation(map, checkpoint, {
    classifications: ['contract_changed'],
    evidence_refs: ['test:contract-regression'],
  });
  assert.equal(result.action, 'stop_and_replan');
  assert.deepEqual(result.evidence_refs, ['test:contract-regression']);
  assert.deepEqual(map, before);
});

test('finalisation is subtractive before completeness and retains safety floors', () => {
  const { map, posture } = fixture();
  const leaf = createLeafPlanningHandoff(map, 'N-001');
  const candidates = [
    {
      behavior_id: 'metric',
      capability: 'measure',
      provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'metric' }],
    },
    {
      behavior_id: 'deploy',
      capability: 'deployment-automation',
      provenance: [{ kind: 'approved_design', ref: 'D-DEPLOY', behavior_id: 'deploy' }],
    },
    {
      behavior_id: 'cost-guard',
      capability: 'bound_runaway_resource_cost',
      provenance: [{ kind: 'safety_floor', ref: 'mandatory', behavior_id: 'cost-guard' }],
      safety_case: {
        threat: 'The experiment can consume unbounded shared compute',
        evidence: ['The runner accepts an unconstrained iteration count'],
        impact: 'Other workloads can be starved',
        smaller_control: 'Cap this experiment at its approved iteration count',
        verification: ['Exercise the cap boundary and observe termination'],
        reversibility: 'Remove the local cap with the experiment',
        cost: 'One boundary check per iteration',
      },
    },
  ];
  const review = reviewLeafForFinalisation(posture, leaf, candidates);
  assert.deepEqual(review.review_order, ['subtractive_scope_and_provenance', 'completeness']);
  assert.deepEqual(review.required, ['metric', 'cost-guard']);
  assert.equal(review.deferred_candidates.find((candidate) => candidate.behavior_id === 'deploy').reason, 'excluded_by_posture');
  assert.deepEqual(review.completeness_gaps, []);
  assert.equal(review.mutates_leaf, false);
});

test('execution evaluator dispatches compatible ready candidates together without provider evidence', () => {
  const map = { nodes: [
    executionNode('A', 'src/a.mjs'),
    executionNode('B', 'src/b.mjs'),
  ] };
  const before = structuredClone(map);

  const result = evaluateExecutionSafeWaves(map);

  assert.deepEqual(result.execution_safe_waves.map((wave) => wave.map((node) => node.node_id)), [['A', 'B']]);
  assert.deepEqual(result.dispatch_batches, [{
    dependency_wave: 1,
    subwave: 1,
    node_ids: ['A', 'B'],
    mode: 'parallel',
  }]);
  assert.deepEqual(result.serial, []);
  assert.deepEqual(map, before);
});

test('execution evaluator assigns unique execution waves to deterministic parallel subwaves', () => {
  const map = { nodes: [
    executionNode('D', 'src/a-d.mjs', {
      parallelization: {
        candidate: true,
        owned_paths: ['src/a-d.mjs', 'src/c-d.mjs'],
        shared_resources: [],
        independent_verification: ['node --test tests/D.test.mjs'],
      },
    }),
    executionNode('B', 'src/a-b.mjs', {
      parallelization: {
        candidate: true,
        owned_paths: ['src/a-b.mjs', 'src/b-c.mjs'],
        shared_resources: [],
        independent_verification: ['node --test tests/B.test.mjs'],
        token_cost: { estimated: 999999 },
      },
    }),
    executionNode('C', 'src/b-c.mjs', {
      parallelization: {
        candidate: true,
        owned_paths: ['src/b-c.mjs', 'src/c-d.mjs'],
        shared_resources: [],
        independent_verification: ['node --test tests/C.test.mjs'],
        estimated_token_cost: 888888,
      },
    }),
    executionNode('A', 'src/a-b.mjs', {
      parallelization: {
        candidate: true,
        owned_paths: ['src/a-b.mjs', 'src/a-d.mjs'],
        shared_resources: [],
        independent_verification: ['node --test tests/A.test.mjs'],
        token_cost: { estimated: 777777 },
      },
    }),
  ] };

  const result = evaluateExecutionSafeWaves(map);

  assert.deepEqual(result.execution_safe_waves.map((wave) => wave.map((node) => ({
    node_id: node.node_id,
    execution_wave: node.execution_wave,
  }))), [
    [
      { node_id: 'A', execution_wave: '1.1' },
      { node_id: 'C', execution_wave: '1.1' },
    ],
    [
      { node_id: 'B', execution_wave: '1.2' },
      { node_id: 'D', execution_wave: '1.2' },
    ],
  ]);
  assert.deepEqual(result.dispatch_batches, [
    {
      dependency_wave: 1,
      subwave: 1,
      node_ids: ['A', 'C'],
      mode: 'parallel',
    },
    {
      dependency_wave: 1,
      subwave: 2,
      node_ids: ['B', 'D'],
      mode: 'parallel',
    },
  ]);
  assert.deepEqual(result.serial, []);
});
