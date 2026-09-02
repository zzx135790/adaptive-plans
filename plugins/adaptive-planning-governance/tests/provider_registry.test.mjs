import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  discoverProviders,
  inferCapabilities,
  selectVisibleProvider,
  transitionProviderInvocation,
} from '../scripts/lib/provider-registry.mjs';

test('provider discovery maps installed skills and MCP servers without executing them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-providers-'));
  const skills = path.join(root, 'skills');
  const plugins = path.join(root, 'plugins');
  await fs.mkdir(path.join(skills, 'planning-clarification'), { recursive: true });
  await fs.writeFile(path.join(skills, 'planning-clarification', 'SKILL.md'), [
    '---',
    'name: planning-clarification',
    'description: Use when requirements need clarification and blocking questions.',
    'capabilities: [clarify, explore]',
    '---',
    '# Clarify',
    '',
  ].join('\n'), 'utf8');
  await fs.mkdir(path.join(skills, 'meta-scenario-planning'), { recursive: true });
  await fs.writeFile(path.join(skills, 'meta-scenario-planning', 'SKILL.md'), [
    '---',
    'name: meta-scenario-planning',
    'description: Explore uncertain futures and risks.',
    'capabilities:',
    '  - scenario',
    '---',
    '# Scenarios',
    '',
  ].join('\n'), 'utf8');
  const pluginRoot = path.join(plugins, 'research-plugin');
  await fs.mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
  await fs.writeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'research-plugin', description: 'Repository exploration provider',
  }), 'utf8');
  await fs.writeFile(path.join(pluginRoot, '.mcp.json'), JSON.stringify({
    mcpServers: { research: { command: 'node', args: ['server.mjs'], description: 'Explore repository evidence' } },
  }), 'utf8');

  const registry = await discoverProviders({ skillsRoots: [skills], pluginRoots: [plugins] });
  assert.equal(registry.policy.discovery_only, true);
  assert.equal(registry.policy.installation, 'never-automatic');
  assert.equal(registry.fallbacks.clarify, 'bounded-user-question');
  const ids = registry.providers.map((provider) => provider.id);
  assert.ok(ids.includes('planning-clarification'));
  assert.ok(ids.includes('meta-scenario-planning'));
  assert.ok(ids.includes('research-plugin/research'));
  assert.equal(registry.providers.find((provider) => provider.id === 'research-plugin/research').availability, 'discovered');
  assert.ok(registry.providers.find((provider) => provider.id === 'planning-clarification').capabilities.includes('clarify'));
  assert.ok(registry.providers.find((provider) => provider.id === 'planning-clarification').capabilities.includes('explore'));
  assert.ok(registry.providers.find((provider) => provider.id === 'meta-scenario-planning').capabilities.includes('scenario'));
  assert.ok(registry.providers.find((provider) => provider.id === 'research-plugin/research').capabilities.includes('explore'));
  assert.equal(registry.providers.find((provider) => provider.id === 'research-plugin/research').execution, 'not-invoked');
  assert.equal(registry.providers.find((provider) => provider.id === 'research-plugin/research').lifecycle.discovery, 'installed');
  assert.equal(registry.providers.find((provider) => provider.id === 'research-plugin/research').lifecycle.invocation, 'not_invoked');
  assert.equal(registry.providers.find((provider) => provider.id === 'research-plugin/research').lifecycle.persistence, 'not_verified');
  assert.match(registry.providers.find((provider) => provider.id === 'planning-clarification').identity.version_or_digest, /^sha256:/);
});

test('capability inference accepts explicit aliases and keeps unknown text conservative', () => {
  assert.deepEqual(inferCapabilities('custom', 'Ask questions and compare alternatives', ['clarification']), ['clarify', 'decide']);
  assert.deepEqual(inferCapabilities('opaque', 'A general helper', []), []);
});

test('visible provider selection ignores hidden candidates and prefers an exact role match', () => {
  const result = selectVisibleProvider({
    capability: 'explore',
    role: 'explorer',
    visibleProviders: {
      providers: [
        { id: 'hidden-explorer', capabilities: ['explore'], roles: ['explorer'], visible: false },
        { id: 'visible-general', capabilities: ['explore'], roles: ['reviewer'], visible: true },
        { id: 'visible-explorer', capabilities: ['explore'], roles: ['explorer'], visible: true },
      ],
    },
  });
  assert.equal(result.status, 'ready_to_invoke');
  assert.equal(result.provider, 'visible-explorer');
  assert.equal(result.invocation, 'not_invoked');
  assert.match(result.reason, /visible provider/);
  assert.ok(result.acceptance);
  assert.ok(result.verification.length > 0);
});

