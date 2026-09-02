import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  asArray,
  cloneJson,
  isObject,
  readJson,
  readJsonIfExists,
  stableHash,
  withFileLock,
  writeJsonAtomic,
  writeTextAtomic,
} from './io-utils.mjs';
import {
  currentStateHash,
  designRevisionContentHash,
  designRevisionStateHash,
  legacyDesignRevisionHash,
  reviewedContentHash,
  withDesignRevisionHashes,
} from './design-hashing.mjs';
import {
  normalizeBehaviorBudget,
  partitionBehaviorCandidates,
} from './engineering-posture.mjs';

export const DESIGN_SCHEMA_VERSION = '2.0';
export const DESIGN_LEDGER_SCHEMA_VERSION = '2.1';
export const DESIGN_STATUSES = new Set(['in_progress', 'approved', 'stale', 'waived']);

const TRIGGER_CONCERNS = {
  cross_module: ['boundaries', 'dependencies', 'compatibility', 'reliability'],
  public_api: ['api', 'compatibility', 'security', 'testing'],
  data_model: ['data', 'integrity', 'migration', 'operability'],
  migration: ['migration', 'compatibility', 'reliability', 'operability'],
  security: ['security', 'operability', 'testing'],
  performance: ['performance', 'operability', 'testing'],
  concurrency: ['distributed', 'reliability', 'performance', 'testing'],
  failure_semantics: ['reliability', 'operability', 'testing'],
  new_dependency: ['dependencies', 'security', 'compatibility'],
  new_module: ['boundaries', 'dependencies', 'operability', 'testing'],
  contract_missing: ['boundaries', 'api', 'dependencies'],
  user_requested: ['alternatives', 'tradeoffs'],
};

const CRITICAL_CONCERNS = new Set(['security', 'data', 'migration', 'distributed']);
const BUILTIN_CONCERNS = new Set(['alternatives', 'tradeoffs', 'boundaries', 'dependencies', 'compatibility', 'reliability', 'operability', 'testing', 'api', 'performance']);
const PROTECTED_REVISION_FIELDS = new Set([
  'revision', 'status', 'architecture_hash', 'profile', 'provider_selection',
  'provider_results', 'approval', 'provider_waiver', 'design_hash', 'updated_at',
]);

export function validateCompositionContract(contract) {
  const errors = [];
  if (!isObject(contract)) return { valid: false, errors: [{ code: 'invalid_composition_contract', message: 'composition contract must be an object' }] };
  for (const field of ['capability', 'provider_id', 'source_ref', 'version_or_digest', 'mutability']) {
    if (typeof contract[field] !== 'string' || contract[field].length === 0) {
      errors.push({ code: `invalid_composition_${field}`, message: `composition contract ${field} is required` });
    }
  }
  for (const field of ['dependency_refs', 'input_refs', 'expected_outputs']) {
    if (!Array.isArray(contract[field])) errors.push({ code: `invalid_composition_${field}`, message: `composition contract ${field} must be an array` });
  }
  if (contract.posture_ref !== null && !isObject(contract.posture_ref)) errors.push({ code: 'invalid_composition_posture_ref', message: 'composition contract posture_ref must be an object or null' });
  if (!isObject(contract.invocation)
    || typeof contract.invocation.policy !== 'string'
    || typeof contract.invocation.state !== 'string'
    || typeof contract.invocation.dependency_readiness !== 'string') {
    errors.push({ code: 'invalid_composition_invocation', message: 'composition contract invocation policy, state, and dependency readiness are required' });
  }
  if (!isObject(contract.persistence)
    || typeof contract.persistence.expectations !== 'string'
    || typeof contract.persistence.state !== 'string') {
    errors.push({ code: 'invalid_composition_persistence', message: 'composition contract persistence expectations and state are required' });
  }
  if (!isObject(contract.verification)
    || typeof contract.verification.status !== 'string'
    || !Array.isArray(contract.verification.evidence_refs)) {
    errors.push({ code: 'invalid_composition_verification', message: 'composition contract verification status and evidence refs are required' });
  }
  if (!Object.hasOwn(contract, 'fallback')) errors.push({ code: 'missing_composition_fallback', message: 'composition contract fallback must be explicit' });
  return { valid: errors.length === 0, errors };
}

function words(input) {
  return `${input.summary ?? ''} ${input.description ?? ''} ${asArray(input.change_types).join(' ')}`.toLowerCase();
}

