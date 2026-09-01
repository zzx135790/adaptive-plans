import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeEngineeringPosture } from './engineering-posture.mjs';
import { classifyDesignRepresentation } from './design-engine.mjs';
import { convertLegacyDesignToLedger, writeMigratedDesignLedger } from './design-ledger.mjs';
import { appendEvent, loadMap, migrateMapV1, withMapLock, writeMap } from './plan-protocol.mjs';
import { asArray, cloneJson, ensureDir, stableHash, writeJsonAtomic } from './io-utils.mjs';

export const MIGRATION_PROTOCOL_VERSION = '2.1';
const RECOVERY_DIR = '.adaptive-migrations';

function hashBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function listFiles(root, relative = '') {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    if (child === RECOVERY_DIR || child.startsWith(`${RECOVERY_DIR}${path.sep}`)) continue;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile() && !entry.name.endsWith('.lock') && !entry.name.includes('.tmp-')) {
      files.push(child.split(path.sep).join('/'));
    }
  }
  return files;
}

async function preservationManifest(root) {
  const manifest = [];
  for (const relative of await listFiles(root)) {
    const content = await fs.readFile(path.join(root, relative));
    manifest.push({ path: relative, sha256: hashBytes(content), bytes: content.byteLength });
  }
  return manifest;
}

function migrationTarget(current) {
  let target;
  if (current.schema_version === '1.0') target = migrateMapV1(current);
  else if (current.schema_version === '2.0') target = cloneJson(current);
  else throw new Error(`unsupported map schema for migration: ${current.schema_version ?? 'missing'}`);
  if (target.engineering_posture === undefined) {
    target.engineering_posture = normalizeEngineeringPosture(null, { legacyRef: `map.json@${current.schema_version}` });
  }
  target.migration = {
    protocol_version: MIGRATION_PROTOCOL_VERSION,
    source_schema_version: current.schema_version,
    source_map_hash: stableHash(current),
    posture_status: target.engineering_posture?.status ?? 'authoritative',
  };
  return target;
}

function proposalContent(proposal) {
  return {
    schema_version: proposal.schema_version,
    operation: proposal.operation,
    status: proposal.status,
    source_schema_version: proposal.source_schema_version,
    target_schema_version: proposal.target_schema_version,
    source_map_hash: proposal.source_map_hash,
    target_map_hash: proposal.target_map_hash,
    target_map: cloneJson(proposal.target_map),
    map_migration_required: proposal.map_migration_required === true,
    changed_paths: cloneJson(proposal.changed_paths),
    preservation_manifest: cloneJson(proposal.preservation_manifest),
    design_migration: cloneJson(proposal.design_migration ?? null),
  };
}

