import fs from 'node:fs/promises';
import path from 'node:path';

import {
  asArray,
  cloneJson,
  ensureDir,
  isObject,
  matchesPath,
  readJson,
  readJsonIfExists,
  stableHash,
  withFileLock,
  writeJsonAtomic,
  writeTextAtomic,
} from './io-utils.mjs';
import { POSTURE_KINDS } from './engineering-posture.mjs';

export const ARCHITECTURE_SCHEMA_VERSION = '2.0';
export const RELATION_TYPES = new Set(['calls', 'reads', 'writes', 'emits', 'owns', 'extends', 'migrates']);
export const EVIDENCE_STATUSES = new Set(['confirmed', 'inferred', 'missing']);
export const CONCERN_REQUIREMENTS = {
  api: ['interfaces', 'error_semantics', 'compatibility'],
  data: ['ownership', 'integrity', 'retention'],
  distributed: ['ordering', 'idempotency', 'retry', 'recovery'],
  security: ['trust_boundaries', 'authorization', 'sensitive_data'],
  performance: ['budgets', 'measurement', 'degradation'],
  operability: ['observability', 'alerts', 'runbook'],
  migration: ['forward', 'rollback', 'compatibility_window'],
  ux: ['states', 'accessibility', 'failure_feedback'],
  testing: ['seams', 'contract_tests'],
};

const MODULE_STRING_ARRAY_FIELDS = [
  'non_goals', 'owners', 'owned_paths', 'invariants', 'dependencies',
  'required_concerns',
];

export function defaultArchitectureRoot(projectRoot) {
  return path.join(path.resolve(projectRoot), 'docs', 'architecture', 'adaptive');
}

function withoutDerivedArchitectureFields(architecture) {
  const next = cloneJson(architecture);
  delete next.architecture_hash;
  delete next.updated_at;
  delete next.approval;
  for (const module of asArray(next.modules)) delete module.contract_hash;
  return next;
}

function withoutContractHash(module) {
  const next = cloneJson(module);
  delete next.contract_hash;
  return next;
}

export function finalizeArchitecture(input) {
  const next = cloneJson(input);
  next.schema_version = ARCHITECTURE_SCHEMA_VERSION;
  next.modules = asArray(next.modules).map((module) => ({
    ...module,
    contract_hash: stableHash(withoutContractHash(module)),
  }));
  next.experimental_zones = asArray(next.experimental_zones);
  next.relations = asArray(next.relations);
  next.architecture_hash = stableHash(withoutDerivedArchitectureFields(next));
  return next;
}

function validatePostureRef(value, errors, prefix, options = {}) {
  if (value?.status === 'unknown_legacy') {
    if (options.allowUnknown !== true) {
      errors.push({ code: 'unknown_legacy_posture', message: `${prefix} needs explicit posture assessment` });
    }
    return;
  }
  if (!isObject(value) || !POSTURE_KINDS.has(value.kind)
    || !/^[a-f0-9]{64}$/.test(String(value.posture_hash ?? ''))
    || typeof value.source_ref !== 'string' || value.source_ref.length === 0) {
    errors.push({ code: 'invalid_posture_ref', message: `${prefix} must be a hash-bound PostureRef` });
    return;
  }
  if (options.zone === true && !['spike', 'experiment'].includes(value.kind)) {
    errors.push({ code: 'invalid_zone_posture', message: `${prefix} must use spike or experiment posture` });
  }
}

function postureResolutionError(code, message) {
  return Object.assign(new Error(message), { code });
}

function requireAuthoritativePostureRef(value, source) {
  const errors = [];
  validatePostureRef(value, errors, source);
  if (errors.length > 0) {
    const code = value?.status === 'unknown_legacy' || value === undefined
      ? 'POSTURE_UNKNOWN_LEGACY'
      : 'INVALID_POSTURE_REF';
    throw postureResolutionError(code, errors[0].message);
  }
  return cloneJson(value);
}