export function triageDesign(input = {}) {
  const text = words(input);
  const triggerSet = new Set(asArray(input.change_types));
  const flags = {
    cross_module: input.cross_module === true,
    public_api: input.public_api === true || /\b(?:public api|openapi|graphql|grpc|sdk|interface)\b/.test(text),
    data_model: input.data_model === true || /\b(?:database|schema|storage|persistence|data model)\b/.test(text),
    migration: input.migration === true || /\b(?:migration|backfill|rollback|dual write)\b/.test(text),
    security: input.security === true || /\b(?:security|authorization|authentication|privacy|sensitive data)\b/.test(text),
    performance: input.performance === true || /\b(?:performance|latency|throughput|memory budget|benchmark)\b/.test(text),
    concurrency: input.concurrency === true || /\b(?:concurrency|distributed|event driven|queue|ordering|idempotent)\b/.test(text),
    failure_semantics: input.failure_semantics === true || /\b(?:failure|retry|recovery|fallback|error semantics)\b/.test(text),
    new_dependency: input.new_dependency === true,
    new_module: input.new_module === true,
    contract_missing: input.contract_missing === true,
    user_requested: input.user_requested === true,
  };
  for (const [trigger, active] of Object.entries(flags)) if (active) triggerSet.add(trigger);
  const triggers = [...triggerSet].filter((trigger) => Object.hasOwn(TRIGGER_CONCERNS, trigger)).sort();
  const concerns = [...new Set(triggers.flatMap((trigger) => TRIGGER_CONCERNS[trigger]))].sort();
  const critical = concerns.some((concern) => CRITICAL_CONCERNS.has(concern));
  const highImpact = critical || triggers.some((trigger) => ['cross_module', 'public_api', 'new_module', 'migration'].includes(trigger));
  return {
    schema_version: DESIGN_SCHEMA_VERSION,
    required: triggers.length > 0,
    scope: input.scope === 'node' ? 'node' : 'root',
    node_id: input.node_id ?? null,
    triggers,
    concerns,
    domains: [...new Set(asArray(input.domains).concat(input.domain ? [input.domain] : ['architecture']))],
    impacted_modules: [...new Set(asArray(input.impacted_modules))],
    impacted_relations: [...new Set(asArray(input.impacted_relations))],
    risk: critical ? 'critical' : highImpact ? 'high' : triggers.length > 0 ? 'standard' : 'low',
    requires_alternatives: highImpact,
    architecture_hash: input.architecture_hash ?? null,
    posture_ref: cloneJson(input.posture_ref ?? null),
    behavior_budget: normalizeBehaviorBudget(input.behavior_budget),
    scope_provenance: asArray(input.scope_provenance),
    deferred_candidates: asArray(input.deferred_candidates),
    input_refs: asArray(input.input_refs),
  };
}

async function defaultCatalog() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const pluginCatalog = path.resolve(currentDir, '..', '..', 'skills', 'adaptive-planning-governance', 'references', 'design-provider-catalog.json');
  try {
    return await readJson(pluginCatalog);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return readJson(path.resolve(currentDir, '..', '..', 'references', 'design-provider-catalog.json'));
  }
}

function descriptorFor(provider, byId) {
  const catalog = byId.get(provider.id) ?? {};
  const frontmatter = provider.metadata?.frontmatter ?? {};
  const design = provider.metadata?.design ?? {};
  const firstNonEmpty = (...values) => values.map(asArray).find((value) => value.length > 0) ?? [];
  const dependencyRefs = firstNonEmpty(provider.metadata?.composition?.dependency_refs, catalog.dependency_refs);
  return {
    id: provider.id,
    source: provider.source,
    availability: provider.availability,
    roles: firstNonEmpty(design.roles, frontmatter.design_roles, catalog.roles),
    domains: firstNonEmpty(design.domains, frontmatter.design_domains, catalog.domains),
    concerns: firstNonEmpty(design.concerns, frontmatter.design_concerns, catalog.concerns),
    mutability: String(
      design.mutability && design.mutability !== 'unknown'
        ? design.mutability
        : frontmatter.mutability ?? catalog.mutability ?? 'unknown',
    ),
    capabilities: asArray(provider.capabilities),
    catalog_match: Object.keys(catalog).length > 0 || provider.metadata?.composition?.catalog_match === true,
    version_or_digest: String(provider.identity?.version_or_digest ?? 'unknown'),
    dependency_refs: dependencyRefs,
    dependency_readiness: dependencyRefs.length === 0
      ? 'ready'
      : String(provider.lifecycle?.dependency_readiness ?? 'not_checked'),
    invocation_state: String(provider.lifecycle?.invocation ?? 'not_invoked'),
    persistence_state: String(provider.lifecycle?.persistence ?? 'not_verified'),
    expected_outputs: firstNonEmpty(provider.metadata?.composition?.expected_outputs, catalog.expected_outputs),
    persistence_expectations: String(
      provider.metadata?.composition?.persistence_expectations
        ?? catalog.persistence_expectations
        ?? 'record provider result before using it as decision evidence',
    ),
    fallback: provider.metadata?.composition?.fallback ?? catalog.fallback ?? null,
  };
}

