import { isArtifactType } from '../../shared/types.js';
import { readJsonBody } from '../http/body.js';
import { HttpError } from '../http/errors.js';
import { Router } from '../http/router.js';
import { sendJson } from '../http/response.js';
import { NodeRepository } from '../nodes/node.repository.js';
import { NodeService } from '../nodes/node.service.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { dispatchAgentTurn, hostAgentAvailable } from './host-agent.js';
import { buildBranchPrompt, buildGeneratePrompt, resolveOrigin } from './prompt.js';

const UNAVAILABLE_MESSAGE = '生成需要在 agent 宿主里运行（未配置 HOST_URL / APP_TOKEN）';

function requireHostAgent(): void {
  if (!hostAgentAvailable()) throw new HttpError(501, UNAVAILABLE_MESSAGE, 'HOST_AGENT_UNAVAILABLE');
}

function parsePrompt(value: unknown): string {
  const prompt = typeof value === 'string' ? value.trim() : '';
  if (!prompt) throw new HttpError(400, 'prompt required', 'PROMPT_REQUIRED');
  return prompt;
}

function parseCount(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) {
    throw new HttpError(400, 'count must be an integer between 1 and 5', 'INVALID_COUNT');
  }
  return Number(value);
}

function parseNodeIds(value: unknown, count: number): string[] {
  if (!Array.isArray(value) || value.length !== count || !value.every((id) => typeof id === 'string' && id)) {
    throw new HttpError(400, 'nodeIds must be an array of ids matching count', 'INVALID_NODE_IDS');
  }
  return value as string[];
}

/** 生成结束后,把仍处于「占位」状态(artifact 节点、content 仍为 null)的节点标记失败,避免永远转圈。 */
function settlePendingPlaceholders(nodes: NodeRepository, nodeService: NodeService, nodeIds: string[], ok: boolean, message: string): void {
  for (const nodeId of nodeIds) {
    const node = nodes.find(nodeId);
    if (!node || !isArtifactType(node.type) || node.content) continue;
    try {
      nodeService.markArtifactError(nodeId, { error: ok ? '生成结束，但该节点未被完成' : `生成失败：${message}` });
    } catch (error) {
      console.error('[agent]', 'failed to mark placeholder as failed', nodeId, error);
    }
  }
}

export function registerAgentRoutes(router: Router, projects: ProjectRepository, nodes: NodeRepository, nodeService: NodeService): void {
  router.post('/api/projects/:projectId/generate', async ({ req, res, params }) => {
    requireHostAgent();
    const project = projects.find(params.projectId);
    if (!project) throw new HttpError(404, 'project not found', 'PROJECT_NOT_FOUND');

    const body = await readJsonBody(req);
    const prompt = parsePrompt(body.prompt);
    const count = parseCount(body.count);
    const nodeIds = parseNodeIds(body.nodeIds, count);
    for (const nodeId of nodeIds) {
      if (!nodes.findInProject(nodeId, params.projectId)) throw new HttpError(404, `node ${nodeId} not found in project`, 'NODE_NOT_FOUND');
    }

    const instruction = buildGeneratePrompt({ origin: resolveOrigin(), projectId: params.projectId, prompt, count, nodeIds });
    dispatchAgentTurn(instruction, (ok, message) => settlePendingPlaceholders(nodes, nodeService, nodeIds, ok, message));
    sendJson(res, 202, { accepted: true, nodeIds });
  });

  router.post('/api/nodes/:nodeId/branch', async ({ req, res, params }) => {
    requireHostAgent();
    const parent = nodes.find(params.nodeId);
    if (!parent) throw new HttpError(404, 'node not found', 'NODE_NOT_FOUND');

    const body = await readJsonBody(req);
    const prompt = parsePrompt(body.prompt);
    const count = parseCount(body.count);
    const nodeIds = parseNodeIds(body.nodeIds, count);
    for (const nodeId of nodeIds) {
      if (!nodes.findInProject(nodeId, parent.project_id)) throw new HttpError(404, `node ${nodeId} not found in project`, 'NODE_NOT_FOUND');
    }

    const instruction = buildBranchPrompt({
      origin: resolveOrigin(), projectId: parent.project_id, nodeId: parent.id, nodeTitle: parent.title, prompt, count, nodeIds,
    });
    dispatchAgentTurn(instruction, (ok, message) => settlePendingPlaceholders(nodes, nodeService, nodeIds, ok, message));
    sendJson(res, 202, { accepted: true, nodeIds });
  });
}
