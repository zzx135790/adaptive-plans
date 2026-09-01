#!/usr/bin/env node
import path from 'node:path';
import { ingestProviderResult } from './lib/planning-engine.mjs';

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
if (!args.root || !args.provider || !args.capability) {
  console.error('Usage: node scripts/ingest-provider.mjs --root <plan-folder> --provider <id> --capability <slot> [JSON on stdin]');
  process.exit(2);
}
let input = '';
for await (const chunk of process.stdin) input += chunk;
let value;
try { value = JSON.parse(input || 'null'); } catch { value = input; }
const result = await ingestProviderResult(path.resolve(args.root), value, {
  provider_id: args.provider,
  capability: args.capability,
  source: args.source,
});
console.log(JSON.stringify(result, null, 2));
