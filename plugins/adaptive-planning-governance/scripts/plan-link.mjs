#!/usr/bin/env node
import path from 'node:path';

import { loadArchitecture } from './lib/architecture-protocol.mjs';
import { loadDesign } from './lib/design-engine.mjs';
import { readJson } from './lib/io-utils.mjs';
import {
  linkApprovedDesign,
  linkArchitectureSnapshot,
  recordArchitectureImpact,
} from './lib/planning-engine.mjs';
import { writeJson } from './lib/stdio.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2).replaceAll('-', '_')] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

const [action, ...argv] = process.argv.slice(2);
const args = parseArgs(argv);
if (!args.root || !['architecture', 'design', 'impact'].includes(action)) {
  console.error('Usage: adaptive-plan plan link-architecture|link-design|record-impact --root <plan-folder> [options]');
  process.exit(2);
}

try {
  const root = path.resolve(args.root);
  let result;
  if (action === 'architecture') {
    if (!args.architecture_root) throw new Error('--architecture-root is required');
    result = await linkArchitectureSnapshot(root, await loadArchitecture(path.resolve(args.architecture_root)));
  } else if (action === 'design') {
    result = await linkApprovedDesign(root, await loadDesign(root));
  } else {
    if (!args.impact) throw new Error('--impact is required');
    result = await recordArchitectureImpact(root, await readJson(path.resolve(args.impact)), args.artifact_path ?? null);
  }
  writeJson(result);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
