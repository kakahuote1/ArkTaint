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
import { parseCanonicalApiId } from "../api/identity";

export interface SemanticFlowModelInvokerInput {
    system: string;
    user: string;
    model?: string;
}

export type SemanticFlowModelInvoker = (input: SemanticFlowModelInvokerInput) => Promise<string>;

export const SEMANTIC_FLOW_LLM_TEMPERATURE = 0;
export const SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION = 20;

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
                    validateSemanticFlowDecisionAgainstAnchor(decision, input);
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

function validateSemanticFlowDecisionAgainstAnchor(
    decision: SemanticFlowDecision,
    input: SemanticFlowDecisionInput,
): void {
    if (decision.status !== "done") {
        return;
    }
    validateReceiverFieldCarrierAsset(decision, input);
    validateProjectStorageWrapperAsset(decision, input);
    validateDecisionSurfacesUseObservedCanonicalIds(decision, input);
}

function validateDecisionSurfacesUseObservedCanonicalIds(
    decision: Extract<SemanticFlowDecision, { status: "done" }>,
    input: SemanticFlowDecisionInput,
): void {
    const observedCanonicalApiIds = collectObservedCanonicalApiSurfaceIds(input);
    const surfaces = decision.asset.surfaces || [];
    if (surfaces.length > 0 && observedCanonicalApiIds.size === 0) {
        throw new Error([
            "asset surfaces require analyzer-backed canonicalApiSurface observations",
            `anchor=${input.anchor.id}`,
            "return need-more-evidence instead of inventing canonicalApiId",
        ].join("; "));
    }
    for (const surface of decision.asset.surfaces || []) {
        const canonicalApiId = String((surface as any).canonicalApiId || "").trim();
        if (!canonicalApiId) {
            continue;
        }
        const expectedSurfaceId = `surface:${canonicalApiId}`;
        if (surface.surfaceId !== expectedSurfaceId) {
            throw new Error([
                `surface ${surface.surfaceId} does not use canonical surfaceId`,
                `expected=${expectedSurfaceId}`,
                `canonicalApiId=${canonicalApiId}`,
                `anchor=${input.anchor.id}`,
            ].join("; "));
        }
        if (!observedCanonicalApiIds.has(canonicalApiId)) {
            throw new Error([
                `surface ${surface.surfaceId} canonicalApiId was not present in canonicalApiSurface observations`,
                `canonicalApiId=${canonicalApiId}`,
                `anchor=${input.anchor.id}`,
                "return need-more-evidence for missing surface evidence",
            ].join("; "));
        }
    }
}

function collectObservedCanonicalApiSurfaceIds(input: SemanticFlowDecisionInput): Set<string> {
    const out = new Set<string>();
    const visitText = (value: unknown): void => {
        for (const surface of collectCanonicalApiSurfaceObservations(value)) {
            out.add(surface.canonicalApiId);
        }
    };
    visitText(input.anchor.surface);
    visitText(input.anchor.methodSignature);
    for (const observation of input.slice.observations || []) {
        visitText(observation);
    }
    for (const note of input.slice.notes || []) {
        visitText(note);
    }
    for (const snippet of input.slice.snippets || []) {
        visitText(snippet?.label);
        visitText(snippet?.code);
    }
    for (const companion of input.slice.companions || []) {
        visitText(companion);
    }
    return out;
}

interface ObservedCanonicalApiSurface {
    canonicalApiId: string;
    memberName: string;
}

function collectCanonicalApiSurfaceObservations(value: unknown): ObservedCanonicalApiSurface[] {
    const text = String(value || "");
    if (!text.includes("canonicalApiSurface:")) {
        return [];
    }
    const out: ObservedCanonicalApiSurface[] = [];
    for (const line of text.split(/\r?\n/)) {
        const markerIndex = line.indexOf("canonicalApiSurface:");
        if (markerIndex < 0) continue;
        const jsonText = line.slice(markerIndex + "canonicalApiSurface:".length).trim();
        if (!jsonText.startsWith("{")) continue;
        try {
            const parsed = JSON.parse(jsonText);
            const canonicalApiId = String(parsed?.canonicalApiId || "").trim();
            const memberName = memberNameFromCanonicalApiId(canonicalApiId);
            if (canonicalApiId && memberName) {
                out.push({ canonicalApiId, memberName });
            }
        } catch {
            continue;
        }
    }
    return out;
}

function memberNameFromCanonicalApiId(canonicalApiId: string): string | undefined {
    const parts = parseCanonicalApiId(canonicalApiId);
    if (!parts) return undefined;
    const memberParts = parts.member.split(":").map(part => part.trim()).filter(Boolean);
    return memberParts[memberParts.length - 1] || undefined;
}

