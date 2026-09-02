#!/usr/bin/env node
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { analyzeArchitectureImpact, validateArchitectureImpact } from './lib/architecture-impact.mjs';
import { defaultArchitectureRoot, loadArchitecture } from './lib/architecture-protocol.mjs';
import { readJson, writeJsonAtomic } from './lib/io-utils.mjs';
import { readStdin, writeJson } from './lib/stdio.mjs';

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replaceAll('-', '_');
    result[key] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

async function changedPaths(args, projectRoot) {
  if (args.changed) return String(args.changed).split(',').filter(Boolean);
  if (args.base && args.head) {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', args.base, args.head], { cwd: projectRoot });
    return stdout.split(/\r?\n/).filter(Boolean);
  }
  const input = await readStdin();
  if (!input.trim()) throw new Error('provide --base/--head, --changed, or changed paths on stdin');
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : parsed.changed_paths;
  } catch {
    return input.split(/\r?\n/).filter(Boolean);
  }
}

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.project_root ?? process.cwd());
const architectureRoot = path.resolve(args.architecture_root ?? defaultArchitectureRoot(projectRoot));

try {
  const architecture = await loadArchitecture(architectureRoot);
  const changed = await changedPaths(args, projectRoot);
  const proposed = analyzeArchitectureImpact(architecture, changed);
  if (args.write_impact) await writeJsonAtomic(path.resolve(args.write_impact), proposed);
  if (!args.impact) {
    writeJson({ valid: false, impact: proposed, errors: [{ code: 'impact_evidence_required', message: 'satisfy and provide an ArchitectureImpact artifact' }] });
    process.exitCode = 1;
  } else {
    const impact = await readJson(path.resolve(args.impact));
    const actual = [...new Set(proposed.changed_paths)].sort();
    const recorded = [...new Set(impact.changed_paths ?? [])].sort();
    const validation = validateArchitectureImpact(impact, architecture);
    if (JSON.stringify(actual) !== JSON.stringify(recorded)) validation.errors.push({ code: 'changed_paths_mismatch', message: 'impact changed_paths do not match the current diff' });
    validation.valid = validation.errors.length === 0;
    writeJson({ ...validation, impact_id: impact.impact_id });
    if (!validation.valid) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
