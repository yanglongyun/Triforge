// Responses API 驱动。
// 只负责一件事:把统一的 { input, instructions, tools } 发出去,把流解析成统一的
// { items, usage, status, stopReason },沿途用 onEvent 吐增量。
// 重试、循环、工具执行都不在这儿 —— 那些是协议无关的,在上一层。
import { EVENTS } from '../events.js';

const readError = async (response) => {
    const body = await response.text().catch(() => '');
    try { return JSON.parse(body)?.error?.message || body; } catch { return body; }
};

/** 模型侧可透传的参数。值由调用方(config / GUI)决定，这一层不设默认。 */
const MODEL_OPTION_KEYS = [
    'reasoning',
    'max_output_tokens',
    'temperature',
    'top_p',
    'parallel_tool_calls',
    'tool_choice',
    'text',
    'truncation',
    'store',
    'service_tier',
    'prompt_cache_key',
    'metadata',
    'include',
];

const pickModelOptions = (options) => {
    const picked = {};
    if (!options || typeof options !== 'object') return picked;
    for (const key of MODEL_OPTION_KEYS) {
        if (options[key] !== undefined && options[key] !== null) picked[key] = options[key];
    }
    return picked;
};

/** 单次尝试：发请求、读流、解析。失败时抛出的错误带上 `status` 和 `emitted`。 */
async function attempt({ url, apiKey, model, input, instructions, tools, modelOptions, signal, onEvent, errorMaxChars }) {
    let emitted = false;
    const fail = (message, status) => {
        const error = new Error(message);
        if (status) error.status = status;
        error.emitted = emitted;
        return error;
    };

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                input,
                instructions,
                tools,
                stream: true,
                ...pickModelOptions(modelOptions),
            }),
            signal,
        });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw fail(String(error?.message || error));
    }

    if (!response.ok) throw fail(`Responses API ${response.status}: ${(await readError(response)).slice(0, errorMaxChars)}`, response.status);
    if (!response.body) throw fail('Responses API 返回空响应', response.status);

    const items = [];
    let usage = {};
    let status = '';
    let stopReason = '';
    let sawTerminal = false;
    let buffer = '';
    const decoder = new TextDecoder();

    try {
        for await (const chunk of response.body) {
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const raw = line.trim();
                if (!raw.startsWith('data:')) continue;
                const payload = raw.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                let event;
                try { event = JSON.parse(payload); } catch { continue; }
                if (event.type === 'response.output_text.delta') {
                    emitted = true;
                    onEvent(EVENTS.MESSAGE, { delta: String(event.delta || '') });
                } else if (event.type === 'response.reasoning_text.delta' || event.type === 'response.reasoning_summary_text.delta') {
                    emitted = true;
                    onEvent(EVENTS.REASONING, { delta: String(event.delta || '') });
                } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
                    onEvent(EVENTS.FUNCTION_CALL, { phase: 'started' });
                } else if (event.type === 'response.output_item.done' && event.item) {
                    items.push(event.item);
                } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
                    sawTerminal = true;
                    usage = event.response?.usage || {};
                    status = String(event.response?.status || (event.type === 'response.completed' ? 'completed' : 'incomplete'));
                    // 截断和内容过滤都会走 incomplete。不读原因就会把半截回复当成功返回。
                    stopReason = String(event.response?.incomplete_details?.reason || '');
                } else if (event.type === 'response.failed') {
                    sawTerminal = true;
                    throw fail(event.response?.error?.message || '模型响应失败');
                } else if (event.type === 'error') {
                    sawTerminal = true;
                    throw fail(event.error?.message || event.message || '模型流返回错误');
                }
            }
        }
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        error.emitted = emitted;
        throw error;
    }

    // 流跑完却没见过终结事件 —— 连接中途断了。不拦住的话半截内容会被当成正常完成。
    if (!sawTerminal) throw fail('Responses API 流在终结事件前中断');

    return { items, usage, status: status || 'completed', stopReason };
}

export default { id: 'responses', label: 'Responses API', attempt };
