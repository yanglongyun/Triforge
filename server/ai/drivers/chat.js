// Chat Completions 驱动。
// 给只有 /chat/completions 的服务(GLM、绝大多数第三方网关)用。
//
// 对上,它和 Responses 驱动交出完全一样的东西:统一的 items 词表、统一的 onEvent 增量、
// 归一化后的 usage。对下,它自己消化 Chat 协议的所有差异 —— 两个驱动之间零依赖。
//
// 内部 item 词表沿用 Responses 那套(message / reasoning / function_call /
// function_call_output),因为它早就是 AGENT 的内部契约:数据库、UI、上下文压缩全按它来。
import { EVENTS } from '../events.js';

const readError = async (response) => {
    const body = await response.text().catch(() => '');
    try { return JSON.parse(body)?.error?.message || body; } catch { return body; }
};

let seq = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}${(seq += 1).toString(36)}`;

/* ────────────── 请求:统一形状 → Chat 形状 ────────────── */

const textOf = (parts) => (Array.isArray(parts) ? parts : [])
    .filter((part) => part?.type === 'input_text' || part?.type === 'output_text' || typeof part?.text === 'string')
    .map((part) => String(part.text || ''))
    .join('');

const imagesOf = (parts) => (Array.isArray(parts) ? parts : [])
    .filter((part) => part?.type === 'input_image' && part.image_url)
    .map((part) => ({ type: 'image_url', image_url: { url: String(part.image_url) } }));

/** 一条普通消息的 content:纯文本就给字符串,带图才给数组(有些服务只认字符串)。 */
function contentOf(raw) {
    if (typeof raw === 'string') return raw;
    const images = imagesOf(raw);
    const text = textOf(raw);
    if (!images.length) return text;
    return [...(text ? [{ type: 'text', text }] : []), ...images];
}

/**
 * input[] → messages[]。
 *
 * 三处 Chat 协议的硬要求:
 *  1. 连续的 function_call 必须并成**一条** assistant 消息,带多个 tool_calls;
 *     拆成多条会被判定为「tool_calls 没有对应的 assistant 消息」。
 *  2. reasoning item 不能回传 —— Chat 没有这个角色,发过去直接 400。
 *  3. tool 消息的 content 只能是文本;工具返回的图片攒起来,等这批 tool 消息发完
 *     再补一条 user 消息带出去,否则会把 assistant/tool 的配对切断。
 */
export function toMessages(input = [], instructions = '') {
    const messages = [];
    if (String(instructions || '').trim()) messages.push({ role: 'system', content: String(instructions) });

    let pendingCalls = null;   // 正在攒的 tool_calls
    let pendingImages = [];    // 正在攒的工具返回图

    const flushCalls = () => {
        if (!pendingCalls) return;
        messages.push({ role: 'assistant', content: null, tool_calls: pendingCalls });
        pendingCalls = null;
    };
    const flushImages = () => {
        if (!pendingImages.length) return;
        messages.push({ role: 'user', content: [{ type: 'text', text: '(上一步工具返回的图片)' }, ...pendingImages] });
        pendingImages = [];
    };

    for (const item of input) {
        if (!item || typeof item !== 'object') continue;

        if (item.type === 'function_call') {
            flushImages();
            pendingCalls ??= [];
            pendingCalls.push({
                id: String(item.call_id || item.id || nextId('call')),
                type: 'function',
                function: { name: String(item.name || ''), arguments: String(item.arguments ?? '{}') },
            });
            continue;
        }
        flushCalls();

        if (item.type === 'function_call_output') {
            const parts = Array.isArray(item.output) ? item.output : null;
            messages.push({
                role: 'tool',
                tool_call_id: String(item.call_id || ''),
                content: parts ? textOf(parts) : String(item.output ?? ''),
            });
            if (parts) pendingImages.push(...imagesOf(parts));
            continue;
        }
        flushImages();

        // Chat 没有 reasoning 这个角色。回传会 400,直接丢掉。
        if (item.type === 'reasoning') continue;

        const role = String(item.role || (item.type === 'message' ? 'assistant' : 'user'));
        const content = contentOf(item.content);
        if (content === '' || (Array.isArray(content) && !content.length)) continue;
        messages.push({ role, content });
    }
    flushCalls();
    flushImages();
    return messages;
}

/** Responses 的扁平 tool → Chat 的嵌套 tool。 */
export const toTools = (tools = []) => (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool && (tool.name || tool.function?.name))
    .map((tool) => (tool.function ? tool : {
        type: 'function',
        function: {
            name: String(tool.name),
            ...(tool.description ? { description: String(tool.description) } : {}),
            ...(tool.parameters ? { parameters: tool.parameters } : {}),
        },
    }));

/**
 * 模型参数。两个协议只有少数几个键能一一对上,其余各家各样 ——
 * 对得上的映射过去,对不上的走 modelOptions.chat 原样透传,别在这儿猜。
 */
const DIRECT_KEYS = ['temperature', 'top_p', 'tool_choice', 'parallel_tool_calls', 'stop', 'seed'];

export function toModelOptions(options) {
    const out = {};
    if (!options || typeof options !== 'object') return out;
    for (const key of DIRECT_KEYS) if (options[key] !== undefined && options[key] !== null) out[key] = options[key];
    if (options.max_output_tokens !== undefined) out.max_tokens = options.max_output_tokens;
    if (options.chat && typeof options.chat === 'object') Object.assign(out, options.chat);
    return out;
}

/** Chat 的 usage → Responses 的字段名。上下文压缩读的是 input_tokens/output_tokens,
 *  不归一化的话水位永远是 0,压缩不会触发,上下文直接撑爆。 */
export function toUsage(usage) {
    if (!usage || typeof usage !== 'object') return {};
    const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
    const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
    return {
        input_tokens: input,
        output_tokens: output,
        total_tokens: Number(usage.total_tokens ?? input + output) || input + output,
        ...(usage.completion_tokens_details ? { output_tokens_details: usage.completion_tokens_details } : {}),
        ...(usage.prompt_tokens_details ? { input_tokens_details: usage.prompt_tokens_details } : {}),
    };
}

/** finish_reason → Responses 的 status / incomplete 原因。
 *  length 和 content_filter 都是「没说完」,当成 completed 会把半截回复当完整结果。 */
export function toStatus(finishReason) {
    const reason = String(finishReason || '');
    if (reason === 'length') return { status: 'incomplete', stopReason: 'max_output_tokens' };
    if (reason === 'content_filter') return { status: 'incomplete', stopReason: 'content_filter' };
    return { status: 'completed', stopReason: '' };
}

/* ────────────── 响应:Chat 流 → 统一 items ────────────── */

/**
 * 把 Chat 的流式增量攒成 Responses 形状的 items。
 *
 * 和 Responses 驱动的差别在于:那边服务端直接给出成型的 item,这边只有碎片,
 * 得自己攒。工具调用的 arguments 在不同服务上行为不一样 —— OpenAI 会切成很多片,
 * GLM 一次给全 —— 按 index 累加对两种都成立。
 */
export function createAssembler(onEvent = () => {}) {
    let text = '';
    let reasoning = '';
    const calls = new Map(); // index -> { id, name, arguments }
    let finishReason = '';
    let usage = null;
    let emitted = false;

    return {
        get emitted() { return emitted; },

        /** 吃一个 chunk。返回 false 表示这个 chunk 没内容(心跳之类)。 */
        push(chunk) {
            if (chunk?.usage) usage = chunk.usage;
            const choice = (chunk?.choices || [])[0];
            if (!choice) return false;
            if (choice.finish_reason) finishReason = String(choice.finish_reason);

            const delta = choice.delta || choice.message || {};
            const think = delta.reasoning_content ?? delta.reasoning;
            if (think) { reasoning += String(think); emitted = true; onEvent(EVENTS.REASONING, { delta: String(think) }); }
            if (delta.content) {
                const piece = typeof delta.content === 'string' ? delta.content : textOf(delta.content);
                if (piece) { text += piece; emitted = true; onEvent(EVENTS.MESSAGE, { delta: piece }); }
            }

            for (const part of delta.tool_calls || []) {
                const index = Number(part.index ?? calls.size);
                let call = calls.get(index);
                if (!call) {
                    call = { id: String(part.id || nextId('call')), name: '', arguments: '' };
                    calls.set(index, call);
                    onEvent(EVENTS.FUNCTION_CALL, { phase: 'started' });
                }
                if (part.id) call.id = String(part.id);
                if (part.function?.name) call.name += String(part.function.name);
                if (part.function?.arguments) call.arguments += String(part.function.arguments);
            }
            return true;
        },

        /** 收尾:攒好的碎片拼成 items。顺序按 Responses 的惯例:先 reasoning,再正文,再工具调用。 */
        finish() {
            const items = [];
            if (reasoning) {
                items.push({
                    type: 'reasoning', id: nextId('rs'),
                    summary: [], content: [{ type: 'reasoning_text', text: reasoning }],
                });
            }
            if (text) {
                items.push({
                    type: 'message', id: nextId('msg'), role: 'assistant', status: 'completed',
                    content: [{ type: 'output_text', text, annotations: [] }],
                });
            }
            for (const call of calls.values()) {
                items.push({
                    type: 'function_call', id: nextId('fc'), call_id: call.id,
                    name: call.name, arguments: call.arguments || '{}', status: 'completed',
                });
            }
            // 有工具调用时 finish_reason 是 tool_calls,那是正常完成,不是截断
            const { status, stopReason } = toStatus(calls.size && finishReason === 'length' ? 'tool_calls' : finishReason);
            return { items, usage: toUsage(usage), status, stopReason };
        },
    };
}

async function attempt({ url, apiKey, model, input, instructions, tools, modelOptions, signal, onEvent, errorMaxChars }) {
    const assembler = createAssembler(onEvent);
    const fail = (message, status) => {
        const error = new Error(message);
        if (status) error.status = status;
        error.emitted = assembler.emitted;
        return error;
    };

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                messages: toMessages(input, instructions),
                ...(tools?.length ? { tools: toTools(tools) } : {}),
                stream: true,
                // 不少服务默认不在流里给 usage,得显式要 —— 没有它上下文压缩就不会触发
                stream_options: { include_usage: true },
                ...toModelOptions(modelOptions),
            }),
            signal,
        });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw fail(String(error?.message || error));
    }

    if (!response.ok) throw fail(`Chat Completions ${response.status}: ${(await readError(response)).slice(0, errorMaxChars)}`, response.status);
    if (!response.body) throw fail('Chat Completions 返回空响应', response.status);

    let sawData = false;
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
                if (!payload) continue;
                if (payload === '[DONE]') { sawData = true; continue; }
                let event;
                try { event = JSON.parse(payload); } catch { continue; }
                // 有些网关把错误塞在流里而不是 HTTP 状态码上
                if (event?.error) throw fail(event.error?.message || String(event.error));
                assembler.push(event);
                sawData = true;
            }
        }
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        error.emitted = assembler.emitted;
        throw error;
    }

    // 一条数据都没见过 = 连接中途断了。不拦住的话空回复会被当成正常完成。
    if (!sawData) throw fail('Chat Completions 流在收到任何数据前中断');
    return assembler.finish();
}

export default { id: 'chat', label: 'Chat Completions', attempt };
