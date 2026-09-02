import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION } from './plan-protocol.mjs';
import { stableHash } from './io-utils.mjs';

export const CAPABILITY_ORDER = ['clarify', 'explore', 'design', 'decide', 'scenario', 'decompose', 'review', 'execute'];
export const BUILTIN_FALLBACKS = {
  clarify: 'bounded-user-question',
  explore: 'repository-search-and-evidence-event',
  design: 'builtin-design-driver',
  decide: 'explicit-options-table',
  scenario: 'risk-register',
  decompose: 'progressive-map',
  review: 'schema-and-dag-validation',
  execute: 'user-selected-executor',
};

const FALLBACK_ACCEPTANCE = {
  clarify: 'one bounded question is answered or explicitly deferred',
  explore: 'repository evidence is collected and referenced',
  design: 'explicit alternatives and a recorded decision are produced',
  decide: 'alternatives are compared against stated criteria',
  scenario: 'a bounded risk register is recorded',
  decompose: 'a progressive or topological task map is produced',
  review: 'schema and dependency checks pass',
  execute: 'the user-selected executor reports completion',
};

function providerRoles(provider) {
  return asArray(provider?.roles ?? provider?.metadata?.design?.roles);
}

/** Select only providers explicitly exposed by the current host session. */
export function selectVisibleProvider({ capability, role, visibleProviders, fallbacks } = {}) {
  const normalized = normaliseAlias(capability) ?? String(capability ?? '').trim().toLowerCase();
  const envelope = visibleProviders && typeof visibleProviders === 'object' ? visibleProviders : {};
  const candidates = asArray(envelope.providers).filter((provider) => provider && provider.visible === true);
  const matching = candidates.filter((provider) => {
    const capabilities = asArray(provider.capabilities).map((item) => normaliseAlias(item) ?? String(item).toLowerCase());
    return capabilities.includes(normalized);
  });
  const exact = role ? matching.find((provider) => providerRoles(provider).includes(role)) : null;
  const provider = exact ?? matching[0] ?? null;
  const verification = provider?.verification ?? [`verify ${normalized} output is observed and persisted`];
  if (provider) {
    return {
      capability: normalized,
      role: role ?? null,
      status: 'ready_to_invoke',
      selection_status: 'selected',
      invocation: 'not_invoked',
      provider: provider.id,
      provider_id: provider.id,
      reason: exact ? `visible provider ${provider.id} explicitly matches capability ${normalized} and role ${role}` : `visible provider ${provider.id} explicitly matches capability ${normalized}`,
      acceptance: FALLBACK_ACCEPTANCE[normalized] ?? 'declared provider output is accepted',
      verification,
    };
  }
  const fallback = (fallbacks && fallbacks[normalized]) ?? envelope.fallbacks?.[normalized] ?? BUILTIN_FALLBACKS[normalized] ?? 'bounded-ada-fallback';
  return {
    capability: normalized,
    role: role ?? null,
    status: 'unavailable',
    selection_status: 'unavailable',
    invocation: 'not_invoked',
    provider: null,
    provider_id: null,
    fallback,
    reason: `no visible provider matched capability ${normalized}${role ? ` and role ${role}` : ''}`,
    acceptance: FALLBACK_ACCEPTANCE[normalized] ?? 'bounded fallback completes without provider invocation',
    verification: [`verify fallback ${fallback} acceptance evidence`],
  };
}

/**
 * Convert an eligible provider route into an invoked route only when the host
 * reports an invocation receipt. This does not invoke the provider itself.
 */
export function transitionProviderInvocation(route = {}, receipt = {}) {
  if (route.status !== 'ready_to_invoke') {
    throw new Error('provider route must be ready_to_invoke before receipt transition');
  }
  if (!route.provider_id || receipt?.provider_id !== route.provider_id) {
    throw new Error('provider id in host receipt must match the ready provider route');
  }
  return {
    ...route,
    status: 'invoked',
    invocation: 'invoked',
    receipt_id: receipt.receipt_id ?? null,
    host_receipt: { ...receipt },
  };
}

