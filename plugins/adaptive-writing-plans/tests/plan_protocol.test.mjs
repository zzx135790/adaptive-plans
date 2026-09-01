import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  appendEvent,
  buildHandoff,
  createPlanManifest,
  getNextNodes,
  normalizeProviderResult,
  validateMap,
} from '../scripts/lib/plan-protocol.mjs';
import {
  createEngineeringPosture,
  postureRef,
} from '../scripts/lib/engineering-posture.mjs';

test('createPlanManifest creates a portable guide/map layout', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-plan-'));
  const manifest = await createPlanManifest(root, {
    planId: '2026-08-22-sample',
    title: 'Sample plan',
    goal: 'Validate a staged migration',
  });

  assert.equal(manifest.schema_version, '2.0');
  assert.equal(manifest.plan_id, '2026-08-22-sample');
  for (const relative of ['GUIDE.md', 'map.json', 'MAP.md', 'events.jsonl', 'nodes', 'plans', 'decisions', 'changes', 'provider-results']) {
    await assert.doesNotReject(fs.access(path.join(root, relative)));
  }
});

test('createPlanManifest preserves an existing append-only event log', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-plan-preserve-events-'));
  await createPlanManifest(root, { planId: 'p', title: 'P', goal: 'G' });
  await appendEvent(root, { event_id: 'keep-me', type: 'fact', message: 'already recorded' });
  await createPlanManifest(root, { planId: 'p', title: 'P refreshed', goal: 'G2', overwrite: true });
  const events = await fs.readFile(path.join(root, 'events.jsonl'), 'utf8');
  assert.match(events, /keep-me/);
});

test('validateMap rejects cycles and unknown dependencies', () => {
  const cyclic = {
    schema_version: '1.0',
    plan_id: 'p',
    nodes: [
      { id: 'N-001', title: 'A', status: 'ready', depends_on: ['N-002'] },
      { id: 'N-002', title: 'B', status: 'ready', depends_on: ['N-001'] },
    ],
  };
  const result = validateMap(cyclic);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'cycle'));

  const dangling = {
    ...cyclic,
    nodes: [{ id: 'N-001', title: 'A', status: 'ready', depends_on: ['N-404'] }],
  };
  const danglingResult = validateMap(dangling);
  assert.ok(danglingResult.errors.some((error) => error.code === 'unknown_dependency'));
});

test('validateMap reports malformed nodes instead of throwing and supports strict schema checks', () => {
  const malformed = validateMap({ schema_version: '1.0', plan_id: 'p', nodes: [null] });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.some((error) => error.code === 'invalid_node'));

  const nonCanonical = validateMap({
    schema_version: '1.0',
    plan_id: 'p',
    nodes: [{ id: 'custom', title: 'A', status: 'idea', depends_on: [] }],
  }, { strict: true });
  assert.equal(nonCanonical.valid, false);
  assert.ok(nonCanonical.errors.some((error) => error.code === 'invalid_node_id'));
});

test('authoritative posture maps require scope contracts on executable non-control nodes', () => {
  const posture = createEngineeringPosture('experiment', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['measurement'],
    excluded_capabilities: ['deployment'],
  });
  const map = {
    schema_version: '2.0',
    plan_id: 'posture-map',
    stage: 'mapping',
    work_shape: 'map',
    gates: {},
    engineering_posture: posture,
    nodes: [
      { id: 'N-000', kind: 'control', title: 'Bootstrap', status: 'done', depends_on: [] },
      {
        id: 'N-001',
        title: 'Measure',
        status: 'ready',
        depends_on: ['N-000'],
        inputs: ['data'],
        outputs: ['measurement'],
        acceptance: ['measurement recorded'],
      },
    ],
  };
  const missing = validateMap(map);
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.code === 'node_missing_posture_ref'));

  map.nodes[1].posture_ref = postureRef(posture);
  map.nodes[1].scope_provenance = [
    { kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'measurement' },
  ];
  map.nodes[1].behavior_budget = {
    required: ['measurement'],
    excluded: ['deployment'],
    deferred_candidates: [],
  };
  map.nodes[1].deferred_candidates = [];
  assert.equal(validateMap(map).valid, true);

  map.nodes[1].posture_ref.posture_hash = '0'.repeat(64);
  assert.ok(validateMap(map).errors.some((error) => error.code === 'node_stale_posture_ref'));
});