test('provider invocation becomes invoked only after a matching host receipt', () => {
  const selected = selectVisibleProvider({
    capability: 'explore',
    visibleProviders: { providers: [{ id: 'visible-explorer', capabilities: ['explore'], visible: true }] },
  });
  assert.equal(selected.status, 'ready_to_invoke');
  assert.equal(selected.invocation, 'not_invoked');

  assert.throws(
    () => transitionProviderInvocation(selected, { provider_id: 'other-provider' }),
    /provider id/i,
  );
  const invoked = transitionProviderInvocation(selected, { provider_id: 'visible-explorer', receipt_id: 'host-42' });
  assert.equal(invoked.status, 'invoked');
  assert.equal(invoked.invocation, 'invoked');
  assert.equal(invoked.receipt_id, 'host-42');
  assert.equal(selected.status, 'ready_to_invoke');
});

test('filesystem-discovered providers are ineligible without explicit visibility', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-provider-ineligible-'));
  const skills = path.join(root, 'skills', 'explorer');
  await fs.mkdir(skills, { recursive: true });
  await fs.writeFile(path.join(skills, 'SKILL.md'), '---\nname: explorer\ncapabilities: [explore]\n---\n', 'utf8');
  const discovered = await discoverProviders({ skillsRoots: [path.dirname(skills)] });
  const result = selectVisibleProvider({ capability: 'explore', visibleProviders: discovered });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.invocation, 'not_invoked');
  assert.ok(result.fallback);
});

test('missing visible providers return a bounded fallback without discovery or invocation', () => {
  const result = selectVisibleProvider({
    capability: 'decompose',
    role: 'mapper',
    visibleProviders: {
      providers: [{ id: 'hidden-mapper', capabilities: ['decompose'], visible: false }],
      fallbacks: { decompose: 'session-progressive-map' },
    },
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.provider, null);
  assert.equal(result.fallback, 'session-progressive-map');
  assert.match(result.reason, /no visible provider matched/);
  assert.ok(result.acceptance);
  assert.ok(result.verification.length > 0);
});

test('provider discovery follows symlinked skills and fills empty design metadata from the catalog', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptive-provider-links-'));
  const installed = path.join(root, 'installed', 'risk-assessment');
  const skills = path.join(root, 'skills');
  await fs.mkdir(installed, { recursive: true });
  await fs.mkdir(skills, { recursive: true });
  await fs.writeFile(path.join(installed, 'SKILL.md'), [
    '---',
    'name: risk-assessment',
    'description: Assess operational risks.',
    '---',
    '# Risk Assessment',
    '',
  ].join('\n'), 'utf8');
  await fs.symlink(installed, path.join(skills, 'risk-assessment'), 'dir');

  const registry = await discoverProviders({
    skillsRoots: [skills],
    catalog: {
      providers: [{
        id: 'risk-assessment',
        roles: ['reviewer'],
        domains: ['architecture'],
        concerns: ['security', 'migration'],
        mutability: 'read_only',
        dependency_refs: [],
        expected_outputs: ['risk-register'],
        fallback: 'visible-risk-register',
      }],
    },
  });
  const provider = registry.providers.find((item) => item.id === 'risk-assessment');
  assert.ok(provider);
  assert.deepEqual(provider.metadata.design.roles, ['reviewer']);
  assert.deepEqual(provider.metadata.design.concerns, ['security', 'migration']);
  assert.equal(provider.metadata.design.mutability, 'read_only');
  assert.equal(provider.metadata.composition.catalog_match, true);
  assert.deepEqual(provider.metadata.composition.expected_outputs, ['risk-register']);
  assert.equal(provider.lifecycle.dependency_readiness, 'ready');
  assert.equal(provider.lifecycle.invocation, 'not_invoked');
  assert.equal(provider.lifecycle.persistence, 'not_verified');
});
