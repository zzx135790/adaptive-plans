import path from 'node:path';

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

export const DESIGN_LEDGER_SCHEMA_VERSION = '2.1';
export const DESIGN_THREAD_KINDS = new Set(['root', 'module', 'relation', 'task']);
export const DESIGN_DECISION_STATUSES = new Set(['in_progress', 'approved', 'stale', 'waived']);
export const CONTRACT_VERIFICATION_STATUSES = new Set(['candidate', 'verified', 'failed']);
export const DESIGN_ASSESSMENT_OUTCOMES = new Set(['covered_by', 'inline', 'thread_required']);
export const DESIGN_IMPACT_CLASSIFICATIONS = new Set([
  'no_contract_change',
  'contract_verified',
  'contract_changed',
  'architecture_changed',
  'posture_changed',
]);

const MATERIAL_DESIGN_TRIGGERS = new Set([
  'cross_module',
  'public_api',
  'data_model',
  'migration',
  'security',
  'performance',
  'concurrency',
  'failure_semantics',
  'new_dependency',
  'new_module',
  'contract_missing',
  'contract_change',
  'posture_change',
  'unresolved_tradeoff',
]);

function without(value, fields) {
  const next = cloneJson(value);
  for (const field of fields) delete next[field];
  return next;
}

function hashPattern(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? ''));
}

function postureRefValid(value) {
  return isObject(value)
    && ['spike', 'experiment', 'reusable_internal', 'production'].includes(value.kind)
    && hashPattern(value.posture_hash)
    && typeof value.source_ref === 'string'
    && value.source_ref.length > 0;
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map((value) => String(value)).filter(Boolean))];
}

function assertExpectedDocumentHash(document, expectedDocumentStateHash, action) {
  if (document.document_state_hash !== expectedDocumentStateHash) {
    throw Object.assign(new Error(`design ledger changed; refresh before ${action}`), { code: 'DESIGN_CONFLICT' });
  }
}

function assertExpectedThreadHash(thread, expectedThreadStateHash, action) {
  if (expectedThreadStateHash !== undefined && thread.thread_state_hash !== expectedThreadStateHash) {
    throw Object.assign(new Error(`design thread changed; refresh before ${action}`), { code: 'DESIGN_THREAD_CONFLICT' });
  }
}

function findThread(document, threadId) {
  const thread = asArray(document?.threads).find((candidate) => candidate.thread_id === threadId);
  if (!thread) throw new Error(`unknown design thread ${threadId}`);
  return thread;
}

export function assessDesignThread(input = {}) {
  const triggers = uniqueStrings(input.triggers).sort();
  const materialTriggers = triggers.filter((trigger) => MATERIAL_DESIGN_TRIGGERS.has(trigger));
  const designRefs = asArray(input.design_refs);
  const coveredTriggers = new Set(uniqueStrings(input.covered_triggers));
  const explicitlyCovered = input.coverage_confirmed === true
    && designRefs.length > 0
    && materialTriggers.every((trigger) => coveredTriggers.has(trigger));
  let outcome;
  if (materialTriggers.length > 0 && explicitlyCovered) outcome = 'covered_by';
  else if (materialTriggers.length > 0 || input.contract_preserving === false) outcome = 'thread_required';
  else outcome = 'inline';
  return {
    outcome,
    subject_ref: input.subject_ref ?? null,
    design_refs: cloneJson(designRefs),
    triggers,
    rationale: String(input.rationale ?? (
      outcome === 'covered_by'
        ? 'The exact referenced design covers every material trigger.'
        : outcome === 'inline'
          ? 'This is a private, contract-preserving implementation choice.'
          : 'A material contract, dependency, failure, posture, or tradeoff decision needs its own thread.'
    )),
  };
}

export function contractClaimContentHash(claim) {
  return stableHash(without(claim, new Set(['content_hash', 'verification_status', 'evidence_refs'])));
}

function finalizeContractClaim(claim) {
  const next = {
    verification_status: 'candidate',
    evidence_refs: [],
    consumer_refs: [],
    ...cloneJson(claim),
  };
  next.consumer_refs = uniqueStrings(next.consumer_refs);
  next.content_hash = contractClaimContentHash(next);
  return next;
}

export function ledgerRevisionContentHash(revision) {
  const content = without(revision, new Set([
    'content_hash',
    'state_hash',
    'decision_status',
    'approval',
    'updated_at',
    'stale_reason',
  ]));
  content.contracts = asArray(content.contracts).map((claim) => without(
    claim,
    new Set(['verification_status', 'evidence_refs']),
  ));
  return stableHash(content);
}

export function ledgerRevisionStateHash(revision) {
  return stableHash(without(revision, new Set(['content_hash', 'state_hash', 'updated_at'])));
}

function finalizeLedgerRevision(revision) {
  const next = {
    resolved_items: [],
    contracts: [],
    assessments: [],
    provider_refs: [],
    approval: null,
    ...cloneJson(revision),
  };
  next.updated_at ??= new Date().toISOString();
  next.contracts = asArray(next.contracts).map(finalizeContractClaim);
  next.content_hash = ledgerRevisionContentHash(next);
  next.state_hash = ledgerRevisionStateHash(next);
  return next;
}

