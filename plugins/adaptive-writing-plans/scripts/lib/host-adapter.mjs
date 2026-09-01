import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDir, readJsonIfExists, stableHash, writeJsonAtomic, writeTextAtomic } from './io-utils.mjs';
import { validateHandoff } from './plan-protocol.mjs';
import { validateCompositionContract } from './design-engine.mjs';

export const HOST_ADAPTER_SCHEMA_VERSION = '1.0';
export const HOST_PROFILES = {
  'claude-code': {
    defaultTarget: () => path.join(os.homedir(), '.claude', 'skills', 'adaptive-writing-plans'),
  },
  agents: {
    defaultTarget: () => path.join(os.homedir(), '.agents', 'skills', 'adaptive-writing-plans'),
  },
};

const MANIFEST_NAME = '.adaptive-host-adapter.json';

function uniqueRefs(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value)).filter(Boolean))];
}

function handoffArtifactRefs(handoff) {
  return uniqueRefs((Array.isArray(handoff?.artifacts) ? handoff.artifacts : []).map((artifact) => (
    typeof artifact === 'string' ? artifact : artifact?.path ?? artifact?.ref ?? ''
  )));
}

export function verifyProviderWorkflowOutcome(receipt = {}) {
  const reasons = [];
  const handoffValidation = validateHandoff(receipt.handoff);
  if (!handoffValidation.valid) reasons.push(...handoffValidation.errors.map((error) => `invalid_handoff:${error.code}`));
  const contractValidation = validateCompositionContract(receipt.composition_contract);
  if (!contractValidation.valid) reasons.push(...contractValidation.errors.map((error) => `invalid_composition:${error.code}`));
  if (receipt.provider_id !== receipt.composition_contract?.provider_id) reasons.push('provider_identity_mismatch');
  if (receipt.invocation_state !== 'completed') reasons.push('invocation_not_completed');
  if (receipt.composition_contract?.invocation?.dependency_readiness !== 'ready') reasons.push('dependency_not_ready');
  if (receipt.expected_version_or_digest
    && receipt.expected_version_or_digest !== receipt.composition_contract?.version_or_digest) {
    reasons.push('version_digest_drift');
  }

  const expected = uniqueRefs(receipt.expected_artifact_refs);
  const observed = uniqueRefs(receipt.observed_artifact_refs);
  const declared = handoffArtifactRefs(receipt.handoff);
  const missing = expected.filter((artifact) => !observed.includes(artifact) || !declared.includes(artifact));
  if (missing.length > 0) reasons.push('expected_artifact_not_observed');

  let status;
  if (reasons.length > 0) status = 'unverified_persistence';
  else if (expected.length === 0) status = 'conversation_only';
  else if (receipt.persistence_state === 'verified') status = 'persisted';
  else {
    status = 'unverified_persistence';
    reasons.push('persistence_not_verified');
  }
  return {
    schema_version: HOST_ADAPTER_SCHEMA_VERSION,
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

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function walk(root, prefix = '') {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function sourceFiles(pluginRoot) {
  const root = path.resolve(pluginRoot);
  const skillRoot = path.join(root, 'skills', 'adaptive-writing-plans');
  const mapped = [];
  for (const relative of await walk(skillRoot)) {
    if (relative === MANIFEST_NAME || relative.startsWith(`agents${path.sep}`)) continue;
    mapped.push({ source: path.join(skillRoot, relative), target: relative });
  }
  for (const directory of ['scripts', 'schemas', 'hooks', 'assets']) {
    for (const relative of await walk(path.join(root, directory))) {
      mapped.push({ source: path.join(root, directory, relative), target: path.join(directory, relative) });
    }
  }
  return mapped.sort((left, right) => left.target.localeCompare(right.target));
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function compactDiff(before, after) {
  const oldLines = before.toString('utf8').split('\n');
  const newLines = after.toString('utf8').split('\n');
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  return [
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join('\n');
}

export async function planHostAdapter(options = {}) {
  const host = String(options.host ?? '');
  const profile = HOST_PROFILES[host];
  if (!profile) throw new Error(`unsupported host ${host}; use ${Object.keys(HOST_PROFILES).join(' or ')}`);
  const pluginRoot = path.resolve(options.pluginRoot ?? process.cwd());
  const targetRoot = path.resolve(options.target ?? profile.defaultTarget());
  const manifestPath = path.join(targetRoot, MANIFEST_NAME);
  const manifest = await readJsonIfExists(manifestPath);
  if (manifest && (manifest.schema_version !== HOST_ADAPTER_SCHEMA_VERSION || manifest.host !== host)) {
    throw new Error('target has an incompatible host adapter manifest');
  }
  const previous = manifest?.managed_files ?? {};
  const changes = [];
  const contents = new Map();
  const managedFiles = {};

  for (const entry of await sourceFiles(pluginRoot)) {
    const relative = entry.target.split(path.sep).join('/');
    const content = await fs.readFile(entry.source);
    const sourceHash = hash(content);
    const targetPath = path.join(targetRoot, relative);
    const current = await readOptional(targetPath);
    const currentHash = current ? hash(current) : null;
    managedFiles[relative] = sourceHash;
    contents.set(relative, content);
    let status = 'unchanged';
    let reason = 'target matches source';
    if (!current) {
      status = 'add';
      reason = 'target file does not exist';
    } else if (currentHash !== sourceHash) {
      if (previous[relative] && previous[relative] === currentHash) {
        status = 'update';
        reason = 'previous managed content is unchanged';
      } else {
        status = 'conflict';
        reason = previous[relative] ? 'managed file was modified outside the adapter' : 'existing file is not adapter-managed';
      }
    }
    const change = {
      path: relative,
      status,
      reason,
      current_hash: currentHash,
      source_hash: sourceHash,
    };
    if (options.diff === true && current && status !== 'unchanged') change.diff = compactDiff(current, content);
    changes.push(change);
  }

  for (const relative of Object.keys(previous).sort()) {
    if (!Object.hasOwn(managedFiles, relative)) {
      changes.push({
        path: relative.split(path.sep).join('/'),
        status: 'retained',
        reason: 'previously managed file is no longer in the source; adapters never delete target files',
        current_hash: hash(await readOptional(path.join(targetRoot, relative)) ?? Buffer.alloc(0)),
        source_hash: null,
      });
    }
  }

  const conflicts = changes.filter((change) => change.status === 'conflict');
  const writes = changes.filter((change) => ['add', 'update'].includes(change.status));
  return {
    schema_version: HOST_ADAPTER_SCHEMA_VERSION,
    host,
    mode: options.apply === true ? 'apply' : 'dry-run',
    plugin: 'adaptive-writing-plans',
    target: targetRoot,
    status: conflicts.length > 0 ? 'conflict' : writes.length > 0 ? 'changes' : 'current',
    summary: {
      add: changes.filter((change) => change.status === 'add').length,
      update: changes.filter((change) => change.status === 'update').length,
      unchanged: changes.filter((change) => change.status === 'unchanged').length,
      conflict: conflicts.length,
      retained: changes.filter((change) => change.status === 'retained').length,
    },
    changes,
    manifest: {
      schema_version: HOST_ADAPTER_SCHEMA_VERSION,
      host,
      plugin: 'adaptive-writing-plans',
      source_digest: hash(Buffer.from(JSON.stringify(managedFiles))),
      managed_files: managedFiles,
    },
    _contents: contents,
  };
}

export async function syncHostAdapter(options = {}) {
  const plan = await planHostAdapter(options);
  if (options.apply !== true) {
    const { _contents, manifest, ...visible } = plan;
    return { ...visible, managed_source_digest: manifest.source_digest };
  }
  if (plan.status === 'conflict') {
    const error = new Error('host adapter has conflicts; no files were written');
    error.code = 'HOST_ADAPTER_CONFLICT';
    error.result = { ...plan, _contents: undefined };
    throw error;
  }
  await ensureDir(plan.target);
  for (const change of plan.changes.filter((item) => ['add', 'update'].includes(item.status))) {
    const filePath = path.join(plan.target, change.path);
    await ensureDir(path.dirname(filePath));
    await writeTextAtomic(filePath, plan._contents.get(change.path));
  }
  await writeJsonAtomic(path.join(plan.target, MANIFEST_NAME), plan.manifest);
  const { _contents, manifest, ...visible } = plan;
  return { ...visible, applied: true, managed_source_digest: manifest.source_digest };
}
