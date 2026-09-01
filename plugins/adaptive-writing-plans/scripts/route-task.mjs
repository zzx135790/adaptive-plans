#!/usr/bin/env node
import { routePlanning } from './lib/planning-engine.mjs';
import { readStdin, writeJson } from './lib/stdio.mjs';

const input = await readStdin();
let signals;
try {
  signals = JSON.parse(input || '{}');
} catch (error) {
  console.error(`Invalid JSON: ${error.message}`);
  process.exit(2);
}
writeJson(routePlanning(signals, signals.visible_providers));
