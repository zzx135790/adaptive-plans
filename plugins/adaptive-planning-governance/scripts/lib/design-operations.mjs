import {
  addDesignThread,
  approveDesignThread,
  createDesignLedger,
  currentThreadRevision,
  ledgerApprovalBrief,
  loadDesignLedger,
  recordDesignThreadProviderResult,
  reviseDesignThread,
  updateDesignThread,
  writeDesignLedger,
} from './design-ledger.mjs';
import {
  designApprovalBrief,
  normalizeDesignProviderSelection,
  triageDesign,
} from './design-engine.mjs';
import { asArray, cloneJson } from './io-utils.mjs';

function designThread(document, threadId = 'root') {
  const thread = asArray(document?.threads).find((candidate) => candidate.thread_id === threadId);
  if (!thread) throw new Error(`unknown design thread ${threadId}`);
  return thread;
}

function providerStatus(selection) {
  return {
    status: selection.status ?? 'unknown',
    blocking_concerns: asArray(selection.blocking_concerns),
    composition_blockers: asArray(selection.composition_blockers),
  };
}

function canonicalSelection(profile, selection = {}) {
  return normalizeDesignProviderSelection(profile, selection);
}

export function createCanonicalDesign(request = {}, selection = {}) {
  const profile = request.profile ?? triageDesign(request);
  const providers = canonicalSelection(profile, selection);
  return createDesignLedger({
    ...cloneJson(request),
    posture_ref: cloneJson(profile.posture_ref),
    behavior_budget: cloneJson(profile.behavior_budget),
    scope_provenance: asArray(profile.scope_provenance),
    provider_refs: cloneJson(providers.selected),
    provider_status: providerStatus(providers),
    architecture_hash: profile.architecture_hash,
  });
}

export async function startCanonicalDesign(root, request = {}, selection = {}) {
  return writeDesignLedger(root, createCanonicalDesign(request, selection));
}

export async function addCanonicalDesignThread(root, input = {}, options = {}) {
  const document = await loadDesignLedger(root);
  const next = addDesignThread(document, input, {
    expectedDocumentStateHash: options.expectedHash,
  });
  return writeDesignLedger(root, next, { expectedDocumentStateHash: options.expectedHash });
}

export async function updateCanonicalDesign(root, updates, options = {}) {
  const document = await loadDesignLedger(root);
  const thread = designThread(document, options.threadId);
  const next = updateDesignThread(document, thread.thread_id, updates, {
    expectedDocumentStateHash: document.document_state_hash,
    expectedThreadStateHash: thread.thread_state_hash,
    expectedContentHash: options.expectedHash,
  });
  return writeDesignLedger(root, next, { expectedDocumentStateHash: document.document_state_hash });
}

export async function recordCanonicalDesignProviderResult(root, result, options = {}) {
  const document = await loadDesignLedger(root);
  const thread = designThread(document, options.threadId);
  const next = recordDesignThreadProviderResult(document, thread.thread_id, result, {
    expectedDocumentStateHash: document.document_state_hash,
    expectedThreadStateHash: thread.thread_state_hash,
    expectedContentHash: options.expectedHash,
  });
  return writeDesignLedger(root, next, { expectedDocumentStateHash: document.document_state_hash });
}

export async function reviseCanonicalDesign(root, details = {}) {
  const document = await loadDesignLedger(root);
  const thread = designThread(document, details.threadId);
  const current = currentThreadRevision(thread);
  if (!current) throw new Error(`current ${thread.thread_id} design revision is missing`);
  const profile = details.profile ?? (details.request ? triageDesign({
    ...details.request,
    posture_ref: details.request.posture_ref ?? current.posture_ref,
    behavior_budget: details.request.behavior_budget ?? current.behavior_budget,
    scope_provenance: details.request.scope_provenance ?? current.scope_provenance,
    architecture_hash: details.request.architecture_hash ?? current.architecture_hash,
  }) : null);
  const selection = details.provider_selection
    ? canonicalSelection(profile ?? {}, details.provider_selection)
    : null;
  const updates = {
    requirements: details.requirements ?? current.requirements,
    options: asArray(details.options),
    selected_option: details.selected_option ?? null,
    interfaces: asArray(details.interfaces),
    invariants: asArray(details.invariants),
    failure_modes: asArray(details.failure_modes),
    operational_model: asArray(details.operational_model),
    migration: asArray(details.migration),
    blocking_questions: asArray(details.blocking_questions),
    architecture_hash: profile?.architecture_hash ?? current.architecture_hash,
    posture_ref: cloneJson(profile?.posture_ref ?? current.posture_ref),
    behavior_budget: cloneJson(profile?.behavior_budget ?? current.behavior_budget),
    scope_provenance: asArray(profile?.scope_provenance ?? current.scope_provenance),
    ...(selection ? {
      provider_refs: cloneJson(selection.selected),
      provider_status: providerStatus(selection),
    } : {}),
  };
  const next = reviseDesignThread(document, thread.thread_id, updates, {
    expectedDocumentStateHash: document.document_state_hash,
    expectedThreadStateHash: thread.thread_state_hash,
    reason: details.reason,
  });
  return writeDesignLedger(root, next, { expectedDocumentStateHash: document.document_state_hash });
}

export function designApprovalBriefForDocument(document, threadId = 'root') {
  return Array.isArray(document?.threads)
    ? ledgerApprovalBrief(document, threadId)
    : designApprovalBrief(document);
}

export async function approveCanonicalDesign(root, input = {}) {
  const document = await loadDesignLedger(root);
  const thread = designThread(document, input.threadId);
  const next = approveDesignThread(document, thread.thread_id, {
    expectedContentHash: input.expectedHash,
    expectedPostureHash: input.expectedPostureHash,
    briefHash: input.briefHash,
    approval: input.approval,
    waiver: input.waiver,
    brief_context: input.brief_context,
  }, {
    expectedDocumentStateHash: document.document_state_hash,
    expectedThreadStateHash: thread.thread_state_hash,
  });
  return writeDesignLedger(root, next, { expectedDocumentStateHash: document.document_state_hash });
}

export function currentCanonicalDesignRef(document, threadId = 'root') {
  const thread = designThread(document, threadId);
  const revision = currentThreadRevision(thread);
  if (!revision) throw new Error(`current ${thread.thread_id} design revision is missing`);
  return {
    design_id: document.design_id,
    thread_id: thread.thread_id,
    revision: revision.revision,
    design_hash: revision.content_hash,
    content_hash: revision.content_hash,
    status: revision.decision_status,
    scope: thread.thread_id === 'root' ? 'root' : 'thread',
    node_id: null,
  };
}
