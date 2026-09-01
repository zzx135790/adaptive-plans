#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';

import { loadMap, validatePlanCompletion } from './lib/plan-protocol.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
if (rootIndex < 0 || !args[rootIndex + 1]) {
  console.error('Usage: adaptive-plan completion check --root <plan-folder>');
  process.exit(2);
}
try {
  const root = path.resolve(args[rootIndex + 1]);
  let designDocument = null;
  try { designDocument = JSON.parse(await fs.readFile(path.join(root, 'design.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = validatePlanCompletion(await loadMap(root), { designDocument });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
