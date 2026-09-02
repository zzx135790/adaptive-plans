import { asArray, isObject } from './io-utils.mjs';
import { topologicalWaves } from './plan-protocol.mjs';

const EXECUTABLE = new Set(['ready', 'in_progress', 'awaiting_validation']);

function pathOverlaps(left, right) {
  const a = String(left).replaceAll('\\', '/').replace(/^\.\//, '');
  const b = String(right).replaceAll('\\', '/').replace(/^\.\//, '');
  if (a === b) return true;
  const prefix = (value) => value.includes('*') ? value.slice(0, value.indexOf('*')) : null;
  const aPrefix = prefix(a);
  const bPrefix = prefix(b);
  if (aPrefix !== null && (b.startsWith(aPrefix) || (bPrefix !== null && aPrefix.startsWith(bPrefix)))) return true;
  if (bPrefix !== null && a.startsWith(bPrefix)) return true;
  return false;
}

function resource(resource) {
  if (isObject(resource)) {
    return {
      name: String(resource.name ?? resource.resource ?? resource.id ?? ''),
      mutable: resource.mutable !== false && resource.mutability !== 'immutable',
      partition: resource.partition ?? resource.partition_key ?? null,
    };
  }
  const value = String(resource);
  const match = value.match(/^([^:]+):partition[:=](.+)$/);
  return { name: match?.[1] ?? value, mutable: true, partition: match?.[2] ?? null };
}

function conflicts(left, right) {
  const leftMeta = left.parallelization ?? {};
  const rightMeta = right.parallelization ?? {};
  for (const leftPath of asArray(leftMeta.owned_paths)) {
    if (asArray(rightMeta.owned_paths).some((rightPath) => pathOverlaps(leftPath, rightPath))) return true;
  }
  for (const leftResource of asArray(leftMeta.shared_resources).map(resource)) {
    for (const rightResource of asArray(rightMeta.shared_resources).map(resource)) {
      if (!leftResource.name || leftResource.name !== rightResource.name) continue;
      if (!leftResource.mutable || !rightResource.mutable) continue;
      const separatelyPartitioned = leftResource.partition !== null
        && rightResource.partition !== null
        && leftResource.partition !== rightResource.partition;
      if (!separatelyPartitioned) return true;
    }
  }
  return false;
}

function candidateBlockers(node) {
  const metadata = node.parallelization ?? {};
  const blockers = [];
  if (!EXECUTABLE.has(node.status)) blockers.push(`node status ${node.status} is not executable`);
  if (asArray(metadata.owned_paths).length === 0) blockers.push('missing owned_paths');
  return blockers;
}

function partition(nodes) {
  const remaining = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  const subwaves = [];
  while (remaining.length > 0) {
    const subwave = [];
    for (let index = 0; index < remaining.length;) {
      const node = remaining[index];
      if (subwave.every((peer) => !conflicts(node, peer))) {
        subwave.push(node);
        remaining.splice(index, 1);
      } else index += 1;
    }
    subwaves.push(subwave);
  }
  return subwaves;
}

export function evaluateExecutionSafeWaves(map) {
  const topology = topologicalWaves(map);
  const executionSafeWaves = [];
  const dispatchBatches = [];
  const serial = [];

  topology.waves.forEach((dependencyWave, dependencyIndex) => {
    const candidates = [];
    for (const node of dependencyWave) {
      if (node.status === 'done' || node.status === 'completed') continue;
      const blockers = candidateBlockers(node);
      if (blockers.length > 0) {
        serial.push({
          node_id: node.id,
          dependency_wave: dependencyIndex + 1,
          execution_wave: 'serial',
          parallel: false,
          reason: blockers.join('; '),
        });
      } else candidates.push(node);
    }

    partition(candidates).forEach((subwave, subwaveIndex) => {
      const executionWave = `${dependencyIndex + 1}.${subwaveIndex + 1}`;
      const entries = subwave.map((node) => ({
        node_id: node.id,
        dependency_wave: dependencyIndex + 1,
        execution_wave: executionWave,
        parallel: subwave.length > 1,
        reason: subwave.length > 1
          ? 'dependency-ready with disjoint ownership and no shared mutable unpartitioned resource'
          : 'deterministic conflict partition or single dependency-ready leaf',
      }));
      executionSafeWaves.push(entries);
      dispatchBatches.push({
        dependency_wave: dependencyIndex + 1,
        subwave: subwaveIndex + 1,
        node_ids: entries.map((entry) => entry.node_id),
        mode: entries.length > 1 ? 'parallel' : 'serial',
      });
    });
  });

  for (const item of topology.blocked) {
    serial.push({ node_id: item.node_id, dependency_wave: null, execution_wave: 'blocked', parallel: false, reason: item.reason });
  }
  return {
    coordinator: 'main_model',
    main_model_takes_leaf_work: false,
    execution_safe_waves: executionSafeWaves,
    dispatch_batches: dispatchBatches,
    serial: serial.sort((left, right) => left.node_id.localeCompare(right.node_id)),
  };
}
