#!/usr/bin/env node
import path from 'node:path';

import { recordDesignProviderResult } from './lib/design-engine.mjs';
import { normalizeProviderResult } from './lib/plan-protocol.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2).replaceAll('-', '_')] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.expected_hash || !args.provider || !args.capability) {
  console.error('Usage: adaptive-plan design record --root <plan-folder> --expected-hash <hash> --provider <id> --capability design < result.json');
  process.exit(2);
}
let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const normalized = normalizeProviderResult(JSON.parse(input || '{}'), {
    provider_id: args.provider,
    capability: args.capability,
    source: args.source,
  });
  console.log(JSON.stringify(await recordDesignProviderResult(path.resolve(args.root), normalized, {
    expectedHash: args.expected_hash,
  }), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

