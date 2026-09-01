#!/usr/bin/env node
import path from 'node:path';
import { discoverProviders } from './lib/provider-registry.mjs';

function parseArgs(argv) {
  const result = { skillsRoots: [], pluginRoots: [], mcpFiles: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--skills-root' || token === '--skill-root') result.skillsRoots.push(argv[++index]);
    else if (token === '--plugin-root' || token === '--plugins-root') result.pluginRoots.push(argv[++index]);
    else if (token === '--mcp') result.mcpFiles.push(argv[++index]);
    else if (token === '--json') result.json = true;
  }
  const envSkills = process.env.ADAPTIVE_SKILL_ROOTS?.split(path.delimiter).filter(Boolean) ?? [];
  const envPlugins = process.env.ADAPTIVE_PLUGIN_ROOTS?.split(path.delimiter).filter(Boolean) ?? [];
  result.skillsRoots = [...result.skillsRoots, ...envSkills];
  result.pluginRoots = [...result.pluginRoots, ...envPlugins];
  return result;
}

const args = parseArgs(process.argv.slice(2));
try {
  const registry = await discoverProviders(args);
  process.stdout.write(`${JSON.stringify(registry, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`provider discovery failed: ${error.message}\n`);
  process.exitCode = 1;
}
