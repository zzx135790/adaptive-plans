#!/usr/bin/env node
import path from 'node:path';
import { loadMap, validateMap } from './lib/plan-protocol.mjs';
import { writeJson } from './lib/stdio.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replaceAll('-', '_');
    if (key === 'strict') result[key] = true;
    else result[key] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root) {
  console.error('Usage: node scripts/validate-plan.mjs --root <plan-folder> [--strict]');
  process.exit(2);
}

try {
  const result = validateMap(await loadMap(path.resolve(args.root)), { strict: Boolean(args.strict) });
  writeJson(result);
  process.exitCode = result.valid ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ valid: false, errors: [{ code: 'read_error', message: error.message }] }, null, 2));
  process.exitCode = 1;
}
