#!/usr/bin/env node
import { triageTask } from './lib/planning-engine.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let signals;
try {
  signals = JSON.parse(input || '{}');
} catch (error) {
  console.error(`Invalid JSON: ${error.message}`);
  process.exit(2);
}
console.log(JSON.stringify(triageTask(signals), null, 2));
