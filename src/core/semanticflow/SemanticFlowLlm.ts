import {
    parseSemanticFlowAssetModelOutput,
    type ParseSemanticFlowAssetModelOutputOptions,
} from "./SemanticFlowAssetModelOutput";
import {
    buildSemanticFlowPrompt,
    buildSemanticFlowRepairPrompt,
    SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION,
} from "./SemanticFlowPrompt";
import { buildSemanticFlowDecisionCacheKey, type SemanticFlowSessionCache } from "./SemanticFlowSessionCache";
import type {
    SemanticFlowDecision,
    SemanticFlowDecider,
    SemanticFlowDecisionInput,
} from "./SemanticFlowTypes";

export interface SemanticFlowModelInvokerInput {
    system: string;
    user: string;
    model?: string;
}

export type SemanticFlowModelInvoker = (input: SemanticFlowModelInvokerInput) => Promise<string>;

export const SEMANTIC_FLOW_LLM_TEMPERATURE = 0;
export const SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION = 14;

export type SemanticFlowParseOptions = ParseSemanticFlowAssetModelOutputOptions;

export interface CreateSemanticFlowLlmDeciderOptions {
    modelInvoker: SemanticFlowModelInvoker;
    model?: string;
    repairInvalidJson?: boolean;
    maxRepairAttempts?: number;
    sessionCache?: SemanticFlowSessionCache;
}

export function createSemanticFlowLlmDecider(options: CreateSemanticFlowLlmDeciderOptions): SemanticFlowDecider {
    const repairInvalidJson = options.repairInvalidJson !== false;
    const maxRepairAttempts = Math.max(0, options.maxRepairAttempts ?? 1);
    return {
        async decide(input: SemanticFlowDecisionInput): Promise<SemanticFlowDecision> {
            const prompt = buildSemanticFlowPrompt(input);
            const cache = options.sessionCache;
            if (cache?.isActive() && !options.model) {
                throw new Error("semanticflow session cache requires an explicit model");
            }
            const decisionCacheKey = cache?.isActive()
                ? buildSemanticFlowDecisionCacheKey({
                    promptSchemaVersion: SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION,
                    parserSchemaVersion: SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION,
                    model: options.model as string,
                    temperature: SEMANTIC_FLOW_LLM_TEMPERATURE,
                    system: prompt.system,
                    user: prompt.user,
                    anchorId: input.anchor.id,
                    round: input.round,
                    slice: input.slice,
                    draft: input.draft,
                    lastMarker: input.lastMarker,
                    lastDelta: input.lastDelta,
                })
                : undefined;
            const cachedDecision = decisionCacheKey ? cache!.lookupDecision(decisionCacheKey) : undefined;
            if (cachedDecision) {
                return cachedDecision;
            }

            const parseOptions: SemanticFlowParseOptions = {
                analyzerBackedSurfaceIds: buildAnalyzerBackedSurfaceSet(input),
            };
            let raw = await options.modelInvoker({
                system: prompt.system,
                user: prompt.user,
                model: options.model,
            });
            let initialError: string | undefined;
            for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
                try {
                    const parseStartedAt = Date.now();
                    console.log(`semanticflow_llm=parse_start anchor=${input.anchor.id} round=${input.round} attempt=${attempt} raw_chars=${String(raw || "").length}`);
                    const decision = parseSemanticFlowAssetDecision(raw, parseOptions);
                    console.log(`semanticflow_llm=parse_done anchor=${input.anchor.id} round=${input.round} attempt=${attempt} elapsed_ms=${Date.now() - parseStartedAt} status=${decision.status}`);
                    if (decisionCacheKey) {
                        cache!.storeDecision(decisionCacheKey, decision);
                    }
                    return decision;
                } catch (error) {
                    const detail = String((error as any)?.message || error);
                    console.log(`semanticflow_llm=parse_error anchor=${input.anchor.id} round=${input.round} attempt=${attempt} error=${detail.replace(/\s+/g, " ").slice(0, 360)}`);
                    if (!repairInvalidJson || attempt >= maxRepairAttempts) {
                        if (initialError) {
                            throw new Error([
                                `semanticflow llm asset response invalid after repair: ${detail}`,
                                `initial_error=${initialError}`,
                                `raw=${truncateLlmRaw(raw)}`,
                            ].join("; "));
                        }
                        throw new Error(`semanticflow llm asset response invalid: ${detail}; raw=${truncateLlmRaw(raw)}`);
                    }
                    initialError = detail;
                    raw = await repairSemanticFlowDecisionRaw(options, prompt, raw, detail);
                }
            }
            throw new Error("semanticflow llm asset response invalid: repair loop ended unexpectedly");
        },
    };
}

export function parseSemanticFlowAssetDecision(
    raw: string,
    options: SemanticFlowParseOptions = {},
): SemanticFlowDecision {
    const parsed = parseSemanticFlowAssetModelOutput(raw, options);
    if (parsed.status === "done") {
        return {
            status: "done",
            asset: parsed.asset,
            rationale: parsed.rationale,
        };
    }
    if (parsed.status === "need-more-evidence") {
        return {
            status: "need-more-evidence",
            draft: parsed.draft,
            request: {
                kind: parsed.request.kind,
                why: parsed.request.why,
                ask: parsed.request.ask,
            },
        };
    }
    return parsed;
}

async function repairSemanticFlowDecisionRaw(
    options: CreateSemanticFlowLlmDeciderOptions,
    originalPrompt: { system: string; user: string },
    invalidRaw: string,
    validationError: string,
): Promise<string> {
    const prompt = buildSemanticFlowRepairPrompt({
        original: originalPrompt,
        validationError,
        raw: invalidRaw,
    });
    try {
        return await options.modelInvoker({
            system: prompt.system,
            user: prompt.user,
            model: options.model,
        });
    } catch (error) {
        const detail = String((error as any)?.message || error);
        throw new Error([
            `semanticflow llm asset response invalid: ${validationError}`,
            `raw=${truncateLlmRaw(invalidRaw)}`,
            `repair_error=${detail}`,
        ].join("; "));
    }
}

function buildAnalyzerBackedSurfaceSet(input: SemanticFlowDecisionInput): Set<string> {
    const set = new Set<string>();
    set.add(`surface.${input.anchor.id}`);
    set.add(input.anchor.id);
    if (input.draft?.surfaces) {
        for (const surface of input.draft.surfaces) {
            if (surface?.surfaceId && surface.provenance?.source === "analyzer") {
                set.add(surface.surfaceId);
            }
        }
    }
    return set;
}

function truncateLlmRaw(raw: string, max = 1200): string {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}...(truncated)`;
}