function compositionContractFor(provider, profile, invocation) {
  return {
    capability: 'design',
    provider_id: provider.id,
    source_ref: provider.source,
    version_or_digest: provider.version_or_digest ?? (provider.id === 'builtin-design-driver' ? 'builtin:2.1' : 'unknown'),
    dependency_refs: asArray(provider.dependency_refs),
    input_refs: asArray(profile.input_refs),
    posture_ref: cloneJson(profile.posture_ref ?? null),
    mutability: provider.mutability,
    invocation: {
      policy: invocation,
      state: provider.invocation_state ?? 'not_invoked',
      dependency_readiness: provider.dependency_readiness ?? 'ready',
    },
    persistence: {
      expectations: provider.persistence_expectations ?? 'record provider result before using it as decision evidence',
      state: provider.persistence_state ?? 'not_verified',
    },
    expected_outputs: asArray(provider.expected_outputs),
    verification: {
      status: provider.catalog_match === false ? 'contract_missing' : 'pending',
      evidence_refs: [],
    },
    fallback: provider.fallback ?? null,
  };
}

function selectedProvider(provider, profile, role, reason) {
  const automatic = provider.id === 'builtin-design-driver'
    || (provider.catalog_match === true
      && provider.mutability === 'read_only'
      && provider.dependency_readiness === 'ready');
  const invocation = automatic ? 'automatic' : 'requires_confirmation';
  return {
    ...provider,
    role,
    reason,
    invocation,
    composition_contract: compositionContractFor(provider, profile, invocation),
  };
}

function matchesProfile(descriptor, profile) {
  return descriptor.domains.some((domain) => profile.domains.includes(domain))
    || descriptor.concerns.some((concern) => profile.concerns.includes(concern));
}

export async function selectDesignProviders(profile, registry, options = {}) {
  const catalog = options.catalog ?? await defaultCatalog();
  const byId = new Map(asArray(catalog.providers).map((item) => [item.id, item]));
  const descriptors = asArray(registry?.providers).map((provider) => descriptorFor(provider, byId));
  const candidates = descriptors.filter((descriptor) => descriptor.availability === 'discovered' && matchesProfile(descriptor, profile));
  const builtin = {
    id: 'builtin-design-driver',
    source: 'builtin://adaptive-planning-governance/design-driver',
    concerns: [...BUILTIN_CONCERNS],
    mutability: 'read_only',
    catalog_match: true,
    version_or_digest: 'builtin:2.1',
    dependency_refs: [],
    dependency_readiness: 'ready',
    invocation_state: 'not_invoked',
    persistence_state: 'not_verified',
    expected_outputs: ['design-options', 'design-decision', 'approval-brief'],
    persistence_expectations: 'write canonical design state only through the ledger contract',
    fallback: null,
  };
  const selected = [selectedProvider(
    builtin,
    profile,
    'driver',
    'Normalizes evidence, alternatives, approvals, and architecture deltas.',
  )];

  for (const role of ['driver', 'reference', 'reviewer']) {
    for (const descriptor of candidates.filter((candidate) => candidate.roles.includes(role))) {
      if (selected.some((item) => item.id === descriptor.id)) continue;
      const covered = descriptor.concerns.filter((concern) => profile.concerns.includes(concern));
      selected.push(selectedProvider(
        descriptor,
        profile,
        role,
        `Covers ${covered.join(', ') || descriptor.domains.join(', ')} for this design profile.`,
      ));
    }
  }

  return normalizeDesignProviderSelection(profile, {
    schema_version: DESIGN_SCHEMA_VERSION,
    selected,
    policy: {
      automatic_only_when: 'installed-catalogued-read-only',
      installation: 'never-automatic',
      critical_missing_provider: 'block-or-explicit-waiver',
    },
  });
}