function validateReceiverFieldCarrierAsset(
    decision: Extract<SemanticFlowDecision, { status: "done" }>,
    input: SemanticFlowDecisionInput,
): void {
    if (String(decision.asset?.plane || "") === "arkmain") {
        return;
    }
    const storageEvidence = collectProjectStorageWrapperEvidence(input);
    if (storageEvidence.storageBoundary && storageEvidence.hasSemanticStorageCall) {
        return;
    }
    const evidence = collectReceiverFieldCarrierEvidence(input);
    if (!evidence.crossMethod || evidence.fields.length === 0) {
        return;
    }
    if (isFocusedReturnedValueSourceAsset(decision.asset, input)) {
        return;
    }
    if (assetHasObjectFieldHandoff(decision.asset)) {
        return;
    }
    throw new Error([
        "receiver-field carrier with cross-method sibling evidence requires plane=\"module\" object-field handoff companion or need-more-evidence",
        `anchor=${input.anchor.id}`,
        `fields=${evidence.fields.join(",")}`,
        "rule-only receiver or argument sink assets are incomplete for this hidden carrier",
    ].join("; "));
}

function collectReceiverFieldCarrierEvidence(input: SemanticFlowDecisionInput): { fields: string[]; crossMethod: boolean } {
    const fields = new Set<string>();
    let crossMethod = false;
    const visitText = (value: unknown): void => {
        const text = String(value || "");
        if (!text) {
            return;
        }
        if (/\bcarrier-sibling\b|\bcarrierCompanion\b|\bcarrier-context\b|\bcarrierMethodSnippet\b/i.test(text)) {
            crossMethod = true;
        }
        for (const match of text.matchAll(/\bthis\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g)) {
            const field = match[1]?.trim();
            const next = text.slice((match.index || 0) + match[0].length);
            if (field && !/^\s*\(/.test(next)) {
                fields.add(field);
            }
        }
    };
    for (const observation of input.slice.observations || []) {
        visitText(observation);
    }
    for (const note of input.slice.notes || []) {
        visitText(note);
    }
    for (const snippet of input.slice.snippets || []) {
        const label = String(snippet?.label || "");
        if (/^carrier-sibling-|^carrier-companion-|carrier/i.test(label)) {
            crossMethod = true;
        }
        visitText(label);
        visitText(snippet?.code);
    }
    for (const companion of input.slice.companions || []) {
        crossMethod = true;
        visitText(companion);
    }
    return { fields: [...fields.values()].sort((a, b) => a.localeCompare(b)), crossMethod };
}

function isFocusedReturnedValueSourceAsset(asset: any, input: SemanticFlowDecisionInput): boolean {
    if (!isReturnedValueFocusedInput(input)) {
        return false;
    }
    if (String(asset?.plane || "") !== "rule") {
        return false;
    }
    const templates = Array.isArray(asset?.effectTemplates) ? asset.effectTemplates : [];
    if (templates.length === 0) {
        return false;
    }
    if (!templates.every(isReturnedValueSourceTemplate)) {
        return false;
    }
    const bindings = Array.isArray(asset?.bindings) ? asset.bindings : [];
    return bindings.length > 0
        && bindings.every((binding: any) =>
            String(binding?.role || "") === "source"
            && isReturnedValueEndpoint(binding?.endpoint));
}

function isReturnedValueFocusedInput(input: SemanticFlowDecisionInput): boolean {
    const text = [
        input.anchor.id,
        ...(input.anchor.metaTags || []),
        ...(input.slice.notes || []),
        ...(input.slice.observations || []),
    ].join("\n").toLowerCase();
    return text.includes("returned_value_surface")
        || text.includes("returned-value modeling question")
        || text.includes("visible returned value");
}

function isReturnedValueSourceTemplate(template: any): boolean {
    return String(template?.kind || "") === "rule.source"
        && String(template?.sourceKind || "") === "call_return"
        && isReturnedValueEndpoint(template?.value);
}

function isReturnedValueEndpoint(endpoint: any): boolean {
    const baseKind = String(endpoint?.base?.kind || "");
    return baseKind === "promiseResult" || baseKind === "return";
}

function assetHasObjectFieldHandoff(asset: any): boolean {
    if (String(asset?.plane || "") !== "module") {
        return false;
    }
    for (const template of asset?.effectTemplates || []) {
        const kind = String(template?.kind || "");
        if (!kind.startsWith("handoff.")) {
            continue;
        }
        if (String(template?.handle?.cellKind || "") === "object-field") {
            return true;
        }
    }
    return false;
}

function validateProjectStorageWrapperAsset(
    decision: Extract<SemanticFlowDecision, { status: "done" }>,
    input: SemanticFlowDecisionInput,
): void {
    const evidence = collectProjectStorageWrapperEvidence(input);
    if (!evidence.storageBoundary || !evidence.hasSemanticStorageCall) {
        return;
    }
    if (assetHasProjectStorageHandoff(decision.asset)) {
        validateObservedProjectStorageSurfaces(decision.asset, input, evidence);
        return;
    }
    throw new Error([
        "project storage wrapper evidence requires plane=\"module\" persistent-storage-slot handoff or need-more-evidence",
        `anchor=${input.anchor.id}`,
        `methods=${evidence.methods.join(",") || "-"}`,
        "rule-only storage sink assets are incomplete for save/set/put project wrappers",
    ].join("; "));
}

function collectProjectStorageWrapperEvidence(
    input: SemanticFlowDecisionInput,
): {
    storageBoundary: boolean;
    hasMutatingStoreCall: boolean;
    hasSemanticStorageCall: boolean;
    methods: string[];
    observedSurfaces: Array<{ canonicalApiId: string; memberName: string; evidence: string }>;
} {
    const methods = new Set<string>();
    const observedSurfaces = new Map<string, { canonicalApiId: string; memberName: string; evidence: string }>();
    let storageBoundary = false;
    let hasMutatingStoreCall = false;
    let hasSemanticStorageCall = false;
    const visitText = (value: unknown): void => {
        const text = String(value || "");
        if (!text) {
            return;
        }
        if (/directBoundaryResolvedImport=true/i.test(text)
            || /project_state_or_database_wrapper_evidence/i.test(text)
            || /persistent-storage-slot/i.test(text)) {
            storageBoundary = true;
        }
        for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
            const method = match[1]?.trim();
            if (!method) {
                continue;
            }
            methods.add(method);
            if (projectStorageMethodHasSemantic(method)) {
                hasSemanticStorageCall = true;
            }
            if (/^(put|set|save|write|store|insert|update)(data|value|item|record|secret|token|password|credential)?$/i.test(method)) {
                hasMutatingStoreCall = true;
            }
        }
        for (const observed of collectCanonicalApiSurfaceObservations(text)) {
            methods.add(observed.memberName);
            if (projectStorageMethodHasSemantic(observed.memberName)) {
                hasSemanticStorageCall = true;
                if (!observedSurfaces.has(observed.canonicalApiId)) {
                    observedSurfaces.set(observed.canonicalApiId, { ...observed, evidence: text.slice(0, 240) });
                }
            }
        }
    };
    visitText(input.anchor.surface);
    visitText(input.anchor.methodSignature);
    for (const observation of input.slice.observations || []) {
        visitText(observation);
    }
    for (const note of input.slice.notes || []) {
        visitText(note);
    }
    for (const snippet of input.slice.snippets || []) {
        visitText(snippet?.label);
        visitText(snippet?.code);
    }
    for (const companion of input.slice.companions || []) {
        visitText(companion);
    }
    return {
        storageBoundary,
        hasMutatingStoreCall,
        hasSemanticStorageCall,
        methods: [...methods.values()].sort((a, b) => a.localeCompare(b)),
        observedSurfaces: [...observedSurfaces.values()].sort((a, b) =>
            a.canonicalApiId.localeCompare(b.canonicalApiId)),
    };
}

