#!/usr/bin/env node
import path from 'node:path';

import { evaluateExecutionSafeWaves } from './lib/execution-protocol.mjs';
import { loadMap } from './lib/plan-protocol.mjs';
import { writeJson } from './lib/stdio.mjs';

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const root = valueAfter('--root');
if (!root) {
  console.error('Usage: adaptive-plan waves --root <plan-folder> [--statuses <json>]');
  process.exit(2);
}

try {
  const map = await loadMap(path.resolve(root));
  const statuses = JSON.parse(valueAfter('--statuses') ?? '{}');
  if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) throw new Error('--statuses must be a JSON object');
  const runtimeMap = structuredClone(map);
  const known = new Set(runtimeMap.nodes.map((node) => node.id));
  for (const [nodeId, status] of Object.entries(statuses)) {
    if (!known.has(nodeId)) throw new Error(`unknown runtime node ${nodeId}`);
    runtimeMap.nodes.find((node) => node.id === nodeId).status = String(status);
  }
  writeJson(evaluateExecutionSafeWaves(runtimeMap));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
