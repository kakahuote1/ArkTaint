import { OpenAICompatibleClient } from "../core/llm/OpenAICompatibleClient";
import type { SemanticFlowModelInvoker } from "../core/semanticflow/SemanticFlowLlm";
import { resolveLlmProfile } from "./llmConfig";

export interface SemanticFlowModelInvokerConfigOptions {
    enabled?: boolean;
    configPath?: string;
    profile?: string;
    model?: string;
    timeoutMs?: number;
    connectTimeoutMs?: number;
    maxAttempts?: number;
    defaultHeaders?: Record<string, string>;
}

export interface SemanticFlowModelInvokerOptions {
    enabled?: boolean;
    model: string;
    apiKey?: string;
    endpoint?: string;
    baseUrl?: string;
    apiKeyHeader?: string;
    apiKeyPrefix?: string;
    minIntervalMs?: number;
    timeoutMs?: number;
    connectTimeoutMs?: number;
    maxAttempts?: number;
    defaultHeaders?: Record<string, string>;
}

export function createSemanticFlowModelInvokerFromConfig(
    options: SemanticFlowModelInvokerConfigOptions = {},
): SemanticFlowModelInvoker | undefined {
    if (options.enabled === false) {
        return undefined;
    }
    const profile = resolveLlmProfile({
        configPath: options.configPath,
        profile: options.profile,
        model: options.model,
    });
    if (!profile) {
        return undefined;
    }
    return createSemanticFlowModelInvoker({
        enabled: true,
        model: profile.model,
        apiKey: profile.apiKey,
        endpoint: profile.endpoint,
        baseUrl: profile.baseUrl,
        apiKeyHeader: profile.apiKeyHeader,
        apiKeyPrefix: profile.apiKeyPrefix,
        minIntervalMs: profile.minIntervalMs,
        timeoutMs: options.timeoutMs ?? profile.timeoutMs,
        connectTimeoutMs: options.connectTimeoutMs ?? profile.connectTimeoutMs,
        maxAttempts: options.maxAttempts,
        defaultHeaders: {
            ...profile.headers,
            ...(options.defaultHeaders || {}),
        },
    });
}

export function createSemanticFlowModelInvoker(
    options: SemanticFlowModelInvokerOptions,
): SemanticFlowModelInvoker | undefined {
    if (options.enabled === false) {
        return undefined;
    }
    if ((!options.endpoint && !options.baseUrl) || !options.model) {
        return undefined;
    }

    const client = new OpenAICompatibleClient({
        endpoint: options.endpoint,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        apiKeyHeader: options.apiKeyHeader,
        apiKeyPrefix: options.apiKeyPrefix,
        minIntervalMs: options.minIntervalMs,
        timeoutMs: options.timeoutMs,
        connectTimeoutMs: options.connectTimeoutMs,
        bodyTimeoutMs: options.timeoutMs,
        maxAttempts: options.maxAttempts,
        defaultHeaders: options.defaultHeaders,
    });

    return async input => {
        const response = await client.complete({
            model: input.model || options.model,
            temperature: 0,
            system: input.system,
            user: input.user,
        });
        return response.text;
    };
}
