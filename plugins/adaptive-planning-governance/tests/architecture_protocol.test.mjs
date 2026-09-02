import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applyArchitectureDelta,
  approveArchitectureProposal,
  loadArchitecture,
  proposeArchitectureDelta,
  proposeExperimentalZonePromotion,
  resolveArchitecturePosture,
  scanArchitectureProposal,
  validateArchitecture,
  writeArchitecture,
} from '../scripts/lib/architecture-protocol.mjs';
import { analyzeArchitectureImpact, validateArchitectureImpact } from '../scripts/lib/architecture-impact.mjs';
import { createPlanManifest, loadMap, writeMap } from '../scripts/lib/plan-protocol.mjs';
import { linkArchitectureSnapshot, recordArchitectureImpact } from '../scripts/lib/planning-engine.mjs';

function baseline() {
  return {
    schema_version: '2.0',
    project_id: 'sample',
    revision: 1,
    status: 'approved',
    modules: [{
      id: 'api', purpose: 'Own the public API', non_goals: [], owners: ['platform'],
      owned_paths: ['src/**'], public_boundaries: [{ id: 'http', path: 'src/api.js', critical: true }],
      invariants: ['Responses use the documented envelope'], dependencies: [], required_concerns: [], concerns: {}, source_refs: [],
    }],
    relations: [],
    coverage: { include_paths: ['src/**'], ignore_paths: ['tests/**'] },
  };
}

function ref(kind, value = kind[0]) {
  return { kind, posture_hash: value.repeat(64), source_ref: `posture:${kind}` };
}

test('architecture bootstrap remains a proposal until an engineer completes and approves it', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-architecture-project-'));
  await fs.mkdir(path.join(project, 'src', 'api'), { recursive: true });
  await fs.mkdir(path.join(project, 'src', 'worker'), { recursive: true });
  const proposal = await scanArchitectureProposal(project, { projectId: 'project' });
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.modules.length, 2);
  assert.equal(validateArchitecture(proposal, { proposal: true }).valid, true);
  assert.equal(validateArchitecture({ ...proposal, status: 'approved' }).valid, false);

  for (const module of proposal.modules) {
    module.purpose = `Own ${module.id}`;
    module.owners = ['team'];
  }
  const root = path.join(project, 'docs', 'architecture', 'adaptive');
  const approved = await approveArchitectureProposal(root, proposal, { source: 'user', statement: 'approved' });
  assert.equal(approved.status, 'approved');
  await assert.doesNotReject(fs.access(path.join(root, 'ARCHITECTURE.md')));
  await assert.doesNotReject(fs.access(path.join(root, 'modules', 'api.md')));
});

test('architecture validation enforces concern packs and typed relation evidence', () => {
  const value = baseline();
  value.modules[0].required_concerns = ['security'];
  value.modules[0].concerns.security = { trust_boundaries: ['internet'] };
  const incomplete = validateArchitecture(value);
  assert.ok(incomplete.errors.some((error) => error.code === 'incomplete_concern_pack'));

  value.modules[0].concerns.security = { trust_boundaries: ['internet'], authorization: ['token'], sensitive_data: ['none'] };
  assert.equal(validateArchitecture(value).valid, true);
});

test('architecture posture defaults and lightweight experimental zones are hash-bound', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-architecture-zones-'));
  const value = baseline();
  value.posture_default = ref('reusable_internal', 'a');
  value.modules[0].posture_default = ref('production', 'b');
  value.experimental_zones = [{
    id: 'api-probe',
    objective: 'Measure parser behavior',
    owned_paths: ['src/experiments/**'],
    posture_ref: ref('experiment', 'c'),
    source_refs: ['plan:N-002'],
    status: 'active',
  }];
  const written = await writeArchitecture(root, value);
  assert.equal(validateArchitecture(written).valid, true);
  assert.equal(written.experimental_zones[0].posture_ref.kind, 'experiment');
  assert.notEqual(written.modules[0].contract_hash, baseline().modules[0].contract_hash);
  const markdown = await fs.readFile(path.join(root, 'ARCHITECTURE.md'), 'utf8');
  assert.match(markdown, /Project posture default.*reusable_internal/);
  assert.match(markdown, /api-probe/);

  const changed = structuredClone(written);
  changed.posture_default = ref('production', 'd');
  const next = await writeArchitecture(root, changed, { expectedHash: written.architecture_hash });
  assert.notEqual(next.architecture_hash, written.architecture_hash);
});

test('legacy baselines stay readable while malformed or production zones are rejected', () => {
  const legacy = validateArchitecture(baseline());
  assert.equal(legacy.valid, true);
  assert.ok(legacy.warnings.some((warning) => warning.code === 'unknown_legacy_architecture_posture'));

  const invalid = baseline();
  invalid.posture_default = ref('reusable_internal', 'a');
  invalid.experimental_zones = [
    {
      id: 'zone',
      objective: 'Try a local approach',
      owned_paths: ['src/experiments/**'],
      posture_ref: ref('production', 'b'),
      source_refs: ['plan:N-002'],
      status: 'active',
    },
    {
      id: 'zone',
      objective: 'Duplicate',
      owned_paths: ['src/experiments/**'],
      posture_ref: ref('spike', 'c'),
      source_refs: ['plan:N-002'],
      status: 'active',
    },
  ];
  const result = validateArchitecture(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'invalid_zone_posture'));
  assert.ok(result.errors.some((error) => error.code === 'duplicate_experimental_zone'));
  assert.ok(result.errors.some((error) => error.code === 'duplicate_zone_path'));
});

