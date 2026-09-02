import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('map schema exposes skill bindings and missing safety case as deferred evidence', async () => {
  const schema = JSON.parse(await fs.readFile(path.join(pluginRoot, 'schemas', 'map.schema.json'), 'utf8'));
  const nodeSchema = schema.properties.nodes.items;
  assert.deepEqual(nodeSchema.properties.skill_bindings, {
    type: 'array',
    items: { $ref: '#/$defs/skill_binding' },
  });
  assert.ok(schema.$defs.deferred_candidate.properties.reason.enum.includes('missing_safety_case'));
  assert.deepEqual(schema.$defs.skill_binding.required, [
    'behavior', 'purpose', 'selection_reason', 'execution_order',
  ]);
  assert.deepEqual(schema.$defs.skill_binding.oneOf, [
    { required: ['selected_skill'], not: { required: ['ada_fallback'] } },
    { required: ['ada_fallback'], not: { required: ['selected_skill'] } },
  ]);
});