export function resolveArchitecturePosture(architecture, context = {}) {
  const selected = requireAuthoritativePostureRef(
    architecture?.posture_default,
    'project posture default',
  );
  const provenance = [{
    level: 'project',
    ref: `architecture:${architecture.project_id}@${architecture.architecture_hash ?? architecture.revision}`,
    posture_hash: selected.posture_hash,
  }];

  let module = null;
  if (context.module_id) {
    module = asArray(architecture.modules).find((candidate) => candidate.id === context.module_id) ?? null;
    if (!module) throw postureResolutionError('UNKNOWN_MODULE', `unknown architecture module ${context.module_id}`);
  } else if (context.path) {
    const candidates = asArray(architecture.modules).filter((candidate) =>
      asArray(candidate.owned_paths).some((pattern) => matchesPath(pattern, context.path)));
    if (candidates.length > 1) throw postureResolutionError('AMBIGUOUS_MODULE', `${context.path} belongs to multiple modules`);
    module = candidates[0] ?? null;
  }

  let current = selected;
  if (module?.posture_default?.status === 'unknown_legacy') {
    throw postureResolutionError('POSTURE_UNKNOWN_LEGACY', `module ${module.id} posture default is unknown`);
  }
  if (module?.posture_default) {
    current = requireAuthoritativePostureRef(module.posture_default, `module ${module.id} posture default`);
    provenance.push({ level: 'module', ref: `module:${module.id}`, posture_hash: current.posture_hash });
  }

  let zone = null;
  if (context.zone_id) {
    zone = asArray(architecture.experimental_zones).find((candidate) => candidate.id === context.zone_id) ?? null;
    if (!zone) throw postureResolutionError('UNKNOWN_EXPERIMENTAL_ZONE', `unknown experimental zone ${context.zone_id}`);
  } else if (context.path) {
    const candidates = asArray(architecture.experimental_zones).filter((candidate) =>
      asArray(candidate.owned_paths).some((pattern) => matchesPath(pattern, context.path)));
    if (candidates.length > 1) throw postureResolutionError('AMBIGUOUS_EXPERIMENTAL_ZONE', `${context.path} belongs to multiple experimental zones`);
    zone = candidates[0] ?? null;
  }
  if (zone) {
    current = requireAuthoritativePostureRef(zone.posture_ref, `experimental zone ${zone.id} posture`);
    provenance.push({ level: 'experimental_zone', ref: `zone:${zone.id}`, posture_hash: current.posture_hash });
  }

  let overrideDecision = null;
  if (context.override) {
    const override = requireAuthoritativePostureRef(context.override, 'task posture override');
    if (override.posture_hash !== current.posture_hash) {
      const decision = context.override_decision;
      if (!isObject(decision)
        || decision.expected_posture_hash !== current.posture_hash
        || typeof decision.decision_ref !== 'string'
        || decision.decision_ref.length === 0
        || !decision.approval) {
        throw postureResolutionError(
          'POSTURE_OVERRIDE_CONFLICT',
          'a differing posture override requires an approved decision bound to the inherited posture hash',
        );
      }
      overrideDecision = cloneJson(decision);
    }
    current = override;
    provenance.push({
      level: 'task_override',
      ref: overrideDecision?.decision_ref ?? 'same-posture-override',
      posture_hash: current.posture_hash,
    });
  }

  return {
    posture_ref: current,
    provenance,
    module_id: module?.id ?? null,
    zone_id: zone?.id ?? null,
    override_decision: overrideDecision,
  };
}

function validateStringArray(value, field, errors, prefix) {
  if (!Array.isArray(value)) {
    errors.push({ code: `invalid_${field}`, message: `${prefix}.${field} must be an array` });
    return;
  }
  if (value.some((item) => typeof item !== 'string')) {
    errors.push({ code: `invalid_${field}_item`, message: `${prefix}.${field} must contain strings` });
  }
}

function validatePublicBoundaries(value, errors, prefix) {
  if (!Array.isArray(value)) {
    errors.push({ code: 'invalid_public_boundaries', message: `${prefix}.public_boundaries must be an array` });
    return;
  }
  for (const boundary of value) {
    if (typeof boundary === 'string' && boundary.length > 0) continue;
    if (!isObject(boundary)) {
      errors.push({ code: 'invalid_public_boundary', message: `${prefix}.public_boundaries entries must be strings or objects` });
      continue;
    }
    const paths = [boundary.path, ...asArray(boundary.paths)].filter((item) => typeof item === 'string' && item.length > 0);
    if (typeof boundary.id !== 'string' || boundary.id.length === 0 || paths.length === 0) {
      errors.push({ code: 'invalid_public_boundary', message: `${prefix}.public_boundaries objects need an id and at least one path` });
    }
  }
}

