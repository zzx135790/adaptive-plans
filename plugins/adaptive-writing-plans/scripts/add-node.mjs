#!/usr/bin/env node
import path from 'node:path';
import { addNode } from './lib/plan-protocol.mjs';
import { writeJson } from './lib/stdio.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    result[token.slice(2).replaceAll('-', '_')] = argv[++index];
  }
  return result;
}

function list(value, separator = '|') {
  return value ? String(value).split(separator).filter(Boolean) : [];
}

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.id || !args.title || args.skill_bindings === undefined) {
  console.error("Usage: adaptive-plan add --root <folder> --id <id> --title <title> --skill-bindings '<json-array>' [--depends-on A,B]");
  process.exitCode = 2;
} else try {
  const result = await addNode(path.resolve(args.root), {
    id: args.id,
    title: args.title,
    depends_on: list(args.depends_on, ','),
    inputs: list(args.inputs),
    outputs: list(args.outputs),
    acceptance: list(args.acceptance),
    blocking_questions: list(args.blocking_questions),
    behavior_budget: args.behavior_budget ? JSON.parse(args.behavior_budget) : undefined,
    skill_bindings: JSON.parse(args.skill_bindings),
    parallelization: {
      candidate: args.parallel !== 'false',
      owned_paths: list(args.owned_paths),
      shared_resources: args.shared_resources ? JSON.parse(args.shared_resources) : [],
      independent_verification: list(args.verification),
    },
  });
  writeJson(result.node);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
