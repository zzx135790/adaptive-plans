#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { currentCanonicalDesignRef, reviseCanonicalDesign } from './lib/design-operations.mjs';
import { loadDesignLedger } from './lib/design-ledger.mjs';
import { readJson } from './lib/io-utils.mjs';
import { invalidateFromDesignRevision } from './lib/planning-engine.mjs';
import { writeJson } from './lib/stdio.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2).replaceAll('-', '_')] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.reason) {
  console.error('Usage: adaptive-plan design revise --root <plan-folder> --reason <evidence> [--question <blocking-question>] [--details <json>]');
  process.exit(2);
}
try {
  const root = path.resolve(args.root);
  const current = currentCanonicalDesignRef(await loadDesignLedger(root));
  const details = args.details ? await readJson(path.resolve(args.details)) : {};
  const revised = await reviseCanonicalDesign(root, {
    ...details,
    reason: args.reason,
    blocking_questions: args.question ? [args.question] : details.blocking_questions,
  });
  try {
    await fs.access(path.join(root, 'map.json'));
    await invalidateFromDesignRevision(root, {
      design_id: revised.design_id,
      thread_id: current.thread_id,
      revision: current.revision,
      design_hash: current.design_hash,
    }, { reason: args.reason });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  writeJson(revised);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
