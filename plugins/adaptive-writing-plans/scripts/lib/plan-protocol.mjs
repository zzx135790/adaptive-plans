import fs from 'node:fs/promises';
import path from 'node:path';

import { asArray, cloneJson, ensureDir, isObject, readJson, writeJsonAtomic, writeTextAtomic } from './io-utils.mjs';
import { normalizeBehaviorBudget } from './scope-budget.mjs';

export const SCHEMA_VERSION = '2.0';
export const READABLE_SCHEMA_VERSIONS = Object.freeze(['1.0', '2.0']);

function nodeIds(map) {
  return new Set(asArray(map?.nodes).filter(isObject).map((node) => node.id).filter(Boolean));
}

export function topologicalWaves(map) {
  const nodes = asArray(map?.nodes)
    .filter((node) => isObject(node) && typeof node.id === 'string' && node.id.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set(nodes.map((node) => node.id));
  const remaining = new Map(nodes.map((node) => [node.id, node]));
  const completed = new Set();
  const waves = [];
  const blocked = [];

  for (const node of nodes) {
    const unknown = asArray(node.depends_on).filter((dependency) => !ids.has(dependency));
    if (unknown.length > 0) blocked.push({ node_id: node.id, reason: `unknown dependency: ${unknown.join(', ')}` });
  }
  const blockedIds = new Set(blocked.map((item) => item.node_id));

  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter((node) =>
      !blockedIds.has(node.id) && asArray(node.depends_on).every((dependency) => completed.has(dependency)));
    if (wave.length === 0) break;
    wave.sort((left, right) => left.id.localeCompare(right.id));
    waves.push(wave);
    for (const node of wave) {
      remaining.delete(node.id);
      completed.add(node.id);
    }
  }

  for (const node of [...remaining.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!blockedIds.has(node.id)) blocked.push({ node_id: node.id, reason: 'dependency cycle' });
  }
  return { waves, blocked };
}

export function validateMap(map) {
  const errors = [];
  const warnings = [];
  if (!isObject(map)) return { valid: false, readable: false, errors: [{ code: 'not_object', message: 'map must be an object' }], warnings };
  if (!READABLE_SCHEMA_VERSIONS.includes(map.schema_version)) {
    errors.push({ code: 'unsupported_schema_version', message: 'schema_version must be 1.0 or 2.0' });
  }
  if (typeof map.plan_id !== 'string' || map.plan_id.length === 0) {
    errors.push({ code: 'missing_plan_id', message: 'plan_id is required' });
  }
  if (!Array.isArray(map.nodes)) errors.push({ code: 'invalid_nodes', message: 'nodes must be an array' });

  const seen = new Set();
  for (const [index, node] of asArray(map.nodes).entries()) {
    if (!isObject(node)) {
      errors.push({ code: 'invalid_node', message: `node ${index} must be an object` });
      continue;
    }
    if (typeof node.id !== 'string' || node.id.length === 0) errors.push({ code: 'missing_node_id', message: `node ${index} needs an id` });
    else if (seen.has(node.id)) errors.push({ code: 'duplicate_node_id', message: `duplicate node id ${node.id}` });
    else seen.add(node.id);
    if (typeof node.title !== 'string' || node.title.length === 0) errors.push({ code: 'missing_node_title', message: `${node.id ?? index} needs a title` });
    if (node.depends_on !== undefined && !Array.isArray(node.depends_on)) {
      errors.push({ code: 'invalid_dependencies', message: `${node.id ?? index} depends_on must be an array` });
    }
  }

  if (Array.isArray(map.nodes)) {
    const ids = nodeIds(map);
    for (const node of map.nodes.filter(isObject)) {
      for (const dependency of asArray(node.depends_on)) {
        if (!ids.has(dependency)) errors.push({ code: 'unknown_dependency', message: `${node.id} depends on unknown node ${dependency}` });
        if (dependency === node.id) errors.push({ code: 'self_dependency', message: `${node.id} depends on itself` });
      }
    }
    const topology = topologicalWaves(map);
    for (const item of topology.blocked.filter((entry) => entry.reason === 'dependency cycle')) {
      errors.push({ code: 'dependency_cycle', message: `${item.node_id} is in a dependency cycle` });
    }
  }
  return {
    valid: errors.length === 0,
    readable: READABLE_SCHEMA_VERSIONS.includes(map.schema_version),
    schema_version: map.schema_version ?? null,
    migration_required: false,
    errors,
    warnings,
  };
}

export async function loadMap(root) {
  return readJson(path.join(path.resolve(root), 'map.json'));
}

export async function writeMap(root, map) {
  const validation = validateMap(map);
  if (!validation.valid) throw new Error(`invalid map: ${validation.errors.map((error) => error.message).join('; ')}`);
  const planRoot = path.resolve(root);
  await ensureDir(planRoot);
  await writeJsonAtomic(path.join(planRoot, 'map.json'), map);
  await writeTextAtomic(path.join(planRoot, 'MAP.md'), renderMapMarkdown(map));
  return cloneJson(map);
}