test('maps without posture remain readable with an unknown legacy warning', () => {
  const result = validateMap({
    schema_version: '2.0',
    plan_id: 'legacy-posture',
    stage: 'mapping',
    work_shape: 'map',
    gates: {},
    nodes: [],
  });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'unknown_legacy_map_posture'));
});

test('getNextNodes does not expose nodes whose readiness gates are incomplete', () => {
  const map = {
    nodes: [
      { id: 'N-001', title: 'Unspecified', status: 'idea', depends_on: [] },
      {
        id: 'N-002', title: 'Ready', status: 'idea', depends_on: [],
        inputs: ['repo'], outputs: ['notes'], acceptance: ['notes exist'], blocking_questions: [],
      },
    ],
  };
  assert.deepEqual(getNextNodes(map).map((node) => node.id), ['N-002']);
});

test('normalizeProviderResult preserves unstructured output and provenance', () => {
  const result = normalizeProviderResult({
    provider_id: 'external-qa',
    capability: 'clarify',
    output: 'Check retention and legacy compatibility before choosing dual-write.',
    source: 'skill://external-qa/run/17',
  });

  assert.equal(result.status, 'unstructured');
  assert.equal(result.provider_id, 'external-qa');
  assert.match(result.raw.text, /retention/);
  assert.equal(result.raw.source, 'skill://external-qa/run/17');
});

test('normalizeProviderResult preserves raw object input and marks missing output unavailable', () => {
  const rawInput = { output: 'Conditional advice', confidence: 'high', vendor: { trace: 1 } };
  const result = normalizeProviderResult(rawInput, { provider_id: 'qa', capability: 'clarify' });
  assert.equal(result.status, 'unstructured');
  assert.deepEqual(result.raw.value, rawInput);
  assert.equal(result.extensions.vendor.trace, 1);
  const unavailable = normalizeProviderResult(null, { provider_id: 'qa', capability: 'clarify' });
  assert.equal(unavailable.status, 'unavailable');
});

test('appendEvent is idempotent by event id', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-events-'));
  const first = await appendEvent(root, { event_id: 'evt-1', type: 'fact', message: 'test passed' });
  const second = await appendEvent(root, { event_id: 'evt-1', type: 'fact', message: 'test passed' });

  assert.equal(first.appended, true);
  assert.equal(second.appended, false);
  const lines = (await fs.readFile(path.join(root, 'events.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
});

test('appendEvent remains idempotent for concurrent writers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-events-concurrent-'));
  const results = await Promise.all(Array.from({ length: 8 }, () => appendEvent(root, {
    event_id: 'evt-concurrent', type: 'fact', message: 'same fact',
  })));
  assert.equal(results.filter((result) => result.appended).length, 1);
  const lines = (await fs.readFile(path.join(root, 'events.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
});

test('appendEvent requires a type and protects canonical metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-events-envelope-'));
  await assert.rejects(() => appendEvent(root, { event_id: 'missing-type' }), /event\.type/i);
  const result = await appendEvent(root, {
    event_id: 'canonical', type: 'fact', schema_version: '9.9', occurred_at: '1970-01-01T00:00:00.000Z',
  });
  assert.equal(result.record.schema_version, '2.0');
  assert.notEqual(result.record.occurred_at, '1970-01-01T00:00:00.000Z');
});

test('buildHandoff keeps extensions for compatible external skills', () => {
  const handoff = buildHandoff({
    source: 'external-skill',
    mode: 'guide',
    summary: 'Need one clarification',
    questions: [{ id: 'q1', text: 'Which retention policy?' }],
    extensions: { vendor_field: { keep: true } },
  });

  assert.equal(handoff.schema_version, '2.0');
  assert.deepEqual(handoff.extensions.vendor_field, { keep: true });
  assert.equal(handoff.questions.length, 1);
});
