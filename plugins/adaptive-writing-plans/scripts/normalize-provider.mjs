#!/usr/bin/env node
import { normalizeProviderResult } from './lib/plan-protocol.mjs';
import { validateProviderResult } from './lib/plan-protocol.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replaceAll('-', '_');
    if (key === 'strict') result.strict = true;
    else result[key] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

let input = '';
for await (const chunk of process.stdin) input += chunk;
let value;
try {
  value = JSON.parse(input || 'null');
} catch {
  value = input;
}
const result = normalizeProviderResult(value, {
  provider_id: args.provider ?? process.env.ADAPTIVE_PROVIDER_ID,
  capability: args.capability ?? process.env.ADAPTIVE_PROVIDER_CAPABILITY,
  source: args.source ?? process.env.ADAPTIVE_PROVIDER_SOURCE,
});
const validation = validateProviderResult(result, { strict: Boolean(args.strict) });
if (!validation.valid) {
  console.log(JSON.stringify(validation, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result, null, 2));
}
