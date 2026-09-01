#!/usr/bin/env node
import path from 'node:path';
import { invalidateFromEvidence } from './lib/planning-engine.mjs';
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
if (!args.root || !args.node || !args.message) {
  console.error('Usage: node scripts/invalidate-node.mjs --root <plan-folder> --node N-001 --message <evidence> [--source <source>] [--decision <decision>]');
  process.exit(2);
}
const result = await invalidateFromEvidence(path.resolve(args.root), args.node, {
  source: args.source,
  message: args.message,
  decision: args.decision,
});
writeJson({ affected: result.affected, next: result.next.map((node) => node.id) });
