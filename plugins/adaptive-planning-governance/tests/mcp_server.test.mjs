import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { writeArchitecture } from '../scripts/lib/architecture-protocol.mjs';
import { createPlanManifest, writeMap } from '../scripts/lib/plan-protocol.mjs';
import { createEngineeringPosture, postureRef } from '../scripts/lib/engineering-posture.mjs';

const serverPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.mjs');

function currentLedgerRevision(document, threadId = 'root') {
  const thread = document.threads.find((candidate) => candidate.thread_id === threadId);
  return thread?.revisions.find((revision) => revision.revision === thread.current_revision);
}

function requestContext(root, extraArgs) {
  const projectRootIndex = extraArgs.indexOf('--project-root');
  const projectRoot = path.resolve(projectRootIndex >= 0 ? extraArgs[projectRootIndex + 1] : root);
  const planPath = path.relative(projectRoot, path.resolve(root));
  return {
    project_root: projectRoot,
    ...(planPath ? { plan_path: planPath } : {}),
  };
}

function addRequestContext(request, root, extraArgs) {
  const context = requestContext(root, extraArgs);
  if (request.method === 'tools/call') {
    return {
      ...request,
      params: {
        ...request.params,
        arguments: { context, ...(request.params?.arguments ?? {}) },
      },
    };
  }
  if (request.method === 'resources/read') {
    return { ...request, params: { context, ...(request.params ?? {}) } };
  }
  return request;
}

function callServer(root, request, framed = false, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath, '--stdio', '--root', root, ...extraArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('MCP server response timeout'));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let payload;
      if (framed) {
        const separator = buffer.indexOf('\r\n\r\n');
        if (separator < 0) return;
        const header = buffer.slice(0, separator);
        const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
        if (!Number.isFinite(length)) return;
        const start = separator + 4;
        if (Buffer.byteLength(buffer.slice(start), 'utf8') < length) return;
        payload = buffer.slice(start, start + length);
        buffer = buffer.slice(start + length);
      } else {
        const line = buffer.split('\n')[0];
        if (!line) return;
        buffer = buffer.slice(line.length + 1);
        payload = line;
      }
      clearTimeout(timer);
      child.kill();
      try {
        resolve(JSON.parse(payload));
      } catch (error) {
        reject(error);
      }
    });
    child.on('error', reject);
    const payload = JSON.stringify(addRequestContext(request, root, extraArgs));
    child.stdin.end(framed
      ? `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`
      : `${payload}\n`);
  });
}

test('MCP tools/list exposes read-only and append-event tools', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-mcp-'));
  await writeFile(path.join(root, 'map.json'), JSON.stringify({ schema_version: '1.0', plan_id: 'p', nodes: [] }));
  const response = await callServer(root, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });

  assert.equal(response.result.tools.some((tool) => tool.name === 'plan_validate'), true);
  for (const name of [
    'plan_overview',
    'plan_validate_completion',
    'architecture_open',
    'architecture_check_diff',
    'design_triage',
    'design_update',
    'design_revise',
    'design_approval_brief',
    'posture_assess',
    'posture_check',
    'posture_promotion_preview',
    'posture_promotion_apply',
    'plan_binding_status',
  ]) {
    assert.equal(response.result.tools.some((tool) => tool.name === name), true, name);
  }
  const append = response.result.tools.find((tool) => tool.name === 'plan_append_event');
  assert.equal(append.annotations.readOnlyHint, false);
  assert.equal(append.inputSchema.required.includes('event'), true);
  assert.equal(response.result.tools.find((tool) => tool.name === 'posture_promotion_preview').annotations.readOnlyHint, true);
  assert.equal(response.result.tools.find((tool) => tool.name === 'posture_promotion_apply').annotations.readOnlyHint, false);
  assert.deepEqual(response.result.tools.find((tool) => tool.name === 'design_approve').inputSchema.required, [
    'context', 'expected_hash', 'expected_posture_hash', 'brief_hash', 'approval',
  ]);
});

test('MCP initialize reports the current plugin protocol version', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-mcp-version-'));
  const response = await callServer(root, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26' },
  });

  assert.equal(response.result.serverInfo.name, 'adaptive-planning-governance');
  assert.equal(response.result.serverInfo.version, '0.4.0');
});

