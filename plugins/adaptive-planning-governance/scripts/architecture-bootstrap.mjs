#!/usr/bin/env node
import path from 'node:path';

import { approveArchitectureProposal, defaultArchitectureRoot, scanArchitectureProposal } from './lib/architecture-protocol.mjs';
import { readJson, writeJsonAtomic } from './lib/io-utils.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replaceAll('-', '_');
    result[key] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.project_root ?? process.cwd());
const architectureRoot = path.resolve(args.architecture_root ?? defaultArchitectureRoot(projectRoot));

try {
  if (args.approve) {
    if (!args.approval) throw new Error('--approval is required when applying a bootstrap proposal');
    const proposal = await readJson(path.resolve(args.approve));
    const result = await approveArchitectureProposal(architectureRoot, proposal, { source: 'user', statement: args.approval });
    console.log(JSON.stringify(result, null, 2));
  } else {
    const proposal = await scanArchitectureProposal(projectRoot, { projectId: args.project_id });
    if (args.out) await writeJsonAtomic(path.resolve(args.out), proposal);
    console.log(JSON.stringify(proposal, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
