import { LlmClient, LlmCompleteRequest, LlmCompleteResponse } from "./LlmClient";

export interface OpenAICompatibleClientOptions {
    baseUrl: string;
    apiKey?: string;
    /** Overall request deadline (abort signal). Default 120_000. */
    timeoutMs?: number;
    /**
     * TCP/TLS connect + handshake timeout for Node's fetch (undici). Default 120_000.
     * Undici's default is 10s, which often fails on slow or filtered routes to api.openai.com.
     */
    connectTimeoutMs?: number;
    /** Undici body / headers timeout; defaults to `timeoutMs`. */
    bodyTimeoutMs?: number;
    defaultHeaders?: Record<string, string>;
}

function tryCreateUndiciDispatcher(connectTimeoutMs: number, bodyTimeoutMs: number): { dispatcher: unknown } | Record<string, never> {
    const agentOpts = {
        connectTimeout: connectTimeoutMs,
        bodyTimeout: bodyTimeoutMs,
        headersTimeout: bodyTimeoutMs,
    };
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const { Agent } = require("node:undici") as { Agent: new (o: typeof agentOpts) => unknown };
        return { dispatcher: new Agent(agentOpts) };
    } catch {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
            const { Agent } = require("undici") as { Agent: new (o: typeof agentOpts) => unknown };
            return { dispatcher: new Agent(agentOpts) };
        } catch {
            return {};
        }
    }
}

function isRetryableFetchError(err: any): boolean {
    const msg = String(err?.message || err);
    const causeCode = err?.cause?.code;
    if (causeCode === "UND_ERR_CONNECT_TIMEOUT" || causeCode === "UND_ERR_HEADERS_TIMEOUT" || causeCode === "UND_ERR_BODY_TIMEOUT") {
        return true;
    }
    return /aborted|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket|ConnectTimeout|UND_ERR_CONNECT|fetch failed/i.test(msg);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class OpenAICompatibleClient implements LlmClient {
    constructor(private readonly options: OpenAICompatibleClientOptions) {}

    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
        const timeoutMs = this.options.timeoutMs ?? 120_000;
        const connectTimeoutMs = this.options.connectTimeoutMs ?? timeoutMs;
        const bodyTimeoutMs = this.options.bodyTimeoutMs ?? timeoutMs;
        const dispatcherPack = tryCreateUndiciDispatcher(connectTimeoutMs, bodyTimeoutMs);
        const extraFetchInit =
            "dispatcher" in dispatcherPack && dispatcherPack.dispatcher != null
                ? { dispatcher: dispatcherPack.dispatcher as any }
                : {};
        const url = resolveChatCompletionsUrl(this.options.baseUrl);
        const headers: Record<string, string> = {
            "content-type": "application/json",
            ...(this.options.defaultHeaders || {}),
        };
        if (this.options.apiKey) {
            headers.authorization = `Bearer ${this.options.apiKey}`;
        }

        const body = {
            model: req.model,
            temperature: req.temperature ?? 0,
            messages: [
                { role: "system", content: req.system },
                { role: "user", content: req.user },
            ],
        };

        // Minimal retry for transient failures (429/5xx/network).
        const maxAttempts = 3;
        let lastErr: any;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const resp = await fetch(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(body),
                    signal: ctrl.signal,
                    ...extraFetchInit,
                } as RequestInit);
                const text = await resp.text();
                if (!resp.ok) {
                    const retryable = resp.status === 429 || (resp.status >= 500 && resp.status <= 599);
                    if (retryable && attempt < maxAttempts) {
                        await sleep(800 * attempt);
                        continue;
                    }
                    throw new Error(`LLM request failed: status=${resp.status} body=${text.slice(0, 2000)}`);
                }

                const json = JSON.parse(text);
                const content = json?.choices?.[0]?.message?.content;
                if (typeof content !== "string" || content.trim().length === 0) {
                    throw new Error(`LLM response missing choices[0].message.content`);
                }
                const usage = json?.usage
                    ? {
                        inputTokens: json.usage.prompt_tokens,
                        outputTokens: json.usage.completion_tokens,
                    }
                    : undefined;
                return {
                    text: content,
                    usage,
                    raw: json,
                };
            } catch (err: any) {
                lastErr = err;
                const retryable = isRetryableFetchError(err);
                if (retryable && attempt < maxAttempts) {
                    await sleep(800 * attempt);
                    continue;
                }
                throw err;
            } finally {
                clearTimeout(timer);
            }
        }

        throw lastErr || new Error("LLM request failed");
    }
}

function resolveChatCompletionsUrl(baseUrl: string): string {
    const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!normalized) {
        return "/v1/chat/completions";
    }
    // Support both API root (..../compatible-mode) and full endpoint (..../v1/chat/completions).
    if (/\/v1\/chat\/completions$/i.test(normalized)) {
        return normalized;
    }
    if (/\/v1$/i.test(normalized)) {
        return `${normalized}/chat/completions`;
    }
    return `${normalized}/v1/chat/completions`;
}