export function designThreadStateHash(thread) {
  return stableHash(without(thread, new Set(['thread_state_hash', 'updated_at'])));
}

function finalizeDesignThread(thread) {
  const next = {
    parent_refs: [],
    revisions: [],
    ...cloneJson(thread),
  };
  next.updated_at ??= new Date().toISOString();
  next.revisions = asArray(next.revisions).map(finalizeLedgerRevision);
  next.thread_state_hash = designThreadStateHash(next);
  return next;
}

export function designDocumentStateHash(document) {
  return stableHash(without(document, new Set(['document_state_hash', 'updated_at'])));
}

export function finalizeDesignLedger(document) {
  const next = {
    schema_version: DESIGN_LEDGER_SCHEMA_VERSION,
    threads: [],
    impacts: [],
    ...cloneJson(document),
  };
  next.updated_at ??= new Date().toISOString();
  next.threads = asArray(next.threads).map(finalizeDesignThread);
  next.document_state_hash = designDocumentStateHash(next);
  return next;
}

function initialRevision(input = {}) {
  return finalizeLedgerRevision({
    revision: 1,
    decision_status: 'in_progress',
    requirements: asArray(input.requirements),
    options: asArray(input.options),
    selected_option: input.selected_option ?? null,
    interfaces: asArray(input.interfaces),
    invariants: asArray(input.invariants),
    failure_modes: asArray(input.failure_modes),
    operational_model: asArray(input.operational_model),
    migration: asArray(input.migration),
    blocking_questions: asArray(input.blocking_questions),
    resolved_items: asArray(input.resolved_items),
    contracts: asArray(input.contracts),
    assessments: asArray(input.assessments),
    posture_ref: cloneJson(input.posture_ref ?? null),
    behavior_budget: cloneJson(input.behavior_budget ?? null),
    scope_provenance: asArray(input.scope_provenance),
    provider_refs: asArray(input.provider_refs),
    provider_status: cloneJson(input.provider_status ?? null),
    architecture_hash: input.architecture_hash ?? null,
    approval: null,
  });
}

export function createDesignThread(input = {}) {
  const kind = String(input.kind ?? 'task');
  const subjectRef = String(input.subject_ref ?? '');
  const purpose = String(input.purpose ?? 'implementation');
  if (!DESIGN_THREAD_KINDS.has(kind)) throw new Error(`invalid design thread kind ${kind}`);
  if (!subjectRef) throw new Error('design thread subject_ref is required');
  if (!purpose) throw new Error('design thread purpose is required');
  const threadId = String(input.thread_id ?? `${kind}:${subjectRef}:${purpose}`);
  return finalizeDesignThread({
    thread_id: threadId,
    kind,
    subject_ref: subjectRef,
    purpose,
    parent_refs: asArray(input.parent_refs),
    current_revision: 1,
    revisions: [initialRevision(input)],
  });
}

export function createDesignLedger(input = {}) {
  const designId = String(input.design_id ?? '');
  if (!designId) throw new Error('design_id is required');
  const root = createDesignThread({
    ...input,
    kind: 'root',
    subject_ref: input.subject_ref ?? designId,
    purpose: input.purpose ?? 'project-design',
    thread_id: input.thread_id ?? 'root',
  });
  return finalizeDesignLedger({
    schema_version: DESIGN_LEDGER_SCHEMA_VERSION,
    design_id: designId,
    threads: [root],
  });
}

function migratedDecisionStatus(status) {
  if (status === 'in_progress') return 'in_progress';
  return 'stale';
}

