#!/usr/bin/env node
import path from 'node:path';
import { createPlanManifest } from './lib/plan-protocol.mjs';
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

function slugify(value) {
  return String(value ?? 'plan').normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plan';
}

const args = parseArgs(process.argv.slice(2));
if (!args.id) {
  console.error('Usage: adaptive-plan init [--root <folder> | --base <folder> --date YYYY-MM-DD --slug <slug>] --id <id>');
  process.exit(2);
}
try {
  const date = String(args.date ?? new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  const root = args.root
    ? path.resolve(args.root)
    : path.join(path.resolve(args.base ?? path.join('docs', 'superpowers', 'plans')), `${date}-${slugify(args.slug ?? args.id)}`);
  const map = await createPlanManifest(root, {
    planId: args.id,
    title: args.title ?? args.id,
    goal: args.goal ?? '',
    behavior_budget: args.behavior_budget ? JSON.parse(args.behavior_budget) : undefined,
  });
  writeJson({ ...map, root });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
