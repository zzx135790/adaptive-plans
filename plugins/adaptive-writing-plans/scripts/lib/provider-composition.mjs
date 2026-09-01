/**
 * Host-neutral provider composition verification.
 *
 * Validates provider workflow outcomes without coupling to host-specific
 * installation or synchronization logic. Discovery remains observational;
 * installation and invocation are never automatic.
 */

import { validateHandoff } from './plan-protocol.mjs';
import { validateCompositionContract } from './design-engine.mjs';
import { stableHash } from './io-utils.mjs';

export const PROVIDER_COMPOSITION_VERSION = '1.0';

function uniqueRefs(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value)).filter(Boolean))];
}

function handoffArtifactRefs(handoff) {
  return uniqueRefs((Array.isArray(handoff?.artifacts) ? handoff.artifacts : []).map((artifact) => (
    typeof artifact === 'string' ? artifact : artifact?.path ?? artifact?.ref ?? ''
  )));
}

/**
 * Verify a provider workflow outcome against expected artifacts and persistence.
 *
 * Returns a verification result distinguishing:
 * - `persisted`: expected artifacts are observed, declared, and persistence verified
 * - `conversation_only`: no artifacts expected (conversation-only provider)
 * - `unverified_persistence`: artifacts expected but not observed/declared, or persistence unverified
 *
 * Discovery may report a provider as available, but verification is the only
 * claim that its output reached durable state. Missing, duplicate, unavailable,
 * and unverified providers remain distinguishable.
 *
 * @param {object} receipt - Provider invocation receipt
 * @param {object} receipt.handoff - PlanningHandoff envelope
 * @param {object} receipt.composition_contract - CompositionContract
 * @param {string} receipt.provider_id - Provider identity
 * @param {string} receipt.invocation_state - 'completed' | other
 * @param {string} receipt.persistence_state - 'verified' | other
 * @param {string[]} receipt.expected_artifact_refs - Expected artifact paths
 * @param {string[]} receipt.observed_artifact_refs - Observed artifact paths
 * @param {string} [receipt.expected_version_or_digest] - Expected provider version
 * @returns {object} Verification result with outcome, reasons, and artifact lists
 */
export function verifyProviderWorkflowOutcome(receipt = {}) {
  const reasons = [];

  // Validate handoff envelope
  const handoffValidation = validateHandoff(receipt.handoff);
  if (!handoffValidation.valid) {
    reasons.push(...handoffValidation.errors.map((error) => `invalid_handoff:${error.code}`));
  }

  // Validate composition contract
  const contractValidation = validateCompositionContract(receipt.composition_contract);
  if (!contractValidation.valid) {
    reasons.push(...contractValidation.errors.map((error) => `invalid_composition:${error.code}`));
  }

  // Check provider identity consistency
  if (receipt.provider_id !== receipt.composition_contract?.provider_id) {
    reasons.push('provider_identity_mismatch');
  }

  // Check invocation completed
  if (receipt.invocation_state !== 'completed') {
    reasons.push('invocation_not_completed');
  }

  // Check dependency readiness
  if (receipt.composition_contract?.invocation?.dependency_readiness !== 'ready') {
    reasons.push('dependency_not_ready');
  }

  // Check version/digest drift
  if (receipt.expected_version_or_digest
    && receipt.expected_version_or_digest !== receipt.composition_contract?.version_or_digest) {
    reasons.push('version_digest_drift');
  }

  // Check artifact presence
  const expected = uniqueRefs(receipt.expected_artifact_refs);
  const observed = uniqueRefs(receipt.observed_artifact_refs);
  const declared = handoffArtifactRefs(receipt.handoff);
  const missing = expected.filter((artifact) => !observed.includes(artifact) || !declared.includes(artifact));
  if (missing.length > 0) {
    reasons.push('expected_artifact_not_observed');
  }

  // Determine outcome status
  let status;
  if (reasons.length > 0) {
    status = 'unverified_persistence';
  } else if (expected.length === 0) {
    status = 'conversation_only';
  } else if (receipt.persistence_state === 'verified') {
    status = 'persisted';
  } else {
    status = 'unverified_persistence';
    reasons.push('persistence_not_verified');
  }

  return {
    schema_version: PROVIDER_COMPOSITION_VERSION,
    provider_id: String(receipt.provider_id ?? ''),
    version_or_digest: receipt.composition_contract?.version_or_digest ?? null,
    outcome: status,
    handoff_hash: receipt.handoff ? stableHash(receipt.handoff) : null,
    expected_artifact_refs: expected,
    observed_artifact_refs: observed,
    missing_artifact_refs: missing,
    reasons,
    canonical_mutation: false,
  };
}
