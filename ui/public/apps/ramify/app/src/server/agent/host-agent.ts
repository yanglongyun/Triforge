// 调宿主能力 POST /host/ai/agent（应用契约「宿主能力」一节，实验性事件词表）。
// 这里只做「递交 + 静默消费 SSE」，不阻塞发起请求的那次 HTTP 响应——
// dispatchAgentTurn 内部用 void 立刻返回，调用方在同一个事件循环里就能给 UI 回 202。

// 契约没有为 /host/ai/agent 规定轮次超时或事件数上限（见 APP.md 摩擦清单）。
// 为了不让占位节点因为宿主那侧卡死而永远转圈，这里自己兜一个安全上限。
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

export function hostAgentAvailable(): boolean {
  return Boolean(process.env.HOST_URL) && Boolean(process.env.APP_TOKEN);
}

type SseEvent = { event: string; data: string };

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length) yield { event, data: dataLines.join('\n') };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 递交一次完整 agent 轮次并静默消费其 SSE 事件流；不等待完成，立刻返回。
 * `onSettled` 在轮次结束（`done`）、收到 `error` 事件、请求失败或超时后触发一次，
 * 调用方据此把仍未完成的占位节点标记失败，避免转圈转到天荒地老。
 */
export function dispatchAgentTurn(prompt: string, onSettled: (ok: boolean, message: string) => void): void {
  const hostUrl = (process.env.HOST_URL ?? '').replace(/\/+$/, '');
  const token = process.env.APP_TOKEN ?? '';
  void (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
    try {
      const res = await fetch(`${hostUrl}/host/ai/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onSettled(false, `host agent request failed: HTTP ${res.status}`);
        return;
      }
      let sawError: string | null = null;
      for await (const event of parseSse(res.body)) {
        if (event.event === 'error') sawError = event.data || 'agent turn reported an error';
        if (event.event === 'done') break;
      }
      onSettled(sawError === null, sawError ?? 'ok');
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      onSettled(false, aborted ? 'agent turn timed out' : error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  })();
}
