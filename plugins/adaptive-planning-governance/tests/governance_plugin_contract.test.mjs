import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(pluginRoot, 'mcp', 'server.mjs');
const CONTEXT_SCHEMA = {
  type: 'object',
  required: ['project_root'],
  properties: {
    project_root: { type: 'string' },
    plan_path: { type: 'string' },
  },
  additionalProperties: false,
};

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function createProject(planId) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), `governance-${planId}-`));
  const planPath = path.join('docs', 'superpowers', 'plans', planId);
  const planRoot = path.join(projectRoot, planPath);
  await fs.mkdir(planRoot, { recursive: true });
  await fs.writeFile(path.join(planRoot, 'map.json'), `${JSON.stringify({
    schema_version: '1.0',
    plan_id: planId,
    mode: 'map',
    nodes: [],
    artifacts: [],
    current_node: null,
  })}\n`);
  return { projectRoot, planPath };
}

function startServer(options = {}) {
  const child = spawn(process.execPath, [serverPath, '--stdio', '--root', options.boundRoot ?? '/startup/root'], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ADAPTIVE_PLAN_ROOT: '/startup/env/plan',
      ADAPTIVE_PROJECT_ROOT: '/startup/env/project',
      ADAPTIVE_ARCHITECTURE_ROOT: '/startup/env/architecture',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();

  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const waiter = pending.get(response.id);
      if (waiter) {
        pending.delete(response.id);
        waiter.resolve(response);
      }
    }
  });
  child.on('close', (code) => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error(`MCP server exited ${code}: ${stderr}`));
    }
    pending.clear();
  });

  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}; ${stderr}`));
        }, 5000);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

test('plugin, skill, package, and MCP server expose the governance identity at v0.4.0', async () => {
  const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  assert.equal(await exists(manifestPath), true, 'governance manifest must exist');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(pluginRoot, 'package.json'), 'utf8'));
  const skill = await fs.readFile(
    path.join(pluginRoot, 'skills', 'adaptive-planning-governance', 'SKILL.md'),
    'utf8',
  );
  const mcp = JSON.parse(await fs.readFile(path.join(pluginRoot, '.mcp.json'), 'utf8'));

  assert.equal(manifest.name, 'adaptive-planning-governance');
  assert.equal(manifest.version, '0.4.0');
  assert.equal(pkg.name, 'adaptive-planning-governance');
  assert.equal(pkg.version, '0.4.0');
  assert.match(skill, /^name: adaptive-planning-governance$/m);
  assert.match(skill, /^description: Use when .*optional advanced planning governance/m);
  assert.match(skill, /Do not use for ordinary implementation planning/);
  assert.ok(mcp.mcpServers['adaptive-planning-governance']);

  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'governance-identity-'));
  const server = startServer({ cwd: projectRoot });
  try {
    const response = await server.request('initialize', { protocolVersion: '2025-03-26' });
    assert.deepEqual(response.result.serverInfo, {
      name: 'adaptive-planning-governance',
      version: '0.4.0',
    });
  } finally {
    server.close();
  }
});

test('hooks are shipped as optional configuration and are not auto-discovered or declared', async () => {
  const optionalConfig = path.join(pluginRoot, 'optional-hooks', 'hooks.json');
  assert.equal(await exists(optionalConfig), true, 'optional hook config must be available');
  assert.equal(await exists(path.join(pluginRoot, 'hooks', 'hooks.json')), false);
  const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal('hooks' in manifest, false);
});

test('package contains maintained source only and has no runtime dependencies or broken host sync command', async () => {
  const forbidden = [
    'node_modules',
    'package-lock.json',
    path.join('docs', 'superpowers', 'plans'),
    path.join('hooks', 'hooks.json'),
    path.join('.codex-plugin', 'manifest.json'),
    path.join('.claude-plugin', 'manifest.json'),
  ];
  for (const relative of forbidden) {
    assert.equal(await exists(path.join(pluginRoot, relative)), false, `${relative} must not ship`);
  }

  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(path.relative(pluginRoot, full));
    }
  }
  await walk(pluginRoot);
  assert.deepEqual(files.filter((file) => file.endsWith('.bak')), []);

  const pkg = JSON.parse(await fs.readFile(path.join(pluginRoot, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.equal(Object.hasOwn(pkg.scripts ?? {}, 'host:sync'), false);
});

test('every MCP tool requires explicit request context and invalid context is a structured tool error', async () => {
  assert.equal(await exists(serverPath), true, 'governance MCP server must exist');
  const startupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'governance-startup-'));
  const server = startServer({ cwd: startupRoot, boundRoot: startupRoot });
  try {
    const listed = await server.request('tools/list');
    assert.ok(listed.result.tools.length > 0);
    for (const tool of listed.result.tools) {
      assert.ok(tool.inputSchema.required?.includes('context'), `${tool.name} requires context`);
      assert.deepEqual(tool.inputSchema.properties.context, CONTEXT_SCHEMA, `${tool.name} context schema`);
    }

    const missing = await server.request('tools/call', {
      name: 'plan_open',
      arguments: {},
    });
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /^INVALID_CONTEXT:/);

    const relative = await server.request('tools/call', {
      name: 'plan_open',
      arguments: { context: { project_root: 'relative/project' } },
    });
    assert.equal(relative.result.isError, true);
    assert.match(relative.result.content[0].text, /^INVALID_CONTEXT:/);
  } finally {
    server.close();
  }
});

test('one MCP process resolves tool and resource roots per request without startup-state leakage', async () => {
  assert.equal(await exists(serverPath), true, 'governance MCP server must exist');
  const first = await createProject('first');
  const second = await createProject('second');
  const startupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'governance-startup-'));
  const server = startServer({ cwd: startupRoot, boundRoot: startupRoot });
  const firstContext = { project_root: first.projectRoot, plan_path: first.planPath };
  const secondContext = { project_root: second.projectRoot, plan_path: second.planPath };
  try {
    const firstOpen = await server.request('tools/call', {
      name: 'plan_open', arguments: { context: firstContext },
    });
    const secondOpen = await server.request('tools/call', {
      name: 'plan_open', arguments: { context: secondContext },
    });
    const firstAgain = await server.request('tools/call', {
      name: 'plan_open', arguments: { context: firstContext },
    });
    assert.equal(firstOpen.result.structuredContent.plan_id, 'first');
    assert.equal(secondOpen.result.structuredContent.plan_id, 'second');
    assert.equal(firstAgain.result.structuredContent.plan_id, 'first');

    const resource = await server.request('resources/read', {
      uri: 'plan://map', context: secondContext,
    });
    assert.equal(JSON.parse(resource.result.contents[0].text).plan_id, 'second');

    const missing = await server.request('resources/read', { uri: 'plan://map' });
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /^INVALID_CONTEXT:/);
  } finally {
    server.close();
  }
});
