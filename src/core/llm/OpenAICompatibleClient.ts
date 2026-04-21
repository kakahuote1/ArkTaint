import { LlmClient, LlmCompleteRequest, LlmCompleteResponse } from "./LlmClient";

export interface OpenAICompatibleClientOptions {
    endpoint?: string;
    baseUrl?: string;
    apiKey?: string;
    apiKeyHeader?: string;
    apiKeyPrefix?: string;
    minIntervalMs?: number;
    /** Overall request deadline (abort signal). Default 120_000. */
    timeoutMs?: number;
    /**
     * TCP/TLS connect + handshake timeout for Node's fetch (undici). Default 120_000.
     * Undici's default is 10s, which often fails on slow or filtered routes to api.openai.com.
     */
    connectTimeoutMs?: number;
    /** Undici body / headers timeout; defaults to `timeoutMs`. */
    bodyTimeoutMs?: number;
    /** Retry count for transient failures, including the first attempt. Default 5. */
    maxAttempts?: number;
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

function parseRetryAfterMs(value: string | null): number | undefined {
    if (!value) {
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.floor(seconds * 1000);
    }
    const when = Date.parse(trimmed);
    if (!Number.isFinite(when)) {
        return undefined;
    }
    return Math.max(0, when - Date.now());
}

function retryDelayMs(status: number | undefined, attempt: number, retryAfterHeader?: string | null): number {
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader || null);
    if (retryAfterMs !== undefined) {
        return retryAfterMs;
    }
    if (status === 429) {
        return Math.min(60_000, 15_000 * attempt);
    }
    return Math.min(10_000, 1_500 * attempt);
}

export class OpenAICompatibleClient implements LlmClient {
    private rateLimitQueue: Promise<void> = Promise.resolve();
    private nextRequestAt = 0;

    constructor(private readonly options: OpenAICompatibleClientOptions) {}

    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
        return this.withRateLimit(() => this.completeOnce(req));
    }

    private async withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
        const minIntervalMs = Math.max(0, this.options.minIntervalMs ?? 0);
        if (minIntervalMs <= 0) {
            return fn();
        }
        let release!: () => void;
        const previous = this.rateLimitQueue;
        this.rateLimitQueue = new Promise<void>(resolve => {
            release = resolve;
        });
        await previous;
        const waitMs = this.nextRequestAt - Date.now();
        if (waitMs > 0) {
            await sleep(waitMs);
        }
        try {
            return await fn();
        } finally {
            this.nextRequestAt = Date.now() + minIntervalMs;
            release();
        }
    }

    private async completeOnce(req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
        const timeoutMs = this.options.timeoutMs ?? 120_000;
        const connectTimeoutMs = this.options.connectTimeoutMs ?? timeoutMs;
        const bodyTimeoutMs = this.options.bodyTimeoutMs ?? timeoutMs;
        const dispatcherPack = tryCreateUndiciDispatcher(connectTimeoutMs, bodyTimeoutMs);
        const extraFetchInit =
            "dispatcher" in dispatcherPack && dispatcherPack.dispatcher != null
                ? { dispatcher: dispatcherPack.dispatcher as any }
                : {};
        const url = resolveChatCompletionsUrl(this.options);
        const headers: Record<string, string> = {
            "content-type": "application/json",
            ...(this.options.defaultHeaders || {}),
        };
        if (this.options.apiKey) {
            const apiKeyHeader = normalizeHeaderName(this.options.apiKeyHeader) || "Authorization";
            const apiKeyPrefix = this.options.apiKeyPrefix ?? "Bearer ";
            headers[apiKeyHeader] = `${apiKeyPrefix}${this.options.apiKey}`;
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
        const maxAttempts = Math.max(1, this.options.maxAttempts ?? 5);
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
                        await sleep(retryDelayMs(resp.status, attempt, resp.headers.get("retry-after")));
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
                    await sleep(retryDelayMs(undefined, attempt));
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

function normalizeHeaderName(value: string | undefined): string | undefined {
    const normalized = String(value || "").trim();
    return normalized || undefined;
}

function resolveChatCompletionsUrl(options: Pick<OpenAICompatibleClientOptions, "endpoint" | "baseUrl">): string {
    const endpoint = String(options.endpoint || "").trim();
    if (endpoint) {
        return endpoint;
    }
    const normalized = String(options.baseUrl || "").trim().replace(/\/+$/, "");
    if (!normalized) {
        return "/v1/chat/completions";
    }
    // Support full chat-completions endpoints and version roots from OpenAI-compatible providers.
    if (/\/chat\/completions$/i.test(normalized)) {
        return normalized;
    }
    if (/\/v\d+$/i.test(normalized)) {
        return `${normalized}/chat/completions`;
    }
    return `${normalized}/v1/chat/completions`;
}

