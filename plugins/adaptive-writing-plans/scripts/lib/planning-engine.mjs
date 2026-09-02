import { partitionBehaviorCandidates } from './scope-budget.mjs';
import { selectVisibleProvider } from './provider-registry.mjs';

const LOW_CLARITY = ['goal_clarity', 'scope_clarity', 'success_criteria_clarity', 'now_later_boundary'];
const DESIGN_SIGNALS = [
  'design_required',
  'public_api',
  'contract_change',
  'data_model_change',
  'security_boundary',
  'failure_semantics',
  'migration_required',
  'user_experience_flow',
  'multiple_valid_approaches',
];

function hasConcreteAmbiguity(signals) {
  return signals.concrete_ambiguity === true
    || LOW_CLARITY.some((key) => signals[key] === 'low');
}

function hasUncertainDependency(signals) {
  return signals.uncertain_dependency === true
    || signals.dependency_unknown === true
    || ['high', 'critical'].includes(signals.dependency_unknown);
}

function hasDesignEvidence(signals) {
  return DESIGN_SIGNALS.some((key) => signals[key] === true)
    || (Array.isArray(signals.design_evidence) && signals.design_evidence.length > 0);
}

export function triageTask(signals = {}) {
  if (hasConcreteAmbiguity(signals)) {
    return { mode: 'guide', work_shape: 'undetermined', stage: 'guiding', strategy: null, reasons: ['concrete ambiguity'] };
  }
  if (hasUncertainDependency(signals)) {
    return { mode: 'map', work_shape: 'map', stage: 'mapping', strategy: 'progressive', reasons: ['uncertain dependency'] };
  }
  if (signals.cross_subsystem === true) {
    return { mode: 'map', work_shape: 'map', stage: 'mapping', strategy: 'topological', reasons: ['cross-subsystem coordination'] };
  }
  if (hasDesignEvidence(signals)) {
    return { mode: 'plan', work_shape: 'plan', stage: 'planning', strategy: 'design-first', reasons: ['concrete design evidence'] };
  }
  return { mode: 'direct', work_shape: 'direct', stage: 'executing', strategy: 'direct', reasons: ['no escalation evidence'] };
}

const PHASE_ROUTES = {
  guide: [{ capability: 'clarify', role: 'clarifier' }],
  map: [{ capability: 'explore', role: 'explorer' }, { capability: 'decompose', role: 'mapper' }],
  plan: [{ capability: 'decompose', role: 'planner' }, { capability: 'review', role: 'reviewer' }],
};

export function routePlanning(signals = {}, visibleProviders = signals.visible_providers) {
  const triage = triageTask(signals);
  if (triage.mode === 'direct') {
    return {
      ...triage,
      routes: [],
      provider: null,
      fallback: [],
      planning_artifacts: [],
      reason: 'stable work stays direct; no planning artifact is created',
    };
  }
  const phaseRoutes = PHASE_ROUTES[triage.mode] ?? [];
  const requestedRoutes = triage.strategy === 'design-first'
    ? [{ capability: 'design', role: 'designer' }, ...phaseRoutes]
    : phaseRoutes;
  const routes = requestedRoutes.map(({ capability, role }) =>
    selectVisibleProvider({ capability, role, visibleProviders }));
  return {
    ...triage,
    routes,
    provider: routes.find((route) => route.status === 'ready_to_invoke')?.provider ?? null,
    fallback: routes.filter((route) => route.status === 'unavailable').map((route) => route.fallback),
    planning_artifacts: triage.mode === 'map' ? ['map-proposal'] : triage.mode === 'plan' ? ['leaf-plan-proposal'] : [],
  };
}

export function assessBehaviorCandidates(map, nodeId, candidates) {
  const node = map?.nodes?.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Unknown node ${nodeId}`);
  return {
    node_id: nodeId,
    current_behavior_budget: structuredClone(node.behavior_budget ?? {}),
    ...partitionBehaviorCandidates(node.behavior_budget ?? map.behavior_budget, candidates),
  };
}
