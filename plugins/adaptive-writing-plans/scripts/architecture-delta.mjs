#!/usr/bin/env node
import path from 'node:path';

import {
  applyArchitectureDelta,
  loadArchitecture,
  proposeArchitectureDelta,
} from './lib/architecture-protocol.mjs';
import { readJson } from './lib/io-utils.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2).replaceAll('-', '_')] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

const [action, ...argv] = process.argv.slice(2);
const args = parseArgs(argv);
if (!args.architecture_root || !['propose', 'apply'].includes(action)) {
  console.error('Usage: adaptive-plan architecture propose|apply --architecture-root <folder> [options]');
  process.exit(2);
}
try {
  const root = path.resolve(args.architecture_root);
  if (action === 'propose') {
    if (!args.proposed) throw new Error('--proposed is required');
    const details = args.details ? await readJson(path.resolve(args.details)) : {};
    const result = proposeArchitectureDelta(
      await loadArchitecture(root),
      await readJson(path.resolve(args.proposed)),
      details,
    );
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (!args.delta || !args.approval) throw new Error('--delta and --approval are required');
    const result = await applyArchitectureDelta(root, await readJson(path.resolve(args.delta)), {
      approval: { source: 'user', statement: args.approval },
    });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

