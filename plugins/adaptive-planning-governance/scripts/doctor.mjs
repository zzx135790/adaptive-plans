#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : '.');
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, detail });

const major = Number(process.versions.node.split('.')[0]);
check('node-version', major >= 20, `Node ${process.versions.node}; requires >=20`);
for (const relative of [
  '.codex-plugin/plugin.json', '.mcp.json', 'skills/adaptive-planning-governance/SKILL.md',
  'mcp/server.mjs', 'scripts/discover-providers.mjs', 'scripts/normalize-handoff.mjs',
  'scripts/validate-provider.mjs', 'schemas/provider-registry.schema.json',
  'scripts/mark-provider-unavailable.mjs',
  'scripts/adaptive-plan.mjs', 'scripts/overview.mjs', 'scripts/migrate-plan.mjs',
  'scripts/posture-assess.mjs', 'scripts/posture-check.mjs', 'scripts/posture-promote.mjs',
  'scripts/design-brief.mjs', 'scripts/architecture-check.mjs', 'scripts/completion-check.mjs',
]) {
  try {
    await fs.access(path.join(root, relative));
    check(`file:${relative}`, true, 'present');
  } catch {
    check(`file:${relative}`, false, 'missing');
  }
}

let manifest;
try {
  manifest = JSON.parse(await fs.readFile(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  check('manifest-name', manifest.name === 'adaptive-planning-governance', `name=${manifest.name ?? 'missing'}`);
  check('portable-paths', !JSON.stringify(manifest).match(/[A-Za-z]:\\|\/{2,}/), 'no absolute path in manifest');
} catch (error) {
  check('manifest-json', false, error.message);
}

for (const relative of ['.mcp.json', 'schemas/map.schema.json', 'schemas/handoff.schema.json', 'schemas/provider-result.schema.json', 'schemas/provider-registry.schema.json']) {
  try {
    JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
    check(`json:${relative}`, true, 'valid JSON');
  } catch (error) {
    check(`json:${relative}`, false, error.message);
  }
}

try {
  const mcp = JSON.parse(await fs.readFile(path.join(root, '.mcp.json'), 'utf8'));
  const server = mcp.mcpServers?.['adaptive-planning-governance'];
  check('mcp-portable-command', server?.command === 'node' && server?.args?.[0] === './mcp/server.mjs' && server?.cwd === '.', 'relative stdio server wiring');
  check('mcp-request-context', server && !server.env_vars, 'project roots are supplied per request, not at startup');
} catch (error) {
  check('mcp-wiring', false, error.message);
}

try {
  const example = JSON.parse(await fs.readFile(path.join(root, 'optional-hooks', 'events.example.json'), 'utf8'));
  check('hooks-example', example.write_policy === 'append-facts-only', 'illustrative append-only mapping');
} catch (error) {
  check('hooks-example', false, error.message);
}

const result = {
  root,
  ok: checks.every((item) => item.ok),
  commands: [
    'adaptive-plan overview',
    'adaptive-plan migrate [--apply --expected-hash|--recover --expected-current-hash]',
    'adaptive-plan posture assess|check|promote',
    'adaptive-plan design start|update|record|revise|brief|approve',
    'adaptive-plan architecture bootstrap|check|propose|apply',
    'adaptive-plan plan link-architecture|link-design|record-impact',
    'adaptive-plan completion check',
  ],
  checks,
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
