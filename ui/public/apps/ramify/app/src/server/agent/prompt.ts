// 把「递交给 agent」这一跳拼成一段指令文本。宿主的 /host/ai/agent 只接受
// { prompt, workdir? } —— 子 agent 在那个会话里只有 bash + curl，没有任何注册工具，
// 所以这段文本本身就是它的 SDK：origin、占位节点 id、写入端点的精确 curl 用法都要写全。

/** 宿主注入的 HOST/PORT 拼出本 app 自己的 origin。子 agent 与本进程同机可达。 */
export function resolveOrigin(): string {
  const host = process.env.HOST;
  const originHost = host && host !== '0.0.0.0' ? host : '127.0.0.1';
  const port = process.env.PORT || '9519';
  return `http://${originHost}:${port}`;
}

function curlGuide(origin: string): string {
  return [
    '写入占位节点用这个端点（把 <nodeId> 换成实际节点 id，<TYPE> 换成 html/markdown/svg/image/video/audio 之一）：',
    `  PUT ${origin}/api/nodes/<nodeId>/artifact`,
    '  Content-Type: application/json',
    '  Body: {"artifactType":"<TYPE>","artifact":"<完整源码，或图片/视频/音频的 URL/data URI>"}',
    '推荐先把产出写入临时文件，再用 jq 安全构造 JSON（避免手工转义引号和换行出错）：',
    `  jq -n --rawfile a /tmp/out.html '{artifactType:"html", artifact:$a}' | curl -sS -X PUT ${origin}/api/nodes/<nodeId>/artifact -H 'Content-Type: application/json' --data-binary @-`,
    '没有 jq 时可以用 python3：',
    `  python3 -c 'import json,sys; print(json.dumps({"artifactType":"html","artifact":open(sys.argv[1]).read()}))' /tmp/out.html | curl -sS -X PUT ${origin}/api/nodes/<nodeId>/artifact -H 'Content-Type: application/json' --data-binary @-`,
    '某个方向确实做不出来时，不要留着占位节点空转，改为标记失败：',
    `  curl -sS -X PUT ${origin}/api/nodes/<nodeId>/artifact/error -H 'Content-Type: application/json' -d '{"error":"说明失败原因"}'`,
    `需要先确认节点范围或已有内容时，可以读取整棵树：GET ${origin}/api/projects/<projectId>/tree`,
  ].join('\n');
}

export function buildGeneratePrompt(params: {
  origin: string;
  projectId: string;
  prompt: string;
  count: number;
  nodeIds: string[];
}): string {
  return [
    `请继续完成 Ramify 项目 ${params.projectId}（项目与根节点已经创建好，不要重新创建项目）。`,
    `完整需求：${params.prompt.trim()}`,
    `画布已经创建了 ${params.count} 个生成中占位节点：${params.nodeIds.join('、')}。`,
    '请为每一个占位节点确定一个明显不同的方向，直接把完整产出写入对应节点，不要合并到一个节点里。',
    '不要新建项目，不要新建额外的方案节点，也不要删除这些占位节点。',
    curlGuide(params.origin),
    '全部处理完（写入或标记失败）之后就结束，不需要额外汇报；Ramify 画布会自动轮询更新。',
  ].join('\n');
}

export function buildBranchPrompt(params: {
  origin: string;
  projectId: string;
  nodeId: string;
  nodeTitle: string;
  prompt: string;
  count: number;
  nodeIds: string[];
}): string {
  return [
    `请继续编辑 Ramify 项目 ${params.projectId}。`,
    `父节点是 ${params.nodeId}（标题：${params.nodeTitle}）。`,
    `画布已经创建了 ${params.count} 个分支占位节点：${params.nodeIds.join('、')}。`,
    `修改要求：${params.prompt.trim()}`,
    '先读取项目树确认父节点当前的内容，再把修改后的完整产出直接写入这些占位节点；不要再创建新节点，也不要动原节点。',
    curlGuide(params.origin),
    '全部处理完（写入或标记失败）之后就结束，不需要额外汇报；Ramify 画布会自动轮询更新。',
  ].join('\n');
}