function validateSourceRefs(value, errors, prefix) {
  if (!Array.isArray(value)) {
    errors.push({ code: 'invalid_source_refs', message: `${prefix}.source_refs must be an array` });
    return;
  }
  if (value.some((item) => typeof item !== 'string' && !isObject(item))) {
    errors.push({ code: 'invalid_source_ref', message: `${prefix}.source_refs entries must be strings or objects` });
  }
}

export function validateArchitecture(value, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(value)) return { valid: false, errors: [{ code: 'not_object', message: 'architecture must be an object' }], warnings };
  const proposal = options.proposal === true || value.status === 'proposed';
  if (value.schema_version !== ARCHITECTURE_SCHEMA_VERSION) {
    errors.push({ code: 'unsupported_schema_version', message: `schema_version must be ${ARCHITECTURE_SCHEMA_VERSION}` });
  }
  if (typeof value.project_id !== 'string' || value.project_id.length === 0) {
    errors.push({ code: 'missing_project_id', message: 'project_id is required' });
  }
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    errors.push({ code: 'invalid_revision', message: 'revision must be a non-negative integer' });
  }
  if (!['proposed', 'approved'].includes(value.status)) {
    errors.push({ code: 'invalid_status', message: 'status must be proposed or approved' });
  }
  if (value.posture_default === undefined || value.posture_default?.status === 'unknown_legacy') {
    warnings.push({
      code: 'unknown_legacy_architecture_posture',
      message: 'project posture default is unknown until explicitly assessed',
    });
  } else {
    validatePostureRef(value.posture_default, errors, 'posture_default');
  }
  if (!Array.isArray(value.modules)) {
    errors.push({ code: 'missing_modules', message: 'modules must be an array' });
    return { valid: false, errors, warnings };
  }

  const moduleIds = new Set();
  const ownedPatterns = new Map();
  for (const module of value.modules) {
    if (!isObject(module) || typeof module.id !== 'string' || module.id.length === 0) {
      errors.push({ code: 'invalid_module', message: 'every module needs an id' });
      continue;
    }
    const prefix = `module ${module.id}`;
    if (moduleIds.has(module.id)) errors.push({ code: 'duplicate_module', message: `duplicate module ${module.id}` });
    moduleIds.add(module.id);
    if (typeof module.purpose !== 'string' || (!proposal && module.purpose.trim().length === 0)) {
      errors.push({ code: 'missing_purpose', message: `${prefix}.purpose is required before approval` });
    }
    for (const field of MODULE_STRING_ARRAY_FIELDS) validateStringArray(module[field] ?? [], field, errors, prefix);
    validatePublicBoundaries(module.public_boundaries ?? [], errors, prefix);
    validateSourceRefs(module.source_refs ?? [], errors, prefix);
    if (!proposal && asArray(module.owners).length === 0) {
      errors.push({ code: 'missing_owner', message: `${prefix} needs at least one owner` });
    }
    if (asArray(module.owned_paths).length === 0) {
      errors.push({ code: 'missing_owned_paths', message: `${prefix} needs owned_paths` });
    }
    for (const pattern of asArray(module.owned_paths)) {
      if (ownedPatterns.has(pattern)) {
        errors.push({ code: 'duplicate_owned_path', message: `${pattern} is owned by ${ownedPatterns.get(pattern)} and ${module.id}` });
      }
      ownedPatterns.set(pattern, module.id);
    }
    if (!isObject(module.concerns)) errors.push({ code: 'invalid_concerns', message: `${prefix}.concerns must be an object` });
    if (module.posture_default !== undefined) {
      validatePostureRef(module.posture_default, errors, `${prefix}.posture_default`, { allowUnknown: true });
    }
    for (const concern of asArray(module.required_concerns)) {
      if (!Object.hasOwn(CONCERN_REQUIREMENTS, concern)) {
        errors.push({ code: 'unknown_concern', message: `${prefix} requires unknown concern ${concern}` });
        continue;
      }
      const pack = module.concerns?.[concern];
      if (!isObject(pack)) {
        errors.push({ code: 'missing_concern_pack', message: `${prefix} requires concern pack ${concern}` });
        continue;
      }
      for (const field of CONCERN_REQUIREMENTS[concern]) {
        if (pack[field] === undefined || pack[field] === null || pack[field] === '') {
          errors.push({ code: 'incomplete_concern_pack', message: `${prefix}.concerns.${concern}.${field} is required` });
        }
      }
    }
  }

  const zoneIds = new Set();
  const zonePaths = new Map();
  if (value.experimental_zones !== undefined && !Array.isArray(value.experimental_zones)) {
    errors.push({ code: 'invalid_experimental_zones', message: 'experimental_zones must be an array' });
  }
  for (const zone of asArray(value.experimental_zones)) {
    if (!isObject(zone) || typeof zone.id !== 'string' || zone.id.length === 0) {
      errors.push({ code: 'invalid_experimental_zone', message: 'every experimental zone needs an id' });
      continue;
    }
    const prefix = `experimental zone ${zone.id}`;
    if (zoneIds.has(zone.id)) errors.push({ code: 'duplicate_experimental_zone', message: `duplicate experimental zone ${zone.id}` });
    zoneIds.add(zone.id);
    if (typeof zone.objective !== 'string' || zone.objective.trim().length === 0) {
      errors.push({ code: 'missing_zone_objective', message: `${prefix}.objective is required` });
    }
    validateStringArray(zone.owned_paths, 'owned_paths', errors, prefix);
    if (asArray(zone.owned_paths).length === 0) errors.push({ code: 'missing_zone_paths', message: `${prefix} needs owned_paths` });
    for (const pattern of asArray(zone.owned_paths)) {
      if (zonePaths.has(pattern)) {
        errors.push({ code: 'duplicate_zone_path', message: `${pattern} belongs to ${zonePaths.get(pattern)} and ${zone.id}` });
      }
      zonePaths.set(pattern, zone.id);
    }
    validatePostureRef(zone.posture_ref, errors, `${prefix}.posture_ref`, { zone: true });
    validateSourceRefs(zone.source_refs, errors, prefix);
    if (asArray(zone.source_refs).length === 0) errors.push({ code: 'missing_zone_source', message: `${prefix} needs provenance` });
    if (zone.status !== 'active') errors.push({ code: 'invalid_zone_status', message: `${prefix}.status must be active` });
  }

  for (const module of value.modules.filter(isObject)) {
    for (const dependency of asArray(module.dependencies)) {
      if (!moduleIds.has(dependency)) errors.push({ code: 'unknown_module_dependency', message: `${module.id} depends on unknown module ${dependency}` });
    }
  }

  if (!Array.isArray(value.relations)) errors.push({ code: 'invalid_relations', message: 'relations must be an array' });
  const relationIds = new Set();
  for (const relation of asArray(value.relations)) {
    if (!isObject(relation) || typeof relation.id !== 'string' || relation.id.length === 0) {
      errors.push({ code: 'invalid_relation', message: 'every relation needs an id' });
      continue;
    }
    if (relationIds.has(relation.id)) errors.push({ code: 'duplicate_relation', message: `duplicate relation ${relation.id}` });
    relationIds.add(relation.id);
    if (!RELATION_TYPES.has(relation.type)) errors.push({ code: 'invalid_relation_type', message: `${relation.id} has invalid type ${relation.type}` });
    if (!moduleIds.has(relation.from) || !moduleIds.has(relation.to)) {
      errors.push({ code: 'unknown_relation_module', message: `${relation.id} references an unknown module` });
    }
    if (!EVIDENCE_STATUSES.has(relation.evidence_status)) {
      errors.push({ code: 'invalid_evidence_status', message: `${relation.id} needs a valid evidence_status` });
    }
    for (const field of ['failure_propagation', 'compatibility']) {
      if (typeof relation[field] !== 'string' || (!proposal && relation[field].trim().length === 0)) {
        errors.push({ code: `missing_relation_${field}`, message: `${relation.id}.${field} is required before approval` });
      }
    }
    if (!proposal && relation.evidence_status === 'missing') {
      errors.push({ code: 'missing_relation_evidence', message: `${relation.id} cannot be approved with missing evidence` });
    }
  }

  if (!isObject(value.coverage)) errors.push({ code: 'invalid_coverage', message: 'coverage must be an object' });
  else {
    validateStringArray(value.coverage.include_paths, 'include_paths', errors, 'coverage');
    validateStringArray(value.coverage.ignore_paths, 'ignore_paths', errors, 'coverage');
  }
  if (!proposal && typeof value.architecture_hash === 'string') {
    const expected = finalizeArchitecture(value).architecture_hash;
    if (expected !== value.architecture_hash) errors.push({ code: 'architecture_hash_mismatch', message: 'architecture_hash does not match the baseline contents' });
  }
  return { valid: errors.length === 0, errors, warnings };
}

