import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hookPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'record-event.mjs');
const hooksConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'hooks.json');

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
