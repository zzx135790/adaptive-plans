#!/usr/bin/env node
import path from 'node:path';
import { buildPlanOverview } from './lib/plan-protocol.mjs';
import { writeJson } from './lib/stdio.mjs';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : null;
if (!root) {
  console.error('Usage: adaptive-plan overview --root <plan-folder>');
  process.exit(2);
}
try {
  writeJson(await buildPlanOverview(path.resolve(root)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
