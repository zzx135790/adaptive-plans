import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineeringPosture, postureRef } from '../scripts/lib/engineering-posture.mjs';

const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

function runNode(script, args = [], input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(scriptsRoot, script), ...args], {
      cwd: path.resolve('.'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out: ${script}`));
    }, 10_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function json(result) {
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function currentLedgerRevision(document, threadId = 'root') {
  const thread = document.threads.find((candidate) => candidate.thread_id === threadId);
  return thread?.revisions.find((revision) => revision.revision === thread.current_revision);
}

test('CLI lifecycle initializes, adds, validates, invalidates, and ingests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-cli-'));
  const init = json(await runNode('init-plan.mjs', [
    '--root', root, '--id', 'cli-plan', '--title', 'CLI plan', '--goal', 'Exercise the lifecycle',
  ]));
  assert.equal(init.plan_id, 'cli-plan');
  const posture = createEngineeringPosture('reusable_internal', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['constraint-discovery', 'adapter'],
    excluded_capabilities: ['deployment'],
  });
  const mapPath = path.join(root, 'map.json');
  const map = JSON.parse(await fs.readFile(mapPath, 'utf8'));
  map.engineering_posture = posture;
  await fs.writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');

  const first = json(await runNode('add-node.mjs', [
    '--root', root, '--id', 'N-001', '--title', 'Discover constraints',
    '--inputs', 'repository|requirements', '--outputs', 'constraints',
    '--acceptance', 'constraints recorded',
    '--scope-provenance', JSON.stringify([
      { kind: 'requirement', ref: 'R-CONSTRAINTS', behavior_id: 'constraint-discovery' },
    ]),
    '--behavior-budget', JSON.stringify({
      required: ['constraint-discovery'], excluded: ['deployment'], deferred_candidates: [],
    }),
    '--deferred-candidates', '[]',
  ]));
  assert.equal(first.status, 'ready');

  const second = json(await runNode('add-node.mjs', [
    '--root', root, '--id', 'N-002', '--title', 'Implement adapter',
    '--depends-on', 'N-001', '--inputs', 'constraints', '--outputs', 'adapter',
    '--acceptance', 'adapter tests pass',
    '--scope-provenance', JSON.stringify([
      { kind: 'requirement', ref: 'R-ADAPTER', behavior_id: 'adapter' },
    ]),
    '--behavior-budget', JSON.stringify({
      required: ['adapter'], excluded: ['deployment'], deferred_candidates: [],
    }),
    '--deferred-candidates', '[]',
  ]));
  assert.equal(second.status, 'blocked');

  const valid = json(await runNode('validate-plan.mjs', ['--root', root]));
  assert.equal(valid.valid, true);
  const strictValid = json(await runNode('validate-plan.mjs', ['--root', root, '--strict']));
  assert.equal(strictValid.valid, true);

  const invalidated = json(await runNode('invalidate-node.mjs', [
    '--root', root, '--node', 'N-001', '--message', 'Legacy contract changed',
    '--source', 'repo-scan', '--decision', 'recheck adapter boundary',
  ]));
  assert.deepEqual(invalidated.affected, ['N-002']);

  const provider = json(await runNode('ingest-provider.mjs', [
    '--root', root, '--provider', 'uncertainty', '--capability', 'clarify',
    '--source', 'skill://uncertainty/run/1',
  ], 'Ask infra about retention.'));
  assert.equal(provider.status, 'unstructured');
  assert.equal(provider.raw.source, 'skill://uncertainty/run/1');

  const unavailable = json(await runNode('mark-provider-unavailable.mjs', [
    '--root', root, '--provider', 'missing-qa', '--capability', 'clarify', '--reason', 'not installed',
  ]));
  assert.equal(unavailable.status, 'unavailable');

  const routed = json(await runNode('route-task.mjs', [], JSON.stringify({
    goal_clarity: 'high', scope_clarity: 'high', technical_risk: 'high',
    dependency_unknown: 'high', domain_familiarity: 'high', phase_count: 4,
  })));
  assert.equal(routed.mode, 'map');
  assert.equal(routed.strategy, 'progressive');

  const events = await fs.readFile(path.join(root, 'events.jsonl'), 'utf8');
  assert.match(events, /Legacy contract changed/);
  assert.match(events, /Ask infra about retention/);
});

test('normalize-handoff CLI emits a validated envelope and rejects malformed input', async () => {
  const normalized = json(await runNode('normalize-handoff.mjs', [
    '--source', 'external-planner', '--mode', 'plan', '--next-skill', 'writing-plans', '--strict',
  ], JSON.stringify({ summary: 'ready', questions: [], vendor_note: 'keep me' })));
  assert.equal(normalized.mode, 'plan');
  assert.equal(normalized.next_skill, 'writing-plans');
  assert.equal(normalized.extensions.vendor_note, 'keep me');

  const malformed = await runNode('normalize-handoff.mjs', ['--strict'], JSON.stringify({ mode: 'not-a-mode' }));
  assert.notEqual(malformed.code, 0);
  assert.match(malformed.stdout + malformed.stderr, /mode/i);
});

test('top-level migration preview, apply, and recovery are exact-hash operations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-migrate-cli-'));
  const source = { schema_version: '1.0', plan_id: 'legacy-cli', mode: 'map', nodes: [], artifacts: [], current_node: null };
  await fs.writeFile(path.join(root, 'map.json'), `${JSON.stringify(source, null, 2)}\n`);
  await fs.writeFile(path.join(root, 'MAP.md'), '# Legacy\n');
  const preview = json(await runNode('adaptive-plan.mjs', ['migrate', '--root', root]));
  assert.equal(preview.writes, false);
  const applied = json(await runNode('adaptive-plan.mjs', [
    'migrate', '--root', root, '--apply', '--expected-hash', preview.proposal_hash,
  ]));
  assert.equal(applied.status, 'applied');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'map.json'), 'utf8')).engineering_posture.status, 'unknown_legacy');
  const recovered = json(await runNode('adaptive-plan.mjs', [
    'migrate', '--root', root, '--recover', applied.migration_id, '--expected-current-hash', applied.map_hash,
  ]));
  assert.equal(recovered.status, 'recovered');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'map.json'), 'utf8')), source);
});

test('top-level posture assess and check commands are read-only structured operations', async () => {
  const assessed = json(await runNode('adaptive-plan.mjs', ['posture', 'assess'], JSON.stringify({
    kind: 'spike',
    source: { kind: 'explicit_assessment', ref: 'conversation://test' },
    allowed_capabilities: ['answer-question'],
    excluded_capabilities: ['deployment'],
    evidence: ['question_answered'],
  })));
  assert.equal(assessed.candidate_posture.kind, 'spike');
  assert.equal(assessed.writes, false);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-posture-check-'));
  const map = json(await runNode('init-plan.mjs', [
    '--root', root, '--id', 'posture-check', '--title', 'Posture check', '--goal', 'Check posture',
  ]));
  map.engineering_posture = assessed.candidate_posture;
  map.nodes = [{
    id: 'N-001', title: 'Answer', status: 'ready', depends_on: [],
    posture_ref: assessed.posture_ref,
    scope_provenance: [{ kind: 'requirement', ref: 'R-ANSWER', behavior_id: 'answer' }],
    behavior_budget: { required: ['answer'], excluded: ['deploy'], deferred_candidates: [] },
    deferred_candidates: [],
  }];
  await fs.writeFile(path.join(root, 'map.json'), `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  const before = await fs.readFile(path.join(root, 'map.json'), 'utf8');
  const checked = json(await runNode('adaptive-plan.mjs', ['posture', 'check', '--root', root]));
  assert.equal(checked.valid, true);
  assert.equal(checked.writes, false);
  assert.equal(await fs.readFile(path.join(root, 'map.json'), 'utf8'), before);
});

