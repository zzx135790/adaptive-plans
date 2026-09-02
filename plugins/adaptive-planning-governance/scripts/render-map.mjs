#!/usr/bin/env node
import path from 'node:path';
import { loadMap, renderMapMarkdown } from './lib/plan-protocol.mjs';
import fs from 'node:fs/promises';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : null;
if (!root) {
  console.error('Usage: node scripts/render-map.mjs --root <plan-folder>');
  process.exit(2);
}
const planRoot = path.resolve(root);
const map = await loadMap(planRoot);
await fs.writeFile(path.join(planRoot, 'MAP.md'), renderMapMarkdown(map), 'utf8');
console.log(path.join(planRoot, 'MAP.md'));