function moduleView(module) {
  const boundary = asArray(module.public_boundaries).map((item) => typeof item === 'string' ? item : `${item.id ?? item.path ?? 'boundary'} (${item.path ?? 'no path'})`);
  const sourceRefs = asArray(module.source_refs).map((item) => typeof item === 'string' ? item : `${item.type ?? 'source'}: ${item.path ?? item.uri ?? 'unknown'}`);
  const list = (items) => items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- None recorded';
  return [
    `# ${module.id}`,
    '',
    `**Purpose:** ${module.purpose || 'Pending approval'}`,
    `**Owners:** ${asArray(module.owners).join(', ') || 'Pending approval'}`,
    `**Contract hash:** \`${module.contract_hash ?? 'proposal'}\``,
    `**Posture default:** ${module.posture_default?.kind ?? module.posture_default?.status ?? 'inherit project'}`,
    '',
    '## Owned paths', '', list(asArray(module.owned_paths)), '',
    '## Public boundaries', '', list(boundary), '',
    '## Invariants', '', list(asArray(module.invariants)), '',
    '## Dependencies', '', list(asArray(module.dependencies)), '',
    '## Active concern packs', '', list(Object.keys(module.concerns ?? {})), '',
    '## Sources', '', list(sourceRefs), '',
  ].join('\n');
}

