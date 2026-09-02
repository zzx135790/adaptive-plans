import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeTextAtomic(filePath, content) {
  await ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, filePath);
  } catch (error) {
    try { await fs.unlink(temporary); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function withFileLock(lockPath, operation, options = {}) {
  const deadline = Date.now() + Number(options.timeoutMs ?? 5_000);
  const staleMs = Number(options.staleMs ?? 30_000);
  await ensureDir(path.dirname(lockPath));
  let handle;
  while (!handle) {
    try {
      handle = await fs.open(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) await fs.unlink(lockPath);
      } catch (statError) {
        if (!['ENOENT', 'EPERM'].includes(statError.code)) throw statError;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    try { await fs.unlink(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function normalizeRelativePath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function matchesPath(pattern, candidate) {
  const normalizedPattern = normalizeRelativePath(pattern);
  const normalizedCandidate = normalizeRelativePath(candidate);
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const expression = escaped
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${expression}$`).test(normalizedCandidate);
}