const CAPABILITY_ALIASES = new Map([
  ['clarify', 'clarify'], ['clarification', 'clarify'], ['questions', 'clarify'], ['question', 'clarify'],
  ['ask', 'clarify'], ['ambiguity', 'clarify'],
  ['explore', 'explore'], ['research', 'explore'], ['search', 'explore'], ['investigate', 'explore'],
  ['repository', 'explore'], ['discovery', 'explore'],
  ['design', 'design'], ['architecture-design', 'design'], ['interface-design', 'design'],
  ['decide', 'decide'], ['decision', 'decide'], ['compare', 'decide'], ['alternatives', 'decide'],
  ['tradeoff', 'decide'], ['tradeoffs', 'decide'],
  ['scenario', 'scenario'], ['scenarios', 'scenario'], ['uncertainty', 'scenario'], ['risk', 'scenario'],
  ['risks', 'scenario'], ['futures', 'scenario'],
  ['decompose', 'decompose'], ['decomposition', 'decompose'], ['roadmap', 'decompose'],
  ['breakdown', 'decompose'], ['task-decomposition', 'decompose'], ['planning', 'decompose'],
  ['review', 'review'], ['finalise', 'review'], ['finalize', 'review'], ['audit', 'review'],
  ['validate', 'review'], ['verification', 'review'],
  ['execute', 'execute'], ['execution', 'execute'], ['implement', 'execute'], ['implementation', 'execute'],
]);

