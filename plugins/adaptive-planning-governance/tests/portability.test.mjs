import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('all JSON resources parse and portable source has no absolute paths', async () => {
  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.name === 'node_modules') continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.json')) files.push(full);
    }
  }
  await walk(root);
  for (const file of files) {
    await assert.doesNotReject(async () => JSON.parse(await fs.readFile(file, 'utf8')), file);
  }
  const source = await fs.readFile(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8');
  assert.equal(/[A-Za-z]:\\/.test(source), false);
  assert.equal(source.includes('TODO'), false);
});

test('plugin does not vendor provider installation state or credentials', async () => {
  const forbidden = /(?:api[_-]?key|(?:^|[^a-z])secret(?:$|[^a-z])|(?:^|[^a-z])password(?:$|[^a-z])|npm\s+install|pip\s+install)/i;
  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.name === 'node_modules') continue;
      if (entry.isDirectory()) await walk(full);
      else if (!full.includes(`${path.sep}tests${path.sep}`)) files.push(full);
    }
  }
  await walk(root);
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    assert.equal(forbidden.test(content), false, `forbidden provider state in ${file}`);
  }
});

test('a plan can be created in a clean temporary directory', async () => {
  const clean = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-clean-'));
  const script = path.join(root, 'scripts', 'init-plan.mjs');
  const { spawn } = await import('node:child_process');
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--root', clean, '--id', 'clean', '--title', 'Clean', '--goal', 'Portable'], { encoding: 'utf8' });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ code, output }));
  });
  assert.equal(result.code, 0);
  const map = JSON.parse(await fs.readFile(path.join(clean, 'map.json'), 'utf8'));
  assert.equal(map.plan_id, 'clean');
});

test('portable MCP and package wiring expose only repository-relative implemented commands', async () => {
  const mcp = JSON.parse(await fs.readFile(path.join(root, '.mcp.json'), 'utf8'));
  const server = mcp.mcpServers['adaptive-planning-governance'];
  assert.equal(server.command, 'node');
  assert.equal(server.args[0], './mcp/server.mjs');
  assert.equal(server.cwd, '.');
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  for (const name of ['migrate', 'posture:assess', 'posture:check', 'posture:promote', 'design:brief', 'architecture:check', 'completion:check']) {
    const script = pkg.scripts[name].split(' ').at(-1);
    await assert.doesNotReject(fs.access(path.join(root, script)));
  }
});
