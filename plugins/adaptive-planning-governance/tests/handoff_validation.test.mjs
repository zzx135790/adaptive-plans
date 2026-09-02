import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoff, normalizeProviderResult, validateHandoff, validateProviderResult } from '../scripts/lib/plan-protocol.mjs';

test('handoff validation catches malformed core fields while retaining extensions', () => {
  const compositionContract = {
    capability: 'design',
    provider_id: 'provider',
    source_ref: 'skill://provider',
    version_or_digest: 'version:1',
    dependency_refs: [],
    input_refs: ['map:N-004'],
    posture_ref: { kind: 'experiment', posture_hash: 'a'.repeat(64), source_ref: 'GUIDE.md#posture' },
    mutability: 'read_only',
    invocation: { policy: 'automatic', state: 'not_invoked', dependency_readiness: 'ready' },
    persistence: { expectations: 'persist result', state: 'not_verified' },
    expected_outputs: ['review'],
    verification: { status: 'pending', evidence_refs: [] },
    fallback: 'builtin-review',
  };
  const handoff = buildHandoff({
    mode: 'map',
    source: 'provider',
    summary: 'ok',
    posture_ref: { kind: 'experiment', posture_hash: 'a'.repeat(64), source_ref: 'GUIDE.md#posture' },
    behavior_budget: { required: ['measure'], excluded: ['deploy'], deferred_candidates: ['dashboard'] },
    scope_provenance: [{ kind: 'requirement', ref: 'R-MEASURE', behavior_id: 'measure' }],
    deferred_candidates: [{ behavior_id: 'dashboard' }],
    composition_contracts: [compositionContract],
    provider_results: [{ provider_id: 'provider', raw_ref: 'provider-results/provider.json', raw: { duplicate: true } }],
    vendor: { trace: 1 },
  });
  assert.equal(handoff.extensions.vendor.trace, 1);
  assert.deepEqual(handoff.behavior_budget.required, ['measure']);
  assert.equal(handoff.provider_results[0].raw, null);
  assert.equal(validateHandoff(handoff).valid, true);
  const invalid = validateHandoff({ ...handoff, mode: 'invalid' });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((item) => item.code === 'invalid_mode'));
});

test('provider validation rejects invented confidence shapes and accepts unstructured raw output', () => {
  const result = normalizeProviderResult('Need to ask infra.', { provider_id: 'qa', capability: 'clarify', source: 'skill://qa/1' });
  assert.equal(validateProviderResult(result).valid, true);
  const invalid = validateProviderResult({ ...result, status: 'ok', confidence: 'high' });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((item) => item.code === 'invalid_confidence'));
  const persisted = normalizeProviderResult({ findings: ['ok'] }, {
    provider_id: 'qa',
    capability: 'design',
    raw_ref: 'provider-results/qa.json',
  });
  assert.equal(persisted.raw, null);
  assert.equal(persisted.lifecycle.persistence, 'verified');
  assert.equal(validateProviderResult(persisted).valid, true);
  const duplicated = validateProviderResult({ ...persisted, raw: { copied: true } });
  assert.ok(duplicated.errors.some((item) => item.code === 'duplicated_provider_raw'));
});
