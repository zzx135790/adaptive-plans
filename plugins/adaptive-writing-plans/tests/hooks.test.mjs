import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPlanManifest } from '../scripts/lib/plan-protocol.mjs';

const hookPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'record-event.mjs');
const hooksConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'hooks.json');
const scriptPath = '/usr/bin/script';

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function createPlanRoot(prefix = 'adaptive-hook-plan-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await createPlanManifest(root);
  return root;
}

async function runHook(payload, args = []) {
  const child = spawn(process.execPath, [hookPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdin.end(payload === undefined ? undefined : JSON.stringify(payload));
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  return { exitCode, stdout, stderr };
}

async function readEvents(root) {
  return (await readFile(path.join(root, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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
    assert.equal('stdin' in hook, false);
  }
});

test('native Codex Stop input emits only empty control JSON and skips without a plan root', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-codex-cwd-'));
  const result = await runHook({
    hook_event_name: 'Stop',
    session_id: 'session-sensitive',
    turn_id: 'turn-1',
    cwd,
    transcript_path: '/private/transcript.jsonl',
    last_assistant_message: 'private response',
    tool_result: { secret: 'do-not-store' },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{}\n');
  assert.equal(existsSync(path.join(cwd, 'events.jsonl')), false);
});

test('native Codex Stop input appends when cwd is a valid plan root', async () => {
  const root = await createPlanRoot('adaptive-hook-codex-plan-cwd-');
  const result = await runHook({
    hook_event_name: 'Stop',
    session_id: 'session-1',
    turn_id: 'turn-1',
    cwd: root,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{}\n');
  const [event] = await readEvents(root);
  assert.equal(event.type, 'Stop');
  assert.equal(event.source, 'codex-hook');
});

test('native Codex Stop input appends a sanitized event to an explicit valid plan root', async () => {
  const root = await createPlanRoot();
  const result = await runHook({
    hook_event_name: 'Stop',
    session_id: 'session-1',
    turn_id: 'turn-1',
    tool_name: 'mcp__adaptive-planning__plan_add_node',
    cwd: '/unrelated/cwd',
    transcript_path: '/private/transcript.jsonl',
    last_assistant_message: 'private response',
    payload: { session_payload: 'do-not-store' },
    tool_result: { secret: 'do-not-store' },
  }, ['--root', root]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{}\n');
  const [event] = await readEvents(root);
  assert.equal(event.type, 'Stop');
  assert.equal(event.source, 'codex-hook');
  assert.match(event.event_id, /^hook-/);
  const persisted = JSON.stringify(event);
  for (const sensitiveValue of ['/private/transcript.jsonl', 'private response', 'do-not-store', '/unrelated/cwd']) {
    assert.equal(persisted.includes(sensitiveValue), false);
  }
  assert.equal('transcript_path' in event, false);
  assert.equal('last_assistant_message' in event, false);
  assert.equal('payload' in event, false);
  assert.equal('tool_result' in event, false);
});

test('record-event hook derives a valid plan root from host tool context when available', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-project-root-'));
  const eventRoot = await mkdtemp(path.join(os.tmpdir(), 'adaptive-hook-tool-cwd-'));
  const planRoot = path.join(projectRoot, 'docs', 'plans', 'example');
  await createPlanManifest(planRoot);
  const result = await runHook({
    hook_event_name: 'PostToolUse',
    cwd: eventRoot,
    tool_input: { context: { project_root: projectRoot, plan_path: 'docs/plans/example' } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{}\n');
  const [event] = await readEvents(planRoot);
  assert.equal(event.type, 'PostToolUse');
  await assert.rejects(readFile(path.join(eventRoot, 'events.jsonl'), 'utf8'));
});

test('record-event hook is idempotent for replay and distinguishes Codex turns', async () => {
  const root = await createPlanRoot();
  const base = { hook_event_name: 'Stop', session_id: 'session-1', tool_name: 'tool-a' };
  const first = await runHook({ ...base, turn_id: 'turn-1' }, ['--root', root]);
  const replay = await runHook({ ...base, turn_id: 'turn-1' }, ['--root', root]);
  const distinct = await runHook({ ...base, turn_id: 'turn-2' }, ['--root', root]);

  assert.equal(first.stdout, '{}\n');
  assert.equal(replay.stdout, '{}\n');
  assert.equal(distinct.stdout, '{}\n');
  const events = await readEvents(root);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].event_id, events[1].event_id);
});

test('record-event hook returns empty control JSON after malformed audit input', async () => {
  const child = spawn(process.execPath, [hookPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stdin.end('{not-json');
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(exitCode, 0);
  assert.equal(stdout, '{}\n');
});

test('record-event hook reads payloads from a pseudo-terminal stdin', {
  skip: process.platform === 'win32' || !existsSync(scriptPath),
}, async () => {
  const root = await createPlanRoot('adaptive-hook-pty-');
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
  const [event] = await readEvents(root);
  assert.equal(event.type, 'turn_ended');
});

test('record-event hook exits cleanly when stdin is unavailable', {
  skip: process.platform === 'win32',
}, async () => {
  const root = await createPlanRoot('adaptive-hook-closed-stdin-');
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
