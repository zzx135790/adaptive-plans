import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillPath = path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'SKILL.md');

test('skill contract exists and names compatibility boundaries', async () => {
  const content = await fs.readFile(skillPath, 'utf8');
  assert.match(content, /writing-plans/);
  assert.match(content, /provider/i);
  assert.match(content, /GUIDE/);
  assert.match(content, /MAP/);
  assert.match(content, /append/i);
  assert.match(content, /do not.*install|not.*auto.?install|never.*auto.?install/i);
});

test('skill contract maps execution progress to Codex without auto-resuming old plans', async () => {
  const content = await fs.readFile(skillPath, 'utf8');
  const execution = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'execution.md'),
    'utf8',
  );
  assert.match(content, /TodoWrite[^\n]*update_plan/i);
  assert.match(content, /explicitly asks to\s+execute or continue a\s+specific plan/i);
  assert.match(content, /new\s+conversation[\s\S]*must not[\s\S]*resume an old plan/i);
  assert.match(content, /exactly one executable task `in_progress`/i);
  assert.match(content, /verification succeeds/i);
  assert.match(execution, /Before the first implementation change/);
});

test('leaf execution is posture-bound, compact-safe, and subtractive before completeness', async () => {
  const skill = await fs.readFile(skillPath, 'utf8');
  const execution = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'execution.md'),
    'utf8',
  );
  const compatibility = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'compatibility.md'),
    'utf8',
  );
  assert.match(skill, /PostureRef[\s\S]*behavior budget[\s\S]*scope provenance/i);
  assert.match(skill, /subtractive first/i);
  assert.match(skill, /hypothetical future reuse[\s\S]*never authorizes production hardening/i);
  assert.match(execution, /stop_and_recover/);
  assert.match(execution, /requires_regeneration: true/);
  assert.match(execution, /Never reuse a pre-compact brief hash/i);
  assert.match(execution, /subtractive scope and provenance review[\s\S]*Check completeness only/i);
  assert.match(compatibility, /persisted[\s\S]*conversation_only[\s\S]*unverified_persistence/);
  assert.match(compatibility, /fresh ApprovalBrief after resume/i);
});

test('Codex entry prompts expose architecture, design, and navigable map outcomes', async () => {
  const agentPrompt = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'agents', 'openai.yaml'),
    'utf8',
  );
  const manifest = JSON.parse(await fs.readFile(
    path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
    'utf8',
  ));

  for (const prompt of [agentPrompt, manifest.interface.defaultPrompt]) {
    assert.match(prompt, /architecture memory/i);
    assert.match(prompt, /Design Gate/i);
    assert.match(prompt, /DAG/i);
    assert.match(prompt, /artifact index/i);
  }
});

test('parallel execution remains gated, coordinator-owned, and sequentially visible', async () => {
  const skill = await fs.readFile(skillPath, 'utf8');
  const execution = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'execution.md'),
    'utf8',
  );
  const compatibility = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'compatibility.md'),
    'utf8',
  );

  assert.match(skill, /execution\.md/);
  assert.match(execution, /Parallelization assessment/);
  assert.match(execution, /Owned paths/);
  assert.match(execution, /Shared resources/);
  assert.match(execution, /Independent verification/);
  assert.match(execution, /single `in_progress` item/);
  assert.match(execution, /Subagents must not call `update_plan`/);
  assert.match(execution, /coordinator-owned queue/);
  assert.match(execution, /falls back to the original sequential workflow/);
  assert.match(compatibility, /Parallel execution/);
  assert.match(compatibility, /coordinator serializes result persistence/);
});

test('map bootstrap preserves the Superpowers leaf-plan contract', async () => {
  const skill = await fs.readFile(skillPath, 'utf8');
  const compatibility = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'compatibility.md'),
    'utf8',
  );
  const prompts = [
    await fs.readFile(
      path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'agents', 'openai.yaml'),
      'utf8',
    ),
    JSON.parse(await fs.readFile(
      path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
      'utf8',
    )).interface.defaultPrompt,
  ];

  assert.match(skill, /For `map`[\s\S]*init-plan\.mjs/);
  assert.match(skill, /For `plan`[\s\S]*writing-plans[\s\S]*YYYY-MM-DD-<feature-name>\.md/);
  assert.match(skill, /For `guide` and `direct`[\s\S]*do\s+not create an adaptive planning folder/i);
  assert.match(skill, /artifact_linked/);
  assert.match(compatibility, /Superpowers artifact boundary/);
  assert.match(compatibility, /writing-plans[\s\S]*Markdown file unchanged/i);
  for (const prompt of prompts) {
    assert.match(prompt, /DAG/i);
    assert.match(prompt, /artifact index/i);
  }
});

test('architecture memory and design are separate canonical, re-entrant gates', async () => {
  const skill = await fs.readFile(skillPath, 'utf8');
  const architecture = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'architecture-memory.md'),
    'utf8',
  );
  const design = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'design-gate.md'),
    'utf8',
  );
  const folder = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'plan-folder-protocol.md'),
    'utf8',
  );
  assert.match(skill, /design.*re-entrant gate, not a fifth route/i);
  assert.match(architecture, /belongs to the project, not a plan or conversation/i);
  assert.match(architecture, /architecture check --base <base> --head <head>/i);
  assert.match(design, /Design is a gate, not a route/i);
  assert.match(design, /exact `design_hash`/);
  assert.match(folder, /full ASCII DAG/i);
  assert.match(folder, /complete artifact index/i);
  assert.match(folder, /independent\s+canonical states/i);
});

test('terminal workflow documents bootstrap, posture stopping, recovery, and composition outcomes', async () => {
  const readme = await fs.readFile(path.join(pluginRoot, 'README.md'), 'utf8');
  const skill = await fs.readFile(skillPath, 'utf8');
  const folder = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'plan-folder-protocol.md'),
    'utf8',
  );
  const compatibility = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'references', 'compatibility.md'),
    'utf8',
  );

  assert.match(readme, /N-000 bootstrap/);
  assert.match(readme, /Root design/i);
  assert.match(readme, /child design/i);
  assert.match(readme, /leaf-first/i);
  for (const posture of ['spike', 'experiment', 'reusable_internal', 'production']) {
    assert.match(readme, new RegExp(`\\b${posture}\\b`));
  }
  assert.match(skill, /distinct definitions of done/i);
  assert.match(folder, /--apply --expected-hash/);
  assert.match(folder, /--recover <migration-id> --expected-current-hash/);
  assert.match(compatibility, /dependency_not_ready/);
  assert.match(compatibility, /version_digest_drift/);
  assert.match(compatibility, /invocation_not_completed/);
  assert.match(compatibility, /expected_artifact_not_observed/);
});