export function normalizeDesignProviderSelection(profile, input = {}) {
  const selected = asArray(input.selected).map((provider) => {
    const mutability = String(provider.mutability ?? 'unknown');
    const automatic = provider.id === 'builtin-design-driver'
      || (provider.catalog_match === true
        && mutability === 'read_only'
        && (provider.dependency_readiness ?? provider.composition_contract?.invocation?.dependency_readiness) === 'ready');
    const invocation = automatic ? 'automatic' : 'requires_confirmation';
    return {
      ...cloneJson(provider),
      mutability,
      invocation,
      composition_contract: cloneJson(provider.composition_contract
        ?? compositionContractFor({ ...provider, mutability }, profile, invocation)),
    };
  });
  if (!selected.some((provider) => provider.id === 'builtin-design-driver')) {
    selected.unshift(selectedProvider({
      id: 'builtin-design-driver',
      source: 'builtin://adaptive-planning-governance/design-driver',
      concerns: [...BUILTIN_CONCERNS],
      mutability: 'read_only',
      catalog_match: true,
      version_or_digest: 'builtin:2.1',
      dependency_refs: [],
      dependency_readiness: 'ready',
      invocation_state: 'not_invoked',
      persistence_state: 'not_verified',
      expected_outputs: ['design-options', 'design-decision', 'approval-brief'],
      fallback: null,
    }, profile, 'driver', 'Normalizes evidence, alternatives, approvals, and architecture deltas.'));
  }
  const covered = new Set(BUILTIN_CONCERNS);
  for (const provider of selected) for (const concern of asArray(provider.concerns)) covered.add(concern);
  const missing = asArray(profile.concerns).filter((concern) => !covered.has(concern));
  const blocking = profile.risk === 'critical' ? missing.filter((concern) => CRITICAL_CONCERNS.has(concern)) : [];
  const confirmationRequired = selected.filter((provider) => provider.invocation === 'requires_confirmation').map((provider) => provider.id);
  const compositionBlockers = selected
    .filter((provider) => provider.composition_contract?.invocation?.dependency_readiness !== 'ready')
    .map((provider) => provider.id);
  return {
    schema_version: DESIGN_SCHEMA_VERSION,
    ...cloneJson(input),
    profile_hash: stableHash(profile),
    selected,
    missing_concerns: missing,
    blocking_concerns: blocking,
    confirmation_required: confirmationRequired,
    composition_blockers: compositionBlockers,
    status: blocking.length > 0 || compositionBlockers.length > 0
      ? 'blocked'
      : confirmationRequired.length > 0 ? 'awaiting_confirmation' : 'ready',
    policy: {
      automatic_only_when: 'installed-catalogued-read-only',
      installation: 'never-automatic',
      critical_missing_provider: 'block-or-explicit-waiver',
      ...(isObject(input.policy) ? cloneJson(input.policy) : {}),
    },
  };
}

function boundedValues(values, limit = 8) {
  const items = asArray(values).map((value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
  });
  if (items.length <= limit) return items;
  return [...items.slice(0, limit), `... ${items.length - limit} more`];
}

function selectedOptionSummary(option) {
  if (!option) return 'No design option selected.';
  if (typeof option === 'string') return option;
  return String(option.summary ?? option.rationale ?? option.id ?? JSON.stringify(option));
}

function providerStatusSummary(selection = {}) {
  return {
    status: selection.status ?? 'unknown',
    selected: asArray(selection.selected).map((provider) => ({
      provider_id: provider.id,
      role: provider.role,
      version_or_digest: provider.composition_contract?.version_or_digest ?? provider.version_or_digest ?? 'unknown',
      dependency_readiness: provider.composition_contract?.invocation?.dependency_readiness ?? provider.dependency_readiness ?? 'unknown',
      invocation: provider.invocation ?? 'unknown',
      persistence: provider.composition_contract?.persistence?.state ?? provider.persistence_state ?? 'not_verified',
    })),
    blocking_concerns: boundedValues(selection.blocking_concerns),
    composition_blockers: boundedValues(selection.composition_blockers),
  };
}

