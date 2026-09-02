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
