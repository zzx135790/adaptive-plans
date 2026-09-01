#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson, readJsonIfExists } from './lib/io-utils.mjs';
import { checkPostureMap } from './lib/posture-operations.mjs';

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    parsed[argv[index].slice(2).replaceAll('-', '_')] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root && !args.map) {
  console.error('Usage: node scripts/posture-check.mjs (--root <plan-folder> | --map <map.json>) [--node <id>] [--design <design.json>] [--input <options.json>]');
  process.exit(2);
}

try {
  const root = args.root ? path.resolve(args.root) : path.dirname(path.resolve(args.map));
  const map = await readJson(args.map ? path.resolve(args.map) : path.join(root, 'map.json'));
  const input = args.input ? await readJson(path.resolve(args.input)) : {};
  let stdin = '';
  if (!process.stdin.isTTY && !args.input) for await (const chunk of process.stdin) stdin += chunk;
  const supplied = stdin.trim() ? JSON.parse(stdin) : input;
  const designDocument = args.design
    ? await readJson(path.resolve(args.design))
    : await readJsonIfExists(path.join(root, 'design.json'));
  const result = checkPostureMap(map, {
    ...supplied,
    nodeId: args.node ?? supplied.nodeId ?? supplied.node_id,
    designDocument: supplied.designDocument ?? designDocument,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

