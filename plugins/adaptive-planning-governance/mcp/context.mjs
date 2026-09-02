#!/usr/bin/env node
/**
 * Context validation and path safety for request-scoped MCP operations.
 *
 * Every MCP tool call must provide { context: { project_root, plan_path } }.
 * This module validates that project roots are existing absolute directories
 * and that plan paths are project-relative with no traversal or symlink escapes.
 */

import fs from 'node:fs';
import path from 'node:path';

function resolveThroughExistingAncestor(target) {
  let existing = target;
  const missingSegments = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...missingSegments);
}

function isContained(target, root) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function resolveContainedProjectPath(projectRoot, relativePath, field) {
  const canonicalPath = resolveThroughExistingAncestor(path.resolve(projectRoot, relativePath));
  if (!isContained(canonicalPath, projectRoot)) {
    throw Object.assign(
      new Error(`${field} escapes project_root: ${relativePath}`),
      { code: 'PATH_TRAVERSAL' }
    );
  }
  return canonicalPath;
}

/**
 * Validate and resolve a request context.
 *
 * @param {object} context - { project_root: string, plan_path?: string }
 * @returns {{ projectRoot: string, planRoot: string, architectureRoot: string }}
 * @throws {Error} with code INVALID_CONTEXT if validation fails
 */
export function validateContext(context) {
  if (!context || typeof context !== 'object') {
    throw Object.assign(
      new Error('context object is required'),
      { code: 'INVALID_CONTEXT' }
    );
  }

  const { project_root, plan_path } = context;

  // Validate project_root: must be an existing absolute directory
  if (typeof project_root !== 'string' || !path.isAbsolute(project_root)) {
    throw Object.assign(
      new Error('context.project_root must be an absolute path'),
      { code: 'INVALID_CONTEXT' }
    );
  }

  // Check project root exists and is a directory
  let projectStats;
  try {
    projectStats = fs.statSync(project_root);
  } catch (error) {
    throw Object.assign(
      new Error(`context.project_root does not exist: ${project_root}`),
      { code: 'INVALID_CONTEXT' }
    );
  }

  if (!projectStats.isDirectory()) {
    throw Object.assign(
      new Error(`context.project_root is not a directory: ${project_root}`),
      { code: 'INVALID_CONTEXT' }
    );
  }

  // Resolve canonical project root (follows symlinks)
  const projectRoot = fs.realpathSync(project_root);

  // Validate plan_path if provided: must be project-relative
  let planRoot;
  if (Object.hasOwn(context, 'plan_path')) {
    if (typeof plan_path !== 'string' || !plan_path.trim()) {
      throw Object.assign(
        new Error('context.plan_path must be a non-empty string'),
        { code: 'INVALID_CONTEXT' }
      );
    }

    // Reject absolute paths
    if (path.isAbsolute(plan_path)) {
      throw Object.assign(
        new Error('context.plan_path must be relative to project_root'),
        { code: 'INVALID_CONTEXT' }
      );
    }

    planRoot = resolveContainedProjectPath(projectRoot, plan_path, 'context.plan_path');
  } else {
    // Default plan root: project_root/docs/superpowers/plans
    planRoot = resolveContainedProjectPath(projectRoot, path.join('docs', 'superpowers', 'plans'), 'default plan root');
  }

  // Architecture root: project_root/docs/architecture/adaptive
  const architectureRoot = resolveContainedProjectPath(projectRoot, path.join('docs', 'architecture', 'adaptive'), 'default architecture root');

  return { projectRoot, planRoot, architectureRoot };
}

/**
 * Validate a file path is safe and contained within the project root.
 *
 * @param {string} filePath - Path to validate
 * @param {string} projectRoot - Canonical project root
 * @throws {Error} with code PATH_TRAVERSAL if path escapes project root
 */
export function validateSafePath(filePath, projectRoot) {
  if (!filePath || typeof filePath !== 'string') {
    throw Object.assign(
      new Error('filePath must be a non-empty string'),
      { code: 'INVALID_PATH' }
    );
  }

  // Resolve absolute path
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectRoot, filePath);

  // Get canonical path (follows symlinks)
  const canonicalPath = resolveThroughExistingAncestor(absolutePath);

  // Check containment
  if (!isContained(canonicalPath, projectRoot)) {
    throw Object.assign(
      new Error(`Path escapes project root: ${filePath}`),
      { code: 'PATH_TRAVERSAL' }
    );
  }

  return canonicalPath;
}
