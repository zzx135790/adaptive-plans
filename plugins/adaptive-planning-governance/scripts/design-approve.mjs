#!/usr/bin/env node
import path from 'node:path';

import { approveCanonicalDesign } from './lib/design-operations.mjs';
import { writeJson } from './lib/stdio.mjs';

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
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
if (!args.root || !args.approval || !args.expected_hash
  || !validHash(args.expected_posture_hash) || !validHash(args.brief_hash)) {
  console.error('Usage: node scripts/design-approve.mjs --root <plan-folder> [--thread <thread-id>] --approval <statement> --expected-hash <hash> --expected-posture-hash <hash> --brief-hash <hash> [--waiver <reason>]');
  process.exit(2);
}
try {
  const result = await approveCanonicalDesign(path.resolve(args.root), {
    expectedHash: args.expected_hash,
    threadId: args.thread,
    approval: { source: 'user', statement: args.approval },
    expectedPostureHash: args.expected_posture_hash,
    briefHash: args.brief_hash,
    waiver: args.waiver ? { reason: args.waiver } : null,
  });
  writeJson(result);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
