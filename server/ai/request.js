// 驱动派发 + 重试。协议差异全在 ai/drivers/ 下,这一层不认识任何具体协议。
import { EVENTS } from './events.js';
import { driverFor } from './drivers/index.js';
import { backoffMs, isRetryable, normalizeRetry, sleep } from './retry.js';

export async function request({
    driver = 'responses',
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
    const impl = driverFor(driver);
    if (!url || !apiKey || !model) throw new Error(`缺少接口地址、API Key 或模型名(驱动:${impl.label})`);
    if (!Number.isInteger(errorMaxChars) || errorMaxChars <= 0) throw new Error('errorMaxChars 必须是正整数');

    const policy = normalizeRetry(retry);
    const args = { url, apiKey, model, input, instructions, tools, modelOptions, signal, onEvent, errorMaxChars };

    for (let attemptNo = 1; ; attemptNo += 1) {
        try {
            return await impl.attempt(args);
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw error;
            const exhausted = attemptNo > policy.maxRetries;
            // 已经吐过内容再重试会重复一遍正文，默认不做，交给上层报错。
            const streamed = error?.emitted && !policy.retryAfterStream;
            if (!policy.enabled || exhausted || streamed || !isRetryable(error)) throw error;

            const delay = backoffMs(attemptNo, policy);
            onEvent(EVENTS.RETRY, {
                attempt: attemptNo,
                maxRetries: policy.maxRetries,
                delayMs: delay,
                error: String(error?.message || error),
            });
            await sleep(delay, signal);
        }
    }
}