export function renderMapMarkdown(map) {
  const { waves, blocked } = topologicalWaves(map);
  const lines = [
    '# Plan Map',
    '',
    `> Schema ${map.schema_version}; generated view of \`map.json\`.`,
    '',
    `**Plan:** ${map.title ?? map.plan_id}`,
    map.goal ? `**Goal:** ${map.goal}` : null,
    '',
    '## DAG',
    '',
    ...(waves.length > 0
      ? waves.map((wave, index) => `Wave ${index + 1}: ${wave.map((node) => `[${node.id} ${node.status ?? 'pending'}] ${node.title}`).join(' | ')}`)
      : ['No dependency-ready nodes.']),
  ].filter((line) => line !== null);
  const edges = asArray(map.nodes).flatMap((node) => asArray(node.depends_on).map((dependency) => `${dependency} -> ${node.id}`));
  lines.push('', `Edges: ${edges.join(' | ') || 'none'}`);
  if (blocked.length > 0) lines.push('', `Blocked topology: ${blocked.map((item) => `${item.node_id} (${item.reason})`).join(' | ')}`);
  lines.push('', '## Nodes', '', '| ID | Status | Dependencies | Title |', '|---|---|---|---|');
  for (const node of asArray(map.nodes).sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    lines.push(`| ${node.id} | ${node.status ?? 'pending'} | ${asArray(node.depends_on).join(', ') || '-'} | ${node.title} |`);
  }
  return `${lines.join('\n')}\n`;
}

export function assessNodeReadiness(map, nodeId) {
  const node = asArray(map?.nodes).find((candidate) => candidate.id === nodeId);
  if (!node) return { ready: false, node_id: nodeId, blockers: [{ code: 'unknown_node', message: `unknown node ${nodeId}` }] };
  const byId = new Map(asArray(map.nodes).map((candidate) => [candidate.id, candidate]));
  const blockers = [];
  for (const dependency of asArray(node.depends_on)) {
    const upstream = byId.get(dependency);
    if (!upstream) blockers.push({ code: 'unknown_dependency', message: dependency });
    else if (upstream.status !== 'done' && upstream.status !== 'completed') blockers.push({ code: 'dependency_not_done', message: dependency });
  }
  for (const question of asArray(node.blocking_questions)) blockers.push({ code: 'blocking_question', message: String(question) });
  return { ready: blockers.length === 0, node_id: nodeId, blockers };
}

export function getNextNodes(map) {
  return asArray(map?.nodes)
    .filter((node) => !['done', 'completed', 'cancelled', 'deferred'].includes(node.status))
    .filter((node) => assessNodeReadiness(map, node.id).ready)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function writeNodeBrief(root, node) {
  const content = [
    `# ${node.id}: ${node.title}`,
    '',
    `**Status:** ${node.status ?? 'pending'}`,
    `**Depends on:** ${asArray(node.depends_on).join(', ') || 'none'}`,
    '',
    '## Acceptance',
    '',
    ...(asArray(node.acceptance).length > 0 ? node.acceptance.map((item) => `- ${item}`) : ['- Not specified']),
    '',
  ].join('\n');
  await writeTextAtomic(path.join(path.resolve(root), 'nodes', `${node.id}.md`), content);
}

export async function createPlanManifest(root, input = {}) {
  const map = {
    schema_version: SCHEMA_VERSION,
    plan_id: String(input.planId ?? input.plan_id ?? ''),
    title: String(input.title ?? input.planId ?? input.plan_id ?? ''),
    goal: String(input.goal ?? ''),
    status: 'active',
    nodes: [],
    behavior_budget: normalizeBehaviorBudget(input.behavior_budget),
  };
  if (!map.plan_id) throw new Error('plan id is required');
  const planRoot = path.resolve(root);
  if (!input.overwrite) {
    try {
      await fs.access(path.join(planRoot, 'map.json'));
      throw new Error(`plan folder already exists: ${planRoot}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await ensureDir(path.join(planRoot, 'nodes'));
  return writeMap(planRoot, map);
}

export async function addNode(root, input = {}) {
  const map = await loadMap(root);
  if (!input.id || !input.title) throw new Error('node id and title are required');
  if (asArray(map.nodes).some((node) => node.id === input.id)) throw new Error(`node ${input.id} already exists`);
  const node = {
    ...cloneJson(input),
    id: String(input.id),
    title: String(input.title),
    status: input.status ?? 'ready',
    depends_on: asArray(input.depends_on).map(String),
    inputs: asArray(input.inputs),
    outputs: asArray(input.outputs),
    acceptance: asArray(input.acceptance),
    blocking_questions: asArray(input.blocking_questions),
    behavior_budget: normalizeBehaviorBudget(input.behavior_budget ?? map.behavior_budget),
    parallelization: {
      candidate: input.parallelization?.candidate === true,
      owned_paths: asArray(input.parallelization?.owned_paths).map(String),
      shared_resources: cloneJson(asArray(input.parallelization?.shared_resources)),
      independent_verification: asArray(input.parallelization?.independent_verification).map(String),
    },
  };
  map.nodes.push(node);
  await writeMap(root, map);
  await writeNodeBrief(root, node);
  return { map, node };
}

async function collectFiles(root, relative = '') {
  let entries;
  try { entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(root, child));
    else result.push(child.split(path.sep).join('/'));
  }
  return result;
}

export async function buildPlanOverview(root) {
  const map = await loadMap(root);
  const validation = validateMap(map);
  const topology = topologicalWaves(map);
  const files = await collectFiles(path.resolve(root));
  const statusCounts = {};
  for (const node of asArray(map.nodes)) statusCounts[node.status ?? 'pending'] = (statusCounts[node.status ?? 'pending'] ?? 0) + 1;
  return {
    plan_id: map.plan_id,
    schema_version: map.schema_version,
    validation,
    dag: renderMapMarkdown(map),
    dependency_waves: topology.waves.map((wave, index) => ({ wave: index + 1, node_ids: wave.map((node) => node.id) })),
    blocked_topology: topology.blocked,
    next_nodes: getNextNodes(map).map((node) => node.id),
    status_counts: statusCounts,
    artifacts: files,
  };
}
