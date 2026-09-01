#!/usr/bin/env node
import path from 'node:path';

import { discoverProviders } from './lib/provider-registry.mjs';
import { createDesignDocument, selectDesignProviders, triageDesign, writeDesign } from './lib/design-engine.mjs';

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

let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const request = JSON.parse(input || '{}');
  const profile = triageDesign(request);
  const registry = await discoverProviders({ skillsRoots: values(argv, '--skills-root'), pluginRoots: values(argv, '--plugin-root') });
  const providerSelection = await selectDesignProviders(profile, registry);
  const document = createDesignDocument({ ...request, profile, provider_selection: providerSelection });
  const written = await writeDesign(path.resolve(argv[rootIndex + 1]), document);
  console.log(JSON.stringify(written, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
