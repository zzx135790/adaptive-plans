#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPlanManifest } from './lib/plan-protocol.mjs';
import { writeJson, writeStderr } from './lib/stdio.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replaceAll('-', '_');
    if (key === 'force') result[key] = true;
    else result[key] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
function slugify(value) {
  return String(value ?? 'plan')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plan';
}

function deriveRoot() {
  if (args.root) return path.resolve(args.root);
  const date = String(args.date ?? new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  const base = path.resolve(args.base ?? path.join('docs', 'superpowers', 'plans'));
  return path.join(base, `${date}-${slugify(args.slug ?? args.id)}`);
}

if (!args.id) {
  console.error('Usage: node scripts/init-plan.mjs [--root <folder> | --base <folder> --date YYYY-MM-DD --slug <slug>] --id <plan-id> --title <title> --goal <goal>');
  process.exit(2);
}

try {
  const root = deriveRoot();
  try {
    await fs.access(path.join(root, 'map.json'));
    if (!args.force) throw new Error(`plan folder already exists: ${root} (use --force to replace it)`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const manifest = await createPlanManifest(root, {
    planId: args.id,
    title: args.title ?? args.id,
    goal: args.goal ?? 'Define and validate the work before implementation.',
    overwrite: Boolean(args.force),
  });
  writeJson({ ...manifest, root });
} catch (error) {
  writeStderr(`${error.message}\n`);
  process.exitCode = 1;
}