function assetHasProjectStorageHandoff(asset: any): boolean {
    if (String(asset?.plane || "") !== "module") {
        return false;
    }
    for (const template of asset?.effectTemplates || []) {
        const kind = String(template?.kind || "");
        if (!kind.startsWith("handoff.")) {
            continue;
        }
        const cellKind = String(template?.handle?.cellKind || "");
        if (cellKind === "persistent-storage-slot" || cellKind === "keyed-semantic-slot") {
            return true;
        }
    }
    return false;
}

function validateObservedProjectStorageSurfaces(
    asset: any,
    input: SemanticFlowDecisionInput,
    evidence: ReturnType<typeof collectProjectStorageWrapperEvidence>,
): void {
    const required = evidence.observedSurfaces.filter(surface =>
        projectStorageMethodHasSemantic(surface.memberName));
    if (required.length === 0) {
        return;
    }
    const missing = required.filter(surface => !assetHasCanonicalInvokeSurface(asset, surface.canonicalApiId));
    if (missing.length === 0) {
        return;
    }
    throw new Error([
        "project storage wrapper module asset must cover every observed companion canonicalApiId or return need-more-evidence",
        `anchor=${input.anchor.id}`,
        `missing=${missing.map(surface => `${surface.memberName}:${surface.canonicalApiId}`).join(",")}`,
        "do not cover only one overload when the evidence slice shows another exact canonical identity",
    ].join("; "));
}

function projectStorageMethodHasSemantic(methodName: string): boolean {
    return /^(put|set|save|write|store|insert|update|load|get|read|query|fetch|delete|remove|clear)(data|value|item|record|secret|token|password|credential)?$/i.test(methodName);
}

function assetHasCanonicalInvokeSurface(
    asset: any,
    canonicalApiId: string,
): boolean {
    return (asset?.surfaces || []).some((surface: any) => {
        if (String(surface?.kind || "") !== "invoke") {
            return false;
        }
        return String(surface?.canonicalApiId || "").trim() === canonicalApiId;
    });
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
