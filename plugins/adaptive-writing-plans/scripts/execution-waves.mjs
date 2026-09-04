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
  const nodesById = new Map();
  for (const node of runtimeMap.nodes) {
    if (!nodesById.has(node.id)) nodesById.set(node.id, node);
  }
  for (const [nodeId, status] of Object.entries(statuses)) {
    const node = nodesById.get(nodeId);
    if (!node) throw new Error(`unknown runtime node ${nodeId}`);
    node.status = String(status);
  }
  writeJson(evaluateExecutionSafeWaves(runtimeMap));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