export function renderArchitectureMarkdown(architecture) {
  const lines = [
    '# Project Architecture Memory', '',
    `**Project:** ${architecture.project_id}`,
    `**Revision:** ${architecture.revision}`,
    `**Status:** ${architecture.status}`,
    `**Hash:** \`${architecture.architecture_hash ?? 'proposal'}\``, '',
    `**Project posture default:** ${architecture.posture_default?.kind ?? architecture.posture_default?.status ?? 'unknown_legacy'}`, '',
    '## Module Map', '',
    '| Module | Purpose | Owners | Contract |',
    '|---|---|---|---|',
  ];
  for (const module of asArray(architecture.modules)) {
    lines.push(`| [${module.id}](modules/${encodeURIComponent(module.id)}.md) | ${module.purpose || 'Pending'} | ${asArray(module.owners).join(', ') || 'Pending'} | \`${String(module.contract_hash ?? 'proposal').slice(0, 12)}\` |`);
  }
  lines.push('', '## Typed Relations', '');
  if (asArray(architecture.relations).length === 0) lines.push('- None recorded.');
  for (const relation of asArray(architecture.relations)) {
    lines.push(`- \`${relation.from}\` -[${relation.type}]-> \`${relation.to}\` via ${relation.interface_ref ?? 'unresolved interface'}; evidence: ${relation.evidence_status}`);
  }
  lines.push('', '## Experimental Zones', '');
  if (asArray(architecture.experimental_zones).length === 0) lines.push('- None recorded.');
  for (const zone of asArray(architecture.experimental_zones)) {
    lines.push(`- \`${zone.id}\` (${zone.posture_ref?.kind ?? 'unknown'}): ${zone.objective}; paths: ${asArray(zone.owned_paths).join(', ')}`);
  }
  lines.push('', '## Coverage', '', `- Include: ${asArray(architecture.coverage?.include_paths).join(', ') || 'none'}`, `- Ignore: ${asArray(architecture.coverage?.ignore_paths).join(', ') || 'none'}`, '');
  return `${lines.join('\n')}\n`;
}

