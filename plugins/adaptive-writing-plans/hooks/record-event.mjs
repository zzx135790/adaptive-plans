#!/usr/bin/env node
import path from 'node:path';
import { appendEvent, makeEventId } from '../scripts/lib/plan-protocol.mjs';
import { readStdin, writeJson } from '../scripts/lib/stdio.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseEmbeddedObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rootFromContext(value) {
  const context = parseEmbeddedObject(value);
  const projectRoot = nonEmptyString(context?.project_root);
  if (!projectRoot) return null;
  const planPath = nonEmptyString(context?.plan_path);
  return planPath ? path.resolve(projectRoot, planPath) : projectRoot;
}

function rootFromEvent(parsed, wrapped) {
  const contextCandidates = [
    wrapped?.context,
    wrapped?.payload?.context,
    parsed?.context,
    parsed?.tool_input?.context,
    parsed?.payload?.context,
  ];
  for (const candidate of contextCandidates) {
    const contextRoot = rootFromContext(candidate);
    if (contextRoot) return contextRoot;
  }

  const eventRootCandidates = [
    wrapped?.cwd,
    parsed?.cwd,
    wrapped?.project_root,
    parsed?.project_root,
    wrapped?.payload?.cwd,
    parsed?.payload?.cwd,
  ];
  return eventRootCandidates.map(nonEmptyString).find(Boolean) ?? null;
}

const explicitRoot = rootIndex >= 0 ? nonEmptyString(args[rootIndex + 1]) : null;

try {
  const input = await readStdin();
  if (!input.trim()) process.exit(0);

  const parsed = JSON.parse(input);
  const wrapped = parsed && typeof parsed === 'object' && parsed.event && typeof parsed.event === 'object'
    ? parsed.event
    : parsed;
  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) throw new TypeError('hook payload must be an object');
  const root = path.resolve(
    explicitRoot
      ?? rootFromEvent(parsed, wrapped)
      ?? process.env.ADAPTIVE_PLAN_ROOT
      ?? '.',
  );
  const type = String(wrapped.type ?? parsed.event_type ?? parsed.event_name ?? parsed.hook_event_name ?? 'fact');
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
  writeJson(result, 0);
} catch (error) {
  // Hooks must not block the main task when a plan root or event is unavailable.
  console.error(`adaptive-writing-plans hook skipped: ${error.message}`);
  process.exitCode = 0;
}
