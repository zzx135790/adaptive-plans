#!/usr/bin/env node
import path from 'node:path';

import { designApprovalBrief, loadDesign } from './lib/design-engine.mjs';
import { currentThreadRevision, ledgerApprovalBrief } from './lib/design-ledger.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2).replaceAll('-', '_')] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root) {
  console.error('Usage: node scripts/design-brief.mjs --root <plan-folder> [--thread <thread-id>]');
  process.exit(2);
}

try {
  const document = await loadDesign(path.resolve(args.root));
  let brief;
  if (Array.isArray(document.threads)) {
    const threadId = args.thread
      ?? document.threads.find((thread) => currentThreadRevision(thread)?.decision_status === 'in_progress')?.thread_id
      ?? 'root';
    brief = ledgerApprovalBrief(document, threadId);
  } else {
    brief = designApprovalBrief(document);
  }
  console.log(JSON.stringify(brief, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

