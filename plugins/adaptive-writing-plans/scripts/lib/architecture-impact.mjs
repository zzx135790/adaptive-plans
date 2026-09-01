import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { asArray, cloneJson, matchesPath, normalizeRelativePath, stableHash } from './io-utils.mjs';

export const IMPACT_CLASSIFICATIONS = new Set(['no_contract_change', 'contract_delta']);
export const IMPACT_STATUSES = new Set(['pending', 'satisfied', 'blocked']);

function boundaryPatterns(boundary) {
  if (typeof boundary === 'string') return boundary.includes('/') || boundary.includes('*') ? [boundary] : [];
  if (!boundary || typeof boundary !== 'object') return [];
  return [boundary.path, ...asArray(boundary.paths)].filter((item) => typeof item === 'string');
}

function ignored(architecture, changedPath) {
  return asArray(architecture.coverage?.ignore_paths).some((pattern) => matchesPath(pattern, changedPath));
}

function modulesForPath(architecture, changedPath) {
  return asArray(architecture.modules).filter((module) =>
    asArray(module.owned_paths).some((pattern) => matchesPath(pattern, changedPath)));
}

function zonesForPath(architecture, changedPath) {
  return asArray(architecture.experimental_zones).filter((zone) =>
    zone.status === 'active'
    && asArray(zone.owned_paths).some((pattern) => matchesPath(pattern, changedPath)));
}

export function analyzeArchitectureImpact(architecture, changedPaths, details = {}) {
  const normalized = [...new Set(asArray(changedPaths).map(normalizeRelativePath).filter(Boolean))].sort();
  const relevant = normalized.filter((changedPath) => !ignored(architecture, changedPath));
  const impacted = new Set();
  const impactedZones = new Set();
  const unmapped = [];
  const ambiguous = [];
  const surfaceChanges = [];

  for (const changedPath of relevant) {
    const owners = modulesForPath(architecture, changedPath);
    const zones = zonesForPath(architecture, changedPath);
    if (owners.length === 0 && zones.length === 0) {
      unmapped.push(changedPath);
      continue;
    }
    if (owners.length > 1) ambiguous.push({ path: changedPath, modules: owners.map((module) => module.id) });
    if (zones.length > 1) ambiguous.push({ path: changedPath, zones: zones.map((zone) => zone.id) });
    for (const zone of zones) impactedZones.add(zone.id);
    for (const module of owners) {
      impacted.add(module.id);
      for (const boundary of asArray(module.public_boundaries)) {
        if (boundaryPatterns(boundary).some((pattern) => matchesPath(pattern, changedPath))) {
          surfaceChanges.push({
            path: changedPath,
            module_id: module.id,
            boundary_id: typeof boundary === 'string' ? boundary : boundary.id ?? boundary.path ?? changedPath,
            critical: typeof boundary === 'object' && boundary.critical === true,
          });
        }
      }
    }
  }

  const classification = details.classification
    ?? ((surfaceChanges.length > 0 || details.forceContractChange === true) ? 'contract_delta' : 'no_contract_change');
  const evidence = asArray(details.evidence);
  const deltaRef = details.delta_ref ?? null;
  let status = 'pending';
  if (unmapped.length > 0 || ambiguous.length > 0) status = 'blocked';
  else if (classification === 'no_contract_change' && evidence.length > 0) status = 'satisfied';
  else if (classification === 'contract_delta' && deltaRef && details.approval) status = 'satisfied';

  const payload = {
    schema_version: '2.0',
    architecture_hash: String(architecture.architecture_hash ?? ''),
    changed_paths: normalized,
    relevant_paths: relevant,
    impacted_modules: [...impacted].sort(),
    impacted_zones: [...impactedZones].sort(),
    unmapped_paths: unmapped,
    ambiguous_paths: ambiguous,
    surface_changes: surfaceChanges,
    classification,
    status,
    evidence,
    delta_ref: deltaRef,
    approval: details.approval ?? null,
  };
  return { ...payload, impact_id: `impact-${stableHash(payload).slice(0, 16)}` };
}

