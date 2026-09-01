// 生成入口:校验占位节点 → 202 → 后台流水线(计划 + 逐卡补全)。
import { readJsonBody } from '../http/body.js';
import { HttpError } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { sendJson } from '../http/response.js';
import type { NodeRepository } from '../nodes/node.repository.js';
import type { NodeService } from '../nodes/node.service.js';
import type { ProjectRepository } from '../projects/project.repository.js';
import { hostAiAvailable } from './host-ai.js';
import { dispatchGeneration } from './run.js';

const UNAVAILABLE_MESSAGE = '生成需要在契约宿主里运行（未配置 HOST_URL / APP_TOKEN）';

function requireHostAi(): void {
  if (!hostAiAvailable()) throw new HttpError(501, UNAVAILABLE_MESSAGE, 'HOST_AI_UNAVAILABLE');
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

export function registerGenerationRoutes(router: Router, projects: ProjectRepository, nodes: NodeRepository, nodeService: NodeService): void {
  router.post('/api/projects/:projectId/generate', async ({ req, res, params }) => {
    requireHostAi();
    const project = projects.find(params.projectId);
    if (!project) throw new HttpError(404, 'project not found', 'PROJECT_NOT_FOUND');

    const body = await readJsonBody(req);
    const prompt = parsePrompt(body.prompt);
    const count = parseCount(body.count);
    const nodeIds = parseNodeIds(body.nodeIds, count);
    for (const nodeId of nodeIds) {
      if (!nodes.findInProject(nodeId, params.projectId)) throw new HttpError(404, `node ${nodeId} not found in project`, 'NODE_NOT_FOUND');
    }

    dispatchGeneration(nodes, nodeService, { kind: 'root', prompt, count, nodeIds });
    sendJson(res, 202, { accepted: true, nodeIds });
  });

  router.post('/api/nodes/:nodeId/branch', async ({ req, res, params }) => {
    requireHostAi();
    const parent = nodes.find(params.nodeId);
    if (!parent) throw new HttpError(404, 'node not found', 'NODE_NOT_FOUND');

    const body = await readJsonBody(req);
    const prompt = parsePrompt(body.prompt);
    const count = parseCount(body.count);
    const nodeIds = parseNodeIds(body.nodeIds, count);
    for (const nodeId of nodeIds) {
      if (!nodes.findInProject(nodeId, parent.project_id)) throw new HttpError(404, `node ${nodeId} not found in project`, 'NODE_NOT_FOUND');
    }

    // 父级上下文:有 artifact 就带完整源码,纯文本节点带正文
    let parentContent = '';
    try { parentContent = String((nodeService.artifactSource(parent.id) as any)?.source ?? ''); }
    catch { parentContent = String(parent.content || ''); }

    dispatchGeneration(nodes, nodeService, {
      kind: 'branch', prompt, count, nodeIds,
      parent: { type: parent.type, content: parentContent },
    });
    sendJson(res, 202, { accepted: true, nodeIds });
  });
}
