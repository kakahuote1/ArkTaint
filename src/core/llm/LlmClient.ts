export interface LlmCompleteRequest {
    model: string;
    temperature?: number;
    system: string;
    user: string;
}

export interface LlmCompleteResponse {
    text: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
    raw?: unknown;
}

export interface LlmClient {
    complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse>;
}

