import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { analyzeArchitectureImpact } from '../scripts/lib/architecture-impact.mjs';
import { writeArchitecture } from '../scripts/lib/architecture-protocol.mjs';

const execFileAsync = promisify(execFile);
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function git(project, ...args) {
  return execFileAsync('git', args, { cwd: project });
}

test('architecture required check validates the exact base/head diff and evidence artifact', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-architecture-ci-'));
  await git(project, 'init');
  await git(project, 'config', 'user.name', 'Adaptive Test');
  await git(project, 'config', 'user.email', 'adaptive@example.invalid');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'internal.js'), 'export const value = 1;\n');
  const architectureRoot = path.join(project, 'docs', 'architecture', 'adaptive');
  const architecture = await writeArchitecture(architectureRoot, {
    schema_version: '2.0',
    project_id: 'ci-project',
    revision: 1,
    status: 'approved',
    modules: [{
      id: 'core',
      purpose: 'Own the core implementation',
      non_goals: [],
      owners: ['platform'],
      owned_paths: ['src/**'],
      public_boundaries: [],
      invariants: [],
      dependencies: [],
      required_concerns: [],
      concerns: {},
      source_refs: [],
    }],
    relations: [],
    coverage: { include_paths: ['src/**'], ignore_paths: ['docs/**'] },
  });
  await git(project, 'add', '.');
  await git(project, 'commit', '-m', 'base');
  await fs.writeFile(path.join(project, 'src', 'internal.js'), 'export const value = 2;\n');
  await git(project, 'add', '.');
  await git(project, 'commit', '-m', 'head');
  const { stdout: head } = await git(project, 'rev-parse', 'HEAD');
  const { stdout: base } = await git(project, 'rev-parse', 'HEAD^');

  const impact = analyzeArchitectureImpact(architecture, ['src/internal.js'], {
    evidence: ['unit and contract tests passed'],
  });
  const impactPath = path.join(project, 'impact.json');
  await fs.writeFile(impactPath, JSON.stringify(impact));
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(pluginRoot, 'scripts', 'architecture-check.mjs'),
    '--project-root', project,
    '--base', base.trim(),
    '--head', head.trim(),
    '--impact', impactPath,
  ]);
  assert.equal(JSON.parse(stdout).valid, true);

  const mismatched = { ...impact, changed_paths: ['src/other.js'] };
  await fs.writeFile(impactPath, JSON.stringify(mismatched));
  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(pluginRoot, 'scripts', 'architecture-check.mjs'),
      '--project-root', project,
      '--base', base.trim(),
      '--head', head.trim(),
      '--impact', impactPath,
    ]),
    (error) => {
      assert.match(error.stdout, /changed_paths_mismatch/);
      return true;
    },
  );
});

test('CI template exposes a stable required-check name and base/head invocation', async () => {
  const workflow = await fs.readFile(path.join(pluginRoot, 'assets', 'ci', 'adaptive-architecture-check.yml'), 'utf8');
  assert.match(workflow, /name: adaptive-architecture/);
  assert.match(workflow, /architecture check/);
  assert.match(workflow, /--base/);
  assert.match(workflow, /--head/);
  assert.match(workflow, /--impact/);
});