export async function writeArchitectureViews(root, architecture) {
  const architectureRoot = path.resolve(root);
  await writeTextAtomic(path.join(architectureRoot, 'ARCHITECTURE.md'), renderArchitectureMarkdown(architecture));
  await ensureDir(path.join(architectureRoot, 'modules'));
  for (const module of asArray(architecture.modules)) {
    await writeTextAtomic(path.join(architectureRoot, 'modules', `${encodeURIComponent(module.id)}.md`), moduleView(module));
  }
}

export async function loadArchitecture(root) {
  return readJson(path.join(path.resolve(root), 'architecture.json'));
}

async function appendArchitectureAudit(root, event) {
  const filePath = path.join(path.resolve(root), 'events.jsonl');
  await withFileLock(`${filePath}.lock`, async () => {
    let existing = '';
    try { existing = await fs.readFile(filePath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing.split('\n').some((line) => {
      try { return JSON.parse(line).event_id === event.event_id; } catch { return false; }
    })) return;
    await fs.appendFile(filePath, `${JSON.stringify({ ...event, schema_version: ARCHITECTURE_SCHEMA_VERSION, occurred_at: new Date().toISOString() })}\n`, 'utf8');
  });
}

export async function writeArchitecture(root, input, options = {}) {
  const architectureRoot = path.resolve(root);
  return withFileLock(path.join(architectureRoot, 'architecture.json.lock'), async () => {
    const current = await readJsonIfExists(path.join(architectureRoot, 'architecture.json'));
    if (current && options.expectedHash === undefined) {
      throw new Error('expected architecture hash is required when replacing an existing baseline');
    }
    if (options.expectedHash !== undefined && current?.architecture_hash !== options.expectedHash) {
      throw Object.assign(new Error('architecture baseline changed; refresh before applying'), { code: 'ARCHITECTURE_CONFLICT' });
    }
    const next = finalizeArchitecture({ ...cloneJson(input), updated_at: new Date().toISOString() });
    const result = validateArchitecture(next, { proposal: next.status === 'proposed' });
    if (!result.valid) {
      const error = new Error(`invalid architecture: ${result.errors.map((item) => item.message).join('; ')}`);
      error.validation = result;
      throw error;
    }
    await writeArchitectureViews(architectureRoot, next);
    await writeJsonAtomic(path.join(architectureRoot, 'architecture.json'), next);
    await appendArchitectureAudit(architectureRoot, {
      event_id: `architecture-${next.architecture_hash.slice(0, 16)}`,
      type: 'architecture_baseline_written',
      previous_hash: current?.architecture_hash ?? null,
      architecture_hash: next.architecture_hash,
      revision: next.revision,
      approval: options.approval ?? next.approval ?? null,
    });
    return next;
  });
}

function slugify(value) {
  return String(value ?? 'module').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'module';
}

async function directoryNames(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function proposedModule(id, ownedPaths) {
  return {
    id: slugify(id),
    purpose: '',
    non_goals: [],
    owners: [],
    owned_paths: ownedPaths,
    public_boundaries: [],
    invariants: [],
    dependencies: [],
    required_concerns: [],
    concerns: {},
    source_refs: [],
  };
}

export async function scanArchitectureProposal(projectRoot, options = {}) {
  const project = path.resolve(projectRoot);
  const packageJson = await readJsonIfExists(path.join(project, 'package.json'));
  const projectId = String(options.projectId ?? packageJson?.name ?? path.basename(project));
  const modules = [];
  for (const container of ['apps', 'packages', 'services']) {
    for (const child of await directoryNames(path.join(project, container))) {
      modules.push(proposedModule(child, [`${container}/${child}/**`]));
    }
  }
  if (modules.length === 0) {
    const sourceChildren = await directoryNames(path.join(project, 'src'));
    if (sourceChildren.length > 1) {
      for (const child of sourceChildren) modules.push(proposedModule(child, [`src/${child}/**`]));
    } else if (sourceChildren.length > 0 || await readJsonIfExists(path.join(project, 'package.json'))) {
      modules.push(proposedModule(projectId, ['src/**']));
    }
  }
  return finalizeArchitecture({
    schema_version: ARCHITECTURE_SCHEMA_VERSION,
    project_id: projectId,
    revision: 0,
    status: 'proposed',
    modules,
    relations: [],
    coverage: {
      include_paths: modules.flatMap((module) => module.owned_paths),
      ignore_paths: ['.git/**', 'node_modules/**', 'docs/superpowers/plans/**'],
    },
    generated_from: { project_root_name: path.basename(project), scanner: 'adaptive-planning-governance' },
  });
}

export async function approveArchitectureProposal(root, proposal, approval) {
  if (!approval) throw new Error('explicit approval evidence is required');
  const candidate = {
    ...cloneJson(proposal),
    status: 'approved',
    revision: Math.max(1, Number(proposal.revision ?? 0)),
    approval: cloneJson(approval),
  };
  return writeArchitecture(root, candidate, { approval });
}

export function proposeArchitectureDelta(current, proposedArchitecture, details = {}) {
  const next = finalizeArchitecture({
    ...cloneJson(proposedArchitecture),
    status: 'approved',
    revision: Number(current.revision ?? 0) + 1,
  });
  const validation = validateArchitecture(next);
  if (!validation.valid) {
    const error = new Error(`invalid proposed architecture: ${validation.errors.map((item) => item.message).join('; ')}`);
    error.validation = validation;
    throw error;
  }
  const payload = {
    schema_version: ARCHITECTURE_SCHEMA_VERSION,
    base_hash: current.architecture_hash,
    proposed_hash: next.architecture_hash,
    affected_modules: asArray(details.affected_modules),
    affected_relations: asArray(details.affected_relations),
    rationale: String(details.rationale ?? ''),
    compatibility: asArray(details.compatibility),
    migration: asArray(details.migration),
    design_ref: details.design_ref ?? null,
    proposed_architecture: next,
    status: 'pending',
  };
  return { ...payload, delta_id: `delta-${stableHash(payload).slice(0, 16)}` };
}

export function proposeExperimentalZonePromotion(current, zoneId, moduleContract, details = {}) {
  const zone = asArray(current.experimental_zones).find((candidate) => candidate.id === zoneId);
  if (!zone) throw new Error(`unknown experimental zone ${zoneId}`);
  if (!isObject(moduleContract) || typeof moduleContract.id !== 'string' || moduleContract.id.length === 0) {
    throw new Error('zone promotion requires a complete target module Core Contract');
  }
  const uncovered = asArray(zone.owned_paths).filter((zonePath) =>
    !asArray(moduleContract.owned_paths).some((modulePath) =>
      modulePath === zonePath || matchesPath(modulePath, zonePath.replace('/**', '/promotion-probe'))));
  if (uncovered.length > 0) {
    throw new Error(`promoted module does not own zone paths: ${uncovered.join(', ')}`);
  }

  const proposed = cloneJson(current);
  const existingIndex = asArray(proposed.modules).findIndex((module) => module.id === moduleContract.id);
  if (existingIndex >= 0) proposed.modules[existingIndex] = cloneJson(moduleContract);
  else proposed.modules.push(cloneJson(moduleContract));
  proposed.experimental_zones = asArray(proposed.experimental_zones)
    .filter((candidate) => candidate.id !== zoneId);
  const delta = proposeArchitectureDelta(current, proposed, {
    affected_modules: [moduleContract.id],
    affected_relations: asArray(details.affected_relations),
    rationale: details.rationale ?? `Promote experimental zone ${zoneId} into module ${moduleContract.id}`,
    compatibility: asArray(details.compatibility),
    migration: asArray(details.migration),
    design_ref: details.design_ref ?? null,
  });
  return {
    ...delta,
    promotion: {
      status: 'pending',
      zone_id: zoneId,
      target_module_id: moduleContract.id,
      source_posture_ref: cloneJson(zone.posture_ref),
    },
  };
}

export async function applyArchitectureDelta(root, delta, options = {}) {
  const current = await loadArchitecture(root);
  if (delta.status !== 'pending') throw new Error('only pending architecture deltas can be applied');
  if (delta.base_hash !== current.architecture_hash) throw Object.assign(new Error('delta base hash is stale'), { code: 'ARCHITECTURE_CONFLICT' });
  if (!options.approval) throw new Error('explicit approval evidence is required');
  const next = await writeArchitecture(root, {
    ...delta.proposed_architecture,
    approval: cloneJson(options.approval),
  }, { expectedHash: delta.base_hash, approval: options.approval });
  return { ...cloneJson(delta), status: 'applied', applied_hash: next.architecture_hash, approval: cloneJson(options.approval) };
}