async function designMigrationPreview(root, options) {
  if (options.includeDesign !== true) return null;
  let document;
  try {
    document = JSON.parse(await fs.readFile(path.join(root, 'design.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { requested: true, status: 'not_present', blockers: [] };
    throw error;
  }
  const classification = classifyDesignRepresentation(document);
  if (!classification.readable) return { requested: true, status: 'blocked', blockers: [{ code: 'unsupported_design_representation' }] };
  if (!classification.migration_required) return { requested: true, status: 'not_required', blockers: [] };
  if (!options.postureRef) {
    return { requested: true, status: 'blocked', blockers: [{ code: 'missing_posture_ref', message: 'design migration requires an explicit authoritative PostureRef' }] };
  }
  const target = convertLegacyDesignToLedger(document, { postureRef: options.postureRef });
  return {
    requested: true,
    status: 'preview',
    blockers: [],
    posture_ref: cloneJson(options.postureRef),
    source_document_hash: stableHash(document),
    target_document_hash: stableHash(target),
    target_design: target,
    preserved_revision_count: document.revisions.length,
    child_threads_created: 0,
    verified_contracts_created: 0,
  };
}

export function planMigrationProposalHash(proposal) {
  return stableHash(proposalContent(proposal));
}

function alreadyCurrent(current) {
  return current.schema_version === '2.0'
    && current.engineering_posture !== undefined
    && (current.migration?.protocol_version === MIGRATION_PROTOCOL_VERSION
      || current.engineering_posture?.status !== 'unknown_legacy');
}

export async function previewPlanMigration(root, options = {}) {
  const planRoot = path.resolve(root);
  const current = await loadMap(planRoot);
  const manifest = await preservationManifest(planRoot);
  const designMigration = await designMigrationPreview(planRoot, options);
  const designBlocked = asArray(designMigration?.blockers).length > 0;
  const mapRequired = !alreadyCurrent(current);
  const designRequired = designMigration?.status === 'preview';
  const status = designBlocked ? 'blocked' : mapRequired || designRequired ? 'preview' : 'not_required';
  const target = mapRequired || designRequired ? migrationTarget(current) : cloneJson(current);
  if (designRequired) {
    target.stage = 'designing';
    target.current_node = null;
    target.gates = target.gates ?? {};
    target.gates.design = {
      ...(target.gates.design ?? {}),
      status: 'stale',
      reason: 'v2.0 design approvals are historical after v2.1 content rehashing; regenerate the inline brief',
    };
    for (const node of asArray(target.nodes)) {
      if (asArray(node?.design_refs).length === 0 || node.status === 'cancelled') continue;
      if (node.status === 'done') node.revalidation_required = true;
      else {
        node.status = 'stale';
        node.stale_reason = 'design representation migrated to v2.1 and requires exact-hash reapproval';
      }
    }
  }
  const nodePaths = asArray(target.nodes)
    .filter((node) => typeof node?.id === 'string' && node.id.length > 0)
    .map((node) => `nodes/${encodeURIComponent(node.id)}.md`);
  const designPaths = designRequired ? ['design.json', 'DESIGN.md', 'designs/root.md'] : [];
  const changedPaths = status !== 'preview' ? [] : [...new Set(['map.json', 'MAP.md', ...nodePaths, ...designPaths])].sort();
  const proposal = {
    schema_version: MIGRATION_PROTOCOL_VERSION,
    operation: 'plan_migration_preview',
    status,
    source_schema_version: current.schema_version,
    target_schema_version: target.schema_version,
    source_map_hash: stableHash(current),
    target_map_hash: stableHash(target),
    target_map: target,
    changed_paths: changedPaths,
    preservation_manifest: manifest,
    map_migration_required: mapRequired || designRequired,
    design_migration: designMigration,
  };
  proposal.proposal_hash = planMigrationProposalHash(proposal);
  proposal.recovery_ref = status === 'preview' ? `${RECOVERY_DIR}/${proposal.proposal_hash}/recovery.json` : null;
  proposal.writes = false;
  return proposal;
}

async function verifyManifest(root, expected) {
  const current = await preservationManifest(root);
  if (stableHash(current) !== stableHash(expected)) {
    throw Object.assign(new Error('plan artifacts changed after migration preview'), { code: 'MIGRATION_PLAN_CONFLICT' });
  }
}

async function recoveryEntries(root, paths) {
  const entries = [];
  for (const relative of paths) {
    const filePath = path.join(root, relative);
    try {
      const content = await fs.readFile(filePath);
      entries.push({ path: relative, existed: true, sha256: hashBytes(content), content_base64: content.toString('base64') });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries.push({ path: relative, existed: false, sha256: null, content_base64: null });
    }
  }
  return entries;
}

function assertSafeRelative(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
    throw new Error(`unsafe recovery path: ${relative}`);
  }
}

async function writeBytesAtomic(filePath, content) {
  await ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, filePath);
  } catch (error) {
    try { await fs.unlink(temporary); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    throw error;
  }
}

export async function applyPlanMigration(root, proposal, options = {}) {
  if (!proposal || proposal.proposal_hash !== planMigrationProposalHash(proposal)) {
    throw Object.assign(new Error('migration proposal hash does not match its content'), { code: 'MIGRATION_PROPOSAL_INVALID' });
  }
  if (options.expectedProposalHash !== proposal.proposal_hash) {
    throw Object.assign(new Error('migration proposal hash was not explicitly confirmed'), { code: 'MIGRATION_PROPOSAL_CONFLICT' });
  }
  if (proposal.status === 'not_required') {
    return { schema_version: MIGRATION_PROTOCOL_VERSION, operation: 'plan_migration_apply', status: 'not_required', writes: false };
  }
  if (proposal.status === 'blocked') {
    throw Object.assign(new Error(`migration is blocked: ${asArray(proposal.design_migration?.blockers).map((blocker) => blocker.code).join(', ')}`), { code: 'MIGRATION_BLOCKED' });
  }
  return withMapLock(root, async () => {
    const fresh = await previewPlanMigration(root, {
      includeDesign: proposal.design_migration?.requested === true,
      postureRef: proposal.design_migration?.posture_ref,
    });
    if (fresh.proposal_hash !== proposal.proposal_hash) {
      throw Object.assign(new Error('migration preview is stale'), { code: 'MIGRATION_PLAN_CONFLICT' });
    }
    await verifyManifest(path.resolve(root), proposal.preservation_manifest);
    const entries = await recoveryEntries(path.resolve(root), proposal.changed_paths);
    const recovery = {
      schema_version: MIGRATION_PROTOCOL_VERSION,
      migration_id: proposal.proposal_hash,
      source_map_hash: proposal.source_map_hash,
      target_map_hash: proposal.target_map_hash,
      proposal_hash: proposal.proposal_hash,
      preservation_manifest_hash: stableHash(proposal.preservation_manifest),
      files: entries,
    };
    recovery.recovery_hash = stableHash(recovery);
    await writeJsonAtomic(path.join(path.resolve(root), proposal.recovery_ref), recovery);
    const written = proposal.map_migration_required
      ? await writeMap(root, proposal.target_map, { preserveUpdatedAt: true })
      : await loadMap(root);
    if (stableHash(written) !== proposal.target_map_hash) throw new Error('written migration target hash differs from preview');
    let writtenDesign = null;
    if (proposal.design_migration?.status === 'preview') {
      writtenDesign = await writeMigratedDesignLedger(root, proposal.design_migration.target_design, {
        expectedSourceDocumentHash: proposal.design_migration.source_document_hash,
      });
      if (stableHash(writtenDesign) !== proposal.design_migration.target_document_hash) throw new Error('written design migration target differs from preview');
    }
    await appendEvent(root, {
      event_id: `plan-migration-applied-${proposal.proposal_hash}`,
      type: 'plan_migration_applied',
      migration_id: proposal.proposal_hash,
      source_map_hash: proposal.source_map_hash,
      target_map_hash: proposal.target_map_hash,
      recovery_ref: proposal.recovery_ref,
    });
    return {
      schema_version: MIGRATION_PROTOCOL_VERSION,
      operation: 'plan_migration_apply',
      status: 'applied',
      migration_id: proposal.proposal_hash,
      map_hash: proposal.target_map_hash,
      recovery_ref: proposal.recovery_ref,
      preservation_manifest_hash: recovery.preservation_manifest_hash,
      writes: true,
      map: written,
      design: writtenDesign,
    };
  });
}

export async function recoverPlanMigration(root, migrationId, options = {}) {
  if (typeof migrationId !== 'string' || !/^[a-f0-9]{64}$/.test(migrationId)) throw new Error('recovery requires a migration hash');
  return withMapLock(root, async () => {
    const planRoot = path.resolve(root);
    const recoveryPath = path.join(planRoot, RECOVERY_DIR, migrationId, 'recovery.json');
    const recovery = JSON.parse(await fs.readFile(recoveryPath, 'utf8'));
    const { recovery_hash: recoveryHash, ...content } = recovery;
    if (recoveryHash !== stableHash(content)) throw Object.assign(new Error('recovery material hash mismatch'), { code: 'MIGRATION_RECOVERY_INVALID' });
    const current = await loadMap(planRoot);
    const currentHash = stableHash(current);
    if (options.expectedCurrentMapHash !== currentHash || currentHash !== recovery.target_map_hash) {
      throw Object.assign(new Error('current map hash was not explicitly confirmed or no longer matches the migration target'), { code: 'MIGRATION_RECOVERY_CONFLICT' });
    }
    for (const entry of recovery.files) {
      assertSafeRelative(entry.path);
      const filePath = path.join(planRoot, entry.path);
      if (!entry.existed) {
        try { await fs.unlink(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        continue;
      }
      const bytes = Buffer.from(entry.content_base64, 'base64');
      if (hashBytes(bytes) !== entry.sha256) throw Object.assign(new Error(`recovery bytes changed for ${entry.path}`), { code: 'MIGRATION_RECOVERY_INVALID' });
      await writeBytesAtomic(filePath, bytes);
    }
    const restored = await loadMap(planRoot);
    if (stableHash(restored) !== recovery.source_map_hash) throw new Error('recovered map does not match its source hash');
    await appendEvent(root, {
      event_id: `plan-migration-recovered-${migrationId}`,
      type: 'plan_migration_recovered',
      migration_id: migrationId,
      restored_map_hash: recovery.source_map_hash,
      recovery_ref: `${RECOVERY_DIR}/${migrationId}/recovery.json`,
    });
    return {
      schema_version: MIGRATION_PROTOCOL_VERSION,
      operation: 'plan_migration_recover',
      status: 'recovered',
      migration_id: migrationId,
      map_hash: recovery.source_map_hash,
      writes: true,
      map: restored,
    };
  });
}
