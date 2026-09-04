import { cloneJson, isObject } from './io-utils.mjs';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function error(code, message, index = null) {
  return { code, message, ...(index === null ? {} : { binding_index: index }) };
}

export function validateSkillBindings(value) {
  if (!Array.isArray(value)) {
    return [error('invalid_skill_bindings', 'skill_bindings must be an array')];
  }

  const errors = [];
  const behaviors = new Set();
  const executionOrders = new Set();
  for (const [index, binding] of value.entries()) {
    if (!isObject(binding)) {
      errors.push(error('invalid_skill_binding', `skill binding ${index} must be an object`, index));
      continue;
    }

    for (const field of ['behavior', 'purpose', 'selection_reason']) {
      if (!isNonEmptyString(binding[field])) {
        errors.push(error('invalid_skill_binding', `skill binding ${index} needs a non-empty ${field}`, index));
      }
    }
    if (!Number.isInteger(binding.execution_order) || binding.execution_order <= 0) {
      errors.push(error('invalid_execution_order', `skill binding ${index} execution_order must be a positive integer`, index));
    }

    const hasSelectedSkill = binding.selected_skill !== undefined;
    const hasAdaFallback = binding.ada_fallback !== undefined;
    if (!hasSelectedSkill && !hasAdaFallback) {
      errors.push(error('missing_skill_route', `skill binding ${index} needs selected_skill or ada_fallback`, index));
    } else if (hasSelectedSkill && hasAdaFallback) {
      errors.push(error('multiple_skill_routes', `skill binding ${index} cannot have both selected_skill and ada_fallback`, index));
    }
    if (hasSelectedSkill && !isNonEmptyString(binding.selected_skill)) {
      errors.push(error('invalid_skill_name', `skill binding ${index} selected_skill must be a non-empty string`, index));
    }
    if (hasAdaFallback && !isNonEmptyString(binding.ada_fallback)) {
      errors.push(error('invalid_skill_name', `skill binding ${index} ada_fallback must be a non-empty string`, index));
    }

    const alternatives = binding.alternatives ?? [];
    if (!Array.isArray(alternatives)) {
      errors.push(error('invalid_skill_alternatives', `skill binding ${index} alternatives must be an array`, index));
    } else {
      if (alternatives.length > 2) {
        errors.push(error('too_many_skill_alternatives', `skill binding ${index} may have at most two alternatives`, index));
      }
      for (const alternative of alternatives) {
        if (!isObject(alternative)
          || !isNonEmptyString(alternative.skill)
          || !isNonEmptyString(alternative.not_selected_reason)) {
          errors.push(error('invalid_skill_alternative', `skill binding ${index} has an invalid alternative`, index));
        }
      }
    }
    if (Object.hasOwn(binding, 'override_reason') && !isNonEmptyString(binding.override_reason)) {
      errors.push(error('invalid_override_reason', `skill binding ${index} override_reason must be non-empty`, index));
    }

    if (isNonEmptyString(binding.behavior)) {
      if (behaviors.has(binding.behavior)) {
        errors.push(error('duplicate_skill_behavior', `skill binding behavior must be unique: ${binding.behavior}`, index));
      }
      behaviors.add(binding.behavior);
    }
    if (Number.isInteger(binding.execution_order) && binding.execution_order > 0) {
      if (executionOrders.has(binding.execution_order)) {
        errors.push(error('duplicate_skill_execution_order', `skill binding execution_order must be unique: ${binding.execution_order}`, index));
      }
      executionOrders.add(binding.execution_order);
    }
  }
  return errors;
}

export function normalizeSkillBindings(value) {
  const errors = validateSkillBindings(value);
  if (errors.length > 0) throw new Error(errors.map((item) => item.message).join('; '));
  const bindings = cloneJson(value);
  for (const binding of bindings) binding.alternatives ??= [];
  return bindings.sort((left, right) => left.execution_order - right.execution_order);
}

export function renderSkillRouteLine(value) {
  const bindings = normalizeSkillBindings(value);
  if (bindings.length === 0) return null;
  return `Skill route: ${bindings.map((binding) => {
    const selected = binding.selected_skill ?? binding.ada_fallback;
    return `${binding.behavior} -> ${selected} (${binding.selection_reason})`;
  }).join('; ')}`;
}

export function renderSkillBindings(value) {
  const bindings = normalizeSkillBindings(value);
  if (bindings.length === 0) return 'No skill bindings.';
  return bindings.flatMap((binding) => {
    const routeLabel = binding.selected_skill ? 'Selected skill' : 'Ada fallback';
    const alternatives = binding.alternatives;
    const lines = [
      `### ${binding.execution_order}. ${binding.behavior}`,
      '',
      `- Purpose: ${binding.purpose}`,
      `- ${routeLabel}: ${binding.selected_skill ?? binding.ada_fallback}`,
      `- Selection reason: ${binding.selection_reason}`,
      `- Alternatives: ${alternatives.length === 0 ? 'none' : alternatives.map((item) => `${item.skill} (${item.not_selected_reason})`).join('; ')}`,
    ];
    if (binding.override_reason !== undefined) lines.push(`- Override reason: ${binding.override_reason}`);
    return [...lines, ''];
  }).join('\n').trimEnd();
}
