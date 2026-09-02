#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from './lib/io-utils.mjs';
import { applyPosturePromotion, previewPosturePromotion } from './lib/posture-operations.mjs';
import { readStdin, writeJson } from './lib/stdio.mjs';

function parseArgs(argv) {
  const parsed = { mode: ['preview', 'apply'].includes(argv[0]) ? argv[0] : null };
  for (let index = parsed.mode ? 1 : 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--preview') { parsed.mode = 'preview'; continue; }
    if (token === '--apply') { parsed.mode = 'apply'; continue; }
    if (!token.startsWith('--')) continue;
    parsed[token.slice(2).replaceAll('-', '_')] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}

async function stdinJson() {
  const raw = await readStdin();
  return raw.trim() ? JSON.parse(raw) : null;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.mode) {
  console.error('Usage: node scripts/posture-promote.mjs <preview|apply> --root <plan-folder> [--input <target.json> | --proposal <proposal.json>]');
  process.exit(2);
}

try {
  const root = path.resolve(args.root);
  if (args.mode === 'preview') {
    const map = await readJson(path.join(root, 'map.json'));
    const input = args.input ? await readJson(path.resolve(args.input)) : await stdinJson();
    if (!input) throw new Error('posture promotion preview requires target JSON');
    writeJson(previewPosturePromotion(map, input));
  } else {
    const proposal = args.proposal ? await readJson(path.resolve(args.proposal)) : await stdinJson();
    if (!proposal) throw new Error('posture promotion apply requires proposal JSON');
    const result = await applyPosturePromotion(root, proposal, {
      expectedProposalHash: args.expected_proposal_hash,
      expectedBasePostureHash: args.expected_posture_hash,
      briefHash: args.brief_hash,
      approval: args.approval,
    });
    writeJson(result);
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? 'POSTURE_PROMOTION_ERROR', message: error.message }));
  process.exitCode = 1;
}