test('posture inheritance is deterministic and differing overrides need a hash-bound decision', () => {
  const architecture = baseline();
  architecture.architecture_hash = 'f'.repeat(64);
  architecture.posture_default = ref('reusable_internal', 'a');
  architecture.modules[0].posture_default = ref('production', 'b');
  architecture.experimental_zones = [{
    id: 'api-probe',
    objective: 'Try a parser',
    owned_paths: ['src/experiments/**'],
    posture_ref: ref('experiment', 'c'),
    source_refs: ['plan:N-002'],
    status: 'active',
  }];

  const module = resolveArchitecturePosture(architecture, { path: 'src/api.js' });
  assert.equal(module.posture_ref.kind, 'production');
  assert.deepEqual(module.provenance.map((item) => item.level), ['project', 'module']);

  const zone = resolveArchitecturePosture(architecture, { path: 'src/experiments/parser.js' });
  assert.equal(zone.posture_ref.kind, 'experiment');
  assert.deepEqual(zone.provenance.map((item) => item.level), ['project', 'module', 'experimental_zone']);

  const override = ref('spike', 'd');
  assert.throws(
    () => resolveArchitecturePosture(architecture, { path: 'src/api.js', override }),
    (error) => error.code === 'POSTURE_OVERRIDE_CONFLICT',
  );
  const decided = resolveArchitecturePosture(architecture, {
    path: 'src/api.js',
    override,
    override_decision: {
      expected_posture_hash: module.posture_ref.posture_hash,
      decision_ref: 'decision:try-spike',
      approval: { source: 'user' },
    },
  });
  assert.equal(decided.posture_ref.kind, 'spike');
  assert.equal(decided.override_decision.decision_ref, 'decision:try-spike');
});

test('posture resolution blocks unknown legacy defaults instead of inventing intent', () => {
  assert.throws(
    () => resolveArchitecturePosture(baseline(), { module_id: 'api' }),
    (error) => error.code === 'POSTURE_UNKNOWN_LEGACY',
  );
});

test('architecture writes use optimistic hashes and deltas require explicit approval', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-architecture-'));
  const current = await writeArchitecture(root, baseline());
  await assert.rejects(() => writeArchitecture(root, baseline()), /expected architecture hash/i);
  await assert.rejects(() => writeArchitecture(root, baseline(), { expectedHash: 'stale' }), /changed/i);
  const proposed = structuredClone(current);
  proposed.modules[0].invariants.push('Errors remain machine-readable');
  const delta = proposeArchitectureDelta(current, proposed, { affected_modules: ['api'], rationale: 'New error contract' });
  await assert.rejects(() => applyArchitectureDelta(root, delta), /approval/i);
  const applied = await applyArchitectureDelta(root, delta, { approval: { source: 'user', statement: 'accept' } });
  assert.equal(applied.status, 'applied');
  assert.equal((await loadArchitecture(root)).architecture_hash, applied.applied_hash);
});

test('architecture impact blocks unmapped paths and contract surfaces without an approved delta', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-impact-'));
  const architecture = await writeArchitecture(root, baseline());
  const surface = analyzeArchitectureImpact(architecture, ['src/api.js']);
  assert.equal(surface.classification, 'contract_delta');
  assert.equal(surface.status, 'pending');
  assert.equal(validateArchitectureImpact(surface, architecture).valid, false);

  const satisfied = analyzeArchitectureImpact(architecture, ['src/api.js'], { delta_ref: 'changes/delta.json', approval: { source: 'user' } });
  assert.equal(validateArchitectureImpact(satisfied, architecture).valid, true);
  const internal = analyzeArchitectureImpact(architecture, ['src/internal.js'], { evidence: ['unit and contract tests pass'] });
  assert.equal(internal.classification, 'no_contract_change');
  assert.equal(validateArchitectureImpact(internal, architecture).valid, true);
  assert.equal(analyzeArchitectureImpact(architecture, ['package.json']).status, 'blocked');
});

