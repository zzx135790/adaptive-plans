#!/usr/bin/env node
import { normalizeHandoff, validateHandoff } from './lib/plan-protocol.mjs';

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
  value = JSON.parse(input || '{}');
} catch (error) {
  process.stderr.write(`Invalid JSON: ${error.message}\n`);
  process.exit(2);
}

const defaults = {};
for (const key of ['source', 'mode', 'next_skill']) {
  if (args[key] !== undefined) defaults[key] = args[key];
}
const candidate = value && typeof value === 'object' && !Array.isArray(value)
  ? { ...value, ...defaults }
  : value;
if (args.strict) {
  const before = validateHandoff(candidate, { partial: true });
  if (!before.valid) {
    process.stdout.write(`${JSON.stringify(before, null, 2)}\n`);
    process.exit(1);
  }
}
const normalized = normalizeHandoff(value, defaults);
const validation = validateHandoff(normalized, { strict: Boolean(args.strict) });
if (!validation.valid) {
  process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`);