export function designApprovalBrief(document, input = {}) {
  const revision = currentDesignRevision(document);
  if (!revision) throw new Error('current design revision is missing');
  const postureHash = revision.profile?.posture_ref?.posture_hash ?? null;
  const blockingConcerns = asArray(revision.provider_selection?.blocking_concerns);
  const compositionBlockers = asArray(revision.provider_selection?.composition_blockers);
  const brief = {
    subject: {
      design_id: document.design_id,
      scope: revision.scope,
      node_id: revision.node_id ?? null,
      revision: revision.revision,
    },
    exact_content_hash: reviewedContentHash(revision),
    exact_posture_hash: postureHash,
    decision_summary: selectedOptionSummary(revision.selected_option),
    included_scope: boundedValues(
      asArray(revision.profile?.behavior_budget?.required).length > 0
        ? revision.profile.behavior_budget.required
        : revision.requirements,
    ),
    excluded_scope: boundedValues(revision.profile?.behavior_budget?.excluded),
    material_risks: boundedValues([
      ...asArray(revision.failure_modes),
      ...blockingConcerns.map((concern) => `missing critical provider coverage: ${concern}`),
      ...compositionBlockers.map((providerId) => `provider composition blocked: ${providerId}`),
    ]),
    provider_status: providerStatusSummary(revision.provider_selection),
    downstream_effect: String(input.downstream_effect ?? (
      asArray(revision.profile?.impacted_modules).length > 0
        ? `Revalidates ${revision.profile.impacted_modules.join(', ')} before dependent work proceeds.`
        : 'Allows dependent planning work to proceed against this exact design revision.'
    )),
    waiver_request: blockingConcerns.length > 0 || compositionBlockers.length > 0
      ? { required: true, reasons: [...blockingConcerns, ...compositionBlockers] }
      : null,
    prompt: `Approve ${document.design_id} revision ${revision.revision} at content ${String(reviewedContentHash(revision)).slice(0, 12)}${postureHash ? ` and posture ${postureHash.slice(0, 12)}` : ''}?`,
  };
  return { ...brief, brief_hash: stableHash(brief) };
}

export function assessDesignProviderProposals(posture, providerResult, proposals = []) {
  const evidenceRef = providerResult?.raw_ref ?? providerResult?.evidence_ref ?? null;
  const persistence = providerResult?.lifecycle?.persistence
    ?? providerResult?.persistence_state
    ?? providerResult?.composition_contract?.persistence?.state
    ?? 'not_verified';
  return partitionBehaviorCandidates(posture, asArray(proposals).map((proposal) => ({
    ...cloneJson(proposal),
    source: {
      kind: 'provider',
      provider_id: providerResult?.provider_id ?? 'unknown-provider',
      status: providerResult?.status ?? 'unavailable',
      evidence_ref: evidenceRef,
      persistence,
    },
  })));
}

function finalizeRevision(revision) {
  return withDesignRevisionHashes({ ...cloneJson(revision), updated_at: new Date().toISOString() });
}

export function createDesignDocument(input = {}) {
  const profile = input.profile ?? triageDesign(input);
  const providerSelection = input.provider_selection?.status === 'pending'
    ? cloneJson(input.provider_selection)
    : normalizeDesignProviderSelection(profile, input.provider_selection);
  const revision = finalizeRevision({
    revision: 1,
    scope: profile.scope,
    node_id: profile.node_id,
    status: 'in_progress',
    architecture_hash: profile.architecture_hash,
    profile,
    provider_selection: providerSelection,
    provider_results: [],
    requirements: asArray(input.requirements),
    options: asArray(input.options),
    selected_option: null,
    interfaces: [],
    invariants: [],
    failure_modes: [],
    operational_model: [],
    migration: [],
    blocking_questions: asArray(input.blocking_questions),
    architecture_delta: null,
    approval: null,
  });
  return {
    schema_version: DESIGN_SCHEMA_VERSION,
    design_id: String(input.design_id ?? `design-${stableHash({ profile, requirements: input.requirements }).slice(0, 12)}`),
    current_revision: 1,
    revisions: [revision],
  };
}