test('zone-owned paths are mapped while stable public boundaries still require a contract delta', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-zone-impact-'));
  const value = baseline();
  value.posture_default = ref('reusable_internal', 'a');
  value.experimental_zones = [{
    id: 'detached-probe',
    objective: 'Try a detached parser',
    owned_paths: ['experiments/**'],
    posture_ref: ref('experiment', 'b'),
    source_refs: ['plan:N-002'],
    status: 'active',
  }, {
    id: 'api-probe',
    objective: 'Try an API parser',
    owned_paths: ['src/experiments/**'],
    posture_ref: ref('experiment', 'c'),
    source_refs: ['plan:N-002'],
    status: 'active',
  }];
  value.modules[0].public_boundaries.push({
    id: 'experimental-public',
    path: 'src/experiments/public.js',
    critical: true,
  });
  const architecture = await writeArchitecture(root, value);

  const detached = analyzeArchitectureImpact(architecture, ['experiments/parser.js'], {
    evidence: ['experiment validity test passed'],
  });
  assert.equal(detached.status, 'satisfied');
  assert.deepEqual(detached.impacted_modules, []);
  assert.deepEqual(detached.impacted_zones, ['detached-probe']);
  assert.deepEqual(detached.unmapped_paths, []);

  const boundary = analyzeArchitectureImpact(architecture, ['src/experiments/public.js']);
  assert.equal(boundary.classification, 'contract_delta');
  assert.deepEqual(boundary.impacted_modules, ['api']);
  assert.deepEqual(boundary.impacted_zones, ['api-probe']);
});

test('zone promotion is a pending architecture delta until explicit approval', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-zone-promotion-'));
  const value = baseline();
  value.posture_default = ref('reusable_internal', 'a');
  value.experimental_zones = [{
    id: 'detached-probe',
    objective: 'Try a detached parser',
    owned_paths: ['experiments/**'],
    posture_ref: ref('experiment', 'b'),
    source_refs: ['plan:N-002'],
    status: 'active',
  }];
  const current = await writeArchitecture(root, value);
  const moduleContract = {
    id: 'parser',
    purpose: 'Own the reusable parser',
    non_goals: [],
    owners: ['platform'],
    owned_paths: ['experiments/**'],
    public_boundaries: [],
    invariants: ['Invalid input fails loudly'],
    dependencies: [],
    required_concerns: [],
    concerns: {},
    source_refs: ['promotion:detached-probe'],
    posture_default: ref('reusable_internal', 'c'),
  };
  const delta = proposeExperimentalZonePromotion(current, 'detached-probe', moduleContract, {
    rationale: 'The experiment now has a stable internal consumer',
    design_ref: { design_id: 'parser-promotion', content_hash: 'd'.repeat(64) },
  });
  assert.equal(delta.status, 'pending');
  assert.equal(delta.promotion.status, 'pending');
  assert.equal(delta.proposed_architecture.experimental_zones.length, 0);
  assert.ok(delta.proposed_architecture.modules.some((module) => module.id === 'parser'));
  await assert.rejects(() => applyArchitectureDelta(root, delta), /approval/i);

  const applied = await applyArchitectureDelta(root, delta, {
    approval: { source: 'user', statement: 'promote parser zone' },
  });
  assert.equal(applied.status, 'applied');
  const next = await loadArchitecture(root);
  assert.equal(next.experimental_zones.length, 0);
  assert.ok(next.modules.some((module) => module.id === 'parser'));
});

test('plan architecture gate accepts only a validated satisfied impact', async () => {
  const planRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-impact-plan-'));
  const architectureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-impact-architecture-'));
  await createPlanManifest(planRoot, { planId: 'impact', title: 'Impact', goal: 'Gate changes' });
  const architecture = await writeArchitecture(architectureRoot, baseline());
  await linkArchitectureSnapshot(planRoot, architecture);
  const withNode = await loadMap(planRoot);
  withNode.nodes = [{
    id: 'N-001',
    title: 'Implement core',
    status: 'done',
    depends_on: [],
    contract_refs: [{ module_id: 'api', contract_hash: architecture.modules[0].contract_hash }],
  }];
  await writeMap(planRoot, withNode);
  await assert.rejects(
    () => recordArchitectureImpact(planRoot, {
      schema_version: '2.0',
      impact_id: 'forged',
      architecture_hash: architecture.architecture_hash,
      changed_paths: ['src/internal.js'],
      impacted_modules: ['api'],
      unmapped_paths: [],
      ambiguous_paths: [],
      surface_changes: [],
      classification: 'no_contract_change',
      status: 'satisfied',
      evidence: [],
    }),
    /requires evidence/i,
  );
  const valid = analyzeArchitectureImpact(architecture, ['src/internal.js'], { evidence: ['tests pass'] });
  const map = await recordArchitectureImpact(planRoot, valid, 'changes/impact.json');
  assert.equal(map.gates.architecture_sync.status, 'satisfied');
  assert.equal((await linkArchitectureSnapshot(planRoot, architecture)).gates.architecture_sync.status, 'satisfied');

  const changedArchitecture = structuredClone(architecture);
  changedArchitecture.revision = 2;
  changedArchitecture.modules[0].invariants.push('New contract invariant');
  const nextArchitecture = await writeArchitecture(architectureRoot, changedArchitecture, {
    expectedHash: architecture.architecture_hash,
  });
  const stale = await linkArchitectureSnapshot(planRoot, nextArchitecture);
  assert.equal(stale.gates.architecture_sync.status, 'pending');
  assert.equal(stale.nodes[0].revalidation_required, true);
});
