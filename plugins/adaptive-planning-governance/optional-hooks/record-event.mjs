#!/usr/bin/env node
import path from 'node:path';
import { validateContext } from '../mcp/context.mjs';
import { appendEvent, loadMap, makeEventId, validateMap } from '../scripts/lib/plan-protocol.mjs';
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
  if (!context) return { present: false, root: null };
  const projectRoot = nonEmptyString(context?.project_root);
  if (!projectRoot) return { present: true, root: null };
  const planPath = nonEmptyString(context?.plan_path);
  try {
    return {
      present: true,
      root: validateContext({ project_root: projectRoot, plan_path: planPath ?? '.' }).planRoot,
    };
  } catch {
    return { present: true, root: null };
  }
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
    const contextResult = rootFromContext(candidate);
    if (contextResult.present) return contextResult.root;
  }

  return [wrapped?.cwd, parsed?.cwd].map(nonEmptyString).find(Boolean) ?? null;
}

const explicitRoot = rootIndex >= 0 ? nonEmptyString(args[rootIndex + 1]) : null;

async function isValidPlanRoot(root) {
  if (!root) return false;
  try {
    return validateMap(await loadMap(root)).valid;
  } catch {
    return false;
  }
}

function identityValue(parsed, wrapped, key) {
  return nonEmptyString(wrapped?.[key]) ?? nonEmptyString(parsed?.[key]);
}

async function recordInput(input) {
  if (!input.trim()) return;

  const parsed = JSON.parse(input);
  const wrapped = parsed && typeof parsed === 'object' && parsed.event && typeof parsed.event === 'object'
    ? parsed.event
    : parsed;
  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) throw new TypeError('hook payload must be an object');
  const candidateRoot =
    explicitRoot
      ?? rootFromEvent(parsed, wrapped)
      ?? nonEmptyString(process.env.ADAPTIVE_PLAN_ROOT);
  if (!candidateRoot) return;
  const root = path.resolve(candidateRoot);
  if (!await isValidPlanRoot(root)) return;
  const type = String(wrapped.type ?? parsed.event_type ?? parsed.event_name ?? parsed.hook_event_name ?? 'fact');
  const source = String(wrapped.source ?? 'codex-hook');
  const event = {
    type,
    source,
    event_id: wrapped.event_id ?? makeEventId('hook', {
      type,
      source,
      event_id: identityValue(parsed, wrapped, 'event_id'),
      session_id: identityValue(parsed, wrapped, 'session_id'),
      turn_id: identityValue(parsed, wrapped, 'turn_id'),
      tool_name: identityValue(parsed, wrapped, 'tool_name'),
    }),
  };
  await appendEvent(root, event);
}

try {
  await recordInput(await readStdin());
} catch (error) {
  // Hooks must not block the main task when a plan root or event is unavailable.
  console.error(`adaptive-planning-governance hook skipped: ${error.message}`);
} finally {
  // Codex Stop hooks require a valid control object, never an audit result.
  writeJson({}, 0);
}
