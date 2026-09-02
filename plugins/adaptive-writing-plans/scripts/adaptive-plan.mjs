#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [command, ...args] = process.argv.slice(2);
const scripts = {
  route: 'route-task.mjs',
  init: 'init-plan.mjs',
  add: 'add-node.mjs',
  validate: 'validate-plan.mjs',
  overview: 'overview.mjs',
};
const selected = scripts[command];
if (!selected) {
  console.error('Usage: adaptive-plan route|init|add|validate|overview');
  process.exit(2);
}
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(scriptRoot, selected), ...args], { stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('close', (code) => { process.exitCode = code ?? 1; });
