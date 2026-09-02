#!/usr/bin/env node
import path from 'node:path';

import { discoverProviders } from './lib/provider-registry.mjs';
import { selectDesignProviders, triageDesign } from './lib/design-engine.mjs';
import { startCanonicalDesign } from './lib/design-operations.mjs';
import { readStdin, writeJson } from './lib/stdio.mjs';

function values(argv, flag) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) if (argv[index] === flag && argv[index + 1]) result.push(argv[index + 1]);
  return result;
}

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf('--root');
if (rootIndex < 0 || !argv[rootIndex + 1]) {
  console.error('Usage: node scripts/design-start.mjs --root <plan-folder> [--skills-root <folder>] [--plugin-root <folder>]');
  process.exit(2);
}

const input = await readStdin();
try {
  const request = JSON.parse(input || '{}');
  const profile = triageDesign(request);
  const registry = await discoverProviders({ skillsRoots: values(argv, '--skills-root'), pluginRoots: values(argv, '--plugin-root') });
  const providerSelection = await selectDesignProviders(profile, registry);
  const written = await startCanonicalDesign(path.resolve(argv[rootIndex + 1]), { ...request, profile }, providerSelection);
  writeJson(written);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
