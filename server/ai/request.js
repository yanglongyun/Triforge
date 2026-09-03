// 一次请求 = attempt + 重试。协议细节在 responses.js,这一层只管失败了要不要再来。
import { attempt } from './responses.js';
import { backoffMs, isRetryable, normalizeRetry, sleep } from './retry.js';

export async function request({
    url,
    apiKey,
    model,
    input,
    instructions = '',
    tools = [],
    modelOptions,
    retry,
    signal,
    onEvent = () => {},
    errorMaxChars,
}) {
    if (!url || !apiKey || !model) throw new Error('缺少接口地址、API Key 或模型名');
    if (!Number.isInteger(errorMaxChars) || errorMaxChars <= 0) throw new Error('errorMaxChars 必须是正整数');

    const policy = normalizeRetry(retry);
    const args = { url, apiKey, model, input, instructions, tools, modelOptions, signal, onEvent, errorMaxChars };

    for (let attemptNo = 1; ; attemptNo += 1) {
        try {
            return await attempt(args);
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw error;
            const exhausted = attemptNo > policy.maxRetries;
            // 已经吐过内容再重试会重复一遍正文，默认不做，交给上层报错。
            const streamed = error?.emitted && !policy.retryAfterStream;
            if (!policy.enabled || exhausted || streamed || !isRetryable(error)) throw error;

            const delay = backoffMs(attemptNo, policy);
            onEvent('retry', {
                attempt: attemptNo,
                maxRetries: policy.maxRetries,
                delayMs: delay,
                error: String(error?.message || error),
            });
            await sleep(delay, signal);
        }
    }
}
