#!/usr/bin/env node
import path from 'node:path';
import { loadMap, validateMap } from './lib/plan-protocol.mjs';
import { writeJson } from './lib/stdio.mjs';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : null;
if (!root) {
  console.error('Usage: adaptive-plan validate --root <plan-folder>');
  process.exit(2);
}
try {
  const result = validateMap(await loadMap(path.resolve(root)));
  writeJson(result);
  process.exitCode = result.valid ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ valid: false, errors: [{ code: 'read_error', message: error.message }] }, null, 2));
  process.exitCode = 1;
}
