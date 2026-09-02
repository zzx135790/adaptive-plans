import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJsonIfExists, writeJsonAtomic, writeTextAtomic } from './io-utils.mjs';
import {
  normalizeEngineeringPosture,
  normalizeBehaviorBudget,
  validateEngineeringPosture,
  validateScopeControl,
} from './engineering-posture.mjs';
import { currentDesignRevision, designApprovalBrief, validateCompositionContract } from './design-engine.mjs';
import { currentThreadRevision, ledgerApprovalBrief } from './design-ledger.mjs';

export const SCHEMA_VERSION = '2.0';
export const LEGACY_SCHEMA_VERSION = '1.0';
export const NODE_STATUSES = new Set([
  'idea',
  'blocked',
  'ready',
  'in_progress',
  'awaiting_validation',
  'done',
  'stale',
  'deferred',
  'cancelled',
]);
export const HANDOFF_MODES = new Set(['guide', 'map', 'plan', 'direct']);
export const PLAN_STAGES = new Set(['intake', 'guiding', 'designing', 'mapping', 'leaf_planning', 'executing', 'validating', 'complete']);
export const WORK_SHAPES = new Set(['undetermined', 'direct', 'plan', 'map']);
export const PROVIDER_STATUSES = new Set(['ok', 'partial', 'unavailable', 'error', 'unstructured']);

const PLAN_DIRS = ['nodes', 'plans', 'decisions', 'changes', 'provider-results'];

async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}

async function writeUtf8(filePath, content) {
  await writeTextAtomic(filePath, content);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function topologicalWaves(map) {
  const nodes = asArray(map.nodes).filter((node) => node && typeof node === 'object');
  const remaining = new Map(nodes.map((node) => [node.id, node]));
  const placed = new Set();
  const waves = [];
  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter((node) => asArray(node.depends_on).every((id) => placed.has(id)));
    if (wave.length === 0) {
      waves.push([...remaining.values()]);
      break;
    }
    waves.push(wave);
    for (const node of wave) {
      placed.add(node.id);
      remaining.delete(node.id);
    }
  }
  return waves;
}

export function renderAsciiDag(map) {
  const nodes = asArray(map.nodes);
  if (nodes.length === 0) return '(empty map)';
  const lines = [];
  topologicalWaves(map).forEach((wave, index) => {
    lines.push(`Wave ${index + 1}: ${wave.map((node) => `[${node.id} ${node.status}] ${node.title}`).join(' | ')}`);
  });
  const edges = nodes.flatMap((node) => asArray(node.depends_on).map((dependency) => `${dependency} -> ${node.id}`));
  if (edges.length > 0) lines.push(`Edges: ${edges.join(', ')}`);
  return lines.join('\n');
}

function statusCounts(map) {
  const counts = {};
  for (const node of asArray(map.nodes)) counts[node.status] = (counts[node.status] ?? 0) + 1;
  return counts;
}

function architectureSummary(map) {
  const snapshot = map.architecture_snapshot;
  if (!snapshot) return 'not linked';
  return `${snapshot.project_id ?? 'project'} revision ${snapshot.revision ?? '?'} (${String(snapshot.architecture_hash ?? 'unknown').slice(0, 12)})`;
}

