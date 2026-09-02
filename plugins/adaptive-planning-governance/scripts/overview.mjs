#!/usr/bin/env node
import path from 'node:path';
import { buildPlanOverview } from './lib/plan-protocol.mjs';
import { writeJson, writeStderr } from './lib/stdio.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
if (rootIndex < 0 || !args[rootIndex + 1]) {
  writeStderr('Usage: node scripts/overview.mjs --root <plan-folder>\n');
  process.exitCode = 2;
} else try {
  const projectIndex = args.indexOf('--project-root');
  const mcpIndex = args.indexOf('--mcp-plan-root');
  writeJson(await buildPlanOverview(path.resolve(args[rootIndex + 1]), {
    projectRoot: projectIndex >= 0 ? path.resolve(args[projectIndex + 1]) : process.cwd(),
    mcpPlanRoot: mcpIndex >= 0 ? path.resolve(args[mcpIndex + 1]) : null,
  }));
} catch (error) {
  writeStderr(`${error.message}\n`);
  process.exitCode = 1;
}
