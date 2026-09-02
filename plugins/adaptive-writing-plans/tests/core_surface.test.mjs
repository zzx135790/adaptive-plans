import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function json(relative) {
  return JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
}

async function absent(relative) {
  await assert.rejects(fs.access(path.join(root, relative)), { code: 'ENOENT' });
}

test('0.4.0 manifests advertise only the dependency-free planning core', async () => {
  const pkg = await json('package.json');
  const codex = await json('.codex-plugin/plugin.json');
  const claude = await json('.claude-plugin/plugin.json');

  assert.equal(pkg.version, '0.4.0');
  assert.equal(codex.version, '0.4.0');
  assert.equal(claude.version, '0.4.0');
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.equal('mcpServers' in codex, false);
  assert.equal('hooks' in codex, false);
  assert.equal('mcp' in claude, false);
  assert.equal('hooks' in claude, false);
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['overview', 'test', 'validate']);
});

test('core package excludes governance runtimes, vendored dependencies, and historical plans', async () => {
  for (const relative of [
    '.mcp.json',
    '.codex-plugin/manifest.json',
    '.claude-plugin/manifest.json',
    'mcp',
    'hooks',
    'node_modules',
    'package-lock.json',
    'docs/superpowers/plans',
    'assets/ci/adaptive-architecture-check.yml',
    'scripts/lib/architecture-protocol.mjs',
    'scripts/lib/design-engine.mjs',
    'scripts/lib/engineering-posture.mjs',
    'scripts/lib/migration-protocol.mjs',
    'scripts/completion-check.mjs',
    'scripts/posture-promote.mjs',
    'tests/design_ledger.test.mjs',
    'tests/migration_protocol.test.mjs',
  ]) await absent(relative);
});
