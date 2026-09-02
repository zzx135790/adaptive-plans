#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const scripts = {
  overview: ['overview.mjs', args.slice(1)],
  migrate: ['migrate-plan.mjs', args.slice(1)],
  'posture:assess': ['posture-assess.mjs', args.slice(2)],
  'posture:check': ['posture-check.mjs', args.slice(2)],
  'posture:promote': ['posture-promote.mjs', args.slice(2)],
  'architecture:bootstrap': ['architecture-bootstrap.mjs', args.slice(2)],
  'architecture:check': ['architecture-check.mjs', args.slice(2)],
  'architecture:propose': ['architecture-delta.mjs', ['propose', ...args.slice(2)]],
  'architecture:apply': ['architecture-delta.mjs', ['apply', ...args.slice(2)]],
  'design:start': ['design-start.mjs', args.slice(2)],
  'design:update': ['design-update.mjs', args.slice(2)],
  'design:record': ['design-record-result.mjs', args.slice(2)],
  'design:revise': ['design-revise.mjs', args.slice(2)],
  'design:approve': ['design-approve.mjs', args.slice(2)],
  'design:brief': ['design-brief.mjs', args.slice(2)],
  'plan:link-architecture': ['plan-link.mjs', ['architecture', ...args.slice(2)]],
  'plan:link-design': ['plan-link.mjs', ['design', ...args.slice(2)]],
  'plan:record-impact': ['plan-link.mjs', ['impact', ...args.slice(2)]],
  'completion:check': ['completion-check.mjs', args.slice(2)],
};
const key = ['architecture', 'design', 'plan', 'posture', 'completion'].includes(args[0]) ? `${args[0]}:${args[1]}` : args[0];
const selected = scripts[key];
if (!selected) {
  console.error('Usage: adaptive-plan overview|migrate|posture <assess|check|promote>|architecture <bootstrap|check|propose|apply>|design <start|update|record|revise|approve|brief>|plan <link-architecture|link-design|record-impact>|completion check');
  process.exit(2);
}
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(scriptRoot, selected[0]), ...selected[1]], { stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('close', (code) => { process.exitCode = code ?? 1; });
