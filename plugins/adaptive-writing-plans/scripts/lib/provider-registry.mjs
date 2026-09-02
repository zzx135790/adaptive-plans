import { asArray } from './io-utils.mjs';

export const CAPABILITY_ORDER = Object.freeze([
  'clarify', 'explore', 'design', 'decide', 'scenario', 'decompose', 'review', 'execute',
]);

export const BUILTIN_FALLBACKS = Object.freeze({
  clarify: 'ada:ask-one-bounded-question',
  explore: 'ada:inspect-repository-evidence',
  design: 'ada:compare-explicit-options',
  decide: 'ada:record-explicit-decision',
  scenario: 'ada:record-bounded-risks',
  decompose: 'ada:build-dag',
  review: 'ada:validate-core-contracts',
  execute: 'ada:coordinate-execution',
});

const ACCEPTANCE = {
  clarify: 'the blocking ambiguity is resolved or explicitly deferred',
  explore: 'repository evidence is cited',
  design: 'options and the selected decision are explicit',
  decide: 'the decision and criteria are explicit',
  scenario: 'material risks and mitigations are explicit',
  decompose: 'the dependency DAG validates',
  review: 'the requested validation passes',
  execute: 'leaf results are integrated and verified',
};

const ALIASES = new Map([
  ['clarification', 'clarify'], ['question', 'clarify'], ['ask', 'clarify'],
  ['research', 'explore'], ['search', 'explore'], ['investigate', 'explore'],
  ['decision', 'decide'], ['compare', 'decide'], ['alternatives', 'decide'],
  ['risk', 'scenario'], ['risks', 'scenario'],
  ['planning', 'decompose'], ['plan', 'decompose'], ['map', 'decompose'],
  ['finalise', 'review'], ['finalize', 'review'], ['validate', 'review'],
  ['implementation', 'execute'], ['implement', 'execute'],
]);

function normalizeCapability(value) {
  const key = String(value ?? '').trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  return ALIASES.get(key) ?? key;
}

function roles(provider) {
  return asArray(provider?.roles).map(String);
}

export function selectVisibleProvider({ capability, role, visibleProviders, fallbacks } = {}) {
  const normalized = normalizeCapability(capability);
  const envelope = visibleProviders && typeof visibleProviders === 'object' ? visibleProviders : {};
  const candidates = asArray(envelope.providers).filter((provider) =>
    provider?.visible === true
    && (provider.kind === undefined || provider.kind === 'skill')
    && asArray(provider.capabilities).map(normalizeCapability).includes(normalized));
  const exact = role ? candidates.find((provider) => roles(provider).includes(role)) : null;
  const provider = exact ?? candidates[0] ?? null;
  if (provider) {
    return {
      capability: normalized,
      role: role ?? null,
      status: 'ready_to_invoke',
      selection_status: 'selected',
      invocation: 'not_invoked',
      provider: provider.id,
      provider_id: provider.id,
      reason: exact
        ? `visible skill ${provider.id} matches ${normalized} and role ${role}`
        : `visible skill ${provider.id} matches ${normalized}`,
      acceptance: ACCEPTANCE[normalized] ?? 'the declared output is accepted',
      verification: asArray(provider.verification).length > 0
        ? [...provider.verification]
        : [`verify ${normalized} output`],
    };
  }
  const fallback = fallbacks?.[normalized]
    ?? envelope.fallbacks?.[normalized]
    ?? BUILTIN_FALLBACKS[normalized]
    ?? `ada:${normalized || 'bounded'}-fallback`;
  return {
    capability: normalized,
    role: role ?? null,
    status: 'unavailable',
    selection_status: 'fallback',
    invocation: 'not_invoked',
    provider: null,
    provider_id: null,
    fallback,
    reason: `no visible skill matched ${normalized}${role ? ` and role ${role}` : ''}`,
    acceptance: ACCEPTANCE[normalized] ?? 'the bounded Ada fallback completes',
    verification: [`verify ${fallback}`],
  };
}

export function transitionProviderInvocation(route = {}, receipt = {}) {
  if (route.status !== 'ready_to_invoke') throw new Error('provider route is not ready');
  if (!route.provider_id || route.provider_id !== receipt.provider_id) {
    throw new Error('provider id in host receipt must match the selected visible skill');
  }
  return { ...route, status: 'invoked', invocation: 'invoked', receipt_id: receipt.receipt_id ?? null };
}