test('MCP architecture, design, overview, resources, and completion tools form a stateful v2 workflow', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'adaptive-mcp-v2-project-'));
  const planRoot = path.join(project, 'docs', 'superpowers', 'plans', 'v2');
  const architectureRoot = path.join(project, 'docs', 'architecture', 'adaptive');
  await createPlanManifest(planRoot, { planId: 'v2', title: 'V2 map', goal: 'Exercise MCP v2' });
  const architecture = await writeArchitecture(architectureRoot, {
    schema_version: '2.0',
    project_id: 'mcp-project',
    revision: 1,
    status: 'approved',
    modules: [{
      id: 'core',
      purpose: 'Own the core',
      non_goals: [],
      owners: ['platform'],
      owned_paths: ['src/**'],
      public_boundaries: [],
      invariants: [],
      dependencies: [],
      required_concerns: [],
      concerns: {},
      source_refs: [],
    }],
    relations: [],
    coverage: { include_paths: ['src/**'], ignore_paths: [] },
  });
  const serverArgs = ['--project-root', project, '--architecture-root', architectureRoot];
  const call = (name, input = {}) => callServer(planRoot, {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1_000_000),
    method: 'tools/call',
    params: { name, arguments: input },
  }, false, serverArgs);

  const opened = await call('architecture_open');
  assert.equal(opened.result.structuredContent.architecture_hash, architecture.architecture_hash);
  const linked = await call('plan_link_architecture');
  assert.equal(linked.result.structuredContent.gates.architecture_sync.status, 'pending');
  const impactResponse = await call('architecture_check_diff', {
    changed_paths: ['src/internal.js'],
    evidence: ['tests pass'],
  });
  const impact = impactResponse.result.structuredContent.impact;
  assert.equal(impact.status, 'satisfied');
  const recorded = await call('plan_record_architecture_impact', {
    impact,
    artifact_path: 'changes/impact.json',
  });
  assert.equal(recorded.result.structuredContent.gates.architecture_sync.status, 'satisfied');

  const triaged = await call('design_triage', { request: { public_api: true } });
  assert.equal(triaged.result.structuredContent.required, true);
  const posture = createEngineeringPosture('reusable_internal', {
    source: { kind: 'explicit_assessment', ref: 'decision://mcp-design-posture' },
    allowed_capabilities: ['public-api'],
    excluded_capabilities: ['deployment'],
  });
  const started = await call('design_start', {
    request: {
      design_id: 'mcp-design', public_api: true, requirements: ['Expose item reads'],
      posture_ref: postureRef(posture),
    },
    provider_selection: { selected: [] },
  });
  const startedDocument = started.result.structuredContent;
  assert.equal(startedDocument.schema_version, '2.1');
  const startedRevision = currentLedgerRevision(startedDocument);
  assert.ok(startedRevision.provider_status.blocking_concerns.includes('security'));

  const updated = await call('design_update', {
    expected_hash: startedRevision.content_hash,
    updates: {
      options: [{ id: 'rest' }, { id: 'graphql' }],
      selected_option: { id: 'rest' },
      interfaces: ['GET /items/:id'],
    },
  });
  const updatedDocument = updated.result.structuredContent;
  const updatedRevision = currentLedgerRevision(updatedDocument);
  const providerRecorded = await call('design_record_result', {
    expected_hash: updatedRevision.content_hash,
    result: {
      schema_version: '2.0',
      provider_id: 'security-reviewer',
      capability: 'design',
      status: 'ok',
      findings: ['No additional boundary risks'],
    },
  });
  assert.ok(currentLedgerRevision(providerRecorded.result.structuredContent).provider_refs.some(
    (provider) => provider.provider_id === 'security-reviewer',
  ));
  const briefResponse = await call('design_approval_brief');
  const brief = briefResponse.result.structuredContent;
  const approved = await call('design_approve', {
    expected_hash: brief.exact_content_hash,
    expected_posture_hash: brief.exact_posture_hash,
    brief_hash: brief.brief_hash,
    approval: { source: 'user', statement: 'approve REST' },
    waiver: { reason: 'No installed security reviewer' },
  });
  assert.equal(currentLedgerRevision(approved.result.structuredContent).decision_status, 'waived');
  const designLinked = await call('plan_link_design');
  assert.equal(designLinked.result.structuredContent.gates.design.status, 'waived');

  const overview = await call('plan_overview');
  assert.match(overview.result.structuredContent.ascii_dag, /empty map/);
  assert.ok(overview.result.structuredContent.artifacts.includes('design.json'));
  assert.equal(overview.result.structuredContent.binding.status, 'matched');
  const binding = await call('plan_binding_status');
  assert.equal(binding.result.structuredContent.status, 'matched');
  const completion = await call('plan_validate_completion');
  assert.equal(completion.result.structuredContent.valid, false);
  assert.ok(completion.result.structuredContent.errors.some((error) => error.code === 'gate_intent'));

  const resources = await callServer(planRoot, {
    jsonrpc: '2.0', id: 9001, method: 'resources/list', params: {},
  }, false, serverArgs);
  assert.deepEqual(
    resources.result.resources.map((resource) => resource.uri).sort(),
    ['architecture://current', 'design://current', 'plan://map', 'plan://overview'],
  );
  const designResource = await callServer(planRoot, {
    jsonrpc: '2.0', id: 9002, method: 'resources/read', params: { uri: 'design://current' },
  }, false, serverArgs);
  assert.equal(JSON.parse(designResource.result.contents[0].text).design_id, 'mcp-design');

  const revised = await call('design_revise', {
    reason: 'Pagination semantics changed',
    blocking_questions: ['Cursor or offset?'],
    request: { data_model: true, architecture_hash: architecture.architecture_hash },
  });
  const revisedRoot = revised.result.structuredContent.threads[0];
  assert.equal(revisedRoot.current_revision, 2);
  assert.equal(revisedRoot.revisions[0].decision_status, 'stale');
  assert.deepEqual(revisedRoot.revisions[1].options, []);
  assert.deepEqual(revisedRoot.revisions[1].blocking_questions, ['Cursor or offset?']);
  const staleOverview = await call('plan_overview');
  assert.equal(staleOverview.result.structuredContent.gates.design.status, 'stale');
});