export function validateDesignDocument(document, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(document)) return { valid: false, errors: [{ code: 'not_object', message: 'design document must be an object' }], warnings };
  if (document.schema_version !== DESIGN_SCHEMA_VERSION) errors.push({ code: 'unsupported_schema_version', message: 'design schema_version must be 2.0' });
  if (typeof document.design_id !== 'string' || document.design_id.length === 0) errors.push({ code: 'missing_design_id', message: 'design_id is required' });
  if (!Number.isInteger(document.current_revision) || document.current_revision < 1) errors.push({ code: 'invalid_current_revision', message: 'current_revision must be positive' });
  if (!Array.isArray(document.revisions) || document.revisions.length === 0) errors.push({ code: 'missing_revisions', message: 'revisions are required' });
  const numbers = new Set();
  for (const revision of asArray(document.revisions)) {
    if (!Number.isInteger(revision.revision) || revision.revision < 1) errors.push({ code: 'invalid_revision', message: 'design revision must be positive' });
    if (numbers.has(revision.revision)) errors.push({ code: 'duplicate_revision', message: `duplicate design revision ${revision.revision}` });
    numbers.add(revision.revision);
    if (!DESIGN_STATUSES.has(revision.status)) errors.push({ code: 'invalid_status', message: `invalid design status ${revision.status}` });
    if (!['root', 'node'].includes(revision.scope)) errors.push({ code: 'invalid_scope', message: 'design scope must be root or node' });
    if (revision.scope === 'node' && !revision.node_id) errors.push({ code: 'missing_node_id', message: 'node design needs node_id' });
    if (revision.status === 'approved') {
      if (!revision.selected_option) errors.push({ code: 'missing_selected_option', message: 'approved design needs a selected option' });
      if (asArray(revision.blocking_questions).length > 0) errors.push({ code: 'blocking_questions', message: 'approved design cannot have blocking questions' });
      if (!revision.approval) errors.push({ code: 'missing_approval', message: 'approved design needs approval evidence' });
    }
    if (options.verifyHashes) {
      if (revision.content_hash !== undefined) {
        if (revision.content_hash !== designRevisionContentHash(revision) || revision.design_hash !== revision.content_hash) {
          errors.push({ code: 'design_content_hash_mismatch', message: `revision ${revision.revision} content hash mismatch` });
        }
        if (revision.state_hash !== designRevisionStateHash(revision)) {
          errors.push({ code: 'design_state_hash_mismatch', message: `revision ${revision.revision} state hash mismatch` });
        }
      } else if (revision.design_hash !== legacyDesignRevisionHash(revision)) {
        errors.push({ code: 'design_hash_mismatch', message: `revision ${revision.revision} legacy hash mismatch` });
      }
    }
  }
  if (!numbers.has(document.current_revision)) errors.push({ code: 'unknown_current_revision', message: 'current_revision does not exist' });
  return { valid: errors.length === 0, errors, warnings };
}

export function currentDesignRevision(document) {
  return asArray(document.revisions).find((revision) => revision.revision === document.current_revision) ?? null;
}

export function renderDesignMarkdown(document) {
  const revision = currentDesignRevision(document);
  if (!revision) return '# Design\n\nNo current revision.\n';
  const list = (items) => asArray(items).length > 0 ? asArray(items).map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n') : '- None recorded';
  return [
    `# Design ${document.design_id}`, '',
    `**Revision:** ${revision.revision}`,
    `**Scope:** ${revision.scope}${revision.node_id ? ` (${revision.node_id})` : ''}`,
    `**Status:** ${revision.status}`,
    `**Design hash:** \`${revision.design_hash}\``, '',
    '## Design profile', '',
    `- Triggers: ${asArray(revision.profile?.triggers).join(', ') || 'none'}`,
    `- Concerns: ${asArray(revision.profile?.concerns).join(', ') || 'none'}`,
    `- Risk: ${revision.profile?.risk ?? 'unknown'}`, '',
    '## Skill routing', '',
    ...asArray(revision.provider_selection?.selected).map((provider) => `- **${provider.role}: ${provider.id}** - ${provider.reason} (${provider.invocation})`), '',
    '## Options', '', list(revision.options), '',
    '## Selected option', '', revision.selected_option ? JSON.stringify(revision.selected_option, null, 2) : 'Not selected.', '',
    '## Interfaces and invariants', '', list([...asArray(revision.interfaces), ...asArray(revision.invariants)]), '',
    '## Failure, operations, and migration', '', list([...asArray(revision.failure_modes), ...asArray(revision.operational_model), ...asArray(revision.migration)]), '',
    '## Blocking questions', '', list(revision.blocking_questions), '',
    '## Architecture delta', '', revision.architecture_delta ? `\`${revision.architecture_delta.delta_id ?? 'proposed'}\`` : 'None proposed.', '',
  ].join('\n');
}

export async function loadDesign(root) {
  return readJson(path.join(path.resolve(root), 'design.json'));
}

export async function writeDesign(root, input, options = {}) {
  const designRoot = path.resolve(root);
  return withFileLock(path.join(designRoot, 'design.json.lock'), async () => {
    const current = await readJsonIfExists(path.join(designRoot, 'design.json'));
    const currentRevision = current ? currentDesignRevision(current) : null;
    if (current && options.expectedHash === undefined && options.expectedStateHash === undefined) {
      throw new Error('design already exists; update or revise the current design instead of replacing its history');
    }
    const expectedState = options.expectedStateHash ?? options.expectedHash;
    const acceptedCurrentHashes = new Set([
      currentStateHash(currentRevision),
      reviewedContentHash(currentRevision),
    ].filter(Boolean));
    if (expectedState !== undefined && !acceptedCurrentHashes.has(expectedState)) {
      throw Object.assign(new Error('design revision changed; refresh before writing'), { code: 'DESIGN_CONFLICT' });
    }
    const next = cloneJson(input);
    next.revisions = asArray(next.revisions).map(finalizeRevision);
    const validation = validateDesignDocument(next, { verifyHashes: true });
    if (!validation.valid) {
      const error = new Error(`invalid design: ${validation.errors.map((item) => item.message).join('; ')}`);
      error.validation = validation;
      throw error;
    }
    await writeTextAtomic(path.join(designRoot, 'DESIGN.md'), renderDesignMarkdown(next));
    await writeJsonAtomic(path.join(designRoot, 'design.json'), next);
    return next;
  });
}

