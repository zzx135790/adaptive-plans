#!/usr/bin/env node
import path from 'node:path';
import { appendEvent, makeEventId } from '../scripts/lib/plan-protocol.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.env.ADAPTIVE_PLAN_ROOT ?? '.');

let input = '';
for await (const chunk of process.stdin) input += chunk;
if (!input.trim()) process.exit(0);

try {
  const parsed = JSON.parse(input);
  const wrapped = parsed && typeof parsed === 'object' && parsed.event && typeof parsed.event === 'object'
    ? parsed.event
    : parsed;
  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) throw new TypeError('hook payload must be an object');
  const type = String(wrapped.type ?? parsed.event_type ?? parsed.event_name ?? 'fact');
  const event = {
    ...wrapped,
    type,
    source: wrapped.source ?? 'codex-hook',
    event_id: wrapped.event_id ?? makeEventId('hook', {
      type,
      source: wrapped.source ?? 'codex-hook',
      message: wrapped.message ?? '',
      payload: wrapped.payload ?? wrapped.result ?? wrapped.data ?? null,
    }),
  };
  const result = await appendEvent(root, event);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  // Hooks must not block the main task when a plan root or event is unavailable.
  console.error(`adaptive-writing-plans hook skipped: ${error.message}`);
  process.exitCode = 0;
}