test('MCP posture tools preserve read/apply parity and exact promotion hashes', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'adaptive-mcp-posture-'));
  const planRoot = path.join(project, 'plan');
  const map = await createPlanManifest(planRoot, { planId: 'posture', title: 'Posture', goal: 'Exercise posture MCP' });
  map.engineering_posture = createEngineeringPosture('spike', {
    source: { kind: 'approved_guide', ref: 'GUIDE.md#posture' },
    allowed_capabilities: ['answer-question'],
    excluded_capabilities: ['deployment'],
  });
  await writeMap(planRoot, map);
  const call = (name, input = {}) => callServer(planRoot, {
    jsonrpc: '2.0', id: Math.floor(Math.random() * 1_000_000), method: 'tools/call', params: { name, arguments: input },
  }, false, ['--project-root', project]);

  const assessed = await call('posture_assess', { assessment: {
    kind: 'experiment',
    source: { kind: 'explicit_assessment', ref: 'decision://mcp-posture' },
    allowed_capabilities: ['measurement'], excluded_capabilities: ['deployment'],
    evidence: ['hypothesis'],
  } });
  assert.equal(assessed.result.structuredContent.writes, false);
  assert.ok(assessed.result.structuredContent.evidence_gaps.includes('measurement_validity'));
  const checked = await call('posture_check');
  assert.equal(checked.result.structuredContent.valid, true);
  assert.equal(checked.result.structuredContent.writes, false);
  const previewed = await call('posture_promotion_preview', { target: {
    kind: 'experiment',
    source: { kind: 'explicit_assessment', ref: 'decision://mcp-posture' },
    allowed_capabilities: ['measurement'], excluded_capabilities: ['deployment'],
    evidence: ['hypothesis', 'measurement_validity', 'reproduction_instructions'],
  } });
  const proposal = previewed.result.structuredContent;
  assert.equal(proposal.writes, false);
  const applied = await call('posture_promotion_apply', {
    proposal,
    expected_proposal_hash: proposal.proposal_hash,
    expected_posture_hash: proposal.base_posture_hash,
    brief_hash: proposal.approval_brief.brief_hash,
    approval: { source: 'user', statement: 'Approve MCP experiment posture' },
  });
  assert.equal(applied.result.structuredContent.writes, true);
  assert.equal(applied.result.structuredContent.posture_ref.kind, 'experiment');
});

test('MCP server accepts standard Content-Length framing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-mcp-framed-'));
  await writeFile(path.join(root, 'map.json'), JSON.stringify({ schema_version: '1.0', plan_id: 'p', nodes: [] }));
  const response = await callServer(root, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, true);
  assert.equal(response.id, 2);
  assert.ok(response.result.tools.length > 0);
});

test('MCP server serializes multiple newline-delimited requests', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-mcp-multi-'));
  await writeFile(path.join(root, 'map.json'), JSON.stringify({ schema_version: '1.0', plan_id: 'p', nodes: [] }));
  const child = spawn(process.execPath, [serverPath, '--stdio', '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const responses = [];
  const timer = setTimeout(() => child.kill(), 5000);
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    for (const line of buffer.split('\n').slice(0, -1)) {
      if (line.trim()) responses.push(JSON.parse(line));
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
    if (responses.length === 2) child.kill();
  });
  child.stdin.end([
    JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'plan_next', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'plan_validate', params: {} }),
  ].join('\n') + '\n');
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', () => { clearTimeout(timer); resolve(); });
  });
  assert.deepEqual(responses.map((response) => response.id), [10, 11]);
});

test('MCP server does not discard a newline request before a framed request', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adaptive-mcp-mixed-'));
  await writeFile(path.join(root, 'map.json'), JSON.stringify({ schema_version: '1.0', plan_id: 'p', nodes: [] }));
  const first = JSON.stringify({ jsonrpc: '2.0', id: 20, method: 'plan_next', params: {} });
  const second = JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'plan_validate', params: {} });
  const child = spawn(process.execPath, [serverPath, '--stdio', '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const timer = setTimeout(() => child.kill(), 5000);
  child.stdout.on('data', (chunk) => { buffer += chunk.toString(); });
  child.stdin.end(`${first}\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(second)}\r\n\r\n${second}`);
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', () => { clearTimeout(timer); resolve(); });
  });
  const ids = [...buffer.matchAll(/"id"\s*:\s*(\d+)/g)].map((match) => Number(match[1]));
  assert.deepEqual(ids, [20, 21]);
});
