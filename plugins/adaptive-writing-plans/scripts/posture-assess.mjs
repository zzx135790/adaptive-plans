#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { assessEngineeringPosture } from './lib/posture-operations.mjs';

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');

try {
  let raw = '';
  if (inputIndex >= 0 && args[inputIndex + 1]) raw = await fs.readFile(path.resolve(args[inputIndex + 1]), 'utf8');
  else for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error('posture assess requires JSON on stdin or --input <json-file>');
  console.log(JSON.stringify(assessEngineeringPosture(JSON.parse(raw)), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

