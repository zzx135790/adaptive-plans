#!/usr/bin/env node
import path from 'node:path';
import { addNode } from './lib/planning-engine.mjs';

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
if (!args.root || !args.id || !args.title) {
  console.error('Usage: node scripts/add-node.mjs --root <plan-folder> --id N-001 --title <title> [--depends-on N-000]');
  process.exit(2);
}
const node = {
  id: args.id,
  title: args.title,
  depends_on: args.depends_on ? String(args.depends_on).split(',').filter(Boolean) : [],
  blocking_questions: args.blocking_questions ? String(args.blocking_questions).split('|').filter(Boolean) : [],
  inputs: args.inputs ? String(args.inputs).split('|').filter(Boolean) : [],
  outputs: args.outputs ? String(args.outputs).split('|').filter(Boolean) : [],
  acceptance: args.acceptance ? String(args.acceptance).split('|').filter(Boolean) : [],
  requirement_ids: args.requirements ? String(args.requirements).split(',').filter(Boolean) : [],
  impacted_modules: args.modules ? String(args.modules).split(',').filter(Boolean) : [],
  contract_refs: args.contract_refs ? JSON.parse(args.contract_refs) : [],
  design_refs: args.design_refs ? JSON.parse(args.design_refs) : [],
  interaction_refs: args.interaction_refs ? String(args.interaction_refs).split(',').filter(Boolean) : [],
  design_required: args.design_required === 'true' || args.design_required === true,
  posture_ref: args.posture_ref ? JSON.parse(args.posture_ref) : undefined,
  scope_provenance: args.scope_provenance ? JSON.parse(args.scope_provenance) : [],
  behavior_budget: args.behavior_budget ? JSON.parse(args.behavior_budget) : undefined,
  deferred_candidates: args.deferred_candidates ? JSON.parse(args.deferred_candidates) : [],
  parallelization: {
    candidate: args.parallel === 'true' || args.parallel === true,
    wave: args.wave ?? 'serial',
    owned_paths: args.owned_paths ? String(args.owned_paths).split('|').filter(Boolean) : [],
    shared_resources: args.shared_resources ? String(args.shared_resources).split('|').filter(Boolean) : [],
    independent_verification: args.verification ? String(args.verification).split('|').filter(Boolean) : [],
    reason: args.parallel_reason ?? 'not assessed',
  },
};
console.log(JSON.stringify((await addNode(path.resolve(args.root), node)).node, null, 2));
