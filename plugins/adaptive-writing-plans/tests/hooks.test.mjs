import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hookPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'record-event.mjs');
const hooksConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'hooks.json');
const scriptPath = '/usr/bin/script';

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

test('hooks config uses the host-neutral Codex schema shape', async () => {
  const config = JSON.parse(await readFile(hooksConfigPath, 'utf8'));
  assert.deepEqual(Object.keys(config), ['hooks']);
  assert.equal('$schema' in config, false);
  assert.equal(typeof config.hooks.PostToolUse, 'object');
});

test('command hooks use complete executable strings supported by Codex', async () => {
  const config = JSON.parse(await readFile(hooksConfigPath, 'utf8'));
  const commandHooks = Object.values(config.hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks ?? []),
  ).filter((hook) => hook.type === 'command');

  assert.ok(commandHooks.length > 0);
  for (const hook of commandHooks) {
    assert.equal(typeof hook.command, 'string');
    assert.match(hook.command, /record-event\.mjs/);
    assert.equal('args' in hook, false);
  }
});

test('record-event hook appends facts and never changes map status', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-'));
  const child = spawn(process.execPath, [hookPath, '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(JSON.stringify({ event_id: 'hook-1', type: 'test_result', message: 'passed' }));
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(exitCode, 0);
  const events = await readFile(path.join(root, 'events.jsonl'), 'utf8');
  assert.match(events, /hook-1/);
});

test('record-event hook accepts a host wrapper and derives an idempotent fact id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-wrapper-'));
  const child = spawn(process.execPath, [hookPath, '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(JSON.stringify({ event: { type: 'checkpoint', message: 'turn ended', source: 'codex' } }));
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(exitCode, 0);
  const events = await readFile(path.join(root, 'events.jsonl'), 'utf8');
  assert.match(events, /checkpoint/);
  assert.match(events, /hook-/);
});

test('record-event hook derives the root from a native Codex cwd when --root is omitted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-codex-cwd-'));
  const child = spawn(process.execPath, [hookPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(JSON.stringify({ hook_event_name: 'PostCompact', cwd: root, turn_id: 'turn-1' }));
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(exitCode, 0);
  const events = await readFile(path.join(root, 'events.jsonl'), 'utf8');
  assert.match(events, /PostCompact/);
});

test('record-event hook derives a plan root from tool context when available', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-project-root-'));
  const eventRoot = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-tool-cwd-'));
  const planRoot = path.join(projectRoot, 'docs', 'plans', 'example');
  const child = spawn(process.execPath, [hookPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(JSON.stringify({
    hook_event_name: 'PostToolUse',
    cwd: eventRoot,
    tool_input: { context: { project_root: projectRoot, plan_path: 'docs/plans/example' } },
  }));
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(exitCode, 0);
  await readFile(path.join(planRoot, 'events.jsonl'), 'utf8');
  await assert.rejects(readFile(path.join(eventRoot, 'events.jsonl'), 'utf8'));
});

test('record-event hook gives an explicit --root precedence over event context', async () => {
  const explicitRoot = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-explicit-root-'));
  const eventRoot = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-event-root-'));
  const child = spawn(process.execPath, [hookPath, '--root', explicitRoot], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', cwd: eventRoot, turn_id: 'turn-2' }));
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(exitCode, 0);
  await readFile(path.join(explicitRoot, 'events.jsonl'), 'utf8');
  await assert.rejects(readFile(path.join(eventRoot, 'events.jsonl'), 'utf8'));
});

test('record-event hook reads payloads from a pseudo-terminal stdin', {
  skip: process.platform === 'win32' || !existsSync(scriptPath),
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-pty-'));
  const command = `${shellQuote(process.execPath)} ${shellQuote(hookPath)} --root ${shellQuote(root)}`;
  const payload = JSON.stringify({ event: { type: 'turn_ended', message: 'Turn completed' } });
  const shellCommand = `printf '%s\\n' ${shellQuote(payload)} | ${shellQuote(scriptPath)} -qefc ${shellQuote(command)} /dev/null`;
  const child = spawn('/bin/sh', ['-c', shellCommand], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  assert.equal(exitCode, 0, stderr);
  const events = await readFile(path.join(root, 'events.jsonl'), 'utf8');
  assert.match(events, /turn_ended/);
});

test('record-event hook exits cleanly when stdin is unavailable', {
  skip: process.platform === 'win32',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-closed-stdin-'));
  const launcher = [
    "import fs from 'node:fs';",
    'fs.closeSync(0);',
    `process.argv = [process.execPath, ${JSON.stringify(hookPath)}, '--root', ${JSON.stringify(root)}];`,
    `await import(${JSON.stringify(pathToFileURL(hookPath).href)});`,
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', launcher], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  assert.equal(exitCode, 0, stderr);
});