export function convertLegacyDesignToLedger(document, options = {}) {
  if (!isObject(document) || document.schema_version !== '2.0' || !Array.isArray(document.revisions)) {
    throw new Error('flat design migration requires a legacy v2.0 revisions document');
  }
  if (!postureRefValid(options.postureRef)) {
    throw Object.assign(new Error('flat design migration requires an explicit authoritative PostureRef'), { code: 'MIGRATION_POSTURE_REQUIRED' });
  }
  const sourceDocumentHash = stableHash(document);
  const fallbackUpdatedAt = String(document.updated_at ?? document.created_at ?? 'legacy-timestamp-unavailable');
  const revisions = document.revisions.map((revision, index) => ({
    revision: Number(revision.revision ?? index + 1),
    decision_status: migratedDecisionStatus(revision.status),
    requirements: asArray(revision.requirements),
    options: asArray(revision.options),
    selected_option: cloneJson(revision.selected_option ?? null),
    interfaces: asArray(revision.interfaces),
    invariants: asArray(revision.invariants),
    failure_modes: asArray(revision.failure_modes),
    operational_model: asArray(revision.operational_model),
    migration: asArray(revision.migration),
    blocking_questions: asArray(revision.blocking_questions),
    resolved_items: [],
    contracts: [],
    assessments: [],
    posture_ref: cloneJson(options.postureRef),
    behavior_budget: cloneJson(revision.profile?.behavior_budget ?? null),
    scope_provenance: [],
    provider_refs: asArray(revision.provider_selection?.selected),
    provider_status: {
      status: revision.provider_selection?.status ?? 'legacy_unknown',
      blocking_concerns: asArray(revision.provider_selection?.blocking_concerns),
      composition_blockers: asArray(revision.provider_selection?.composition_blockers),
    },
    architecture_hash: revision.architecture_hash ?? null,
    approval: null,
    legacy_approval: cloneJson(revision.approval ?? null),
    stale_reason: revision.status === 'in_progress'
      ? undefined
      : 'Representation migration changed the content hash; regenerate the inline brief before reapproval.',
    migration_evidence: {
      source_schema_version: '2.0',
      source_document_hash: sourceDocumentHash,
      source_revision_hash: revision.content_hash ?? revision.design_hash ?? stableHash(revision),
      raw_revision: cloneJson(revision),
      approval_authority: 'historical_only',
    },
    updated_at: String(revision.updated_at ?? fallbackUpdatedAt),
  }));
  if (revisions.length === 0) throw new Error('flat design migration requires at least one legacy revision');
  const ledger = finalizeDesignLedger({
    schema_version: DESIGN_LEDGER_SCHEMA_VERSION,
    design_id: document.design_id,
    threads: [{
      thread_id: 'root',
      kind: 'root',
      subject_ref: document.design_id,
      purpose: 'project-design',
      parent_refs: [],
      current_revision: Number(document.current_revision ?? revisions.at(-1).revision),
      revisions,
      updated_at: fallbackUpdatedAt,
    }],
    impacts: [],
    migration_evidence: {
      source_schema_version: '2.0',
      source_document_hash: sourceDocumentHash,
      raw_document: cloneJson(document),
      child_threads_created: false,
      verified_contracts_created: false,
    },
    updated_at: fallbackUpdatedAt,
  });
  const validation = validateDesignLedger(ledger, { verifyHashes: true });
  if (!validation.valid) throw new Error(`migrated design ledger is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  return ledger;
}

export function currentThreadRevision(thread) {
  return asArray(thread?.revisions).find((revision) => revision.revision === thread.current_revision) ?? null;
}

function activeThreadKey(thread) {
  return `${thread.kind}:${thread.subject_ref}:${thread.purpose}`;
}

export function addDesignThread(document, input = {}, options = {}) {
  assertExpectedDocumentHash(document, options.expectedDocumentStateHash, 'adding a thread');
  const thread = createDesignThread(input);
  if (asArray(document.threads).some((candidate) => activeThreadKey(candidate) === activeThreadKey(thread))) {
    throw new Error(`an active design thread already exists for ${activeThreadKey(thread)}`);
  }
  const next = cloneJson(document);
  next.threads.push(thread);
  delete next.updated_at;
  return finalizeDesignLedger(next);
}

export function reviseDesignThread(document, threadId, updates = {}, options = {}) {
  assertExpectedDocumentHash(document, options.expectedDocumentStateHash, 'revising a thread');
  const next = cloneJson(document);
  const thread = findThread(next, threadId);
  assertExpectedThreadHash(thread, options.expectedThreadStateHash, 'revising a thread');
  const current = currentThreadRevision(thread);
  if (!current) throw new Error(`${threadId} has no current revision`);
  current.decision_status = 'stale';
  current.stale_reason = String(options.reason ?? updates.reentry_reason ?? 'design evidence changed');
  delete current.updated_at;
  const successor = {
    ...without(current, new Set([
      'content_hash',
      'state_hash',
      'decision_status',
      'approval',
      'updated_at',
      'stale_reason',
    ])),
    ...cloneJson(updates),
    revision: Math.max(...thread.revisions.map((revision) => revision.revision)) + 1,
    decision_status: 'in_progress',
    approval: null,
    supersedes_hash: current.content_hash,
    reentry_reason: String(options.reason ?? updates.reentry_reason ?? 'design evidence changed'),
  };
  thread.revisions.push(successor);
  thread.current_revision = successor.revision;
  delete thread.updated_at;
  delete next.updated_at;
  return finalizeDesignLedger(next);
}

function impactId(input) {
  return String(input.impact_id ?? `impact:${stableHash({
    classification: input.classification,
    source_ref: input.source_ref,
    affected_contract_ids: input.affected_contract_ids,
    affected_thread_ids: input.affected_thread_ids,
    evidence_refs: input.evidence_refs,
  }).slice(0, 20)}`);
}

function finalizeDesignImpact(input = {}) {
  return {
    impact_id: impactId(input),
    classification: String(input.classification ?? ''),
    source_ref: String(input.source_ref ?? ''),
    affected_contract_ids: uniqueStrings(input.affected_contract_ids),
    affected_thread_ids: uniqueStrings(input.affected_thread_ids),
    evidence_refs: asArray(input.evidence_refs),
    rationale: String(input.rationale ?? ''),
  };
}

function boundedBriefValues(values, limit = 8) {
  const items = asArray(values).map((value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
  });
  if (items.length <= limit) return items;
  return [...items.slice(0, limit), `... ${items.length - limit} more`];
}

export function ledgerApprovalBrief(document, threadId, input = {}) {
  const thread = findThread(document, threadId);
  const revision = currentThreadRevision(thread);
  if (!revision) throw new Error(`${threadId} has no current revision`);
  const blockingConcerns = asArray(revision.provider_status?.blocking_concerns);
  const compositionBlockers = asArray(revision.provider_status?.composition_blockers);
  const providerRefs = asArray(revision.provider_refs).map((provider) => ({
    provider_id: provider.provider_id ?? provider.id ?? String(provider),
    version_or_digest: provider.version_or_digest ?? provider.composition_contract?.version_or_digest ?? 'unknown',
    dependency_readiness: provider.dependency_readiness ?? provider.composition_contract?.invocation?.dependency_readiness ?? 'unknown',
    invocation: provider.invocation ?? provider.composition_contract?.invocation?.state ?? 'unknown',
    persistence: provider.persistence ?? provider.composition_contract?.persistence?.state ?? 'not_verified',
  }));
  const selectedOption = revision.selected_option;
  const decisionSummary = selectedOption
    ? (typeof selectedOption === 'string'
      ? selectedOption
      : String(selectedOption.summary ?? selectedOption.rationale ?? selectedOption.id ?? JSON.stringify(selectedOption)))
    : 'No design option selected.';
  const brief = {
    subject: {
      design_id: document.design_id,
      thread_id: thread.thread_id,
      kind: thread.kind,
      subject_ref: thread.subject_ref,
      purpose: thread.purpose,
      revision: revision.revision,
    },
    exact_content_hash: revision.content_hash,
    exact_posture_hash: revision.posture_ref?.posture_hash ?? null,
    decision_summary: decisionSummary,
    included_scope: boundedBriefValues(
      asArray(revision.behavior_budget?.required).length > 0
        ? revision.behavior_budget.required
        : revision.requirements,
    ),
    excluded_scope: boundedBriefValues(revision.behavior_budget?.excluded),
    material_risks: boundedBriefValues([
      ...asArray(revision.failure_modes),
      ...blockingConcerns.map((concern) => `missing critical provider coverage: ${concern}`),
      ...compositionBlockers.map((providerId) => `provider composition blocked: ${providerId}`),
    ]),
    provider_status: {
      status: revision.provider_status?.status ?? 'unknown',
      providers: providerRefs,
      blocking_concerns: boundedBriefValues(blockingConcerns),
      composition_blockers: boundedBriefValues(compositionBlockers),
    },
    downstream_effect: String(input.downstream_effect ?? 'Allows exact dependent consumers to revalidate against this thread revision.'),
    waiver_request: blockingConcerns.length > 0 || compositionBlockers.length > 0
      ? { required: true, reasons: [...blockingConcerns, ...compositionBlockers] }
      : null,
    prompt: `Approve ${thread.thread_id} revision ${revision.revision} at content ${revision.content_hash.slice(0, 12)} and posture ${revision.posture_ref.posture_hash.slice(0, 12)}?`,
  };
  return { ...brief, brief_hash: stableHash(brief) };
}

export function approveDesignThread(document, threadId, input = {}, options = {}) {
  assertExpectedDocumentHash(document, options.expectedDocumentStateHash, 'approving a thread');
  const next = cloneJson(document);
  const thread = findThread(next, threadId);
  assertExpectedThreadHash(thread, options.expectedThreadStateHash, 'approving a thread');
  const revision = currentThreadRevision(thread);
  if (!revision || revision.decision_status !== 'in_progress') throw new Error('only an in-progress design thread can be approved');
  if (asArray(revision.blocking_questions).length > 0) throw new Error('blocking design questions must be resolved before approval');
  if (!revision.selected_option) throw new Error('select a design option before approval');
  const readiness = designThreadReadiness(next, threadId);
  if (!readiness.ready) throw new Error(`design thread is blocked: ${readiness.blockers.map((blocker) => blocker.code).join(', ')}`);
  const brief = ledgerApprovalBrief(next, threadId, input.brief_context);
  if (input.expectedContentHash !== revision.content_hash) throw Object.assign(new Error('design thread content changed'), { code: 'DESIGN_CONFLICT' });
  if (input.expectedPostureHash !== revision.posture_ref.posture_hash) throw Object.assign(new Error('design thread posture changed'), { code: 'DESIGN_POSTURE_CONFLICT' });
  if (input.briefHash !== brief.brief_hash) throw Object.assign(new Error('approval brief changed; regenerate it before approval'), { code: 'APPROVAL_BRIEF_CONFLICT' });
  const providerBlocked = revision.provider_status?.status === 'blocked';
  if (providerBlocked && !input.waiver) throw new Error('blocked provider coverage requires an explicit waiver');
  if (!input.approval) throw new Error('explicit approval evidence is required');
  const contentHash = revision.content_hash;
  const stateHash = revision.state_hash;
  revision.decision_status = input.waiver ? 'waived' : 'approved';
  revision.approval = {
    ...cloneJson(input.approval),
    expected_content_hash: contentHash,
    expected_posture_hash: revision.posture_ref.posture_hash,
    approval_brief_hash: brief.brief_hash,
    waiver: cloneJson(input.waiver ?? null),
  };
  delete revision.updated_at;
  delete thread.updated_at;
  delete next.updated_at;
  const approved = finalizeDesignLedger(next);
  const approvedRevision = currentThreadRevision(findThread(approved, threadId));
  if (approvedRevision.content_hash !== contentHash || approvedRevision.state_hash === stateHash) {
    throw new Error('approval must preserve content identity and change only lifecycle state');
  }
  return approved;
}

export function reenterDesignThreads(document, input = {}, options = {}) {
  assertExpectedDocumentHash(document, options.expectedDocumentStateHash, 're-entering design');
  const classification = String(input.classification ?? '');
  if (!['contract_changed', 'architecture_changed', 'posture_changed'].includes(classification)) {
    throw new Error('design re-entry requires a material impact classification');
  }
  const affectedThreadIds = uniqueStrings(input.affected_thread_ids);
  if (affectedThreadIds.length === 0) throw new Error('design re-entry requires exact affected_thread_ids');
  const affectedContractIds = uniqueStrings(input.affected_contract_ids);
  if (classification === 'contract_changed' && affectedContractIds.length === 0) {
    throw new Error('contract change re-entry requires exact affected_contract_ids');
  }
  if (asArray(input.evidence_refs).length === 0) throw new Error('design re-entry requires evidence_refs');
  const next = cloneJson(document);
  for (const threadId of affectedThreadIds) {
    const thread = findThread(next, threadId);
    assertExpectedThreadHash(thread, options.expectedThreadStateHashes?.[threadId], 're-entering design');
    const current = currentThreadRevision(thread);
    if (!current) throw new Error(`${threadId} has no current revision`);
    const reason = String(input.rationale ?? `${classification} requires design re-entry`);
    current.decision_status = 'stale';
    current.stale_reason = reason;
    delete current.updated_at;
    const updates = cloneJson(input.updates_by_thread?.[threadId] ?? {});
    if (classification === 'posture_changed') updates.posture_ref = cloneJson(input.posture_ref);
    const successor = {
      ...without(current, new Set(['content_hash', 'state_hash', 'decision_status', 'approval', 'updated_at', 'stale_reason'])),
      ...updates,
      revision: Math.max(...thread.revisions.map((candidate) => candidate.revision)) + 1,
      decision_status: 'in_progress',
      approval: null,
      supersedes_hash: current.content_hash,
      reentry_reason: reason,
      reentry_evidence: {
        classification,
        source_ref: String(input.source_ref ?? ''),
        affected_contract_ids: affectedContractIds,
        evidence_refs: asArray(input.evidence_refs),
      },
    };
    thread.revisions.push(successor);
    thread.current_revision = successor.revision;
    delete thread.updated_at;
  }
  const impact = finalizeDesignImpact({
    ...input,
    classification,
    affected_contract_ids: affectedContractIds,
    affected_thread_ids: affectedThreadIds,
  });
  next.impacts.push(impact);
  delete next.updated_at;
  return { document: finalizeDesignLedger(next), impact };
}

export function designThreadReadiness(document, threadId) {
  const thread = findThread(document, threadId);
  const current = currentThreadRevision(thread);
  const blockers = [];
  if (!current || current.decision_status === 'stale') {
    blockers.push({ code: 'stale_design_thread', thread_id: threadId });
  }
  for (const producer of asArray(document.threads)) {
    const revision = currentThreadRevision(producer);
    for (const claim of asArray(revision?.contracts)) {
      if (claim.criticality !== 'critical' || !asArray(claim.consumer_refs).includes(threadId)) continue;
      if (claim.verification_status !== 'verified') {
        blockers.push({
          code: claim.verification_status === 'failed' ? 'critical_contract_failed' : 'critical_contract_unverified',
          contract_id: claim.contract_id,
          owner_thread_id: producer.thread_id,
        });
      }
    }
  }
  return { ready: blockers.length === 0, thread_id: threadId, blockers };
}

export function recordContractEvidence(document, input = {}, options = {}) {
  assertExpectedDocumentHash(document, options.expectedDocumentStateHash, 'recording contract evidence');
  const status = String(input.verification_status ?? '');
  if (!['verified', 'failed'].includes(status)) throw new Error('contract evidence status must be verified or failed');
  if (asArray(input.evidence_refs).length === 0) throw new Error('contract evidence requires at least one evidence_ref');
  const next = cloneJson(document);
  const owner = findThread(next, String(input.thread_id ?? ''));
  assertExpectedThreadHash(owner, options.expectedThreadStateHash, 'recording contract evidence');
  let revision = currentThreadRevision(owner);
  const claim = asArray(revision?.contracts).find((candidate) => candidate.contract_id === input.contract_id);
  if (!claim) throw new Error(`unknown contract ${input.contract_id} in ${owner.thread_id}`);
  claim.verification_status = status;
  claim.evidence_refs = asArray(input.evidence_refs);
  delete revision.updated_at;
  delete owner.updated_at;

  const affectedThreadIds = status === 'failed' && claim.criticality === 'critical'
    ? uniqueStrings(claim.consumer_refs)
    : [];
  if (affectedThreadIds.length > 0) {
    const reason = String(input.rationale ?? `critical contract ${claim.contract_id} failed verification`);
    revision.decision_status = 'stale';
    revision.stale_reason = reason;
    const successor = {
      ...without(revision, new Set([
        'content_hash',
        'state_hash',
        'decision_status',
        'approval',
        'updated_at',
        'stale_reason',
      ])),
      revision: Math.max(...owner.revisions.map((candidate) => candidate.revision)) + 1,
      decision_status: 'in_progress',
      approval: null,
      supersedes_hash: revision.content_hash,
      reentry_reason: reason,
    };
    owner.revisions.push(successor);
    owner.current_revision = successor.revision;
    revision = successor;
    for (const consumerId of affectedThreadIds) {
      const consumer = findThread(next, consumerId);
      const consumerRevision = currentThreadRevision(consumer);
      if (consumerRevision && consumerRevision.decision_status !== 'stale') {
        consumerRevision.decision_status = 'stale';
        consumerRevision.stale_reason = reason;
        delete consumerRevision.updated_at;
        delete consumer.updated_at;
      }
    }
  }

  const impact = finalizeDesignImpact({
    ...input,
    classification: status === 'verified' ? 'contract_verified' : 'contract_changed',
    source_ref: input.source_ref ?? `${owner.thread_id}@${revision.revision}`,
    affected_contract_ids: [claim.contract_id],
    affected_thread_ids: affectedThreadIds,
    rationale: input.rationale ?? (status === 'verified'
      ? `Contract ${claim.contract_id} has verified evidence.`
      : `Contract ${claim.contract_id} failed verification.`),
  });
  next.impacts.push(impact);
  delete next.updated_at;
  return { document: finalizeDesignLedger(next), impact };
}

export function validateDesignLedger(document, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(document)) return { valid: false, errors: [{ code: 'not_object', message: 'design ledger must be an object' }], warnings };
  if (document.schema_version !== DESIGN_LEDGER_SCHEMA_VERSION) errors.push({ code: 'unsupported_schema_version', message: 'design ledger schema_version must be 2.1' });
  if (typeof document.design_id !== 'string' || document.design_id.length === 0) errors.push({ code: 'missing_design_id', message: 'design_id is required' });
  if (!Array.isArray(document.threads) || document.threads.length === 0) errors.push({ code: 'missing_threads', message: 'design ledger needs at least one thread' });
  if (!Array.isArray(document.impacts)) errors.push({ code: 'invalid_impacts', message: 'design ledger impacts must be an array' });
  const ids = new Set();
  const active = new Set();
  const contractIds = new Set();
  for (const thread of asArray(document.threads)) {
    if (!thread?.thread_id || ids.has(thread.thread_id)) errors.push({ code: 'duplicate_thread_id', message: `invalid or duplicate thread_id ${thread?.thread_id}` });
    ids.add(thread?.thread_id);
    if (!DESIGN_THREAD_KINDS.has(thread?.kind)) errors.push({ code: 'invalid_thread_kind', message: `${thread?.thread_id} has invalid kind` });
    if (typeof thread?.subject_ref !== 'string' || !thread.subject_ref) errors.push({ code: 'invalid_thread_subject', message: `${thread?.thread_id} needs a subject_ref` });
    if (typeof thread?.purpose !== 'string' || !thread.purpose) errors.push({ code: 'invalid_thread_purpose', message: `${thread?.thread_id} needs a purpose` });
    const key = activeThreadKey(thread);
    if (active.has(key)) errors.push({ code: 'duplicate_active_subject', message: `multiple active threads for ${key}` });
    active.add(key);
    if (!Array.isArray(thread.parent_refs)) errors.push({ code: 'invalid_parent_refs', message: `${thread.thread_id}.parent_refs must be an array` });
    const revisions = asArray(thread.revisions);
    if (!revisions.some((revision) => revision.revision === thread.current_revision)) errors.push({ code: 'unknown_current_revision', message: `${thread.thread_id} current revision is missing` });
    for (const revision of revisions) {
      if (!DESIGN_DECISION_STATUSES.has(revision.decision_status)) errors.push({ code: 'invalid_decision_status', message: `${thread.thread_id}@${revision.revision} has invalid status` });
      if (!postureRefValid(revision.posture_ref)) errors.push({ code: 'invalid_posture_ref', message: `${thread.thread_id}@${revision.revision} needs a PostureRef` });
      for (const assessment of asArray(revision.assessments)) {
        if (!DESIGN_ASSESSMENT_OUTCOMES.has(assessment?.outcome)
          || !Array.isArray(assessment?.design_refs)
          || !Array.isArray(assessment?.triggers)
          || typeof assessment?.rationale !== 'string'
          || assessment.rationale.length === 0) {
          errors.push({ code: 'invalid_design_assessment', message: `${thread.thread_id} has an invalid design assessment` });
        }
      }
      for (const claim of asArray(revision.contracts)) {
        if (!claim.contract_id || !claim.owner_ref || !['noncritical', 'critical'].includes(claim.criticality)
          || !CONTRACT_VERIFICATION_STATUSES.has(claim.verification_status)) {
          errors.push({ code: 'invalid_contract_claim', message: `${thread.thread_id} has an invalid contract claim` });
        }
        if (!Array.isArray(claim.consumer_refs)) errors.push({ code: 'invalid_contract_consumers', message: `${claim.contract_id} consumer_refs must be an array` });
        if (revision.revision === thread.current_revision) {
          if (contractIds.has(claim.contract_id)) errors.push({ code: 'duplicate_contract_id', message: `duplicate current contract ${claim.contract_id}` });
          contractIds.add(claim.contract_id);
        }
        if (options.verifyHashes && claim.content_hash !== contractClaimContentHash(claim)) errors.push({ code: 'contract_hash_mismatch', message: `${claim.contract_id} hash mismatch` });
      }
      if (options.verifyHashes && revision.content_hash !== ledgerRevisionContentHash(revision)) errors.push({ code: 'revision_content_hash_mismatch', message: `${thread.thread_id}@${revision.revision} content hash mismatch` });
      if (options.verifyHashes && revision.state_hash !== ledgerRevisionStateHash(revision)) errors.push({ code: 'revision_state_hash_mismatch', message: `${thread.thread_id}@${revision.revision} state hash mismatch` });
    }
    if (options.verifyHashes && thread.thread_state_hash !== designThreadStateHash(thread)) errors.push({ code: 'thread_state_hash_mismatch', message: `${thread.thread_id} state hash mismatch` });
  }
  for (const thread of asArray(document.threads)) {
    for (const parent of asArray(thread.parent_refs)) if (!ids.has(parent.thread_id ?? parent)) errors.push({ code: 'unknown_parent_thread', message: `${thread.thread_id} references an unknown parent` });
    for (const claim of asArray(currentThreadRevision(thread)?.contracts)) {
      for (const consumerId of asArray(claim.consumer_refs)) {
        if (!ids.has(consumerId)) errors.push({ code: 'unknown_contract_consumer', message: `${claim.contract_id} references unknown consumer ${consumerId}` });
      }
    }
  }
  const impactIds = new Set();
  for (const impact of asArray(document.impacts)) {
    if (!impact.impact_id || !DESIGN_IMPACT_CLASSIFICATIONS.has(impact.classification) || !impact.source_ref) {
      errors.push({ code: 'invalid_design_impact', message: 'design impact needs identity, classification, and source_ref' });
    }
    if (impactIds.has(impact.impact_id)) errors.push({ code: 'duplicate_design_impact', message: `duplicate design impact ${impact.impact_id}` });
    impactIds.add(impact.impact_id);
    for (const threadId of asArray(impact.affected_thread_ids)) {
      if (!ids.has(threadId)) errors.push({ code: 'unknown_impact_thread', message: `${impact.impact_id} references unknown thread ${threadId}` });
    }
    for (const contractId of asArray(impact.affected_contract_ids)) {
      if (!contractIds.has(contractId)) errors.push({ code: 'unknown_impact_contract', message: `${impact.impact_id} references unknown contract ${contractId}` });
    }
  }
  if (options.verifyHashes && document.document_state_hash !== designDocumentStateHash(document)) errors.push({ code: 'document_state_hash_mismatch', message: 'design ledger state hash mismatch' });
  return { valid: errors.length === 0, errors, warnings };
}

function subjectSlug(thread) {
  const withoutKind = String(thread.subject_ref).replace(new RegExp(`^${thread.kind}:`), '');
  const normalized = withoutKind.toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'subject';
  return normalized === slug ? slug : `${slug}-${stableHash(thread.subject_ref).slice(0, 8)}`;
}

export function designThreadViewPath(thread) {
  if (thread.kind === 'root') return 'designs/root.md';
  return `designs/${thread.kind}s/${subjectSlug(thread)}.md`;
}

function renderValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderThreadView(document, threads) {
  const first = threads[0];
  const lines = [
    `# ${first.kind[0].toUpperCase()}${first.kind.slice(1)} Design: ${first.subject_ref}`,
    '',
    `**Design:** ${document.design_id}`,
    '',
  ];
  for (const thread of threads) {
    const revision = currentThreadRevision(thread);
    lines.push(
      `## ${thread.purpose}`,
      '',
      `- Thread: \`${thread.thread_id}\``,
      `- Revision: ${thread.current_revision}`,
      `- Status: ${revision?.decision_status ?? 'missing'}`,
      `- Content hash: \`${revision?.content_hash ?? 'missing'}\``,
      `- Parents: ${asArray(thread.parent_refs).map((ref) => ref.thread_id ?? ref).join(', ') || 'none'}`,
      '',
      '### Requirements',
      '',
      ...(asArray(revision?.requirements).length ? asArray(revision.requirements).map((item) => `- ${renderValue(item)}`) : ['- None recorded']),
      '',
      '### Interfaces and invariants',
      '',
      ...(asArray(revision?.interfaces).concat(asArray(revision?.invariants)).length
        ? asArray(revision?.interfaces).concat(asArray(revision?.invariants)).map((item) => `- ${renderValue(item)}`)
        : ['- None recorded']),
      '',
      '### Contracts',
      '',
      ...(asArray(revision?.contracts).length
        ? asArray(revision.contracts).map((claim) => `- \`${claim.contract_id}\` (${claim.criticality}, ${claim.verification_status}); consumers: ${asArray(claim.consumer_refs).join(', ') || 'none'}`)
        : ['- None recorded']),
      '',
      '### Blocking questions',
      '',
      ...(asArray(revision?.blocking_questions).length ? asArray(revision.blocking_questions).map((item) => `- ${renderValue(item)}`) : ['- None recorded']),
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

function groupedThreadViews(document) {
  const grouped = new Map();
  for (const thread of document.threads) {
    const viewPath = designThreadViewPath(thread);
    if (!grouped.has(viewPath)) grouped.set(viewPath, []);
    grouped.get(viewPath).push(thread);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function renderLedgerIndex(document) {
  const lines = [
    `# Design ${document.design_id}`,
    '',
    `**Schema:** ${document.schema_version}`,
    `**Document state:** \`${document.document_state_hash}\``,
    '',
    '## Design Threads',
    '',
    '| Thread | Kind | Subject | Revision | Status | Content | View |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const thread of document.threads) {
    const revision = currentThreadRevision(thread);
    lines.push(`| ${thread.thread_id} | ${thread.kind} | ${thread.subject_ref} | ${thread.current_revision} | ${revision?.decision_status ?? 'missing'} | \`${String(revision?.content_hash ?? '').slice(0, 12)}\` | [open](${designThreadViewPath(thread)}) |`);
  }
  return `${lines.join('\n')}\n`;
}

export async function loadDesignLedger(root) {
  const document = await readJson(path.join(path.resolve(root), 'design.json'));
  if (document.schema_version !== DESIGN_LEDGER_SCHEMA_VERSION) {
    throw new Error('design.json is legacy v2.0; explicit migration is required before ledger operations');
  }
  return document;
}

export async function writeDesignLedger(root, input, options = {}) {
  const designRoot = path.resolve(root);
  return withFileLock(path.join(designRoot, 'design.json.lock'), async () => {
    const current = await readJsonIfExists(path.join(designRoot, 'design.json'));
    if (current?.schema_version === '2.0') {
      throw new Error('design.json is legacy v2.0; explicit migration is required before writing a v2.1 ledger');
    }
    if (current && options.expectedDocumentStateHash === undefined) {
      throw new Error('expected document state hash is required when updating a design ledger');
    }
    if (options.expectedDocumentStateHash !== undefined
      && current?.document_state_hash !== options.expectedDocumentStateHash) {
      throw Object.assign(new Error('design ledger changed; refresh before writing'), { code: 'DESIGN_CONFLICT' });
    }
    const next = finalizeDesignLedger(input);
    const validation = validateDesignLedger(next, { verifyHashes: true });
    if (!validation.valid) {
      const error = new Error(`invalid design ledger: ${validation.errors.map((item) => item.message).join('; ')}`);
      error.validation = validation;
      throw error;
    }
    await writeJsonAtomic(path.join(designRoot, 'design.json'), next);
    await writeTextAtomic(path.join(designRoot, 'DESIGN.md'), renderLedgerIndex(next));
    for (const [relativePath, threads] of groupedThreadViews(next)) {
      await writeTextAtomic(path.join(designRoot, relativePath), renderThreadView(next, threads));
    }
    return next;
  });
}

export async function writeMigratedDesignLedger(root, input, options = {}) {
  const designRoot = path.resolve(root);
  return withFileLock(path.join(designRoot, 'design.json.lock'), async () => {
    const current = await readJson(path.join(designRoot, 'design.json'));
    if (current.schema_version !== '2.0' || stableHash(current) !== options.expectedSourceDocumentHash) {
      throw Object.assign(new Error('legacy design changed after migration preview'), { code: 'MIGRATION_DESIGN_CONFLICT' });
    }
    const next = finalizeDesignLedger(input);
    const validation = validateDesignLedger(next, { verifyHashes: true });
    if (!validation.valid) throw new Error(`invalid migrated design ledger: ${validation.errors.map((error) => error.message).join('; ')}`);
    await writeJsonAtomic(path.join(designRoot, 'design.json'), next);
    await writeTextAtomic(path.join(designRoot, 'DESIGN.md'), renderLedgerIndex(next));
    for (const [relativePath, threads] of groupedThreadViews(next)) {
      await writeTextAtomic(path.join(designRoot, relativePath), renderThreadView(next, threads));
    }
    return next;
  });
}
