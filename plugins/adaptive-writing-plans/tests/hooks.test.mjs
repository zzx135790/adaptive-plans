import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hookPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'record-event.mjs');

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
