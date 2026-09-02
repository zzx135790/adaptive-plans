#!/usr/bin/env node
import path from 'node:path';

import { addCanonicalDesignThread } from './lib/design-operations.mjs';
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
  console.error('Usage: adaptive-plan design add-thread --root <plan-folder> --expected-hash <document-state-hash> < thread.json');
  process.exit(2);
}

try {
  const input = JSON.parse(await readStdin() || '{}');
  writeJson(await addCanonicalDesignThread(path.resolve(args.root), input, {
    expectedHash: args.expected_hash,
  }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
