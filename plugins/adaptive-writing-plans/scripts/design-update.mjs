#!/usr/bin/env node
import path from 'node:path';

import { updateDesignRevision } from './lib/design-engine.mjs';
import { readStdin, writeJson } from './lib/stdio.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2).replaceAll('-', '_')] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.expected_hash) {
  console.error('Usage: adaptive-plan design update --root <plan-folder> --expected-hash <hash> < updates.json');
  process.exit(2);
}
const input = await readStdin();
try {
  const updates = JSON.parse(input || '{}');
  writeJson(await updateDesignRevision(path.resolve(args.root), updates, {
    expectedHash: args.expected_hash,
  }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
