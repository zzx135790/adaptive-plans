import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'scripts', 'adaptive-plan.mjs');

function run(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function parsed(result) {
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('core CLI routes directly and creates, validates, and summarizes a DAG', async () => {
  const routed = parsed(await run(['route'], JSON.stringify({ phase_count: 6, long_running: true })));
  assert.equal(routed.mode, 'direct');
  assert.deepEqual(routed.planning_artifacts, []);

  const planRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ada-cli-'));
  parsed(await run(['init', '--root', planRoot, '--id', 'core', '--title', 'Core', '--goal', 'Ship core']));
  parsed(await run([
    'add', '--root', planRoot, '--id', 'A', '--title', 'First', '--skill-bindings', '[]', '--owned-paths', 'src/a.mjs', '--verification', 'test A',
  ]));
  parsed(await run([
    'add', '--root', planRoot, '--id', 'B', '--title', 'Second', '--skill-bindings', '[]', '--depends-on', 'A', '--owned-paths', 'src/b.mjs', '--verification', 'test B',
  ]));
  assert.equal(parsed(await run(['validate', '--root', planRoot])).valid, true);
  const overview = parsed(await run(['overview', '--root', planRoot]));
  assert.deepEqual(overview.dependency_waves.map((wave) => wave.node_ids), [['A'], ['B']]);
  assert.deepEqual(parsed(await run(['waves', '--root', planRoot])).dispatch_batches.map((batch) => batch.node_ids), [['A']]);
  assert.deepEqual(parsed(await run([
    'waves', '--root', planRoot, '--statuses', JSON.stringify({ A: 'done' }),
  ])).dispatch_batches.map((batch) => batch.node_ids), [['B']]);
});

test('core CLI requires and persists behavior-level skill bindings in every rendered view', async () => {
  const planRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ada-cli-skills-'));
  parsed(await run(['init', '--root', planRoot, '--id', 'skills', '--title', 'Skills']));

  const missing = await run(['add', '--root', planRoot, '--id', 'A', '--title', 'Missing']);
  assert.equal(missing.code, 2);

  const skillBindings = [{
    behavior: 'create a Codex plugin',
    purpose: 'Scaffold the requested plugin.',
    selection_reason: 'The host-visible skill owns plugin creation.',
    execution_order: 1,
    selected_skill: 'plugin-creator',
    alternatives: [{ skill: 'pdf', not_selected_reason: 'PDF handling is unrelated.' }],
    override_reason: 'The user explicitly requested a plugin artifact.',
  }];
  const node = parsed(await run([
    'add', '--root', planRoot, '--id', 'A', '--title', 'Create plugin',
    '--skill-bindings', JSON.stringify(skillBindings),
  ]));
  assert.deepEqual(node.skill_bindings, skillBindings);

  const map = JSON.parse(await fs.readFile(path.join(planRoot, 'map.json'), 'utf8'));
  assert.deepEqual(map.nodes[0].skill_bindings, skillBindings);
  const mapMarkdown = await fs.readFile(path.join(planRoot, 'MAP.md'), 'utf8');
  assert.match(mapMarkdown, /## Skill routing/);
  assert.match(mapMarkdown, /A: create a Codex plugin -> plugin-creator/);
  const brief = await fs.readFile(path.join(planRoot, 'nodes', 'A.md'), 'utf8');
  for (const value of [
    'create a Codex plugin',
    'Scaffold the requested plugin.',
    'The host-visible skill owns plugin creation.',
    'plugin-creator',
    'pdf',
    'PDF handling is unrelated.',
    'The user explicitly requested a plugin artifact.',
  ]) assert.match(brief, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const overview = parsed(await run(['overview', '--root', planRoot]));
  assert.deepEqual(overview.skill_routes, [{ node_id: 'A', ...skillBindings[0] }]);
});

test('core CLI does not expose governance commands', async () => {
  for (const args of [['migrate'], ['posture', 'promote'], ['design', 'start'], ['architecture', 'check'], ['completion', 'check'], ['host', 'sync']]) {
    const result = await run(args);
    assert.equal(result.code, 2);
    assert.doesNotMatch(result.stderr, /migrate|posture|design|architecture|completion|host/i);
  }
});
