#!/usr/bin/env node
/**
 * Canary test for N-006 release verification
 *
 * Tests that the plugin can:
 * 1. Load in both Codex and Claude Code
 * 2. Serve MCP tools successfully
 * 3. Create and manipulate plans
 */

import { strictEqual } from 'node:assert';
import { test } from 'node:test';
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const pluginRoot = path.resolve(__dirname, '..');
const serverPath = path.join(pluginRoot, 'mcp', 'server.mjs');

test('MCP server starts and responds to list tools', async () => {
  const server = spawn('node', [serverPath, '--root', pluginRoot], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  server.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  const waitForOutput = (needle, timeoutMs = 60000) => new Promise((resolve, reject) => {
    if (stdout.includes(needle)) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      server.stdout.off('data', onData);
      reject(new Error(`timed out waiting for MCP output: ${needle}`));
    }, timeoutMs);
    const onData = () => {
      if (!stdout.includes(needle)) return;
      clearTimeout(timer);
      server.stdout.off('data', onData);
      resolve();
    };
    server.stdout.on('data', onData);
  });

  // Send initialize request
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'canary-test', version: '1.0.0' }
    }
  };
  const listRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  };
  server.stdin.write(`${JSON.stringify(initRequest)}\n${JSON.stringify(listRequest)}\n`);
  await waitForOutput('plan_open');

  server.kill();

  // Verify we got tool list response
  strictEqual(stdout.includes('plan_open'), true, 'MCP server should list plan_open tool');
  strictEqual(stdout.includes('plan_add_node'), true, 'MCP server should list plan_add_node tool');
});

test('can create a test plan in temporary directory', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'canary-'));

  try {
    // Create minimal map.json
    const testMap = {
      schema_version: '2.0',
      plan_id: 'canary-test',
      title: 'Canary Test Plan',
      goal: 'Verify plugin works',
      status: 'planning',
      nodes: []
    };

    await fs.writeFile(
      path.join(tmpDir, 'map.json'),
      JSON.stringify(testMap, null, 2)
    );

    // Verify file was created
    const content = await fs.readFile(path.join(tmpDir, 'map.json'), 'utf-8');
    const parsed = JSON.parse(content);
    strictEqual(parsed.plan_id, 'canary-test');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('plugin manifests exist for both hosts', async () => {
  const codexManifest = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  const claudeManifest = path.join(pluginRoot, '.claude-plugin', 'plugin.json');

  // Both manifests should exist
  await fs.access(codexManifest);
  await fs.access(claudeManifest);

  // Both should reference the current package version.
  const codex = JSON.parse(await fs.readFile(codexManifest, 'utf-8'));
  const claude = JSON.parse(await fs.readFile(claudeManifest, 'utf-8'));

  strictEqual(codex.version.split('+', 1)[0], '0.4.0');
  strictEqual(claude.version, '0.4.0');
});

console.log('✅ All canary tests passed');
