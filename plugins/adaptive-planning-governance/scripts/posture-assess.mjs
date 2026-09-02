#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { assessEngineeringPosture } from './lib/posture-operations.mjs';
import { readStdin, writeJson } from './lib/stdio.mjs';

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');

try {
  let raw = '';
  if (inputIndex >= 0 && args[inputIndex + 1]) raw = await fs.readFile(path.resolve(args[inputIndex + 1]), 'utf8');
  else raw = await readStdin();
  if (!raw.trim()) throw new Error('posture assess requires JSON on stdin or --input <json-file>');
  writeJson(assessEngineeringPosture(JSON.parse(raw)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
