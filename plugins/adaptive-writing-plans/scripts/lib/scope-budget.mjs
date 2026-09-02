import { asArray, cloneJson, isObject } from './io-utils.mjs';

export const SAFETY_FLOORS = Object.freeze([
  'bound_runaway_resource_cost',
  'fail_loud_on_invalid_results',
  'prevent_credential_exposure',
  'prevent_destructive_data_loss',
]);

function uniqueStrings(values) {
  return [...new Set(asArray(values).map(String).filter(Boolean))];
}

function candidateId(candidate) {
  return String(candidate?.behavior_id ?? candidate?.capability ?? candidate ?? '');
}

export function normalizeBehaviorBudget(input = {}) {
  const budget = isObject(input) ? input : {};
  const required = uniqueStrings([...asArray(budget.required), ...SAFETY_FLOORS]);
  const requiredSet = new Set(required);
  return {
    required,
    excluded: uniqueStrings(budget.excluded).filter((item) => !requiredSet.has(item)),
    deferred_candidates: cloneJson(asArray(budget.deferred_candidates)),
  };
}

export function partitionBehaviorCandidates(inputBudget = {}, candidates = []) {
  const budget = normalizeBehaviorBudget(inputBudget);
  const requiredIds = new Set(budget.required);
  const excludedIds = new Set(budget.excluded);
  const required = [];
  const excluded = [];
  const deferred = cloneJson(budget.deferred_candidates);
  const alreadyDeferred = new Set(deferred.map(candidateId));

  for (const source of asArray(candidates)) {
    const candidate = isObject(source) ? cloneJson(source) : { behavior_id: String(source) };
    const id = candidateId(candidate);
    const capability = String(candidate.capability ?? id);
    if (requiredIds.has(id) || requiredIds.has(capability)) required.push(candidate);
    else if (excludedIds.has(id) || excludedIds.has(capability)) {
      excluded.push({ ...candidate, reason: candidate.reason ?? 'excluded_by_behavior_budget' });
    } else if (!alreadyDeferred.has(id)) {
      deferred.push({ ...candidate, reason: candidate.reason ?? 'outside_behavior_budget' });
      alreadyDeferred.add(id);
    }
  }

  return {
    budget,
    required,
    excluded,
    deferred_candidates: deferred,
    safety_floors: [...SAFETY_FLOORS],
    mutates_budget: false,
  };
}
