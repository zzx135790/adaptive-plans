import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('skill and README describe the lean direct-first planning and execution core', async () => {
  const skill = await fs.readFile(path.join(root, 'skills', 'adaptive-writing-plans', 'SKILL.md'), 'utf8');
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  const metadata = await fs.readFile(path.join(root, 'skills', 'adaptive-writing-plans', 'agents', 'openai.yaml'), 'utf8');
  const joined = `${skill}\n${readme}\n${metadata}`;

  for (const phrase of [
    'direct-first',
    'visible skills',
    'Ada fallback',
    'required',
    'excluded',
    'deferred_candidates',
    'bound_runaway_resource_cost',
    'fail_loud_on_invalid_results',
    'prevent_credential_exposure',
    'prevent_destructive_data_loss',
    'disjoint owned paths',
    'token cost',
    'coordinates and integrates',
  ]) assert.match(joined, new RegExp(phrase, 'i'), phrase);

  assert.match(skill, /long-running work alone stays\s+direct/i);
  assert.match(skill, /do not create a planning artifact/i);
  assert.match(skill, /unknown extension fields/i);
  assert.doesNotMatch(joined, /architecture memory|design ledger|design gate|engineering posture|posture promotion|recovery workflow|strict completion|MCP server|hook lifecycle/i);
});
