import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateContext, validateSafePath } from '../mcp/context.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('MCP Context Validation', () => {
  it('rejects missing context', () => {
    assert.throws(() => validateContext(), { code: 'INVALID_CONTEXT' });
    assert.throws(() => validateContext(null), { code: 'INVALID_CONTEXT' });
  });

  it('rejects relative project_root', () => {
    assert.throws(
      () => validateContext({ project_root: 'relative/path' }),
      { code: 'INVALID_CONTEXT', message: /absolute path/ }
    );
  });

  it('rejects non-existent project_root', () => {
    assert.throws(
      () => validateContext({ project_root: '/nonexistent/path' }),
      { code: 'INVALID_CONTEXT', message: /does not exist/ }
    );
  });

  it('accepts valid absolute project_root', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    try {
      const ctx = validateContext({ project_root: tmpDir });
      assert.equal(ctx.projectRoot, fs.realpathSync(tmpDir));
      assert.ok(ctx.planRoot);
      assert.ok(ctx.architectureRoot);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects a default plan root that escapes through a symlink', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-outside-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'docs', 'superpowers'), { recursive: true });
      fs.symlinkSync(outsideDir, path.join(tmpDir, 'docs', 'superpowers', 'plans'));
      assert.throws(
        () => validateContext({ project_root: tmpDir }),
        { code: 'PATH_TRAVERSAL' },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
      fs.rmSync(outsideDir, { recursive: true });
    }
  });

  it('rejects a default architecture root that escapes through a symlink', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-outside-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'docs', 'architecture'), { recursive: true });
      fs.symlinkSync(outsideDir, path.join(tmpDir, 'docs', 'architecture', 'adaptive'));
      assert.throws(
        () => validateContext({ project_root: tmpDir }),
        { code: 'PATH_TRAVERSAL' },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
      fs.rmSync(outsideDir, { recursive: true });
    }
  });

  it('rejects absolute plan_path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    try {
      assert.throws(
        () => validateContext({ project_root: tmpDir, plan_path: '/etc/passwd' }),
        { code: 'INVALID_CONTEXT', message: /must be relative/ }
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects path traversal in plan_path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    try {
      assert.throws(
        () => validateContext({ project_root: tmpDir, plan_path: '../../etc/passwd' }),
        { code: 'PATH_TRAVERSAL', message: /escapes project_root/ }
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects a not-yet-created plan below a symlink that escapes the project', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-outside-'));
    try {
      fs.symlinkSync(outsideDir, path.join(tmpDir, 'plans'));
      assert.throws(
        () => validateContext({ project_root: tmpDir, plan_path: 'plans/new-plan' }),
        { code: 'PATH_TRAVERSAL' },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
      fs.rmSync(outsideDir, { recursive: true });
    }
  });

  it('accepts valid project-relative plan_path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const planDir = path.join(tmpDir, 'docs', 'plans', 'test-plan');
    fs.mkdirSync(planDir, { recursive: true });

    try {
      const ctx = validateContext({ project_root: tmpDir, plan_path: 'docs/plans/test-plan' });
      assert.ok(ctx.planRoot.startsWith(ctx.projectRoot));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('validates safe path containment', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    try {
      const projectRoot = fs.realpathSync(tmpDir);

      // Valid path
      const safePath = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(safePath, 'test');
      assert.doesNotThrow(() => validateSafePath('test.txt', projectRoot));

      // Path traversal
      assert.throws(
        () => validateSafePath('../../etc/passwd', projectRoot),
        { code: 'PATH_TRAVERSAL' }
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('handles symlink escapes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-outside-'));

    try {
      const projectRoot = fs.realpathSync(tmpDir);
      const symlinkPath = path.join(tmpDir, 'escape');

      // Create symlink pointing outside project
      fs.symlinkSync(outsideDir, symlinkPath);

      // Should reject symlink that escapes
      assert.throws(
        () => validateSafePath('escape', projectRoot),
        { code: 'PATH_TRAVERSAL' }
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
      fs.rmSync(outsideDir, { recursive: true });
    }
  });
});

describe('MCP Concurrent Multi-Project Isolation', () => {
  it('serves two projects without state leakage', async () => {
    const project1 = fs.mkdtempSync(path.join(os.tmpdir(), 'proj1-'));
    const project2 = fs.mkdtempSync(path.join(os.tmpdir(), 'proj2-'));

    try {
      // Validate both contexts independently
      const ctx1 = validateContext({ project_root: project1 });
      const ctx2 = validateContext({ project_root: project2 });

      // Ensure they are isolated
      assert.notEqual(ctx1.projectRoot, ctx2.projectRoot);
      assert.ok(!ctx1.planRoot.startsWith(ctx2.projectRoot));
      assert.ok(!ctx2.planRoot.startsWith(ctx1.projectRoot));
    } finally {
      fs.rmSync(project1, { recursive: true });
      fs.rmSync(project2, { recursive: true });
    }
  });
});
