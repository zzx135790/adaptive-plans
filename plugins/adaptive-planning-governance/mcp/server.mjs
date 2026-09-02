#!/usr/bin/env node
import fs from 'node:fs';
import { listenStdin } from '../scripts/lib/stdio.mjs';
import { validateContext } from './context.mjs';
import {
  appendEvent,
  buildPlanOverview,
  diagnosePlanBinding,
  getNextNodes,
  loadMap,
  validatePlanCompletion,
  validateMap,
} from '../scripts/lib/plan-protocol.mjs';
import {
  addNode,
  assessNodeReadiness,
  ingestProviderResult,
  invalidateFromDesignRevision,
  invalidateFromEvidence,
  linkApprovedDesign,
  linkArchitectureSnapshot,
  recordArchitectureImpact,
  routePlanning,
  triageTask,
} from '../scripts/lib/planning-engine.mjs';
import {
  applyArchitectureDelta,
  loadArchitecture,
  proposeArchitectureDelta,
  scanArchitectureProposal,
  validateArchitecture,
} from '../scripts/lib/architecture-protocol.mjs';
import { analyzeArchitectureImpact, validateArchitectureImpact } from '../scripts/lib/architecture-impact.mjs';
import {
  approveDesign,
  createDesignDocument,
  designApprovalBrief,
  loadDesign,
  recordDesignProviderResult,
  reviseDesign,
  selectDesignProviders,
  triageDesign,
  updateDesignRevision,
  validateDesignDocument,
  writeDesign,
} from '../scripts/lib/design-engine.mjs';
import {
  applyPosturePromotion,
  assessEngineeringPosture,
  checkPostureMap,
  previewPosturePromotion,
} from '../scripts/lib/posture-operations.mjs';

const contextSchema = {
  type: 'object',
  required: ['project_root'],
  properties: {
    project_root: { type: 'string' },
    plan_path: { type: 'string' },
  },
  additionalProperties: false,
};

