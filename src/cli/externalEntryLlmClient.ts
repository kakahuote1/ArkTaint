import type { ArkMainExternalEntryModelInvoker } from "../core/entry/arkmain/llm/ArkMainExternalEntryRecognizer";

declare const process: any;

type ChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
};

type ResponsesApiResponse = {
    output_text?: string;
    output?: Array<{
        content?: Array<{
            text?: string;
            type?: string;
        }>;
    }>;
};

type SupportedApiStyle = "auto" | "responses" | "chat_completions";

interface ExternalEntryInvokerEnvOptions {
    enabled?: boolean;
    model?: string;
}

class ModelHttpError extends Error {
    public readonly status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.status = status;
    }
}

export function createExternalEntryModelInvokerFromEnv(
    options: ExternalEntryInvokerEnvOptions,
): ArkMainExternalEntryModelInvoker | undefined {
    if (!options.enabled) {
        return undefined;
    }

    const apiKey = firstNonEmpty(
        process.env.ARKTAINT_EXTERNAL_ENTRY_API_KEY,
        process.env.OPENAI_API_KEY,
    );
    const baseUrl = normalizeBaseUrl(firstNonEmpty(
        process.env.ARKTAINT_EXTERNAL_ENTRY_BASE_URL,
        process.env.OPENAI_BASE_URL,
        "https://api.openai.com/v1",
    ));
    const configuredModel = firstNonEmpty(
        options.model,
        process.env.ARKTAINT_EXTERNAL_ENTRY_MODEL,
        process.env.OPENAI_MODEL,
    );
    const apiStyle = resolveApiStyle(firstNonEmpty(
        process.env.ARKTAINT_EXTERNAL_ENTRY_API_STYLE,
        process.env.OPENAI_API_STYLE,
        "auto",
    ));
    const extraHeaders = parseExtraHeaders(process.env.ARKTAINT_EXTERNAL_ENTRY_HEADERS);

    if (!apiKey || !configuredModel) {
        return undefined;
    }

    return async ({ prompt, model: modelOverride }) => {
        const selectedModel = firstNonEmpty(modelOverride, configuredModel)!;
        const systemPrompt = "You are a strict JSON-only classifier for ArkTS framework entry recognition.";
        const requestOptions = {
            apiKey,
            baseUrl,
            extraHeaders,
            model: selectedModel,
            systemPrompt,
            prompt,
        };

        if (apiStyle === "responses") {
            return requestWithResponsesApi(requestOptions);
        }
        if (apiStyle === "chat_completions") {
            return requestWithChatCompletions(requestOptions);
        }

        try {
            return await requestWithResponsesApi(requestOptions);
        } catch (error) {
            if (!shouldFallbackToChatCompletions(error)) {
                throw error;
            }
        }
        return requestWithChatCompletions(requestOptions);
    };
}

async function requestWithResponsesApi(input: {
    apiKey: string;
    baseUrl: string;
    extraHeaders: Record<string, string>;
    model: string;
    systemPrompt: string;
    prompt: string;
}): Promise<string> {
    const response = await fetch(`${input.baseUrl}/responses`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.apiKey}`,
            ...input.extraHeaders,
        },
        body: JSON.stringify({
            model: input.model,
            temperature: 0,
            input: [
                {
                    role: "system",
                    content: [
                        {
                            type: "input_text",
                            text: input.systemPrompt,
                        },
                    ],
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: input.prompt,
                        },
                    ],
                },
            ],
        }),
    });

    if (!response.ok) {
        throw await buildHttpError("LLM responses request failed", response);
    }

    const json = await response.json() as ResponsesApiResponse;
    const text = extractResponsesApiText(json);
    if (!text) {
        throw new Error("LLM responses API response missing text output");
    }
    return text;
}

async function requestWithChatCompletions(input: {
    apiKey: string;
    baseUrl: string;
    extraHeaders: Record<string, string>;
    model: string;
    systemPrompt: string;
    prompt: string;
}): Promise<string> {
    const response = await fetch(`${input.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.apiKey}`,
            ...input.extraHeaders,
        },
        body: JSON.stringify({
            model: input.model,
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: input.systemPrompt,
                },
                {
                    role: "user",
                    content: input.prompt,
                },
            ],
        }),
    });

    if (!response.ok) {
        throw await buildHttpError("LLM chat-completions request failed", response);
    }

    const json = await response.json() as ChatCompletionResponse;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
        throw new Error("LLM chat-completions response missing choices[0].message.content");
    }
    return content;
}

async function buildHttpError(prefix: string, response: Response): Promise<ModelHttpError> {
    const text = await response.text().catch(() => "");
    return new ModelHttpError(
        `${prefix}: ${response.status} ${response.statusText} ${text}`.trim(),
        response.status,
    );
}

function extractResponsesApiText(response: ResponsesApiResponse): string {
    if (typeof response?.output_text === "string" && response.output_text.trim()) {
        return response.output_text;
    }

    const pieces: string[] = [];
    for (const outputItem of response?.output || []) {
        for (const contentItem of outputItem?.content || []) {
            if (typeof contentItem?.text === "string" && contentItem.text.trim()) {
                pieces.push(contentItem.text);
            }
        }
    }

    return pieces.join("\n").trim();
}

function shouldFallbackToChatCompletions(error: unknown): boolean {
    if (!(error instanceof ModelHttpError)) {
        return false;
    }
    return error.status === 400 || error.status === 404 || error.status === 405 || error.status === 415;
}

function resolveApiStyle(value: string | undefined): SupportedApiStyle {
    if (value === "responses" || value === "chat_completions") {
        return value;
    }
    return "auto";
}

function parseExtraHeaders(raw: string | undefined): Record<string, string> {
    if (!raw?.trim()) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }

        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (!key || value === undefined || value === null) {
                continue;
            }
            headers[String(key)] = String(value);
        }
        return headers;
    } catch {
        return {};
    }
}

function normalizeBaseUrl(value: string | undefined): string {
    return String(value || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
}