const KEYWORD_RULES = [
  ['clarify', /(?:clarif|question|ambigu|ask[- ]plan|requirements?[- ]?gather)/i],
  ['explore', /(?:explor|research|search|investigat|repository|repo[- ]scan|discover)/i],
  ['design', /(?:software[- ]design|architecture[- ]design|interface[- ]design|design[- ]review)/i],
  ['decide', /(?:decision|compare|alternative|trade[- ]?off|option analysis)/i],
  ['scenario', /(?:scenario|uncertaint|risk|future|stress[- ]?test)/i],
  ['decompose', /(?:decompos|roadmap|breakdown|task[- ]?decompos|phase planning)/i],
  ['review', /(?:review|finali[sz]e|audit|verif|validation)/i],
  // Execution is opt-in via an explicit capability; generic skill prose often
  // mentions implementation while still being a design or review provider.
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normaliseAlias(value) {
  const key = String(value).trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  return CAPABILITY_ALIASES.get(key) ?? (CAPABILITY_ORDER.includes(key) ? key : null);
}

export function inferCapabilities(id = '', description = '', explicit = []) {
  const text = `${id} ${description}`;
  const found = new Set();
  for (const value of asArray(explicit)) {
    const capability = normaliseAlias(value);
    if (capability) found.add(capability);
  }
  for (const [capability, pattern] of KEYWORD_RULES) {
    if (pattern.test(text)) found.add(capability);
  }
  return CAPABILITY_ORDER.filter((capability) => found.has(capability));
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseScalar(item));
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { return JSON.parse(trimmed.replaceAll("'", '"')); } catch { /* fall through */ }
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {};
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return {};
  const result = {};
  let listKey = null;
  for (const line of lines.slice(1, end)) {
    const listMatch = line.match(/^\s*-\s*(.*?)\s*$/);
    if (listMatch && listKey) {
      if (!Array.isArray(result[listKey])) result[listKey] = [];
      result[listKey].push(parseScalar(listMatch[1]));
      continue;
    }
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].replaceAll('-', '_');
    listKey = match[2] ? null : key;
    result[key] = match[2] ? parseScalar(match[2]) : [];
  }
  return result;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function walk(directory, predicate, visited = new Set()) {
  const resolved = path.resolve(directory);
  let canonical;
  try {
    canonical = await fs.realpath(resolved);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  if (visited.has(canonical)) return [];
  visited.add(canonical);
  let entries;
  try { entries = await fs.readdir(resolved, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  const result = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.cache') continue;
    const full = path.join(resolved, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full, predicate, visited));
    else if (entry.isSymbolicLink()) {
      let target;
      try {
        target = await fs.stat(full);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (target.isDirectory()) result.push(...await walk(full, predicate, visited));
      else if (target.isFile() && predicate(entry.name, full)) result.push(full);
    }
    else if (predicate(entry.name, full)) result.push(full);
  }
  return result;
}

function skillProvider({ filePath, frontmatter, body }) {
  const name = String(frontmatter.name ?? path.basename(path.dirname(filePath)));
  const description = String(frontmatter.description ?? '');
  const capabilities = inferCapabilities(name, description, frontmatter.capabilities ?? frontmatter.capability);
  return {
    id: name,
    kind: 'skill',
    name,
    description,
    capabilities,
    availability: 'discovered',
    source: `skill://${name}`,
    location: filePath,
    execution: 'not-invoked',
    lifecycle: {
      discovery: 'installed',
      dependency_readiness: 'not_checked',
      invocation: 'not_invoked',
      persistence: 'not_verified',
    },
    identity: {
      version_or_digest: frontmatter.version
        ? `version:${frontmatter.version}`
        : `sha256:${stableHash(body)}`,
    },
    metadata: {
      has_instructions: body.trim().length > 0,
      frontmatter: clone(frontmatter),
      design: {
        roles: asArray(frontmatter.design_roles),
        domains: asArray(frontmatter.design_domains),
        concerns: asArray(frontmatter.design_concerns),
        mutability: frontmatter.mutability ?? 'unknown',
      },
    },
  };
}

function mcpProvider({ pluginName, serverName, server, manifest, configPath }) {
  const description = String(server?.description ?? manifest?.description ?? '');
  const explicit = server?.capabilities ?? server?.capability ?? manifest?.capabilities;
  const id = `${pluginName}/${serverName}`;
  return {
    id,
    kind: 'mcp',
    name: serverName,
    plugin: pluginName,
    description,
    capabilities: inferCapabilities(`${pluginName} ${serverName}`, description, explicit),
    availability: 'discovered',
    source: `mcp://${pluginName}/${serverName}`,
    location: configPath,
    execution: 'not-invoked',
    transport: 'stdio',
    lifecycle: {
      discovery: 'installed',
      dependency_readiness: 'not_checked',
      invocation: 'not_invoked',
      persistence: 'not_verified',
    },
    identity: {
      version_or_digest: manifest?.version
        ? `version:${manifest.version}`
        : `sha256:${stableHash({ serverName, server })}`,
    },
    metadata: {
      command: typeof server?.command === 'string' ? server.command : null,
      args: asArray(server?.args),
      // Environment values are deliberately omitted; discovery never carries credentials.
      has_environment: Boolean(server?.env || server?.env_vars),
    },
  };
}

function nonEmpty(value, fallback = []) {
  const items = asArray(value);
  return items.length > 0 ? items : asArray(fallback);
}

async function defaultCatalog() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const catalogPath = path.resolve(
    currentDir,
    '..',
    '..',
    'skills',
    'adaptive-writing-plans',
    'references',
    'design-provider-catalog.json',
  );
  try {
    return await readJson(catalogPath);
  } catch (error) {
    if (error.code === 'ENOENT') return { providers: [] };
    throw error;
  }
}

function applyCatalog(provider, catalogById) {
  const catalog = catalogById.get(provider.id) ?? null;
  const currentDesign = provider.metadata?.design ?? {};
  const design = {
    roles: nonEmpty(currentDesign.roles, catalog?.roles),
    domains: nonEmpty(currentDesign.domains, catalog?.domains),
    concerns: nonEmpty(currentDesign.concerns, catalog?.concerns),
    mutability: currentDesign.mutability && currentDesign.mutability !== 'unknown'
      ? currentDesign.mutability
      : catalog?.mutability ?? 'unknown',
  };
  const dependencyRefs = nonEmpty(catalog?.dependency_refs);
  return {
    ...provider,
    lifecycle: {
      ...provider.lifecycle,
      dependency_readiness: dependencyRefs.length === 0 ? 'ready' : 'not_checked',
    },
    metadata: {
      ...provider.metadata,
      design,
      composition: {
        catalog_match: Boolean(catalog),
        dependency_refs: dependencyRefs,
        expected_outputs: nonEmpty(catalog?.expected_outputs),
        persistence_expectations: String(
          catalog?.persistence_expectations ?? 'record provider result before using it as decision evidence',
        ),
        fallback: catalog?.fallback ?? null,
      },
    },
  };
}

async function discoverSkills(roots, warnings) {
  const providers = [];
  for (const root of roots) {
    let files;
    try { files = await walk(root, (name) => name === 'SKILL.md'); } catch (error) {
      warnings.push({ code: 'skill_root_error', root, message: error.message });
      continue;
    }
    for (const filePath of files) {
      try {
        const body = await fs.readFile(filePath, 'utf8');
        providers.push(skillProvider({ filePath, frontmatter: parseFrontmatter(body), body }));
      } catch (error) {
        warnings.push({ code: 'skill_read_error', path: filePath, message: error.message });
      }
    }
  }
  return providers;
}

async function discoverMcpFile(configPath, pluginName, warnings) {
  try {
    const config = await readJson(configPath);
    const servers = config?.mcpServers ?? config?.servers ?? {};
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      warnings.push({ code: 'invalid_mcp_servers', path: configPath, message: 'mcpServers must be an object' });
      return [];
    }
    let manifest = {};
    const manifestPath = path.join(path.dirname(configPath), '.codex-plugin', 'plugin.json');
    try { manifest = await readJson(manifestPath); } catch { /* standalone MCP config */ }
    return Object.entries(servers).map(([name, server]) => mcpProvider({
      pluginName: String(manifest.name ?? pluginName ?? path.basename(path.dirname(configPath))),
      serverName: name,
      server: server && typeof server === 'object' ? server : {},
      manifest,
      configPath,
    }));
  } catch (error) {
    warnings.push({ code: 'mcp_read_error', path: configPath, message: error.message });
    return [];
  }
}