export async function updateDesignRevision(root, updates, options = {}) {
  const document = await loadDesign(root);
  const current = currentDesignRevision(document);
  if (!current) throw new Error('current design revision is missing');
  if (current.status !== 'in_progress') throw new Error('only an in-progress design revision can be updated');
  const protectedFields = Object.keys(updates).filter((field) => PROTECTED_REVISION_FIELDS.has(field));
  if (protectedFields.length > 0) throw new Error(`design update cannot change protected fields: ${protectedFields.join(', ')}`);
  Object.assign(current, cloneJson(updates));
  return writeDesign(root, document, { expectedHash: options.expectedHash ?? current.design_hash });
}

export async function recordDesignProviderResult(root, providerResult, options = {}) {
  const document = await loadDesign(root);
  const current = currentDesignRevision(document);
  if (!current || current.status !== 'in_progress') throw new Error('provider results require an in-progress design');
  if (options.expectedHash !== undefined && current.design_hash !== options.expectedHash) throw Object.assign(new Error('design revision changed'), { code: 'DESIGN_CONFLICT' });
  if (!current.provider_results.some((result) => result.provider_id === providerResult.provider_id && stableHash(result) === stableHash(providerResult))) {
    current.provider_results.push(cloneJson(providerResult));
  }
  return writeDesign(root, document, { expectedHash: current.design_hash });
}

export async function approveDesign(root, input = {}) {
  const document = await loadDesign(root);
  const current = currentDesignRevision(document);
  if (!current || current.status !== 'in_progress') throw new Error('only an in-progress design can be approved');
  if (typeof input.expectedHash !== 'string' || input.expectedHash.length === 0) throw new Error('expected design hash is required for approval');
  const expectedContentHash = reviewedContentHash(current);
  if (expectedContentHash !== input.expectedHash) throw Object.assign(new Error('design revision changed'), { code: 'DESIGN_CONFLICT' });
  const brief = designApprovalBrief(document, input.brief_context);
  const postureHash = current.profile?.posture_ref?.posture_hash ?? null;
  if (postureHash && input.expectedPostureHash !== postureHash) {
    throw Object.assign(new Error('design posture changed; regenerate the approval brief'), { code: 'DESIGN_POSTURE_CONFLICT' });
  }
  if (postureHash && input.briefHash !== brief.brief_hash) {
    throw Object.assign(new Error('approval brief changed; regenerate it before approval'), { code: 'APPROVAL_BRIEF_CONFLICT' });
  }
  if (input.briefHash !== undefined && input.briefHash !== brief.brief_hash) {
    throw Object.assign(new Error('approval brief changed; regenerate it before approval'), { code: 'APPROVAL_BRIEF_CONFLICT' });
  }
  if (!input.approval) throw new Error('explicit approval evidence is required');
  const normalizedSelection = normalizeDesignProviderSelection(current.profile, current.provider_selection);
  if (stableHash(normalizedSelection) !== stableHash(current.provider_selection)) {
    throw new Error('provider selection normalization would change reviewed content; update the design before approval');
  }
  if (asArray(current.blocking_questions).length > 0) throw new Error('blocking design questions must be resolved before approval');
  if (!current.selected_option) throw new Error('select a design option before approval');
  if (current.profile?.requires_alternatives && asArray(current.options).length < 2) throw new Error('high-impact design requires at least two alternatives');
  if (asArray(current.provider_selection?.blocking_concerns).length > 0 && !input.waiver) throw new Error('critical design provider gaps require an explicit waiver');
  const resultProviders = new Set(asArray(current.provider_results).map((result) => result.provider_id));
  const missingResults = asArray(current.provider_selection?.selected)
    .filter((provider) => provider.id !== 'builtin-design-driver' && !resultProviders.has(provider.id))
    .map((provider) => provider.id);
  if (missingResults.length > 0 && !input.waiver) throw new Error(`selected design providers have no recorded result: ${missingResults.join(', ')}`);
  current.status = input.waiver ? 'waived' : 'approved';
  current.approval = {
    ...cloneJson(input.approval),
    expected_content_hash: expectedContentHash,
    expected_posture_hash: postureHash,
    approval_brief_hash: brief.brief_hash,
  };
  current.provider_waiver = input.waiver ?? null;
  const written = await writeDesign(root, document, { expectedStateHash: currentStateHash(current) });
  const approved = currentDesignRevision(written);
  if (reviewedContentHash(approved) !== expectedContentHash) {
    throw new Error('approval changed reviewed design content');
  }
  return written;
}