export function validateArchitectureImpact(impact, architecture, options = {}) {
  const errors = [];
  const warnings = [];
  if (!impact || typeof impact !== 'object' || Array.isArray(impact)) {
    return { valid: false, errors: [{ code: 'not_object', message: 'architecture impact must be an object' }], warnings };
  }
  if (impact.schema_version !== '2.0') errors.push({ code: 'unsupported_schema_version', message: 'impact schema_version must be 2.0' });
  if (typeof impact.impact_id !== 'string' || impact.impact_id.length === 0) errors.push({ code: 'missing_impact_id', message: 'impact_id is required' });
  if (impact.architecture_hash !== architecture.architecture_hash) errors.push({ code: 'stale_architecture', message: 'impact references a stale architecture baseline' });
  if (!IMPACT_CLASSIFICATIONS.has(impact.classification)) errors.push({ code: 'invalid_classification', message: 'invalid architecture impact classification' });
  if (!IMPACT_STATUSES.has(impact.status)) errors.push({ code: 'invalid_status', message: 'invalid architecture impact status' });
  if (asArray(impact.unmapped_paths).length > 0) errors.push({ code: 'unmapped_changes', message: `unmapped changes: ${impact.unmapped_paths.join(', ')}` });
  if (asArray(impact.ambiguous_paths).length > 0) errors.push({ code: 'ambiguous_ownership', message: 'some changed paths have multiple owners' });
  if (impact.classification === 'no_contract_change' && asArray(impact.evidence).length === 0) {
    errors.push({ code: 'missing_no_change_evidence', message: 'no_contract_change requires evidence' });
  }
  if (impact.classification === 'contract_delta') {
    if (!impact.delta_ref) errors.push({ code: 'missing_delta_ref', message: 'contract_delta requires delta_ref' });
    if (!impact.approval) errors.push({ code: 'missing_delta_approval', message: 'contract_delta requires explicit approval evidence' });
  }
  if (options.requireSatisfied !== false && impact.status !== 'satisfied') {
    errors.push({ code: 'impact_not_satisfied', message: `architecture impact is ${impact.status}` });
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function satisfyArchitectureImpact(impact, details = {}) {
  return analyzeArchitectureImpact(details.architecture, impact.changed_paths, {
    classification: impact.classification,
    evidence: details.evidence ?? impact.evidence,
    delta_ref: details.delta_ref ?? impact.delta_ref,
    approval: details.approval ?? impact.approval,
    forceContractChange: impact.classification === 'contract_delta',
  });
}

export async function fingerprintArchitectureSurfaces(projectRoot, architecture) {
  const fingerprints = [];
  for (const module of asArray(architecture.modules)) {
    for (const boundary of asArray(module.public_boundaries)) {
      if (!boundary || typeof boundary !== 'object' || typeof boundary.path !== 'string' || boundary.path.includes('*')) continue;
      const filePath = path.join(path.resolve(projectRoot), normalizeRelativePath(boundary.path));
      try {
        const content = await fs.readFile(filePath);
        fingerprints.push({ module_id: module.id, boundary_id: boundary.id ?? boundary.path, path: boundary.path, sha256: crypto.createHash('sha256').update(content).digest('hex') });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        fingerprints.push({ module_id: module.id, boundary_id: boundary.id ?? boundary.path, path: boundary.path, sha256: null });
      }
    }
  }
  return fingerprints;
}

export function withImpactEvidence(impact, evidence) {
  const next = cloneJson(impact);
  next.evidence = asArray(evidence);
  if (next.classification === 'no_contract_change' && next.evidence.length > 0 && asArray(next.unmapped_paths).length === 0 && asArray(next.ambiguous_paths).length === 0) {
    next.status = 'satisfied';
  }
  return next;
}
