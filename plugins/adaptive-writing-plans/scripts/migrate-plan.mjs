#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';

import { applyPlanMigration, previewPlanMigration, recoverPlanMigration } from './lib/migration-protocol.mjs';
import { writeJson } from './lib/stdio.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    result[token.slice(2).replaceAll('-', '_')] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root) {
  console.error('Usage: adaptive-plan migrate --root <plan-folder> [--apply --expected-hash <proposal-hash> | --recover <migration-id> --expected-current-hash <map-hash>]');
  process.exit(2);
}

try {
  const root = path.resolve(args.root);
  const postureRef = args.posture_ref_file
    ? JSON.parse(await fs.readFile(path.resolve(args.posture_ref_file), 'utf8'))
    : args.posture_ref ? JSON.parse(args.posture_ref) : undefined;
  let result;
  if (args.recover) {
    result = await recoverPlanMigration(root, args.recover, { expectedCurrentMapHash: args.expected_current_hash });
  } else {
    const proposal = await previewPlanMigration(root, { includeDesign: args.include_design === true, postureRef });
    result = args.apply
      ? await applyPlanMigration(root, proposal, { expectedProposalHash: args.expected_hash })
      : proposal;
  }
  writeJson(result);
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? 'MIGRATION_ERROR', message: error.message }));
  process.exitCode = 1;
}
