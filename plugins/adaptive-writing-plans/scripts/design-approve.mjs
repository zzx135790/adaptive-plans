#!/usr/bin/env node
import path from 'node:path';

import { approveDesign } from './lib/design-engine.mjs';

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

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.approval || !args.expected_hash) {
  console.error('Usage: node scripts/design-approve.mjs --root <plan-folder> --approval <statement> --expected-hash <hash> [--expected-posture-hash <hash>] [--brief-hash <hash>] [--waiver <reason>]');
  process.exit(2);
}
try {
  const result = await approveDesign(path.resolve(args.root), {
    expectedHash: args.expected_hash,
    approval: { source: 'user', statement: args.approval },
    expectedPostureHash: args.expected_posture_hash,
    briefHash: args.brief_hash,
    waiver: args.waiver ? { reason: args.waiver } : null,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
