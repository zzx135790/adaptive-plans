#!/usr/bin/env node
import { validateProviderResult } from './lib/plan-protocol.mjs';

const strict = process.argv.includes('--strict');
let input = '';
for await (const chunk of process.stdin) input += chunk;
let value;
try {
  value = JSON.parse(input || 'null');
} catch (error) {
  process.stderr.write(`Invalid JSON: ${error.message}\n`);
  process.exit(2);
}
const result = validateProviderResult(value, { strict });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.valid ? 0 : 1;