async function discoverPlugins(roots, warnings) {
  const providers = [];
  const configs = new Set();
  for (const root of roots) {
    let files;
    try { files = await walk(root, (name) => name === '.mcp.json'); } catch (error) {
      warnings.push({ code: 'plugin_root_error', root, message: error.message });
      continue;
    }
    for (const file of files) configs.add(file);
  }
  for (const file of [...configs].sort()) {
    providers.push(...await discoverMcpFile(file, path.basename(path.dirname(file)), warnings));
  }
  return providers;
}

function dedupeProviders(providers) {
  const byId = new Map();
  for (const provider of providers) {
    const existing = byId.get(provider.id);
    if (!existing) byId.set(provider.id, provider);
    else {
      existing.capabilities = CAPABILITY_ORDER.filter((capability) =>
        existing.capabilities.includes(capability) || provider.capabilities.includes(capability));
      existing.metadata = { ...existing.metadata, duplicate_locations: [
        ...(existing.metadata?.duplicate_locations ?? []), provider.location,
      ] };
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function discoverProviders(options = {}) {
  const warnings = [];
  const catalog = options.catalog ?? await defaultCatalog();
  const catalogById = new Map(asArray(catalog?.providers).map((entry) => [entry.id, entry]));
  const skillsRoots = asArray(options.skillsRoots ?? options.skillRoots);
  const pluginRoots = asArray(options.pluginRoots ?? options.pluginsRoots);
  const explicitMcp = asArray(options.mcpFiles ?? options.mcp);
  const providers = [
    ...(await discoverSkills(skillsRoots, warnings)),
    ...(await discoverPlugins(pluginRoots, warnings)),
  ];
  for (const file of explicitMcp) providers.push(...await discoverMcpFile(path.resolve(file), null, warnings));
  const discovered = dedupeProviders(providers).map((provider) => applyCatalog(provider, catalogById));
  const result = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    providers: discovered,
    aliases: {},
    fallbacks: { ...BUILTIN_FALLBACKS },
    warnings,
    policy: {
      discovery_only: true,
      execution: 'not-invoked',
      installation: 'never-automatic',
    },
  };
  for (const capability of CAPABILITY_ORDER) {
    result.aliases[capability] = result.providers
      .filter((provider) => provider.capabilities.includes(capability))
      .map((provider) => provider.id);
  }
  return result;
}