export function renderMapMarkdown(map) {
  const counts = statusCounts(map);
  const dependency = topologicalWaves(map);
  const executionWaves = new Map();
  for (const node of asArray(map.nodes)) {
    const safeWave = node?.parallelization?.execution_wave ?? node?.parallelization?.safe_wave;
    if (safeWave && safeWave !== 'serial') {
      if (!executionWaves.has(safeWave)) executionWaves.set(safeWave, []);
      executionWaves.get(safeWave).push(node.id);
    }
  }
  const designRefs = asArray(map.design_refs);
  const lines = [
    '# Plan Map',
    '',
    `> Generated from \`map.json\`; schema ${map.schema_version ?? SCHEMA_VERSION}.`,
    '',
    `**Plan:** ${map.title ?? map.plan_id ?? 'Untitled'}`,
    `**Status:** ${map.status ?? 'planning'}`,
    `**Stage:** ${map.stage ?? 'legacy'}`,
    `**Work shape:** ${map.work_shape ?? map.mode ?? 'legacy'}`,
    `**Current node:** ${map.current_node ?? 'none'}`,
    `**Architecture:** ${architectureSummary(map)}`,
    `**Design:** ${designRefs.length > 0 ? designRefs.map((ref) => `${ref.design_id}@${ref.revision} (${ref.status})`).join(', ') : 'not required or not linked'}`,
    `**Node status:** ${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(', ') || 'none'}`,
    '',
    '## Topology',
    '',
    '```text',
    renderAsciiDag(map),
    '```',
    '',
    '## Execution waves',
    '',
    `Dependency waves: ${dependency.map((wave, index) => `${index + 1}=[${wave.map((node) => node.id).join(', ')}]`).join(' | ') || 'none'}`,
    `Execution-safe waves: ${[...executionWaves.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([wave, ids]) => `${wave}=[${ids.join(', ')}]`).join(' | ') || 'none (evaluate before dispatch)'}`,
    `Serial fallback: ${asArray(map.nodes).filter((node) => node?.parallelization?.execution_wave === 'serial' || node?.parallelization?.safe_wave === 'serial').map((node) => `${node.id} (${node.parallelization.reason ?? 'execution safety evidence incomplete'})`).join(' | ') || 'none recorded'}`,
    '',
    '## Nodes',
    '',
    '| Node | Status | Depends on | Requirements | Contracts | Title |',
    '|---|---|---|---|---|---|',
  ];
  for (const node of asArray(map.nodes).filter((candidate) => candidate && typeof candidate === 'object')) {
    lines.push(
      `| [${node.id}](nodes/${encodeURIComponent(node.id)}.md) | ${node.status} | ${(node.depends_on ?? []).join(', ') || '-'} | ${asArray(node.requirement_ids).join(', ') || '-'} | ${asArray(node.contract_refs).map((ref) => typeof ref === 'string' ? ref : ref.module_id ?? ref.id).join(', ') || '-'} | ${node.title} |`,
    );
  }
  lines.push('', '## Readiness notes', '');
  for (const node of asArray(map.nodes).filter((candidate) => candidate && typeof candidate === 'object')) {
    const questions = asArray(node.blocking_questions);
    if (questions.length > 0) {
      lines.push(`- **${node.id}** blocked by: ${questions.join('; ')}`);
    }
  }
  if (!lines.at(-1)?.trim()) lines.push('- No blocking questions recorded.');
  lines.push('', '## Gates', '');
  for (const [gate, value] of Object.entries(map.gates ?? {})) {
    lines.push(`- **${gate}:** ${typeof value === 'string' ? value : value?.status ?? 'unknown'}`);
  }
  if (Object.keys(map.gates ?? {}).length === 0) lines.push('- Legacy map; explicit v2 migration is required before design or architecture gates can be asserted.');
  lines.push('', '## Artifact Index', '', '- [GUIDE.md](GUIDE.md) - goal, scope, constraints, and success criteria', '- [MAP.md](MAP.md) - this navigation view', '- [map.json](map.json) - canonical plan topology');
  if (designRefs.length > 0) lines.push('- [DESIGN.md](DESIGN.md) - current design view', '- [design.json](design.json) - canonical design revisions');
  for (const node of asArray(map.nodes)) lines.push(`- [nodes/${encodeURIComponent(node.id)}.md](nodes/${encodeURIComponent(node.id)}.md) - ${node.title}`);
  for (const artifact of asArray(map.artifacts)) {
    if (artifact?.path) lines.push(`- [${artifact.path}](${artifact.path}) - ${artifact.format ?? artifact.type ?? 'linked artifact'}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderNodeMarkdown(node) {
  const list = (value) => (Array.isArray(value) && value.length > 0 ? value.map((item) => `- ${item}`).join('\n') : '- None recorded');
  return [
    `# ${node.id}: ${node.title}`,
    '',
    `**Status:** ${node.status}`,
    `**Depends on:** ${(node.depends_on ?? []).join(', ') || 'none'}`,
    `**Requirements:** ${asArray(node.requirement_ids).join(', ') || 'none'}`,
    `**Contract refs:** ${asArray(node.contract_refs).map((ref) => typeof ref === 'string' ? ref : `${ref.module_id ?? ref.id}@${String(ref.contract_hash ?? '').slice(0, 12)}`).join(', ') || 'none'}`,
    `**Design refs:** ${asArray(node.design_refs).map((ref) => typeof ref === 'string' ? ref : `${ref.design_id}@${ref.revision}`).join(', ') || 'none'}`,
    '',
    '## Inputs',
    '',
    list(node.inputs),
    '',
    '## Outputs',
    '',
    list(node.outputs),
    '',
    '## Acceptance',
    '',
    list(node.acceptance),
    '',
    '## Blocking questions',
    '',
    list(node.blocking_questions),
    '',
    '## Parallelization assessment',
    '',
    `- Candidate: ${node.parallelization?.candidate === true ? 'yes' : 'no'}`,
    `- Wave: ${node.parallelization?.wave ?? 'serial'}`,
    `- Owned paths: ${asArray(node.parallelization?.owned_paths).join(', ') || 'none'}`,
    `- Shared resources: ${asArray(node.parallelization?.shared_resources).map((resource) => typeof resource === 'string' ? resource : resource?.name ?? resource?.resource ?? JSON.stringify(resource)).join(', ') || 'none'}`,
    `- Independent verification: ${asArray(node.parallelization?.independent_verification).join(', ') || 'none'}`,
    `- Reason: ${node.parallelization?.reason ?? 'not assessed'}`,
    '',
    node.stale_reason ? `**Stale reason:** ${node.stale_reason}\n` : '',
    node.revalidation_required ? '**Revalidation required:** yes\n' : '',
  ].join('\n');
}

export async function writeNodeBrief(root, node) {
  if (!node || typeof node.id !== 'string' || node.id.length === 0) return null;
  const filePath = path.join(path.resolve(root), 'nodes', `${encodeURIComponent(node.id)}.md`);
  await writeUtf8(filePath, renderNodeMarkdown(node));
  return filePath;
}

export async function createPlanManifest(root, options = {}) {
  const planRoot = path.resolve(root);
  try {
    await fs.access(path.join(planRoot, 'map.json'));
    if (!options.overwrite) throw new Error(`plan folder already contains map.json: ${planRoot}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await ensureDir(planRoot);
  for (const directory of PLAN_DIRS) await ensureDir(path.join(planRoot, directory));

  const planId = String(options.planId ?? path.basename(planRoot));
  const title = String(options.title ?? planId);
  const goal = String(options.goal ?? 'Define and validate the work before implementation.');
  const createdAt = options.createdAt ?? new Date().toISOString();
  const manifest = {
    schema_version: SCHEMA_VERSION,
    plan_id: planId,
    title,
    goal,
    status: 'planning',
    stage: 'guiding',
    work_shape: 'map',
    mode: 'map',
    gates: {
      intent: { status: 'pending' },
      design: { status: 'not_required' },
      architecture_sync: { status: 'not_required' },
    },
    architecture_snapshot: null,
    design_refs: [],
    artifacts: [],
    current_node: null,
    nodes: [],
    created_at: createdAt,
    updated_at: createdAt,
  };

  await writeUtf8(
    path.join(planRoot, 'GUIDE.md'),
    `# ${title}\n\n## Goal\n\n${goal}\n\n## Scope\n\n- In scope: to be confirmed during discovery.\n- Out of scope: implementation details that are not yet supported by evidence.\n\n## Constraints\n\n- Record technical, time, resource, compatibility, and approval constraints here.\n\n## Success Criteria\n\n- The goal, boundaries, constraints, and next planning gate are explicit.\n`,
  );
  await writeJsonAtomic(path.join(planRoot, 'map.json'), manifest);
  await writeUtf8(path.join(planRoot, 'MAP.md'), renderMapMarkdown(manifest));
  try {
    await fs.access(path.join(planRoot, 'events.jsonl'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeUtf8(path.join(planRoot, 'events.jsonl'), '');
  }
  return manifest;
}

export async function loadMap(root) {
  const content = await fs.readFile(path.join(path.resolve(root), 'map.json'), 'utf8');
  return JSON.parse(content);
}

export async function writeMap(root, map, options = {}) {
  const result = validateMap(map);
  if (!result.valid) {
    const error = new Error(`Cannot write invalid map: ${result.errors.map((item) => item.message).join('; ')}`);
    error.validation = result;
    throw error;
  }
  const next = options.preserveUpdatedAt === true
    ? cloneJson(map)
    : { ...cloneJson(map), updated_at: new Date().toISOString() };
  const planRoot = path.resolve(root);
  await writeJsonAtomic(path.join(planRoot, 'map.json'), next);
  await writeUtf8(path.join(planRoot, 'MAP.md'), renderMapMarkdown(next));
  for (const node of asArray(next.nodes)) await writeNodeBrief(planRoot, node);
  return next;
}

export function validateMap(map, options = {}) {
  const errors = [];
  const warnings = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { valid: false, errors: [{ code: 'not_object', message: 'map must be an object' }], warnings };
  }
  if (typeof map.schema_version !== 'string' || map.schema_version.length === 0) {
    errors.push({ code: 'missing_schema_version', message: 'schema_version must be a string' });
  } else if (![SCHEMA_VERSION, LEGACY_SCHEMA_VERSION].includes(map.schema_version)) {
    errors.push({ code: 'unsupported_schema_version', message: `schema_version must be ${LEGACY_SCHEMA_VERSION} or ${SCHEMA_VERSION}` });
  }
  if (typeof map.plan_id !== 'string' || map.plan_id.length === 0) {
    errors.push({ code: 'missing_plan_id', message: 'plan_id must be a non-empty string' });
  }
  if (!Array.isArray(map.nodes)) {
    errors.push({ code: 'missing_nodes', message: 'nodes must be an array' });
    return { valid: errors.length === 0, errors, warnings };
  }
  if (map.schema_version === SCHEMA_VERSION) {
    if (!PLAN_STAGES.has(map.stage)) errors.push({ code: 'invalid_stage', message: `stage must be one of ${[...PLAN_STAGES].join(', ')}` });
    if (!WORK_SHAPES.has(map.work_shape)) errors.push({ code: 'invalid_work_shape', message: `work_shape must be one of ${[...WORK_SHAPES].join(', ')}` });
    if (!map.gates || typeof map.gates !== 'object' || Array.isArray(map.gates)) errors.push({ code: 'invalid_gates', message: 'gates must be an object' });
  } else {
    warnings.push({ code: 'legacy_schema', message: 'v1 map is readable but must be explicitly migrated before using v2 gates' });
  }

  let authoritativePosture = null;
  if (map.engineering_posture === undefined) {
    warnings.push({ code: 'unknown_legacy_map_posture', message: 'map posture is unknown until explicitly assessed' });
  } else {
    const postureValidation = validateEngineeringPosture(map.engineering_posture);
    for (const error of postureValidation.errors) {
      errors.push({ ...error, code: `map_${error.code}`, message: `engineering_posture: ${error.message}` });
    }
    if (postureValidation.valid && map.engineering_posture.status !== 'unknown_legacy') {
      authoritativePosture = map.engineering_posture;
    }
  }

  const ids = new Set();
  for (const node of map.nodes) {
    if (!node || typeof node !== 'object') {
      errors.push({ code: 'invalid_node', message: 'each node must be an object' });
      continue;
    }
    if (typeof node.id !== 'string' || node.id.length === 0) {
      errors.push({ code: 'missing_node_id', message: 'each node needs an id' });
      continue;
    }
    if (options.strict && !/^N-[0-9]{3,}$/.test(node.id)) {
      errors.push({ code: 'invalid_node_id', message: `${node.id} must match N-<digits>` });
    }
    if (ids.has(node.id)) errors.push({ code: 'duplicate_node', message: `duplicate node ${node.id}` });
    ids.add(node.id);
    if (typeof node.title !== 'string' || node.title.length === 0) {
      errors.push({ code: 'missing_node_title', message: `${node.id} needs a title` });
    }
    if (!NODE_STATUSES.has(node.status)) {
      errors.push({ code: 'invalid_status', message: `${node.id} has invalid status ${node.status}` });
    }
    if (!Array.isArray(node.depends_on)) {
      errors.push({ code: 'invalid_dependencies', message: `${node.id}.depends_on must be an array` });
    }
    for (const field of ['blocking_questions', 'inputs', 'outputs', 'acceptance', 'requirement_ids', 'contract_refs', 'design_refs', 'interaction_refs']) {
      if (node[field] !== undefined && !Array.isArray(node[field])) {
        errors.push({ code: `invalid_${field}`, message: `${node.id}.${field} must be an array` });
      }
    }
    const productWork = node.kind !== 'control' && node.id !== 'N-000';
    const executableState = ['ready', 'in_progress', 'awaiting_validation', 'done'].includes(node.status);
    if (authoritativePosture && productWork && executableState) {
      const scopeValidation = validateScopeControl(node, authoritativePosture);
      for (const error of scopeValidation.errors) {
        errors.push({ ...error, code: `node_${error.code}`, message: `${node.id}: ${error.message}` });
      }
      if (!Array.isArray(node.deferred_candidates)) {
        errors.push({ code: 'node_invalid_deferred_candidates', message: `${node.id}.deferred_candidates must be an array` });
      }
    }
  }

  const adjacency = new Map(map.nodes
    .filter((node) => node && typeof node === 'object' && typeof node.id === 'string' && node.id.length > 0)
    .map((node) => [node.id, asArray(node.depends_on)]));
  for (const [id, dependencies] of adjacency) {
    for (const dependency of dependencies) {
      if (!ids.has(dependency)) {
        errors.push({ code: 'unknown_dependency', message: `${id} depends on unknown node ${dependency}` });
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const walk = (id, trail = []) => {
    if (visiting.has(id)) {
      errors.push({ code: 'cycle', message: `dependency cycle: ${[...trail, id].join(' -> ')}` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of adjacency.get(id) ?? []) {
      if (adjacency.has(dependency)) walk(dependency, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of adjacency.keys()) walk(id);

  if (map.current_node !== undefined && map.current_node !== null && typeof map.current_node !== 'string') {
    errors.push({ code: 'invalid_current_node', message: 'current_node must be a string or null' });
  } else if (map.current_node !== undefined && map.current_node !== null && !ids.has(map.current_node)) {
    warnings.push({ code: 'unknown_current_node', message: `current_node ${map.current_node} is not in nodes` });
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function getNextNodes(map) {
  if (map.schema_version === SCHEMA_VERSION && ['required', 'in_progress', 'stale'].includes(map.gates?.design?.status)) return [];
  const nodes = asArray(map?.nodes).filter((node) => node && typeof node === 'object' && typeof node.id === 'string');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => {
    if (!['idea', 'ready'].includes(node.status)) return false;
    if (typeof node.title !== 'string' || node.title.trim().length === 0) return false;
    if (node.revalidation_required === true) return false;
    if (!Array.isArray(node.inputs) || node.inputs.length === 0) return false;
    if (!Array.isArray(node.outputs) || node.outputs.length === 0) return false;
    if (!Array.isArray(node.acceptance) || node.acceptance.length === 0) return false;
    if (node.design_required === true && asArray(node.design_refs).length === 0) return false;
    if (asArray(node.impacted_modules).length > 0 && asArray(node.contract_refs).length === 0) return false;
    if (!Array.isArray(node.blocking_questions)) return false;
    if (asArray(node.blocking_questions).length > 0) return false;
    if (map.schema_version === SCHEMA_VERSION && node.kind !== 'control' && node.id !== 'N-000') {
      const postureValidation = validateEngineeringPosture(map.engineering_posture);
      if (!postureValidation.valid || map.engineering_posture?.status === 'unknown_legacy') return false;
      if (!validateScopeControl(node, map.engineering_posture).valid) return false;
      if (!Array.isArray(node.deferred_candidates)) return false;
    }
    return Array.isArray(node.depends_on)
      && node.depends_on.every((id) => {
        const dependency = byId.get(id);
        return dependency?.status === 'done' && dependency.revalidation_required !== true;
      });
  });
}

export function markDescendantsStale(map, nodeId, reason = 'dependency invalidated') {
  const next = cloneJson(map);
  const dependents = new Map();
  for (const node of asArray(next.nodes)) {
    if (!node || typeof node !== 'object') continue;
    for (const dependency of asArray(node.depends_on)) {
      if (!dependents.has(dependency)) dependents.set(dependency, []);
      dependents.get(dependency).push(node.id);
    }
  }
  const affected = [];
  const queue = [...(dependents.get(nodeId) ?? [])];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = next.nodes.find((candidate) => candidate && typeof candidate === 'object' && candidate.id === id);
    if (node && node.status !== 'cancelled') {
      if (node.status === 'done') {
        node.revalidation_required = true;
      } else {
        node.status = 'stale';
        node.stale_reason = reason;
      }
      affected.push(id);
    }
    queue.push(...(dependents.get(id) ?? []));
  }
  return { map: next, affected };
}

async function withEventLock(lockPath, operation) {
  const deadline = Date.now() + 5_000;
  let handle;
  while (!handle) {
    try {
      handle = await fs.open(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > 30_000) await fs.unlink(lockPath);
      } catch (statError) {
        if (!['ENOENT', 'EPERM'].includes(statError.code)) throw statError;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    try { await fs.unlink(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function withMapLock(root, operation) {
  const planRoot = path.resolve(root);
  await ensureDir(planRoot);
  return withEventLock(path.join(planRoot, 'map.json.lock'), operation);
}

export async function appendEvent(root, event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.event_id !== 'string' || event.event_id.length === 0) {
    throw new TypeError('event.event_id is required');
  }
  if (typeof event.type !== 'string' || event.type.length === 0) {
    throw new TypeError('event.type is required');
  }
  const planRoot = path.resolve(root);
  const filePath = path.join(planRoot, 'events.jsonl');
  await ensureDir(planRoot);
  return withEventLock(`${filePath}.lock`, async () => {
    let existing = '';
    try {
      existing = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const lines = existing.split('\n').filter(Boolean);
    if (lines.some((line) => {
      try { return JSON.parse(line).event_id === event.event_id; } catch { return false; }
    })) {
      return { appended: false, event_id: event.event_id };
    }
    const { schema_version: _schemaVersion, occurred_at: _occurredAt, ...payload } = cloneJson(event);
    const record = {
      ...payload,
      schema_version: SCHEMA_VERSION,
      occurred_at: new Date().toISOString(),
    };
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    return { appended: true, event_id: event.event_id, record };
  });
}

export function normalizeProviderResult(input, defaults = {}) {
  const source = defaults.source ?? input?.source ?? input?.provenance ?? null;
  const providerId = String(defaults.provider_id ?? input?.provider_id ?? 'unknown-provider');
  const capability = String(defaults.capability ?? input?.capability ?? 'unknown');
  const isString = typeof input === 'string';
  const object = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const hasStructuredField = ['questions', 'assumptions', 'findings', 'options', 'risks', 'evidence']
    .some((key) => Object.prototype.hasOwnProperty.call(object, key));
  const outputText = isString ? input : typeof object.output === 'string' ? object.output : typeof object.text === 'string' ? object.text : null;
  const empty = (isString && input.trim().length === 0)
    || (isPlainObject(input) && !outputText && !hasStructuredField && !input.raw && !input.status);
  const unavailable = input === null || input === undefined || Array.isArray(input) || empty
    || (isPlainObject(input) && input.status === 'unavailable');
  const unstructured = Boolean(outputText && !hasStructuredField && !unavailable);
  const observedAt = defaults.observed_at ?? object.observed_at ?? new Date().toISOString();
  const rawRef = defaults.raw_ref ?? object.raw_ref ?? null;
  const requestedStatus = defaults.status ?? object.status;
  const status = unavailable
    ? 'unavailable'
    : (requestedStatus === 'error' ? 'error' : (unstructured ? 'unstructured' : (PROVIDER_STATUSES.has(requestedStatus) ? requestedStatus : requestedStatus ? 'error' : 'ok')));
  const knownFields = new Set([
    'schema_version', 'provider_id', 'capability', 'status', 'questions', 'assumptions',
    'findings', 'options', 'risks', 'confidence', 'evidence', 'raw', 'extensions',
    'output', 'text', 'source', 'provenance', 'observed_at',
    'raw_ref', 'composition_contract', 'lifecycle',
  ]);
  const unknownExtensions = Object.fromEntries(
    Object.entries(object).filter(([key]) => !knownFields.has(key)),
  );
  const candidateConfidence = object.confidence;
  const validConfidence = candidateConfidence === undefined || candidateConfidence === null
    || (isPlainObject(candidateConfidence)
      && (candidateConfidence.score === undefined
        || (typeof candidateConfidence.score === 'number' && candidateConfidence.score >= 0 && candidateConfidence.score <= 1)));
  if (!validConfidence) unknownExtensions.invalid_confidence = cloneJson(candidateConfidence);
  const confidence = validConfidence ? cloneJson(candidateConfidence ?? null) : null;
  const raw = rawRef ? null : (unstructured
    ? { value: cloneJson(input), text: outputText, source, observed_at: observedAt }
    : cloneJson(input));
  return {
    schema_version: SCHEMA_VERSION,
    provider_id: providerId,
    capability,
    status,
    questions: asArray(object.questions),
    assumptions: asArray(object.assumptions),
    findings: asArray(object.findings),
    options: asArray(object.options),
    risks: asArray(object.risks),
    confidence,
    evidence: asArray(object.evidence),
    raw,
    raw_ref: rawRef,
    composition_contract: cloneJson(defaults.composition_contract ?? object.composition_contract ?? null),
    lifecycle: cloneJson(defaults.lifecycle ?? object.lifecycle ?? {
      invocation: 'observed',
      persistence: rawRef ? 'verified' : 'not_verified',
    }),
    observed_at: observedAt,
    extensions: {
      ...(isPlainObject(object.extensions) ? cloneJson(object.extensions) : {}),
      ...unknownExtensions,
    },
  };
}

export function buildHandoff(input = {}) {
  const sourceInput = isPlainObject(input) ? input : {};
  const knownFields = new Set([
    'schema_version', 'source', 'mode', 'summary', 'artifacts', 'questions',
    'assumptions', 'findings', 'decisions', 'provider_results', 'next_skill', 'extensions',
    'stage', 'work_shape', 'gates', 'architecture_snapshot', 'design_refs',
    'posture_ref', 'behavior_budget', 'scope_provenance', 'deferred_candidates', 'composition_contracts',
  ]);
  const unknownExtensions = Object.fromEntries(
    Object.entries(sourceInput)
      .filter(([key]) => !knownFields.has(key)),
  );
  const mode = HANDOFF_MODES.has(sourceInput.mode) ? sourceInput.mode : 'guide';
  const stageForMode = { guide: 'guiding', map: 'mapping', plan: 'leaf_planning', direct: 'intake' };
  const shapeForMode = { guide: 'undetermined', map: 'map', plan: 'plan', direct: 'direct' };
  return {
    schema_version: SCHEMA_VERSION,
    source: String(sourceInput.source ?? 'adaptive-planning-governance'),
    mode,
    stage: PLAN_STAGES.has(sourceInput.stage) ? sourceInput.stage : stageForMode[mode],
    work_shape: WORK_SHAPES.has(sourceInput.work_shape) ? sourceInput.work_shape : shapeForMode[mode],
    gates: isPlainObject(sourceInput.gates) ? cloneJson(sourceInput.gates) : {
      intent: { status: mode === 'guide' ? 'pending' : 'approved' },
      design: { status: 'unknown_legacy' },
      architecture_sync: { status: 'unknown_legacy' },
    },
    architecture_snapshot: cloneJson(sourceInput.architecture_snapshot ?? null),
    design_refs: asArray(sourceInput.design_refs),
    posture_ref: cloneJson(sourceInput.posture_ref ?? null),
    behavior_budget: normalizeBehaviorBudget(sourceInput.behavior_budget),
    scope_provenance: asArray(sourceInput.scope_provenance),
    deferred_candidates: asArray(sourceInput.deferred_candidates),
    composition_contracts: asArray(sourceInput.composition_contracts),
    summary: String(sourceInput.summary ?? ''),
    artifacts: asArray(sourceInput.artifacts),
    questions: asArray(sourceInput.questions),
    assumptions: asArray(sourceInput.assumptions),
    findings: asArray(sourceInput.findings),
    decisions: asArray(sourceInput.decisions),
    provider_results: asArray(sourceInput.provider_results).map((result) => result?.raw_ref
      ? { ...cloneJson(result), raw: null }
      : cloneJson(result)),
    next_skill: sourceInput.next_skill ?? null,
    extensions: {
      ...unknownExtensions,
      ...(isPlainObject(sourceInput.extensions) ? cloneJson(sourceInput.extensions) : {}),
    },
  };
}

export function normalizeHandoff(input = {}, defaults = {}) {
  const source = isPlainObject(input) ? input : {};
  return buildHandoff({ ...source, ...defaults });
}

function validateArrayFields(value, fields, errors) {
  for (const field of fields) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      errors.push({ code: `invalid_${field}`, message: `${field} must be an array` });
    }
  }
}

export function validateHandoff(value, options = {}) {
  const errors = [];
  const warnings = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: [{ code: 'not_object', message: 'handoff must be an object' }], warnings };
  }
  if (!options.partial && (typeof value.schema_version !== 'string' || value.schema_version.length === 0)) {
    errors.push({ code: 'missing_schema_version', message: 'schema_version must be a non-empty string' });
  } else if (value.schema_version !== undefined && (typeof value.schema_version !== 'string' || value.schema_version.length === 0)) {
    errors.push({ code: 'invalid_schema_version', message: 'schema_version must be a non-empty string' });
  } else if (options.strict && value.schema_version !== undefined && ![LEGACY_SCHEMA_VERSION, SCHEMA_VERSION].includes(value.schema_version)) {
    errors.push({ code: 'unsupported_schema_version', message: `schema_version must be ${LEGACY_SCHEMA_VERSION} or ${SCHEMA_VERSION}` });
  }
  if (!options.partial && (typeof value.source !== 'string' || value.source.length === 0)) {
    errors.push({ code: 'missing_source', message: 'source must be a non-empty string' });
  } else if (value.source !== undefined && (typeof value.source !== 'string' || value.source.length === 0)) {
    errors.push({ code: 'invalid_source', message: 'source must be a non-empty string' });
  }
  if (!options.partial && !HANDOFF_MODES.has(value.mode)) {
    errors.push({ code: 'invalid_mode', message: `mode must be one of ${[...HANDOFF_MODES].join(', ')}` });
  } else if (value.mode !== undefined && !HANDOFF_MODES.has(value.mode)) {
    errors.push({ code: 'invalid_mode', message: `mode must be one of ${[...HANDOFF_MODES].join(', ')}` });
  }
  if (value.summary !== undefined && typeof value.summary !== 'string') {
    errors.push({ code: 'invalid_summary', message: 'summary must be a string' });
  }
  if (value.schema_version === SCHEMA_VERSION) {
    if (!PLAN_STAGES.has(value.stage)) errors.push({ code: 'invalid_stage', message: `stage must be one of ${[...PLAN_STAGES].join(', ')}` });
    if (!WORK_SHAPES.has(value.work_shape)) errors.push({ code: 'invalid_work_shape', message: `work_shape must be one of ${[...WORK_SHAPES].join(', ')}` });
    if (!isPlainObject(value.gates)) errors.push({ code: 'invalid_gates', message: 'gates must be an object' });
    if (value.posture_ref !== null && !isPlainObject(value.posture_ref)) errors.push({ code: 'invalid_posture_ref', message: 'posture_ref must be an object or null' });
    if (!isPlainObject(value.behavior_budget)) errors.push({ code: 'invalid_behavior_budget', message: 'behavior_budget must be an object' });
  }
  validateArrayFields(value, ['artifacts', 'questions', 'assumptions', 'findings', 'decisions', 'provider_results', 'scope_provenance', 'deferred_candidates', 'composition_contracts'], errors);
  for (const contract of asArray(value.composition_contracts)) errors.push(...validateCompositionContract(contract).errors);
  if (value.next_skill !== undefined && value.next_skill !== null && typeof value.next_skill !== 'string') {
    errors.push({ code: 'invalid_next_skill', message: 'next_skill must be a string or null' });
  }
  if (value.extensions !== undefined && (!value.extensions || typeof value.extensions !== 'object' || Array.isArray(value.extensions))) {
    errors.push({ code: 'invalid_extensions', message: 'extensions must be an object' });
  }
  if (options.strict) {
    const allowed = new Set([
      'schema_version', 'source', 'mode', 'summary', 'artifacts', 'questions', 'assumptions',
      'findings', 'decisions', 'provider_results', 'next_skill', 'extensions',
      'stage', 'work_shape', 'gates', 'architecture_snapshot', 'design_refs',
      'posture_ref', 'behavior_budget', 'scope_provenance', 'deferred_candidates', 'composition_contracts',
    ]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) warnings.push({ code: 'unknown_field', message: `unknown handoff field ${key}` });
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function validateProviderResult(value, options = {}) {
  const errors = [];
  const warnings = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: [{ code: 'not_object', message: 'provider result must be an object' }], warnings };
  }
  for (const field of ['schema_version', 'provider_id', 'capability']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      errors.push({ code: `missing_${field}`, message: `${field} must be a non-empty string` });
    }
  }
  if (!PROVIDER_STATUSES.has(value.status)) {
    errors.push({ code: 'invalid_status', message: `status must be one of ${[...PROVIDER_STATUSES].join(', ')}` });
  }
  if (value.observed_at !== undefined && typeof value.observed_at !== 'string') {
    errors.push({ code: 'invalid_observed_at', message: 'observed_at must be a string' });
  }
  validateArrayFields(value, ['questions', 'assumptions', 'findings', 'options', 'risks', 'evidence'], errors);
  if (value.confidence !== undefined && value.confidence !== null) {
    if (!value.confidence || typeof value.confidence !== 'object' || Array.isArray(value.confidence)) {
      errors.push({ code: 'invalid_confidence', message: 'confidence must be an object or null' });
    } else if (value.confidence.score !== undefined
      && (typeof value.confidence.score !== 'number' || value.confidence.score < 0 || value.confidence.score > 1)) {
      errors.push({ code: 'invalid_confidence', message: 'confidence.score must be a number between 0 and 1' });
    } else if (value.confidence.basis !== undefined && typeof value.confidence.basis !== 'string') {
      errors.push({ code: 'invalid_confidence', message: 'confidence.basis must be a string' });
    }
  }
  if (value.extensions !== undefined && (!value.extensions || typeof value.extensions !== 'object' || Array.isArray(value.extensions))) {
    errors.push({ code: 'invalid_extensions', message: 'extensions must be an object' });
  }
  if (value.raw_ref !== undefined && value.raw_ref !== null && (typeof value.raw_ref !== 'string' || value.raw_ref.length === 0)) {
    errors.push({ code: 'invalid_raw_ref', message: 'raw_ref must be a non-empty string or null' });
  }
  if (value.raw_ref && value.raw !== undefined && value.raw !== null) {
    errors.push({ code: 'duplicated_provider_raw', message: 'provider raw output must be stored once and referenced by raw_ref' });
  }
  if (value.composition_contract !== undefined && value.composition_contract !== null
    && (!value.composition_contract || typeof value.composition_contract !== 'object' || Array.isArray(value.composition_contract))) {
    errors.push({ code: 'invalid_composition_contract', message: 'composition_contract must be an object or null' });
  }
  if (value.composition_contract) errors.push(...validateCompositionContract(value.composition_contract).errors);
  if (value.lifecycle !== undefined && (!value.lifecycle || typeof value.lifecycle !== 'object' || Array.isArray(value.lifecycle))) {
    errors.push({ code: 'invalid_provider_lifecycle', message: 'provider lifecycle must be an object' });
  }
  if (options.strict && value.schema_version !== SCHEMA_VERSION) {
    errors.push({ code: 'unsupported_schema_version', message: `schema_version must be ${SCHEMA_VERSION}` });
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function makeEventId(prefix = 'event', payload = {}) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  return `${prefix}-${digest}`;
}

export function migrateMapV1(map) {
  if (map?.schema_version !== LEGACY_SCHEMA_VERSION) {
    if (map?.schema_version === SCHEMA_VERSION) return cloneJson(map);
    throw new Error('only v1 maps can be migrated');
  }
  const mode = HANDOFF_MODES.has(map.mode) ? map.mode : 'map';
  const stageForMode = { guide: 'guiding', map: 'mapping', plan: 'leaf_planning', direct: 'intake' };
  const next = {
    ...cloneJson(map),
    schema_version: SCHEMA_VERSION,
    mode,
    stage: stageForMode[mode],
    work_shape: mode === 'guide' ? 'undetermined' : mode,
    gates: {
      intent: { status: mode === 'guide' ? 'pending' : 'unknown_legacy' },
      design: { status: 'unknown_legacy' },
      architecture_sync: { status: 'unknown_legacy' },
    },
    architecture_snapshot: null,
    design_refs: [],
    engineering_posture: normalizeEngineeringPosture(null, { legacyRef: 'map.json@1.0' }),
    artifacts: asArray(map.artifacts),
    migrated_from: { schema_version: LEGACY_SCHEMA_VERSION, design_status: 'unknown_legacy' },
  };
  next.nodes = asArray(next.nodes).map((node) => ({
    ...node,
    requirement_ids: asArray(node.requirement_ids),
    contract_refs: asArray(node.contract_refs),
    design_refs: asArray(node.design_refs),
    interaction_refs: asArray(node.interaction_refs),
  }));
  return next;
}

async function listArtifactFiles(root, relative = '') {
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
    if (entry.isDirectory()) files.push(...await listArtifactFiles(root, child));
    else if (entry.isFile() && !entry.name.endsWith('.lock') && !entry.name.includes('.tmp-')) {
      files.push(child.split(path.sep).join('/'));
    }
  }
  return files;
}

function overviewReadiness(map, node) {
  const blockers = [];
  const byId = new Map(asArray(map.nodes).map((candidate) => [candidate.id, candidate]));
  const productWork = node.kind !== 'control' && node.id !== 'N-000';
  if (map.schema_version === SCHEMA_VERSION && productWork) {
    const postureValidation = validateEngineeringPosture(map.engineering_posture);
    if (!postureValidation.valid || map.engineering_posture?.status === 'unknown_legacy') {
      blockers.push({ code: 'missing_map_posture', message: 'v2 product work requires an authoritative map posture' });
    } else {
      blockers.push(...validateScopeControl(node, map.engineering_posture).errors);
      if (!Array.isArray(node.deferred_candidates)) blockers.push({ code: 'invalid_deferred_candidates', message: 'deferred_candidates must be an array' });
    }
  }
  if (!node.title) blockers.push({ code: 'missing_title', message: 'title is required' });
  if (!Array.isArray(node.inputs) || node.inputs.length === 0) blockers.push({ code: 'missing_inputs', message: 'inputs are required' });
  if (!Array.isArray(node.outputs) || node.outputs.length === 0) blockers.push({ code: 'missing_outputs', message: 'outputs are required' });
  if (!Array.isArray(node.acceptance) || node.acceptance.length === 0) blockers.push({ code: 'missing_acceptance', message: 'acceptance criteria are required' });
  if (node.design_required === true && asArray(node.design_refs).length === 0) blockers.push({ code: 'missing_design_ref', message: 'an approved design revision is required' });
  if (asArray(node.impacted_modules).length > 0 && asArray(node.contract_refs).length === 0) blockers.push({ code: 'missing_contract_refs', message: 'impacted modules require contract references' });
  if (node.blocking_questions !== undefined && !Array.isArray(node.blocking_questions)) blockers.push({ code: 'invalid_blocking_questions', message: 'blocking_questions must be an array' });
  for (const question of asArray(node.blocking_questions)) blockers.push({ code: 'blocking_question', message: question });
  if (node.revalidation_required === true) blockers.push({ code: 'revalidation_required', message: 'node requires revalidation after dependency evidence changed' });
  for (const dependency of asArray(node.depends_on)) {
    const upstream = byId.get(dependency);
    if (!upstream) blockers.push({ code: 'unknown_dependency', message: dependency });
    else if (upstream.status === 'stale') blockers.push({ code: 'stale_dependency', message: dependency });
    else if (upstream.revalidation_required === true) blockers.push({ code: 'dependency_revalidation_required', message: dependency });
    else if (upstream.status !== 'done') blockers.push({ code: 'dependency_not_done', message: dependency });
  }
  if (['stale', 'cancelled', 'deferred'].includes(node.status)) blockers.push({ code: 'status_not_ready', message: node.status });
  return { node_id: node.id, ready: blockers.length === 0, blockers };
}

function providerStatusForOverview(designDocument) {
  if (!designDocument) return null;
  if (Array.isArray(designDocument.threads)) {
    return {
      representation: 'design_ledger',
      threads: designDocument.threads.map((thread) => {
        const revision = currentThreadRevision(thread);
        return {
          thread_id: thread.thread_id,
          decision_status: revision?.decision_status ?? 'missing',
          provider_status: cloneJson(revision?.provider_status ?? null),
          provider_refs: cloneJson(asArray(revision?.provider_refs)),
        };
      }),
    };
  }
  const revision = currentDesignRevision(designDocument);
  if (!revision) return { representation: 'legacy_revisions', status: 'missing_current_revision' };
  return {
    representation: 'legacy_revisions',
    design_revision: revision.revision,
    design_status: revision.status,
    selection_status: revision.provider_selection?.status ?? 'unknown',
    selected: asArray(revision.provider_selection?.selected).map((provider) => ({
      provider_id: provider.id,
      role: provider.role,
      version_or_digest: provider.composition_contract?.version_or_digest ?? provider.version_or_digest ?? 'unknown',
      dependency_readiness: provider.composition_contract?.invocation?.dependency_readiness ?? provider.dependency_readiness ?? 'unknown',
      invocation: provider.composition_contract?.invocation?.state ?? provider.invocation ?? 'unknown',
      persistence: provider.composition_contract?.persistence?.state ?? provider.persistence_state ?? 'not_verified',
      verification: cloneJson(provider.composition_contract?.verification ?? null),
    })),
    blocking_concerns: cloneJson(asArray(revision.provider_selection?.blocking_concerns)),
    composition_blockers: cloneJson(asArray(revision.provider_selection?.composition_blockers)),
    results: asArray(revision.provider_results).map((result) => ({
      provider_id: result.provider_id,
      status: result.status,
      raw_ref: result.raw_ref ?? null,
      persistence: result.lifecycle?.persistence ?? result.persistence_state ?? 'not_verified',
    })),
  };
}

function pendingApprovalBrief(map, designDocument) {
  if (!designDocument || !['required', 'in_progress', 'stale'].includes(map.gates?.design?.status)) return null;
  if (Array.isArray(designDocument.threads)) {
    const pending = designDocument.threads.find((thread) => currentThreadRevision(thread)?.decision_status === 'in_progress');
    return pending ? ledgerApprovalBrief(designDocument, pending.thread_id) : null;
  }
  const revision = currentDesignRevision(designDocument);
  return revision?.status === 'in_progress' ? designApprovalBrief(designDocument) : null;
}

export function diagnosePlanBinding(planRoot, map, options = {}) {
  const requestedPlanRoot = path.resolve(planRoot);
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : null;
  const mcpPlanRoot = options.mcpPlanRoot ? path.resolve(options.mcpPlanRoot) : null;
  const recorded = map.gates?.bootstrap?.mcp_binding ?? null;
  const status = mcpPlanRoot
    ? (mcpPlanRoot === requestedPlanRoot ? 'matched' : 'mismatch')
    : recorded ?? 'unreported';
  return {
    status,
    source: mcpPlanRoot ? 'runtime_binding' : recorded ? 'bootstrap_receipt' : 'not_reported',
    requested_plan_root: requestedPlanRoot,
    bound_plan_root: mcpPlanRoot,
    project_root: projectRoot,
    plan_state: 'loaded',
    state_resolution: 'requested plan state is present even when an MCP binding differs',
  };
}

function flowReceipt(map, artifactIndex, binding) {
  const bootstrap = map.gates?.bootstrap ?? {};
  return {
    workflow: bootstrap.workflow ?? 'adaptive-planning-governance',
    plugin_source: bootstrap.plugin_source ?? 'plugin://adaptive-planning-governance',
    plugin_version: bootstrap.plugin_version ?? null,
    route: map.work_shape ?? map.mode ?? 'legacy',
    route_rationale: bootstrap.route_rationale ?? `map topology contains ${asArray(map.nodes).length} nodes`,
    project_ref: bootstrap.project_ref ?? null,
    plan_ref: bootstrap.plan_ref ?? null,
    persistence_status: bootstrap.persistence_status ?? 'observed',
    artifact_manifest: asArray(bootstrap.artifact_manifest).length > 0
      ? cloneJson(bootstrap.artifact_manifest)
      : artifactIndex.map((artifact) => ({ path: artifact.path, state: artifact.exists ? 'existing' : 'missing' })),
    architecture_status: map.gates?.architecture_sync?.status ?? 'unknown',
    design_status: map.gates?.design?.status ?? 'unknown',
    control_surface: bootstrap.control_surface ?? 'cli',
    mcp_binding: binding.status,
    next_action: bootstrap.next_action ?? null,
  };
}

export async function buildPlanOverview(root, options = {}) {
  const planRoot = path.resolve(root);
  const map = await loadMap(planRoot);
  const designDocument = await readJsonIfExists(path.join(planRoot, 'design.json'));
  const actualArtifacts = await listArtifactFiles(planRoot);
  const actualSet = new Set(actualArtifacts);
  const declaredArtifacts = asArray(map.artifacts).filter((artifact) => artifact?.path);
  const artifactPaths = [...new Set([
    ...actualArtifacts,
    ...declaredArtifacts.map((artifact) => artifact.path),
  ])].sort();
  const declaredByPath = new Map(declaredArtifacts.map((artifact) => [artifact.path, artifact]));
  const artifactIndex = await Promise.all(artifactPaths.map(async (artifactPath) => {
    const declared = declaredByPath.get(artifactPath);
    let exists = false;
    try {
      await fs.access(path.resolve(planRoot, artifactPath));
      exists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return {
      path: artifactPath,
      source: declared ? (actualSet.has(artifactPath) ? 'plan-folder+map-link' : 'map-link') : 'plan-folder',
      format: declared?.format ?? null,
      id: declared?.id ?? null,
      exists_in_plan_folder: actualSet.has(artifactPath),
      exists,
    };
  }));
  const readiness = asArray(map.nodes).filter(isPlainObject).map((node) => overviewReadiness(map, node));
  const binding = diagnosePlanBinding(planRoot, map, options);
  return {
    schema_version: SCHEMA_VERSION,
    plan_id: map.plan_id,
    title: map.title,
    status: map.status,
    stage: map.stage ?? 'legacy',
    work_shape: map.work_shape ?? map.mode ?? 'legacy',
    gates: cloneJson(map.gates ?? {}),
    architecture_snapshot: cloneJson(map.architecture_snapshot ?? null),
    design_refs: cloneJson(asArray(map.design_refs)),
    engineering_posture: map.engineering_posture ? {
      kind: map.engineering_posture.kind ?? null,
      source: cloneJson(map.engineering_posture.source ?? null),
      posture_hash: map.engineering_posture.posture_hash ?? null,
      objective: map.engineering_posture.objective ?? null,
      required_evidence: cloneJson(asArray(map.engineering_posture.required_evidence)),
    } : null,
    node_scope: asArray(map.nodes).filter(isPlainObject).map((node) => ({
      node_id: node.id,
      status: node.status,
      posture_ref: cloneJson(node.posture_ref ?? null),
      scope_provenance: cloneJson(asArray(node.scope_provenance)),
      behavior_budget: cloneJson(node.behavior_budget ?? null),
      deferred_candidates: cloneJson(asArray(node.deferred_candidates)),
      readiness: readiness.find((entry) => entry.node_id === node.id),
    })),
    readiness,
    readiness_blockers: readiness.flatMap((entry) => entry.blockers.map((blocker) => ({ node_id: entry.node_id, ...blocker }))),
    provider_status: providerStatusForOverview(designDocument),
    approval_brief: pendingApprovalBrief(map, designDocument),
    status_counts: statusCounts(map),
    ready_nodes: getNextNodes(map).map((node) => node.id),
    blocked_nodes: asArray(map.nodes).filter((node) => ['blocked', 'stale'].includes(node.status)).map((node) => ({ id: node.id, status: node.status, reason: node.stale_reason ?? asArray(node.blocking_questions).join('; ') })),
    ascii_dag: renderAsciiDag(map),
    binding,
    flow_receipt: flowReceipt(map, artifactIndex, binding),
    artifacts: artifactPaths,
    artifact_index: artifactIndex,
  };
}

function completionDesignErrors(map, designDocument) {
  const errors = [];
  const designStatus = map.gates?.design?.status;
  if (!['approved', 'waived'].includes(designStatus)) return errors;
  if (!designDocument) return [{ code: 'missing_design_document', message: 'approved design gate requires design.json for freshness validation' }];
  const refs = [
    ...asArray(map.design_refs),
    ...(map.gates?.design?.design_ref ? [map.gates.design.design_ref] : []),
    ...asArray(map.nodes).flatMap((node) => asArray(node?.design_refs)),
  ];
  if (refs.length === 0) errors.push({ code: 'missing_design_ref', message: 'approved design gate requires an exact design reference' });
  for (const ref of refs) {
    if (Array.isArray(designDocument.revisions)) {
      const revision = designDocument.revisions.find((candidate) => candidate.revision === ref.revision);
      if (!revision || revision.revision !== designDocument.current_revision) {
        errors.push({ code: 'stale_design_ref', message: `${ref.design_id ?? 'design'}@${ref.revision ?? '?'} is not the current design revision` });
        continue;
      }
      const contentHash = revision.content_hash ?? revision.design_hash;
      if ((ref.content_hash ?? ref.design_hash) !== contentHash || !['approved', 'waived'].includes(revision.status)) {
        errors.push({ code: 'stale_design_ref', message: `${ref.design_id ?? 'design'}@${ref.revision} does not match current approved content` });
      }
      continue;
    }
    const thread = asArray(designDocument.threads).find((candidate) => candidate.thread_id === (ref.thread_id ?? 'root'));
    const revision = currentThreadRevision(thread);
    if (!revision || (ref.revision !== undefined && ref.revision !== revision.revision)
      || (ref.content_hash ?? ref.design_hash) !== revision.content_hash
      || !['approved', 'waived'].includes(revision.decision_status)) {
      errors.push({ code: 'stale_design_ref', message: `${ref.thread_id ?? 'root'} design reference is not current and approved` });
    }
  }
  const current = Array.isArray(designDocument.revisions)
    ? currentDesignRevision(designDocument)
    : currentThreadRevision(asArray(designDocument.threads).find((thread) => thread.thread_id === 'root'));
  const provider = current?.provider_selection ?? current?.provider_status ?? {};
  for (const concern of asArray(provider.blocking_concerns)) errors.push({ code: 'critical_provider_coverage_gap', message: `missing critical provider coverage: ${concern}` });
  for (const providerId of asArray(provider.composition_blockers)) errors.push({ code: 'provider_composition_blocked', message: `provider composition blocked: ${providerId}` });
  return errors;
}

export function validatePlanCompletion(map, options = {}) {
  const errors = [];
  if (map.schema_version !== SCHEMA_VERSION) errors.push({ code: 'legacy_map', message: 'migrate the map to v2 before completion' });
  if (map.schema_version === SCHEMA_VERSION) {
    const mapValidation = validateMap(map, { strict: true });
    errors.push(...mapValidation.errors);
    const productNodes = asArray(map.nodes).filter((node) => node?.kind !== 'control' && node?.id !== 'N-000' && node?.status !== 'cancelled');
    const postureValidation = validateEngineeringPosture(map.engineering_posture);
    if (productNodes.length > 0 && (!postureValidation.valid || map.engineering_posture?.status === 'unknown_legacy')) {
      errors.push({ code: 'missing_completion_posture', message: 'completion requires an authoritative engineering posture' });
    } else if (productNodes.length > 0) {
      const observed = new Set(asArray(map.posture_evidence).map((entry) => typeof entry === 'string' ? entry : entry?.id).filter(Boolean));
      for (const required of asArray(map.engineering_posture.required_evidence)) {
        if (!observed.has(required)) errors.push({ code: 'missing_posture_evidence', message: `required posture evidence is missing: ${required}`, evidence_id: required });
      }
    }
  }
  for (const gate of ['intent', 'design', 'architecture_sync']) {
    const status = map.gates?.[gate]?.status;
    const allowed = gate === 'design' ? ['approved', 'not_required', 'waived'] : gate === 'architecture_sync' ? ['satisfied', 'not_required'] : ['approved'];
    if (!allowed.includes(status)) errors.push({ code: `gate_${gate}`, message: `${gate} gate is ${status ?? 'missing'}` });
  }
  for (const node of asArray(map.nodes)) {
    if (node.status === 'cancelled') continue;
    if (node.status !== 'done' || node.revalidation_required === true) errors.push({ code: 'node_incomplete', message: `${node.id} is not complete and current` });
  }
  errors.push(...completionDesignErrors(map, options.designDocument));
  const unique = [...new Map(errors.map((error) => [`${error.code}:${error.message}`, error])).values()];
  return { valid: unique.length === 0, errors: unique, warnings: [] };
}
