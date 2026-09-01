// 生成流水线:计划(1 次补全,结构化方向)→ 逐卡生成(每卡 1 次补全)。
// 全程没有 agent、没有工具 —— 慢的只是模型本身。
import { isArtifactType } from '../../shared/types.js';
import type { NodeRepository } from '../nodes/node.repository.js';
import type { NodeService } from '../nodes/node.service.js';
import { hostComplete } from './host-ai.js';
import {
  type CardType, type Direction,
  PLAN_SYSTEM, branchPrompt, contentError, generatorSystem,
  normalizeContent, parseDirections, planPrompt, rootPrompt,
} from './prompts.js';

const MAX_PARENT_CHARS = 140_000;
const CONCURRENCY = 3;

export type GenerationJob = {
  kind: 'root' | 'branch';
  prompt: string;
  count: number;
  nodeIds: string[];
  parent?: { type: string; content: string };
};

async function generateOne(nodes: NodeRepository, nodeService: NodeService, nodeId: string, direction: Direction, job: GenerationJob): Promise<void> {
  try {
    const type: CardType = direction.type;
    const prompt = job.kind === 'branch' && job.parent
      ? branchPrompt(job.parent.type, job.parent.content.slice(0, MAX_PARENT_CHARS), type, direction.idea)
      : rootPrompt(direction.idea, type);
    const raw = await hostComplete(generatorSystem(type), prompt);
    const content = normalizeContent(raw, type);
    const invalid = contentError(type, content);
    if (invalid) throw new Error(invalid);
    nodeService.updateArtifact(nodeId, { artifactType: type, artifact: content });
    nodeService.update(nodeId, { title: direction.title });
  } catch (error) {
    markFailed(nodes, nodeService, nodeId, error instanceof Error ? error.message : String(error));
  }
}

function markFailed(nodes: NodeRepository, nodeService: NodeService, nodeId: string, message: string): void {
  const node = nodes.find(nodeId);
  if (!node || !isArtifactType(node.type) || node.content) return; // 已完成/已没了就不动
  try {
    nodeService.markArtifactError(nodeId, { error: `生成失败：${message}` });
  } catch (error) {
    console.error('[generation]', 'failed to mark node as failed', nodeId, error);
  }
}

/** 后台跑完整条流水线;立即返回,占位节点由画布轮询看到结果。 */
export function dispatchGeneration(nodes: NodeRepository, nodeService: NodeService, job: GenerationJob): void {
  void (async () => {
    let directions: Direction[];
    try {
      const plan = await hostComplete(PLAN_SYSTEM, planPrompt({
        kind: job.kind, count: job.count, prompt: job.prompt,
        parentType: job.parent?.type, parentContent: job.parent?.content.slice(0, MAX_PARENT_CHARS),
      }));
      directions = parseDirections(plan, job.count);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const nodeId of job.nodeIds) markFailed(nodes, nodeService, nodeId, `方向规划失败：${message}`);
      return;
    }
    // 方向不够就用最后一个补齐 —— 宁可两卡同方向,不留转圈的占位
    const assigned = job.nodeIds.map((nodeId, i) => ({ nodeId, direction: directions[i] || directions[directions.length - 1] }));
    // 有限并发:一批 CONCURRENCY 个
    for (let i = 0; i < assigned.length; i += CONCURRENCY) {
      await Promise.all(assigned.slice(i, i + CONCURRENCY)
        .map(({ nodeId, direction }) => generateOne(nodes, nodeService, nodeId, direction, job)));
    }
  })();
}