const toolDefinitions = [
  {
    name: 'plan_open',
    description: 'Read the complete machine-readable plan map.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_overview',
    description: 'Return an inline-ready DAG, gate summary, blocked nodes, and complete artifact index.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_get_map',
    description: 'Read a bounded view of the plan map and its nodes.',
    inputSchema: {
      type: 'object',
      properties: { node_ids: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_get_node',
    description: 'Read one node by stable node ID.',
    inputSchema: {
      type: 'object',
      required: ['node_id'],
      properties: { node_id: { type: 'string' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_next',
    description: 'Return nodes whose dependencies are complete and whose gates are open.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_validate',
    description: 'Validate node IDs, dependency references, statuses, and cycles.',
    inputSchema: { type: 'object', properties: { strict: { type: 'boolean' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_validate_completion',
    description: 'Validate intent, design, architecture synchronization, and current node completion gates.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_binding_status',
    description: 'Diagnose startup-bound project and plan roots without treating a mismatch as missing plan state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'posture_assess',
    description: 'Return one explicit candidate EngineeringPosture, its PostureRef, and evidence gaps without writing state.',
    inputSchema: { type: 'object', required: ['assessment'], properties: { assessment: { type: 'object', additionalProperties: true } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'posture_check',
    description: 'Check map or node posture refs, provenance, behavior budgets, design refs, and provider blockers without mutation.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string' },
        behavior_candidates: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'posture_promotion_preview',
    description: 'Create an explicit hash-bound posture promotion proposal and ApprovalBrief without writing state.',
    inputSchema: { type: 'object', required: ['target'], properties: { target: { type: 'object', additionalProperties: true } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'posture_promotion_apply',
    description: 'Apply an exact approved posture proposal and re-enter design and architecture gates.',
    inputSchema: {
      type: 'object',
      required: ['proposal', 'expected_proposal_hash', 'expected_posture_hash', 'brief_hash', 'approval'],
      properties: {
        proposal: { type: 'object', additionalProperties: true },
        expected_proposal_hash: { type: 'string', minLength: 64, maxLength: 64 },
        expected_posture_hash: { type: 'string', minLength: 64, maxLength: 64 },
        brief_hash: { type: 'string', minLength: 64, maxLength: 64 },
        approval: {},
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_append_event',
    description: 'Append one idempotent fact, evidence, decision, or checkpoint event.',
    inputSchema: {
      type: 'object',
      required: ['event'],
      properties: {
        event: {
          type: 'object',
          required: ['event_id', 'type'],
          properties: {
            event_id: { type: 'string' },
            type: { type: 'string' },
            message: { type: 'string' },
            source: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_assess_node',
    description: 'Check whether a node has enough evidence to generate a leaf plan.',
    inputSchema: {
      type: 'object',
      required: ['node_id'],
      properties: { node_id: { type: 'string' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_triage',
    description: 'Choose guide, map, plan, or direct mode from supplied uncertainty signals.',
    inputSchema: {
      type: 'object',
      properties: { signals: { type: 'object', additionalProperties: true } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_route',
    description: 'Route planning phases through providers visible in the current Codex session, with bounded Ada fallbacks.',
    inputSchema: {
      type: 'object',
      properties: {
        signals: { type: 'object', additionalProperties: true },
        visible_providers: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_add_node',
    description: 'Add a node and compute its readiness without auto-completing it.',
    inputSchema: {
      type: 'object',
      required: ['node'],
      properties: { node: { type: 'object', additionalProperties: true } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'plan_ingest_provider',
    description: 'Normalize and append a provider result while preserving raw output.',
    inputSchema: {
      type: 'object',
      required: ['provider_id', 'capability', 'result'],
      properties: {
        provider_id: { type: 'string' },
        capability: { type: 'string' },
        source: { type: 'string' },
        result: {},
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_invalidate_node',
    description: 'Record new evidence and mark affected descendants stale for explicit replanning.',
    inputSchema: {
      type: 'object',
      required: ['node_id', 'message'],
      properties: {
        node_id: { type: 'string' },
        message: { type: 'string' },
        source: { type: 'string' },
        decision: { type: 'string' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_link_architecture',
    description: 'Bind the map to an approved architecture revision and its module contract hashes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_link_design',
    description: 'Bind the map or one node to the approved current design revision.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'plan_record_architecture_impact',
    description: 'Update the architecture synchronization gate from a persisted ArchitectureImpact.',
    inputSchema: { type: 'object', required: ['impact'], properties: { impact: { type: 'object' }, artifact_path: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'architecture_open',
    description: 'Read the approved project architecture baseline and module contracts.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'architecture_validate',
    description: 'Validate module ownership, concern packs, typed relations, evidence, and hashes.',
    inputSchema: { type: 'object', properties: { architecture: { type: 'object' }, proposal: { type: 'boolean' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'architecture_bootstrap_scan',
    description: 'Scan project structure and return an unapproved architecture proposal without writing a baseline.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'architecture_check_diff',
    description: 'Classify changed paths against module ownership and public contract surfaces.',
    inputSchema: {
      type: 'object', required: ['changed_paths'],
      properties: { changed_paths: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array' }, classification: { type: 'string' }, delta_ref: { type: 'string' }, approval: {} },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'architecture_propose_delta',
    description: 'Create a pending, hash-bound architecture delta without changing the baseline.',
    inputSchema: { type: 'object', required: ['proposed_architecture'], properties: { proposed_architecture: { type: 'object' }, details: { type: 'object' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'architecture_apply_delta',
    description: 'Apply an approved architecture delta when its base hash still matches.',
    inputSchema: { type: 'object', required: ['delta', 'approval'], properties: { delta: { type: 'object' }, approval: {} }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'design_triage',
    description: 'Determine whether design is required and derive task-specific concerns and risk.',
    inputSchema: { type: 'object', properties: { request: { type: 'object' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'design_route',
    description: 'Select a visible driver/reference/reviewer skill bundle for a DesignProfile.',
    inputSchema: { type: 'object', required: ['profile', 'registry'], properties: { profile: { type: 'object' }, registry: { type: 'object' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'design_start',
    description: 'Create the first in-progress design revision after triage and provider routing.',
    inputSchema: { type: 'object', required: ['request', 'provider_selection'], properties: { request: { type: 'object' }, provider_selection: { type: 'object' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'design_update',
    description: 'Update the exact current in-progress design revision using optimistic hash matching.',
    inputSchema: { type: 'object', required: ['updates', 'expected_hash'], properties: { updates: { type: 'object' }, expected_hash: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'design_revise',
    description: 'Mark the current design stale and create a linked in-progress revision after new evidence.',
    inputSchema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: { type: 'string' },
        blocking_questions: { type: 'array', items: { type: 'string' } },
        request: { type: 'object' },
        provider_selection: { type: 'object' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'design_record_result',
    description: 'Attach one provider contribution to the current design revision without granting it state authority.',
    inputSchema: { type: 'object', required: ['result'], properties: { result: { type: 'object' }, expected_hash: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'design_approval_brief',
    description: 'Render the current exact design ApprovalBrief for inline terminal confirmation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'design_approve',
    description: 'Approve the exact current design content, posture, and inline brief hashes with explicit user evidence or a recorded provider-gap waiver.',
    inputSchema: {
      type: 'object',
      required: ['expected_hash', 'expected_posture_hash', 'brief_hash', 'approval'],
      properties: {
        expected_hash: { type: 'string', minLength: 1 },
        expected_posture_hash: { type: ['string', 'null'] },
        brief_hash: { type: 'string', minLength: 1 },
        approval: {},
        waiver: {},
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const tools = toolDefinitions.map((tool) => ({
  ...tool,
  inputSchema: {
    ...tool.inputSchema,
    required: [...new Set(['context', ...(tool.inputSchema.required ?? [])])],
    properties: {
      context: contextSchema,
      ...(tool.inputSchema.properties ?? {}),
    },
    additionalProperties: false,
  },
}));

function success(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function failure(message, code = 'PLAN_ERROR') {
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent: { error: { code, message } },
  };
}

async function callTool(name, input = {}) {
  const { projectRoot, planRoot, architectureRoot } = validateContext(input.context);
  let map;
  switch (name) {
    case 'plan_open':
      map = await loadMap(planRoot);
      return success(map);
    case 'plan_overview':
      return success(await buildPlanOverview(planRoot, { projectRoot, mcpPlanRoot: planRoot }));
    case 'plan_get_map':
      map = await loadMap(planRoot);
      if (Array.isArray(input.node_ids) && input.node_ids.length > 0) {
        const wanted = new Set(input.node_ids);
        return success({ ...map, nodes: map.nodes.filter((node) => wanted.has(node.id)) });
      }
      return success(map);
    case 'plan_get_node':
      map = await loadMap(planRoot);
      {
        const node = map.nodes.find((candidate) => candidate.id === input.node_id);
        return node ? success(node) : failure(`Unknown node ${input.node_id}`, 'UNKNOWN_NODE');
      }
    case 'plan_next':
      map = await loadMap(planRoot);
      return success({ nodes: getNextNodes(map) });
    case 'plan_validate':
      map = await loadMap(planRoot);
      return success(validateMap(map, { strict: input.strict === true }));
    case 'plan_validate_completion':
      {
        let designDocument = null;
        try { designDocument = await loadDesign(planRoot); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return success(validatePlanCompletion(await loadMap(planRoot), { designDocument }));
      }
    case 'plan_binding_status':
      map = await loadMap(planRoot);
      return success(diagnosePlanBinding(planRoot, map, { projectRoot, mcpPlanRoot: planRoot }));
    case 'posture_assess':
      return success(assessEngineeringPosture(input.assessment));
    case 'posture_check': {
      map = await loadMap(planRoot);
      let designDocument = null;
      try { designDocument = await loadDesign(planRoot); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return success(checkPostureMap(map, {
        nodeId: input.node_id,
        behaviorCandidates: input.behavior_candidates,
        designDocument,
      }));
    }
    case 'posture_promotion_preview':
      return success(previewPosturePromotion(await loadMap(planRoot), input.target));
    case 'posture_promotion_apply':
      return success(await applyPosturePromotion(planRoot, input.proposal, {
        expectedProposalHash: input.expected_proposal_hash,
        expectedBasePostureHash: input.expected_posture_hash,
        briefHash: input.brief_hash,
        approval: input.approval,
      }));
    case 'plan_append_event':
      if (!input.event || typeof input.event !== 'object') return failure('event object is required', 'INVALID_EVENT');
      return success(await appendEvent(planRoot, input.event));
    case 'plan_assess_node':
      map = await loadMap(planRoot);
      return success(assessNodeReadiness(map, input.node_id));
    case 'plan_triage':
      return success(triageTask(input.signals ?? {}));
    case 'plan_route':
      return success(routePlanning(input.signals ?? {}, input.visible_providers ?? input.signals?.visible_providers));
    case 'plan_add_node':
      if (!input.node || typeof input.node !== 'object') return failure('node object is required', 'INVALID_NODE');
      return success(await addNode(planRoot, input.node));
    case 'plan_ingest_provider':
      return success(await ingestProviderResult(planRoot, input.result, {
        provider_id: input.provider_id,
        capability: input.capability,
        source: input.source,
      }));
    case 'plan_invalidate_node':
      return success(await invalidateFromEvidence(planRoot, input.node_id, input));
    case 'plan_link_architecture':
      return success(await linkArchitectureSnapshot(planRoot, await loadArchitecture(architectureRoot)));
    case 'plan_link_design':
      return success(await linkApprovedDesign(planRoot, await loadDesign(planRoot)));
    case 'plan_record_architecture_impact':
      return success(await recordArchitectureImpact(planRoot, input.impact, input.artifact_path));
    case 'architecture_open':
      return success(await loadArchitecture(architectureRoot));
    case 'architecture_validate':
      return success(validateArchitecture(input.architecture ?? await loadArchitecture(architectureRoot), { proposal: input.proposal === true }));
    case 'architecture_bootstrap_scan':
      return success(await scanArchitectureProposal(projectRoot, { projectId: input.project_id }));
    case 'architecture_check_diff': {
      const architecture = await loadArchitecture(architectureRoot);
      const impact = analyzeArchitectureImpact(architecture, input.changed_paths, input);
      return success({ impact, validation: validateArchitectureImpact(impact, architecture, { requireSatisfied: false }) });
    }
    case 'architecture_propose_delta': {
      const architecture = await loadArchitecture(architectureRoot);
      return success(proposeArchitectureDelta(architecture, input.proposed_architecture, input.details));
    }
    case 'architecture_apply_delta':
      return success(await applyArchitectureDelta(architectureRoot, input.delta, { approval: input.approval }));
    case 'design_triage':
      return success(triageDesign(input.request ?? {}));
    case 'design_route':
      return success(await selectDesignProviders(input.profile, input.registry));
    case 'design_start': {
      const profile = triageDesign(input.request);
      return success(await writeDesign(planRoot, createDesignDocument({ ...input.request, profile, provider_selection: input.provider_selection })));
    }
    case 'design_update':
      return success(await updateDesignRevision(planRoot, input.updates, { expectedHash: input.expected_hash }));
    case 'design_revise':
      {
        const currentDocument = await loadDesign(planRoot);
        const currentRevision = currentDocument.revisions.find((revision) => revision.revision === currentDocument.current_revision);
        const revised = await reviseDesign(planRoot, {
          reason: input.reason,
          blocking_questions: input.blocking_questions,
          request: input.request,
          provider_selection: input.provider_selection,
        });
        await invalidateFromDesignRevision(planRoot, {
          design_id: currentDocument.design_id,
          revision: currentRevision.revision,
          design_hash: currentRevision.design_hash,
        }, { reason: input.reason });
        return success(revised);
      }
    case 'design_record_result':
      return success(await recordDesignProviderResult(planRoot, input.result, { expectedHash: input.expected_hash }));
    case 'design_approval_brief':
      return success(designApprovalBrief(await loadDesign(planRoot)));
    case 'design_approve':
      return success(await approveDesign(planRoot, {
        expectedHash: input.expected_hash,
        expectedPostureHash: input.expected_posture_hash,
        briefHash: input.brief_hash,
        approval: input.approval,
        waiver: input.waiver,
      }));
    default:
      return failure(`Unknown tool ${name}`, 'UNKNOWN_TOOL');
  }
}

async function handle(request) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: request.params?.protocolVersion ?? '2025-03-26',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'adaptive-planning-governance', version: '0.4.0' },
      instructions: 'Use plan_overview and plan_validate before acting. Project architecture, design revisions, and plans are separate canonical states; audit events never change them automatically.',
    };
  }
  if (request.method === 'tools/list') return { tools };
  if (request.method === 'tools/call') {
    try {
      return await callTool(request.params?.name, request.params?.arguments ?? {});
    } catch (error) {
      return failure(error.message, error.code ?? 'PLAN_ERROR');
    }
  }
  if (request.method === 'resources/list') {
    return { resources: [
      { uri: 'plan://map', name: 'Current plan map', mimeType: 'application/json' },
      { uri: 'plan://overview', name: 'Human-visible plan overview', mimeType: 'application/json' },
      { uri: 'architecture://current', name: 'Current project architecture memory', mimeType: 'application/json' },
      { uri: 'design://current', name: 'Current design revisions', mimeType: 'application/json' },
    ] };
  }
  if (request.method === 'resources/read') {
    try {
      const uri = request.params?.uri;
      const { projectRoot, planRoot, architectureRoot } = validateContext(request.params?.context);
      if (uri === 'plan://map') return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await loadMap(planRoot), null, 2) }] };
      if (uri === 'plan://overview') return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await buildPlanOverview(planRoot, { projectRoot, mcpPlanRoot: planRoot }), null, 2) }] };
      if (uri === 'architecture://current') return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await loadArchitecture(architectureRoot), null, 2) }] };
      if (uri === 'design://current') return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await loadDesign(planRoot), null, 2) }] };
      return failure(`Unknown resource ${uri}`, 'UNKNOWN_RESOURCE');
    } catch (error) {
      return failure(error.message, error.code ?? 'PLAN_ERROR');
    }
  }
  if (request.method?.startsWith('notifications/')) return null;
  throw Object.assign(new Error(`Method not found: ${request.method}`), { code: -32601 });
}

let inputBuffer = Buffer.alloc(0);
let contentLength = null;
let pendingFramed = false;

function emit(response, framed) {
  if (response === null || response === undefined) return;
  const serialized = JSON.stringify(response);
  if (framed) {
    const bytes = Buffer.byteLength(serialized, 'utf8');
    fs.writeSync(process.stdout.fd, `Content-Length: ${bytes}\r\n\r\n${serialized}`);
  } else {
    fs.writeSync(process.stdout.fd, `${serialized}\n`);
  }
}

async function drain() {
  while (true) {
    let message;
    let framed = pendingFramed;
    if (contentLength === null) {
      const asText = inputBuffer.toString('utf8');
      const firstNewline = inputBuffer.indexOf(0x0a);
      const firstLine = firstNewline >= 0 ? asText.slice(0, firstNewline).trim() : asText.trim();
      const newlineJsonFirst = firstLine.startsWith('{') || firstLine.startsWith('[');
      if (!newlineJsonFirst && /(?:^|\r?\n)Content-Length:\s*\d+/i.test(asText)) {
        const crlfSeparator = asText.indexOf('\r\n\r\n');
        const lfSeparator = asText.indexOf('\n\n');
        const separator = crlfSeparator >= 0 ? crlfSeparator : lfSeparator;
        const separatorSize = crlfSeparator >= 0 ? 4 : 2;
        if (separator < 0) return;
        const header = asText.slice(0, separator);
        const match = header.match(/(?:^|\r?\n)Content-Length:\s*(\d+)/i);
        if (!match) return;
        contentLength = Number(match[1]);
        inputBuffer = inputBuffer.subarray(separator + separatorSize);
        pendingFramed = true;
        framed = true;
      }
    }
    if (contentLength !== null) {
      if (inputBuffer.length < contentLength) return;
      message = inputBuffer.subarray(0, contentLength).toString('utf8');
      inputBuffer = inputBuffer.subarray(contentLength);
      contentLength = null;
      pendingFramed = false;
    } else {
      const newline = inputBuffer.indexOf(0x0a);
      if (newline < 0) return;
      message = inputBuffer.subarray(0, newline).toString('utf8').trim();
      inputBuffer = inputBuffer.subarray(newline + 1);
      if (!message) continue;
    }
    let request;
    try {
      request = JSON.parse(message);
    } catch (error) {
      emit({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } }, framed);
      continue;
    }
    try {
      const result = await handle(request);
      if (request.id !== undefined) emit({ jsonrpc: '2.0', id: request.id, result }, framed);
    } catch (error) {
      if (request.id !== undefined) {
        emit({ jsonrpc: '2.0', id: request.id, error: { code: error.code ?? -32603, message: error.message } }, framed);
      }
    }
  }
}

let drainQueue = Promise.resolve();
listenStdin((chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainQueue = drainQueue.then(() => drain()).catch((error) => {
    console.error(`MCP drain error: ${error.message}`);
  });
}, { onError: (error) => console.error(`MCP stdin error: ${error.message}`) });
