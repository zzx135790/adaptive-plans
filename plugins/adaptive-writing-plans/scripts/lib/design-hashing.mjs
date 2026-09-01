import { cloneJson, stableHash } from './io-utils.mjs';

const HASH_FIELDS = new Set(['content_hash', 'design_hash', 'state_hash', 'updated_at']);
const APPROVAL_STATE_FIELDS = new Set(['status', 'approval', 'provider_waiver', 'stale_reason']);

function withoutFields(value, fields) {
  const next = cloneJson(value);
  for (const field of fields) delete next[field];
  return next;
}

export function designRevisionContent(revision) {
  return withoutFields(revision, new Set([...HASH_FIELDS, ...APPROVAL_STATE_FIELDS]));
}

export function designRevisionContentHash(revision) {
  return stableHash(designRevisionContent(revision));
}

export function designRevisionState(revision) {
  return withoutFields(revision, HASH_FIELDS);
}

export function designRevisionStateHash(revision) {
  return stableHash(designRevisionState(revision));
}

export function legacyDesignRevisionHash(revision) {
  const next = cloneJson(revision);
  delete next.design_hash;
  delete next.approval;
  delete next.updated_at;
  return stableHash(next);
}

export function withDesignRevisionHashes(revision) {
  const next = cloneJson(revision);
  next.content_hash = designRevisionContentHash(next);
  next.design_hash = next.content_hash;
  next.state_hash = designRevisionStateHash(next);
  return next;
}

export function reviewedContentHash(revision) {
  return revision?.content_hash ?? revision?.design_hash ?? null;
}

export function currentStateHash(revision) {
  return revision?.state_hash ?? revision?.design_hash ?? null;
}
