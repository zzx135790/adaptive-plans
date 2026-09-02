import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyProviderWorkflowOutcome, PROVIDER_COMPOSITION_VERSION } from '../scripts/lib/provider-composition.mjs';

// Helper to create valid handoff and composition contract
function createValidHandoff(overrides = {}) {
  return {
    schema_version: '2.0',
    provider_id: 'test',
    capability: 'clarify',
    source: 'test-provider',
    mode: 'direct',
    stage: 'complete',
    work_shape: 'direct',
    gates: {},
    posture_ref: null,
    behavior_budget: {},
    ...overrides,
  };
}

function createValidContract(overrides = {}) {
  return {
    schema_version: '2.0',
    capability: 'clarify',
    provider_id: 'test',
    source_ref: 'test-source',
    version_or_digest: 'v1.0.0',
    mutability: 'immutable',
    dependency_refs: [],
    input_refs: [],
    expected_outputs: [],
    posture_ref: null,
    invocation: { policy: 'manual', state: 'completed', dependency_readiness: 'ready' },
    persistence: { expectations: 'none', state: 'verified' },
    verification: { status: 'verified', evidence_refs: [] },
    fallback: null,
    ...overrides,
  };
}

describe('Provider Composition Verification', () => {
  it('rejects invalid handoff', () => {
    const receipt = {
      handoff: { schema_version: '999.0', provider_id: 'test' },
      composition_contract: { schema_version: '2.0', provider_id: 'test' },
      provider_id: 'test',
      invocation_state: 'completed',
      persistence_state: 'verified',
      expected_artifact_refs: [],
      observed_artifact_refs: [],
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.equal(result.outcome, 'unverified_persistence');
    assert.ok(result.reasons.some((r) => r.startsWith('invalid_handoff')));
  });

  it('rejects invalid composition contract', () => {
    const receipt = {
      handoff: { schema_version: '2.0', provider_id: 'test', capability: 'clarify' },
      composition_contract: { schema_version: '999.0' },
      provider_id: 'test',
      invocation_state: 'completed',
      persistence_state: 'verified',
      expected_artifact_refs: [],
      observed_artifact_refs: [],
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.equal(result.outcome, 'unverified_persistence');
    assert.ok(result.reasons.some((r) => r.startsWith('invalid_composition')));
  });

  it('detects provider identity mismatch', () => {
    const receipt = {
      handoff: { schema_version: '2.0', provider_id: 'provider-a', capability: 'clarify' },
      composition_contract: { schema_version: '2.0', provider_id: 'provider-b' },
      provider_id: 'provider-a',
      invocation_state: 'completed',
      persistence_state: 'verified',
      expected_artifact_refs: [],
      observed_artifact_refs: [],
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.ok(result.reasons.includes('provider_identity_mismatch'));
  });

  it('detects incomplete invocation', () => {
    const receipt = {
      handoff: { schema_version: '2.0', provider_id: 'test', capability: 'clarify' },
      composition_contract: { schema_version: '2.0', provider_id: 'test' },
      provider_id: 'test',
      invocation_state: 'failed',
      persistence_state: 'verified',
      expected_artifact_refs: [],
      observed_artifact_refs: [],
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.ok(result.reasons.includes('invocation_not_completed'));
  });

  it('detects missing artifacts', () => {
    const receipt = {
      handoff: {
        schema_version: '2.0',
        provider_id: 'test',
        capability: 'design',
        artifacts: ['design.md'],
      },
      composition_contract: { schema_version: '2.0', provider_id: 'test', invocation: { dependency_readiness: 'ready' } },
      provider_id: 'test',
      invocation_state: 'completed',
      persistence_state: 'verified',
      expected_artifact_refs: ['design.md', 'spec.md'],
      observed_artifact_refs: ['design.md'],
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.equal(result.outcome, 'unverified_persistence');
    assert.ok(result.reasons.includes('expected_artifact_not_observed'));
    assert.deepEqual(result.missing_artifact_refs, ['spec.md']);
  });

  it('returns conversation_only for no expected artifacts', () => {
    const receipt = {
      handoff: createValidHandoff(),
      composition_contract: createValidContract(),
      provider_id: 'test',
      invocation_state: 'completed',
      persistence_state: 'verified',
      expected_artifact_refs: [],
      observed_artifact_refs: [],
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.equal(result.outcome, 'conversation_only');
    assert.equal(result.reasons.length, 0);
  });

  it('returns persisted for verified artifacts', () => {
    const receipt = {
      handoff: createValidHandoff({
        capability: 'design',
        artifacts: ['design.md'],
      }),
      composition_contract: createValidContract({
        capability: 'design',
        expected_outputs: ['design.md'],
        persistence: { expectations: 'artifacts', state: 'verified' },
      }),
      provider_id: 'test',
      invocation_state: 'completed',
      persistence_state: 'verified',
      expected_artifact_refs: ['design.md'],
      observed_artifact_refs: ['design.md'],
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.equal(result.outcome, 'persisted');
    assert.equal(result.reasons.length, 0);
    assert.equal(result.schema_version, PROVIDER_COMPOSITION_VERSION);
  });

  it('flags unverified persistence', () => {
    const receipt = {
      handoff: createValidHandoff({
        capability: 'design',
        artifacts: ['design.md'],
      }),
      composition_contract: createValidContract({
        capability: 'design',
        expected_outputs: ['design.md'],
        persistence: { expectations: 'artifacts', state: 'unverified' },
        verification: { status: 'unverified', evidence_refs: [] },
      }),
      provider_id: 'test',
      invocation_state: 'completed',
      persistence_state: 'unverified',
      expected_artifact_refs: ['design.md'],
      observed_artifact_refs: ['design.md'],
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.equal(result.outcome, 'unverified_persistence');
    assert.ok(result.reasons.includes('persistence_not_verified'));
  });

  it('detects version/digest drift', () => {
    const receipt = {
      handoff: { schema_version: '2.0', provider_id: 'test', capability: 'clarify' },
      composition_contract: {
        schema_version: '2.0',
        provider_id: 'test',
        version_or_digest: 'v1.0.0',
        invocation: { dependency_readiness: 'ready' },
      },
      provider_id: 'test',
      invocation_state: 'completed',
      persistence_state: 'verified',
      expected_artifact_refs: [],
      observed_artifact_refs: [],
      expected_version_or_digest: 'v2.0.0',
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.ok(result.reasons.includes('version_digest_drift'));
  });

  it('handles missing dependency readiness', () => {
    const receipt = {
      handoff: { schema_version: '2.0', provider_id: 'test', capability: 'clarify' },
      composition_contract: {
        schema_version: '2.0',
        provider_id: 'test',
        invocation: { dependency_readiness: 'blocked' },
      },
      provider_id: 'test',
      invocation_state: 'completed',
      persistence_state: 'verified',
      expected_artifact_refs: [],
      observed_artifact_refs: [],
    };

    const result = verifyProviderWorkflowOutcome(receipt);
    assert.ok(result.reasons.includes('dependency_not_ready'));
  });
});

describe('Provider Discovery Non-Automatic', () => {
  it('verifyProviderWorkflowOutcome never installs or invokes', () => {
    // This is a design constraint test: verifyProviderWorkflowOutcome is
    // purely observational. It receives a receipt from an already-completed
    // invocation and validates its outcome. It never triggers discovery,
    // installation, or invocation.

    const receipt = {
      handoff: createValidHandoff({ provider_id: 'unknown-provider' }),
      composition_contract: createValidContract({ provider_id: 'unknown-provider' }),
      provider_id: 'unknown-provider',
      invocation_state: 'completed',
      persistence_state: 'verified',
      expected_artifact_refs: [],
      observed_artifact_refs: [],
    };

    // Should not throw, should not attempt to discover/install/invoke
    const result = verifyProviderWorkflowOutcome(receipt);
    assert.equal(result.provider_id, 'unknown-provider');
    assert.equal(result.outcome, 'conversation_only');
  });
});