test('top-level posture promotion preview and apply require the exact approval brief', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-posture-promote-cli-'));
  const map = json(await runNode('init-plan.mjs', [
    '--root', root, '--id', 'promote', '--title', 'Promote', '--goal', 'Promote explicitly',
  ]));
  const sourcePosture = createEngineeringPosture('spike', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['answer-question'], excluded_capabilities: ['deployment'],
  });
  map.engineering_posture = sourcePosture;
  map.nodes = [];
  await fs.writeFile(path.join(root, 'map.json'), `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  const proposal = json(await runNode('adaptive-plan.mjs', [
    'posture', 'promote', 'preview', '--root', root,
  ], JSON.stringify({
    kind: 'experiment',
    source: { kind: 'explicit_assessment', ref: 'decision://cli-promotion' },
    allowed_capabilities: ['measurement'], excluded_capabilities: ['deployment'],
    evidence: ['hypothesis', 'measurement_validity', 'reproduction_instructions'],
  })));
  assert.equal(proposal.writes, false);
  const proposalPath = path.join(root, 'promotion.json');
  await fs.writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
  const applied = json(await runNode('adaptive-plan.mjs', [
    'posture', 'promote', 'apply', '--root', root, '--proposal', proposalPath,
    '--expected-proposal-hash', proposal.proposal_hash,
    '--expected-posture-hash', proposal.base_posture_hash,
    '--brief-hash', proposal.approval_brief.brief_hash,
    '--approval', 'Approve experiment posture',
  ]));
  assert.equal(applied.writes, true);
  assert.equal(applied.posture_ref.kind, 'experiment');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'map.json'), 'utf8')).gates.design.status, 'stale');
});

test('init-plan can derive the canonical date-slug folder without overwriting an existing map', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-plan-base-'));
  const created = json(await runNode('init-plan.mjs', [
    '--base', base, '--date', '2026-08-22', '--slug', 'large migration',
    '--id', 'migration', '--title', 'Migration', '--goal', 'Stage the work',
  ]));
  assert.equal(created.plan_id, 'migration');
  assert.match(created.root, /2026-08-22-large-migration$/);
  const again = await runNode('init-plan.mjs', [
    '--base', base, '--date', '2026-08-22', '--slug', 'large migration',
    '--id', 'migration', '--title', 'Migration', '--goal', 'Stage the work',
  ]);
  assert.notEqual(again.code, 0);
  assert.match(again.stderr, /exists|force/i);
});

test('init-plan creates missing Superpowers plan parents and preserves sibling leaf plans', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-new-project-'));
  const base = path.join(project, 'docs', 'superpowers', 'plans');
  const created = json(await runNode('init-plan.mjs', [
    '--base', base, '--date', '2026-08-23', '--slug', 'new project migration',
    '--id', 'new-project-migration', '--title', 'New project migration', '--goal', 'Bootstrap planning',
  ]));
  assert.match(created.root, /docs[\\/]superpowers[\\/]plans[\\/]2026-08-23-new-project-migration$/);
  for (const relative of ['GUIDE.md', 'map.json', 'MAP.md', 'events.jsonl', 'nodes', 'plans', 'decisions', 'changes', 'provider-results']) {
    await assert.doesNotReject(fs.access(path.join(created.root, relative)));
  }

  const leafPath = path.join(base, '2026-08-23-existing-leaf.md');
  const leafContent = '# Existing Superpowers leaf plan\n';
  await fs.writeFile(leafPath, leafContent, 'utf8');
  await runNode('init-plan.mjs', [
    '--base', base, '--date', '2026-08-23', '--slug', 'second map',
    '--id', 'second-map', '--title', 'Second map', '--goal', 'Keep the leaf plan untouched',
  ]);
  assert.equal(await fs.readFile(leafPath, 'utf8'), leafContent);
});

test('top-level CLI completes and re-enters the design gate without replacing history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-design-cli-'));
  json(await runNode('init-plan.mjs', [
    '--root', root, '--id', 'design-map', '--title', 'Design map', '--goal', 'Exercise design re-entry',
  ]));
  const posture = createEngineeringPosture('reusable_internal', {
    source: { kind: 'explicit_assessment', ref: 'decision://cli-design-posture' },
    allowed_capabilities: ['public-api'],
    excluded_capabilities: ['deployment'],
  });
  const started = json(await runNode('adaptive-plan.mjs', [
    'design', 'start', '--root', root,
  ], JSON.stringify({
    design_id: 'public-api',
    public_api: true,
    requirements: ['Expose item reads'],
    posture_ref: postureRef(posture),
  })));
  assert.equal(started.schema_version, '2.1');
  assert.equal(started.threads[0].thread_id, 'root');
  const first = currentLedgerRevision(started);
  assert.equal(first.decision_status, 'in_progress');

  const updated = json(await runNode('adaptive-plan.mjs', [
    'design', 'update', '--root', root, '--expected-hash', first.content_hash,
  ], JSON.stringify({
    options: [{ id: 'rest', summary: 'REST' }, { id: 'graphql', summary: 'GraphQL' }],
    selected_option: { id: 'rest' },
    interfaces: ['GET /items/:id'],
    invariants: ['Errors use the public envelope'],
  })));
  const updatedRevision = currentLedgerRevision(updated);
  const brief = json(await runNode('adaptive-plan.mjs', [
    'design', 'brief', '--root', root,
  ]));
  const approved = json(await runNode('adaptive-plan.mjs', [
    'design', 'approve', '--root', root,
    '--expected-hash', brief.exact_content_hash,
    '--expected-posture-hash', brief.exact_posture_hash,
    '--brief-hash', brief.brief_hash,
    '--approval', 'Approve REST design',
    '--waiver', 'No installed security design reviewer',
  ]));
  assert.equal(brief.exact_content_hash, updatedRevision.content_hash);
  assert.equal(currentLedgerRevision(approved).decision_status, 'waived');
  const linked = json(await runNode('adaptive-plan.mjs', [
    'plan', 'link-design', '--root', root,
  ]));
  assert.equal(linked.gates.design.status, 'waived');

  const revised = json(await runNode('adaptive-plan.mjs', [
    'design', 'revise', '--root', root,
    '--reason', 'Pagination contract changed',
    '--question', 'Cursor or offset pagination?',
  ]));
  assert.equal(revised.threads[0].current_revision, 2);
  assert.equal(revised.threads[0].revisions[0].decision_status, 'stale');
  assert.equal(revised.threads[0].revisions[1].decision_status, 'in_progress');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'map.json'), 'utf8')).gates.design.status, 'stale');
});

test('top-level design update, approve, and link accept a migrated v2.1 ledger', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-design-migrated-cli-'));
  json(await runNode('init-plan.mjs', [
    '--root', root, '--id', 'migrated-design-map', '--title', 'Migrated design', '--goal', 'Continue migrated design work',
  ]));
  await fs.writeFile(path.join(root, 'design.json'), `${JSON.stringify({
    schema_version: '2.0',
    design_id: 'legacy-in-progress',
    current_revision: 1,
    revisions: [{
      revision: 1,
      status: 'in_progress',
      requirements: ['Choose a storage API'],
      options: [],
      selected_option: null,
      interfaces: [],
      invariants: [],
      failure_modes: [],
      operational_model: [],
      migration: [],
      blocking_questions: [],
      provider_selection: { status: 'ready', selected: [], blocking_concerns: [], composition_blockers: [] },
      profile: {},
      approval: null,
    }],
  }, null, 2)}\n`, 'utf8');
  const posture = createEngineeringPosture('reusable_internal', {
    source: { kind: 'explicit_assessment', ref: 'decision://migrated-design-posture' },
    allowed_capabilities: ['storage-api'],
    excluded_capabilities: ['deployment'],
  });
  const postureJson = JSON.stringify(postureRef(posture));
  const preview = json(await runNode('adaptive-plan.mjs', [
    'migrate', '--root', root, '--include-design', '--posture-ref', postureJson,
  ]));
  const migrated = json(await runNode('adaptive-plan.mjs', [
    'migrate', '--root', root, '--include-design', '--posture-ref', postureJson,
    '--apply', '--expected-hash', preview.proposal_hash,
  ]));
  assert.equal(migrated.design.schema_version, '2.1');

  const first = currentLedgerRevision(migrated.design);
  const updated = json(await runNode('adaptive-plan.mjs', [
    'design', 'update', '--root', root, '--expected-hash', first.content_hash,
  ], JSON.stringify({
    options: [{ id: 'files' }],
    selected_option: { id: 'files' },
    interfaces: ['Storage.read(key)'],
  })));
  const brief = json(await runNode('adaptive-plan.mjs', ['design', 'brief', '--root', root]));
  const approved = json(await runNode('adaptive-plan.mjs', [
    'design', 'approve', '--root', root,
    '--expected-hash', brief.exact_content_hash,
    '--expected-posture-hash', brief.exact_posture_hash,
    '--brief-hash', brief.brief_hash,
    '--approval', 'Approve file storage',
  ]));
  assert.equal(currentLedgerRevision(updated).decision_status, 'in_progress');
  assert.equal(currentLedgerRevision(approved).decision_status, 'approved');
  const linked = json(await runNode('adaptive-plan.mjs', ['plan', 'link-design', '--root', root]));
  assert.equal(linked.gates.design.status, 'approved');
  assert.equal(linked.gates.design.design_ref.design_hash, currentLedgerRevision(approved).content_hash);
});

test('top-level completion check enforces all workflow gates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-completion-cli-'));
  const map = json(await runNode('init-plan.mjs', [
    '--root', root, '--id', 'complete', '--title', 'Complete', '--goal', 'Validate gates',
  ]));
  const blocked = await runNode('adaptive-plan.mjs', ['completion', 'check', '--root', root]);
  assert.notEqual(blocked.code, 0);
  assert.match(blocked.stdout, /gate_intent/);

  map.gates.intent = { status: 'approved' };
  map.gates.design = { status: 'not_required' };
  map.gates.architecture_sync = { status: 'not_required' };
  const posture = createEngineeringPosture('spike', {
    source: { kind: 'explicit_assessment', ref: 'test://completion-cli' },
    allowed_capabilities: ['answer-question'],
    excluded_capabilities: ['deployment'],
  });
  map.engineering_posture = posture;
  map.posture_evidence = ['question_answered', 'result_validity'];
  map.nodes = [{
    id: 'N-001', title: 'Done', status: 'done', depends_on: [],
    posture_ref: postureRef(posture),
    scope_provenance: [{ kind: 'requirement', ref: 'R-ANSWER', behavior_id: 'answer' }],
    behavior_budget: { required: ['answer'], excluded: ['deploy'], deferred_candidates: [] },
    deferred_candidates: [],
  }];
  await fs.writeFile(path.join(root, 'map.json'), JSON.stringify(map));
  const complete = json(await runNode('adaptive-plan.mjs', ['completion', 'check', '--root', root]));
  assert.equal(complete.valid, true);
});

test('top-level design brief prints the exact terminal approval contract', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-design-brief-cli-'));
  json(await runNode('init-plan.mjs', [
    '--root', root, '--id', 'brief', '--title', 'Brief', '--goal', 'Render approval inline',
  ]));
  const posture = createEngineeringPosture('reusable_internal', {
    source: { kind: 'explicit_assessment', ref: 'decision://brief-design-posture' },
    allowed_capabilities: ['public-api'],
    excluded_capabilities: ['deployment'],
  });
  json(await runNode('adaptive-plan.mjs', ['design', 'start', '--root', root], JSON.stringify({
    design_id: 'brief-design', public_api: true, requirements: ['Expose reads'], posture_ref: postureRef(posture),
  })));
  const brief = json(await runNode('adaptive-plan.mjs', ['design', 'brief', '--root', root]));
  assert.equal(brief.subject.design_id, 'brief-design');
  assert.equal(typeof brief.exact_content_hash, 'string');
  assert.equal(typeof brief.brief_hash, 'string');
  assert.match(brief.prompt, /Approve root revision 1/);
});