export function classifyDesignRepresentation(document) {
  if (!isObject(document)) return { readable: false, schema_version: null, representation: 'invalid', migration_required: false };
  if (document.schema_version === DESIGN_LEDGER_SCHEMA_VERSION && Array.isArray(document.threads)) {
    return { readable: true, schema_version: DESIGN_LEDGER_SCHEMA_VERSION, representation: 'design_ledger', migration_required: false };
  }
  if (document.schema_version === DESIGN_SCHEMA_VERSION && Array.isArray(document.revisions)) {
    return { readable: true, schema_version: DESIGN_SCHEMA_VERSION, representation: 'legacy_revisions', migration_required: true };
  }
  return { readable: false, schema_version: document.schema_version ?? null, representation: 'unsupported', migration_required: false };
}

export function previewDesignLedgerMigration(document) {
  const classification = classifyDesignRepresentation(document);
  if (!classification.readable) throw new Error('design document is not a readable v2.0 or v2.1 representation');
  if (!classification.migration_required) {
    return {
      status: 'not_required',
      source_schema_version: DESIGN_LEDGER_SCHEMA_VERSION,
      target_schema_version: DESIGN_LEDGER_SCHEMA_VERSION,
      writes: false,
    };
  }
  return {
    status: 'preview',
    source_schema_version: DESIGN_SCHEMA_VERSION,
    target_schema_version: DESIGN_LEDGER_SCHEMA_VERSION,
    writes: false,
    requires_explicit_apply: true,
    preserved_revision_count: asArray(document.revisions).length,
    unresolved: ['thread_parents', 'posture_ref'],
    source_document_hash: stableHash(document),
  };
}

export async function reviseDesign(root, details = {}) {
  const document = await loadDesign(root);
  const current = currentDesignRevision(document);
  if (!current) throw new Error('current design revision is missing');
  current.status = 'stale';
  current.stale_reason = String(details.reason ?? 'new evidence invalidated the design');
  const profile = details.profile ?? (details.request ? triageDesign({
    ...details.request,
    scope: current.scope,
    node_id: current.node_id,
    architecture_hash: details.request.architecture_hash ?? current.architecture_hash,
  }) : current.profile);
  const providerSelection = normalizeDesignProviderSelection(
    profile,
    details.provider_selection ?? current.provider_selection,
  );
  const previousPostureHash = current.profile?.posture_ref?.posture_hash ?? null;
  const nextPostureHash = profile?.posture_ref?.posture_hash ?? null;
  const reentryClassification = previousPostureHash !== nextPostureHash
    ? 'posture_changed'
    : asArray(details.affected_contract_ids).length > 0 ? 'contract_changed' : null;
  const nextRevision = finalizeRevision({
    ...cloneJson(current),
    revision: current.revision + 1,
    status: 'in_progress',
    architecture_hash: profile.architecture_hash,
    profile,
    provider_selection: providerSelection,
    provider_results: [],
    requirements: details.requirements ?? current.requirements,
    options: asArray(details.options),
    approval: null,
    selected_option: null,
    interfaces: asArray(details.interfaces),
    invariants: asArray(details.invariants),
    failure_modes: asArray(details.failure_modes),
    operational_model: asArray(details.operational_model),
    migration: asArray(details.migration),
    architecture_delta: null,
    blocking_questions: asArray(details.blocking_questions),
    supersedes_hash: current.design_hash,
    review_reset: ['options', 'interfaces', 'invariants', 'failure_modes', 'operational_model', 'migration', 'provider_results'],
    reentry_evidence: reentryClassification ? {
      classification: reentryClassification,
      source_ref: String(details.source_ref ?? details.reason ?? 'design revision request'),
      previous_content_hash: current.content_hash,
      previous_posture_hash: previousPostureHash,
      next_posture_hash: nextPostureHash,
      affected_contract_ids: asArray(details.affected_contract_ids),
      evidence_refs: asArray(details.evidence_refs),
    } : undefined,
    stale_reason: undefined,
  });
  document.current_revision = nextRevision.revision;
  document.revisions.push(nextRevision);
  return writeDesign(root, document, { expectedHash: current.design_hash });
}
