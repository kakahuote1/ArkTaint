import { validateModuleSpecOrThrow } from "../orchestration/modules/ModuleSpecValidator";
import type {
    ModuleConstraint,
    ModuleDispatchPreset,
    ModuleFieldPathPart,
    ModuleFieldPathSpec,
    ModuleSemantic,
    ModuleSpec,
} from "../kernel/contracts/ModuleSpec";
import {
    buildSemanticFlowPrompt,
    buildSemanticFlowRepairPrompt,
    SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION,
} from "./SemanticFlowPrompt";
import { buildSemanticFlowDecisionCacheKey, type SemanticFlowSessionCache } from "./SemanticFlowSessionCache";
import {
    buildSemanticFlowSlotAliasLookup,
    canonicalSlotAliasKey,
    cloneSlotRef,
} from "./SemanticFlowSlotAliases";
import type {
    SemanticFlowArtifactClass,
    SemanticFlowBudgetClass,
    SemanticFlowDecision,
    SemanticFlowDecider,
    SemanticFlowDecisionInput,
    SemanticFlowDeficitFocus,
    SemanticFlowDeficitScope,
    SemanticFlowDispatchHint,
    SemanticFlowEntryPattern,
    SemanticFlowExpansionRequest,
    SemanticFlowRelations,
    SemanticFlowResolution,
    SemanticFlowSummary,
    SemanticFlowSurfaceSlotRef,
    SemanticFlowTransfer,
} from "./SemanticFlowTypes";

export interface SemanticFlowModelInvokerInput {
    system: string;
    user: string;
    model?: string;
}

export type SemanticFlowModelInvoker = (input: SemanticFlowModelInvokerInput) => Promise<string>;

export const SEMANTIC_FLOW_LLM_TEMPERATURE = 0;
export const SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION = 11;

export interface SemanticFlowParseOptions {
    slotAliases?: Map<string, SemanticFlowSurfaceSlotRef>;
}

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
                slotAliases: buildSemanticFlowSlotAliasLookup(input),
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
                    const decision = parseSemanticFlowDecision(raw, parseOptions);
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
                                `semanticflow llm response invalid after repair: ${detail}`,
                                `initial_error=${initialError}`,
                                `raw=${truncateLlmRaw(raw)}`,
                            ].join("; "));
                        }
                        throw new Error(`semanticflow llm response invalid: ${detail}; raw=${truncateLlmRaw(raw)}`);
                    }
                    initialError = detail;
                    raw = await repairSemanticFlowDecisionRaw(options, prompt, raw, detail);
                }
            }
            throw new Error("semanticflow llm response invalid: repair loop ended unexpectedly");
        },
    };
}

export function parseSemanticFlowDecision(raw: string, options: SemanticFlowParseOptions = {}): SemanticFlowDecision {
    const parsed = parseLlmJsonObject(raw);
    return normalizeDecision(parsed, options);
}

function parseLlmJsonObject(raw: string): unknown {
    const text = stripJsonFences(raw);
    try {
        return JSON.parse(text);
    } catch (firstError) {
        const extracted = extractFirstJsonObject(text);
        if (!extracted || extracted === text) {
            throw firstError;
        }
        return JSON.parse(extracted);
    }
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
            `semanticflow llm response invalid: ${validationError}`,
            `raw=${truncateLlmRaw(invalidRaw)}`,
            `repair_error=${detail}`,
        ].join("; "));
    }
}

const SEMANTIC_FLOW_SLOT_VALUES = [
    "arg",
    "base",
    "result",
    "callback_param",
    "method_this",
    "method_param",
    "field_load",
    "decorated_field_value",
] as const;

const SEMANTIC_FLOW_TRANSFER_RELATIONS = [
    "direct",
    "companion",
    "state",
    "deferred",
    "binding",
] as const;

function normalizeDecision(value: unknown, options: SemanticFlowParseOptions): SemanticFlowDecision {
    const obj = expectRecord(value, "decision");
    const status = normalizeDecisionStatus(obj.status);

    if (Object.prototype.hasOwnProperty.call(obj, "classificationHint")) {
        throw new Error("decision.classificationHint is not supported; use decision.classification");
    }
    if (Object.prototype.hasOwnProperty.call(obj, "class")) {
        throw new Error("decision.class is not supported; use decision.classification");
    }

    if (status === "reject") {
        return {
            status: "reject",
            reason: expectString(obj.reason, "decision.reason"),
        };
    }

    if (status === "need-more-evidence") {
        return {
            status: "need-more-evidence",
            draft: normalizeSummary(obj.draft, undefined, options),
            request: normalizeRequest(obj.request, options),
        };
    }

    if (status !== "done") {
        throw new Error(`decision.status must be "done", "need-more-evidence", or "reject". Got: ${status}`);
    }

    let classification = normalizeClassification(obj.classification);
    const normalizedShape = normalizeDoneDecisionShape(obj, classification);
    classification = normalizedShape.classification;
    const summaryInput = normalizedShape.summary;
    const summaryRuleKind = summaryInput && typeof summaryInput === "object" && !Array.isArray(summaryInput)
        ? normalizeOptionalEnum((summaryInput as Record<string, unknown>).ruleKind, "decision.summary.ruleKind", [
            "source",
            "sink",
            "sanitizer",
            "transfer",
        ]) as SemanticFlowSummary["ruleKind"]
        : undefined;
    const resolutionText = normalizeResolution(obj.resolution, classification, summaryRuleKind);
    if (!new Set(["resolved", "irrelevant", "no-transfer", "wrapper-only", "need-human-check"]).has(resolutionText)) {
        throw new Error(`decision.resolution invalid: ${resolutionText}`);
    }
    const resolution = resolutionText as Exclude<SemanticFlowResolution, "rejected" | "unresolved">;

    let artifactClassification = resolution === "resolved" ? classification : undefined;
    const summaryForResolution = normalizeDoneSummaryForResolution(summaryInput, resolution);
    let summary = normalizeSummary(summaryForResolution, artifactClassification, options);
    const liftedSummary = tryLiftRuleTransferWithModuleOnlySlots(artifactClassification, summary);
    if (liftedSummary) {
        artifactClassification = "module";
        summary = liftedSummary;
    }
    const decision: SemanticFlowDecision = {
        status: "done",
        resolution,
        classification: artifactClassification,
        summary,
        rationale: normalizeStringArray(obj.rationale),
    };
    if (resolution === "resolved" && !decision.classification) {
        throw new Error("decision.classification is required when decision.resolution=resolved");
    }
    validateDoneDecisionConsistency(decision);
    return decision;
}

function tryLiftRuleTransferWithModuleOnlySlots(
    classification: SemanticFlowArtifactClass | undefined,
    summary: SemanticFlowSummary,
): SemanticFlowSummary | undefined {
    const transfers = summary.transfers.map(transfer => normalizeBareDecoratedFieldTransfer(summary, transfer));
    const convertedBareDecoratedField = transfers.some((transfer, index) => transfer !== summary.transfers[index]);
    if (
        classification !== "rule"
        || summary.ruleKind !== "transfer"
        || (
            !convertedBareDecoratedField
            && !transfers.some(transfer => isModuleOnlySlot(transfer.from) || isModuleOnlySlot(transfer.to))
        )
    ) {
        return undefined;
    }
    return {
        ...summary,
        transfers,
        ruleKind: undefined,
        sourceKind: undefined,
        moduleKind: summary.moduleKind ?? "bridge",
    };
}

function normalizeBareDecoratedFieldTransfer(
    summary: SemanticFlowSummary,
    transfer: SemanticFlowTransfer,
): SemanticFlowTransfer {
    if (transfer.to.slot !== "decorated_field_value" || transfer.to.surface) {
        return transfer;
    }
    const carrierPath = inferCarrierFieldPath(summary.relations?.carrier?.label);
    if (carrierPath.length === 0) {
        return transfer;
    }
    const sourceTail = Array.isArray(transfer.from.fieldPath) && transfer.from.fieldPath.length > 0
        ? transfer.from.fieldPath[transfer.from.fieldPath.length - 1]
        : undefined;
    const fieldPath = sourceTail && carrierPath[carrierPath.length - 1] !== sourceTail
        ? [...carrierPath, sourceTail]
        : carrierPath;
    return {
        ...transfer,
        to: {
            slot: "base",
            fieldPath,
        },
    };
}

function inferCarrierFieldPath(label?: string): string[] {
    const normalized = String(label || "").trim().replace(/^this\./i, "");
    if (!normalized) {
        return [];
    }
    const parts = normalized.split(".").map(part => part.trim()).filter(Boolean);
    if (parts.length === 0 || parts.some(part => !/^[A-Za-z_$][\w$]*$/.test(part))) {
        return [];
    }
    return parts;
}

function normalizeDoneSummaryForResolution(
    summary: unknown,
    resolution: Exclude<SemanticFlowResolution, "rejected" | "unresolved">,
): unknown {
    if (resolution === "resolved" || !isPlainRecord(summary)) {
        return summary;
    }
    const transfers = summary.transfers;
    if (Array.isArray(transfers) && transfers.length > 0) {
        return summary;
    }
    const out: Record<string, unknown> = { ...summary };
    delete out.ruleKind;
    delete out.sourceKind;
    delete out.moduleKind;
    delete out.moduleSpec;
    return out;
}

function normalizeClassification(value: unknown): SemanticFlowArtifactClass | undefined {
    if (value === undefined) return undefined;
    const text = canonicalToken(expectString(value, "decision.classification"));
    if (text === "arkmain") {
        return "arkmain";
    }
    if (text === "rule") {
        return "rule";
    }
    if (text === "module") {
        return "module";
    }
    throw new Error(`decision.classification invalid: ${text}`);
}

function normalizeDoneDecisionShape(
    obj: Record<string, unknown>,
    classification: SemanticFlowArtifactClass | undefined,
): { classification: SemanticFlowArtifactClass | undefined; summary: unknown } {
    const summary = normalizeTopLevelSummaryFields(obj);
    if (classification !== "module") {
        return {
            classification,
            summary,
        };
    }
    const summaryObj = isPlainRecord(summary) ? summary : undefined;
    const moduleSpecCandidate = obj.moduleSpec !== undefined
        ? obj.moduleSpec
        : summaryObj?.moduleSpec;
    const sourceRuleSummary = tryBuildSourceRuleSummaryFromModuleSpecDrift(moduleSpecCandidate, summary);
    if (sourceRuleSummary) {
        return {
            classification: "rule",
            summary: sourceRuleSummary,
        };
    }
    const transferSummary = tryBuildTransferSummaryFromModuleSpecDrift(moduleSpecCandidate, summary);
    if (transferSummary) {
        return transferSummary;
    }
    const sourceRuleOutputSummary = tryBuildSourceRuleSummaryFromModuleOutputDrift(summary);
    if (sourceRuleOutputSummary) {
        return {
            classification: "rule",
            summary: sourceRuleOutputSummary,
        };
    }
    if (obj.moduleSpec !== undefined && summaryObj) {
        return {
            classification,
            summary: {
                ...summaryObj,
                moduleSpec: Object.prototype.hasOwnProperty.call(summaryObj, "moduleSpec")
                    ? summaryObj.moduleSpec
                    : obj.moduleSpec,
            },
        };
    }
    return {
        classification,
        summary,
    };
}

function normalizeTopLevelSummaryFields(obj: Record<string, unknown>): unknown {
    if (!isPlainRecord(obj.summary)) {
        return obj.summary;
    }
    let out: Record<string, unknown> | undefined;
    const ensureOut = (): Record<string, unknown> => {
        if (!out) {
            out = { ...obj.summary as Record<string, unknown> };
        }
        return out;
    };
    for (const key of ["ruleKind", "sourceKind", "moduleKind"] as const) {
        if (
            obj[key] !== undefined
            && !Object.prototype.hasOwnProperty.call(obj.summary, key)
        ) {
            ensureOut()[key] = obj[key];
        }
    }
    return out || obj.summary;
}

function tryBuildSourceRuleSummaryFromModuleOutputDrift(
    summary: unknown,
): Record<string, unknown> | undefined {
    if (!isPlainRecord(summary) || summary.moduleSpec !== undefined) {
        return undefined;
    }
    const inputs = summary.inputs ?? [];
    const outputs = summary.outputs ?? [];
    const transfers = summary.transfers ?? [];
    if (!Array.isArray(inputs) || inputs.length > 0) {
        return undefined;
    }
    if (!Array.isArray(outputs) || outputs.length === 0) {
        return undefined;
    }
    if (!Array.isArray(transfers) || transfers.length > 0) {
        return undefined;
    }
    return {
        ...summary,
        inputs,
        outputs,
        transfers: [],
        confidence: summary.confidence ?? "medium",
        ruleKind: "source",
        sourceKind: summary.sourceKind,
        relations: undefined,
        moduleKind: undefined,
        moduleSpec: undefined,
        entryPattern: undefined,
    };
}

function tryBuildSourceRuleSummaryFromModuleSpecDrift(
    moduleSpec: unknown,
    summary: unknown,
): Record<string, unknown> | undefined {
    const semantic = extractSingleSourceLikeSemantic(moduleSpec);
    if (!semantic) {
        return undefined;
    }
    const summaryObj = isPlainRecord(summary) ? summary : {};
    const inputs = summaryObj.inputs ?? [];
    const transfers = summaryObj.transfers ?? [];
    const outputs = summaryObj.outputs
        ?? semantic.outputs
        ?? semantic.output
        ?? (semantic.ret !== undefined ? ["ret"] : undefined);
    if (!Array.isArray(inputs) || inputs.length > 0) {
        return undefined;
    }
    if (!Array.isArray(transfers) || transfers.length > 0) {
        return undefined;
    }
    if (!Array.isArray(outputs) || outputs.length === 0) {
        return undefined;
    }
    const confidence = summaryObj.confidence ?? semantic.confidence ?? "medium";
    return {
        ...summaryObj,
        inputs,
        outputs,
        transfers: [],
        confidence,
        ruleKind: "source",
        sourceKind: summaryObj.sourceKind ?? semantic.sourceKind,
        relations: undefined,
        moduleKind: undefined,
        moduleSpec: undefined,
    };
}

function extractSingleSourceLikeSemantic(value: unknown): Record<string, unknown> | undefined {
    const semantic = extractSingleInlineSemantic(value);
    return semantic && typeof semantic.kind === "string" && canonicalToken(semantic.kind) === "source"
        ? semantic
        : undefined;
}

function tryBuildTransferSummaryFromModuleSpecDrift(
    moduleSpec: unknown,
    summary: unknown,
): { classification: SemanticFlowArtifactClass | undefined; summary: Record<string, unknown> } | undefined {
    const semantic = extractSingleInlineSemantic(moduleSpec);
    if (!semantic || typeof semantic.kind !== "string" || canonicalToken(semantic.kind) !== "transfer") {
        return undefined;
    }
    const summaryObj = isPlainRecord(summary) ? summary : {};
    const effect = typeof semantic.effect === "string" ? semantic.effect : "";
    const inferred = inferCallbackTransferFromEffect(effect);
    if (!inferred) {
        return undefined;
    }
    return {
        classification: "module",
        summary: {
            ...summaryObj,
            inputs: [inferred.from],
            outputs: [inferred.to],
            transfers: [`${inferred.from} -> ${inferred.to}`],
            confidence: summaryObj.confidence ?? semantic.confidence ?? "medium",
            moduleKind: "bridge",
            ruleKind: undefined,
            sourceKind: undefined,
            moduleSpec: undefined,
            relations: undefined,
        },
    };
}

function extractSingleInlineSemantic(value: unknown): Record<string, unknown> | undefined {
    if (!isPlainRecord(value)) {
        return undefined;
    }
    const semantics = Array.isArray(value.semantics)
        ? value.semantics
        : typeof value.kind === "string"
            ? [value]
            : [];
    if (semantics.length !== 1 || !isPlainRecord(semantics[0])) {
        return undefined;
    }
    return semantics[0];
}

function inferCallbackTransferFromEffect(effect: string): { from: string; to: string } | undefined {
    const text = String(effect || "");
    const invoked = text.match(/\barg(\d+)\b[^.;,\n]*(?:is\s+)?(?:invoked|called|executed|callback)/i)
        || text.match(/\bcallback\s*\(?\s*arg(\d+)/i);
    if (!invoked) {
        return undefined;
    }
    const callbackIndex = Number(invoked[1]);
    const derived = text.match(/\bderived\s+from\s+(arg\d+(?:\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)?)/i)
        || text.match(/\bfrom\s+(arg\d+(?:\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)?)/i);
    if (!derived) {
        return undefined;
    }
    return {
        from: derived[1],
        to: `callback${callbackIndex}.param0`,
    };
}

function normalizeRequest(value: unknown, options: SemanticFlowParseOptions): SemanticFlowExpansionRequest {
    const obj = expectRecord(value, "decision.request");
    const kind = expectString(obj.kind, "decision.request.kind");
    if (!new Set(["q_ret", "q_recv", "q_cb", "q_comp", "q_meta", "q_wrap"]).has(kind)) {
        throw new Error(`decision.request.kind invalid: ${kind}`);
    }
    return {
        kind: kind as SemanticFlowExpansionRequest["kind"],
        focus: normalizeDeficitFocus(obj.focus, options),
        scope: normalizeDeficitScope(obj.scope),
        budgetClass: normalizeBudgetClass(obj.budgetClass),
        why: normalizeRequiredStringArray(obj.why, "decision.request.why"),
        ask: expectString(obj.ask, "decision.request.ask"),
    };
}

function normalizeDeficitFocus(value: unknown, options: SemanticFlowParseOptions): SemanticFlowDeficitFocus {
    const obj = expectRecord(value, "decision.request.focus");
    const focus: SemanticFlowDeficitFocus = {
        from: obj.from ? normalizeSlotRef(obj.from, "decision.request.focus.from", options) : undefined,
        to: obj.to ? normalizeSlotRef(obj.to, "decision.request.focus.to", options) : undefined,
        companion: typeof obj.companion === "string" ? obj.companion.trim() || undefined : undefined,
        carrierHint: typeof obj.carrierHint === "string" ? obj.carrierHint.trim() || undefined : undefined,
        triggerHint: typeof obj.triggerHint === "string" ? obj.triggerHint.trim() || undefined : undefined,
    };
    if (!focus.from && !focus.to && !focus.companion && !focus.carrierHint && !focus.triggerHint) {
        throw new Error("decision.request.focus must describe at least one target relation");
    }
    return focus;
}

function normalizeDeficitScope(value: unknown): SemanticFlowDeficitScope {
    if (value === undefined) {
        return {};
    }
    const obj = expectRecord(value, "decision.request.scope");
    return {
        owner: typeof obj.owner === "string" ? obj.owner.trim() || undefined : undefined,
        importSource: typeof obj.importSource === "string" ? obj.importSource.trim() || undefined : undefined,
        locality: normalizeOptionalEnum(
            obj.locality,
            "decision.request.scope.locality",
            ["method", "owner", "import", "file"],
        ) as SemanticFlowDeficitScope["locality"],
        sharedSymbols: normalizeStringArray(obj.sharedSymbols, "decision.request.scope.sharedSymbols"),
        surface: typeof obj.surface === "string" ? obj.surface.trim() || undefined : undefined,
    };
}

function normalizeBudgetClass(value: unknown): SemanticFlowBudgetClass | undefined {
    return normalizeOptionalEnum(
        value,
        "decision.request.budgetClass",
        ["micro", "body_local", "owner_local", "import_local"],
    ) as SemanticFlowBudgetClass | undefined;
}

function normalizeSummary(
    value: unknown,
    classification: SemanticFlowArtifactClass | undefined,
    options: SemanticFlowParseOptions,
): SemanticFlowSummary {
    const obj = expectRecord(value, "decision.summary");
    const rawRuleKind = normalizeOptionalEnum(obj.ruleKind, "decision.summary.ruleKind", [
        "source",
        "sink",
        "sanitizer",
        "transfer",
    ]) as SemanticFlowSummary["ruleKind"];
    const transfers = normalizeTransfers(obj.transfers, "decision.summary.transfers", options);
    const ruleKind = normalizeRuleKindForTransfers(rawRuleKind, transfers, classification);
    const relations = normalizeRelations(obj.relations, options);
    const summary: SemanticFlowSummary = {
        inputs: normalizeSlotRefs(obj.inputs, "decision.summary.inputs", options),
        outputs: normalizeSlotRefs(obj.outputs, "decision.summary.outputs", options),
        transfers,
        confidence: normalizeConfidence(obj.confidence),
        ruleKind,
        sourceKind: ruleKind === "source"
            ? normalizeOptionalEnum(obj.sourceKind, "decision.summary.sourceKind", [
                "entry_param",
                "call_return",
                "call_arg",
                "field_read",
                "callback_param",
            ]) as SemanticFlowSummary["sourceKind"]
            : undefined,
        moduleKind: normalizeOptionalEnum(obj.moduleKind, "decision.summary.moduleKind", [
            "state",
            "pair",
            "bridge",
            "deferred",
            "declarative",
        ]) as SemanticFlowSummary["moduleKind"],
        relations: normalizeRelationsForClassification(relations, classification, ruleKind, transfers),
        moduleSpec: classification === "module" ? normalizeModuleSpec(obj.moduleSpec) : undefined,
    };
    validateSummaryInternalConsistency(summary);
    return summary;
}

function normalizeRelationsForClassification(
    relations: SemanticFlowRelations | undefined,
    classification?: SemanticFlowArtifactClass,
    ruleKind?: SemanticFlowSummary["ruleKind"],
    transfers: SemanticFlowTransfer[] = [],
): SemanticFlowRelations | undefined {
    if (!relations || classification !== "rule") {
        return relations;
    }
    if (
        ruleKind
        && !relations.trigger
        && !relations.entryPattern
        && transfers.every(transfer => !transfer.relation || transfer.relation === "direct")
        && transfers.every(transfer => transfer.from.surface === undefined && transfer.to.surface === undefined)
        && transfers.every(transfer => !isModuleOnlySlot(transfer.from) && !isModuleOnlySlot(transfer.to))
    ) {
        return undefined;
    }
    if (
        ruleKind === "transfer"
        && transfers.some(transfer => isFieldSensitiveTransferTarget(transfer.to))
        && !relations.trigger
        && !relations.entryPattern
        && (!relations.constraints || relations.constraints.length === 0)
    ) {
        return undefined;
    }
    if (
        relations.companions?.length
        && !relations.carrier
        && !relations.trigger
        && !relations.entryPattern
        && (!relations.constraints || relations.constraints.length === 0)
    ) {
        return undefined;
    }
    return relations;
}

function normalizeRuleKindForTransfers(
    ruleKind: SemanticFlowSummary["ruleKind"],
    transfers: SemanticFlowTransfer[],
    classification?: SemanticFlowArtifactClass,
): SemanticFlowSummary["ruleKind"] {
    if (classification === "rule" && transfers.length > 0 && ruleKind && ruleKind !== "transfer") {
        return "transfer";
    }
    if (
        classification === "rule"
        && ruleKind === "sink"
        && transfers.some(transfer => isFieldSensitiveTransferTarget(transfer.to))
    ) {
        return "transfer";
    }
    return ruleKind;
}

function isFieldSensitiveTransferTarget(ref: SemanticFlowSurfaceSlotRef): boolean {
    return ref.slot === "field_load" || (Array.isArray(ref.fieldPath) && ref.fieldPath.length > 0);
}

function normalizeModuleSpec(value: unknown) {
    if (value === undefined) return undefined;
    try {
        validateModuleSpecOrThrow(value);
        return value as ModuleSpec;
    } catch (error) {
        const normalized = normalizeInlineModuleSpec(value);
        if (!normalized) {
            throw error;
        }
        validateModuleSpecOrThrow(normalized);
        return normalized;
    }
}

function normalizeRelations(value: unknown, options: SemanticFlowParseOptions): SemanticFlowRelations | undefined {
    if (value === undefined) return undefined;
    const obj = expectRecord(value, "decision.summary.relations");
    return {
        companions: normalizeStringArray(obj.companions),
        carrier: normalizeCarrier(obj.carrier),
        trigger: normalizeDispatchHint(obj.trigger, options),
        constraints: normalizeConstraints(obj.constraints, options),
        entryPattern: normalizeEntryPattern(obj.entryPattern),
    };
}

function normalizeCarrier(value: unknown): SemanticFlowRelations["carrier"] | undefined {
    if (value === undefined) return undefined;
    const obj = expectRecord(value, "decision.summary.relations.carrier");
    return {
        kind: expectString(obj.kind, "decision.summary.relations.carrier.kind"),
        label: typeof obj.label === "string" ? obj.label.trim() || undefined : undefined,
    };
}

function normalizeDispatchHint(value: unknown, options: SemanticFlowParseOptions): SemanticFlowDispatchHint | undefined {
    if (value === undefined) return undefined;
    const obj = expectRecord(value, "decision.summary.relations.trigger");
    const preset = normalizeOptionalEnum(
        obj.preset,
        "decision.summary.relations.trigger.preset",
        [
            "callback_sync",
            "callback_event",
            "promise_fulfilled",
            "promise_rejected",
            "promise_any",
            "declarative_field",
        ],
    );
    if (!preset) {
        throw new Error("decision.summary.relations.trigger.preset is required");
    }
    return {
        preset: preset as ModuleDispatchPreset,
        via: obj.via ? normalizeSlotRef(obj.via, "decision.summary.relations.trigger.via", options) : undefined,
        reason: typeof obj.reason === "string" ? obj.reason : undefined,
    };
}

function normalizeEntryPattern(value: unknown): SemanticFlowEntryPattern | undefined {
    if (value === undefined) return undefined;
    const obj = expectRecord(value, "decision.summary.relations.entryPattern");
    return {
        phase: normalizeRequiredEnum(
            obj.phase,
            "decision.summary.relations.entryPattern.phase",
            ["bootstrap", "composition", "interaction", "reactive_handoff", "teardown"],
        ) as SemanticFlowEntryPattern["phase"],
        kind: normalizeRequiredEnum(
            obj.kind,
            "decision.summary.relations.entryPattern.kind",
            ["ability_lifecycle", "stage_lifecycle", "extension_lifecycle", "page_build", "page_lifecycle", "callback"],
        ) as SemanticFlowEntryPattern["kind"],
        ownerKind: normalizeOptionalEnum(
            obj.ownerKind,
            "decision.summary.relations.entryPattern.ownerKind",
            ["ability_owner", "stage_owner", "extension_owner", "component_owner", "builder_owner", "unknown_owner"],
        ) as SemanticFlowEntryPattern["ownerKind"],
        schedule: typeof obj.schedule === "boolean" ? obj.schedule : undefined,
        reason: typeof obj.reason === "string" ? obj.reason : undefined,
        entryFamily: typeof obj.entryFamily === "string" ? obj.entryFamily : undefined,
        entryShape: typeof obj.entryShape === "string" ? obj.entryShape : undefined,
    };
}

function normalizeTransfers(value: unknown, path: string, options: SemanticFlowParseOptions): SemanticFlowTransfer[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new Error(`${path} must be an array`);
    }
    return value.map((item, index) => {
        if (typeof item === "string") {
            return parseTransferShorthand(item, `${path}[${index}]`, options);
        }
        const obj = expectRecord(item, `${path}[${index}]`);
        return {
            from: normalizeSlotRef(obj.from, `${path}[${index}].from`, options),
            to: normalizeSlotRef(obj.to, `${path}[${index}].to`, options),
            relation: normalizeOptionalEnum(
                obj.relation,
                `${path}[${index}].relation`,
                [...SEMANTIC_FLOW_TRANSFER_RELATIONS],
            ) as SemanticFlowTransfer["relation"],
            companionSurface: typeof obj.companionSurface === "string" ? obj.companionSurface : undefined,
        };
    });
}

function normalizeSlotRefs(value: unknown, path: string, options: SemanticFlowParseOptions): SemanticFlowSurfaceSlotRef[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new Error(`${path} must be an array`);
    }
    return value.map((item, index) => normalizeSlotRef(item, `${path}[${index}]`, options));
}

function normalizeSlotRef(value: unknown, path: string, options: SemanticFlowParseOptions): SemanticFlowSurfaceSlotRef {
    if (typeof value === "string") {
        return parseSlotRefShorthand(value, path, options);
    }
    const obj = expectRecord(value, path);
    const slot = normalizeRequiredEnum(
        obj.slot,
        `${path}.slot`,
        [...SEMANTIC_FLOW_SLOT_VALUES],
    ) as SemanticFlowSurfaceSlotRef["slot"];
    const fieldPath = normalizeFieldPathSpec(obj.fieldPath, `${path}.fieldPath`);
    const out: SemanticFlowSurfaceSlotRef = {
        surface: normalizeSurfaceRef(obj.surface, `${path}.surface`),
        slot,
        fieldPath,
    };
    if (slot === "arg") {
        out.index = normalizeRequiredInteger(obj.index, `${path}.index`);
        return out;
    }
    if (slot === "callback_param") {
        out.callbackArgIndex = normalizeOptionalNumber(obj.callbackArgIndex, `${path}.callbackArgIndex`) ?? 0;
        out.paramIndex = normalizeOptionalNumber(obj.paramIndex, `${path}.paramIndex`) ?? 0;
        return out;
    }
    if (slot === "method_param") {
        out.paramIndex = normalizeRequiredInteger(obj.paramIndex, `${path}.paramIndex`);
        return out;
    }
    if (slot === "field_load") {
        const fieldName = typeof obj.fieldName === "string" ? obj.fieldName.trim() : "";
        const fieldPathHead = Array.isArray(fieldPath) && fieldPath.length > 0 ? fieldPath[0] : undefined;
        out.fieldName = fieldName || fieldPathHead;
        if (!out.fieldName) {
            throw new Error(`${path}.fieldName or ${path}.fieldPath is required for field_load`);
        }
        return out;
    }
    return out;
}

function normalizeConfidence(value: unknown): SemanticFlowSummary["confidence"] {
    const text = canonicalToken(expectString(value, "decision.summary.confidence"));
    if (text === "low" || text === "medium" || text === "high") {
        return text;
    }
    throw new Error(`decision.summary.confidence invalid: ${text}`);
}

function normalizeOptionalEnum(value: unknown, path: string, allowed: string[]): string | undefined {
    if (value === undefined) return undefined;
    const text = canonicalToken(expectString(value, path));
    const matched = allowed.find(candidate => canonicalToken(candidate) === text);
    if (!matched) {
        throw new Error(`${path} invalid: ${text}`);
    }
    return matched;
}

function normalizeRequiredEnum(value: unknown, path: string, allowed: string[]): string {
    const matched = normalizeOptionalEnum(value, path, allowed);
    if (!matched) {
        throw new Error(`${path} is required`);
    }
    return matched;
}

function normalizeOptionalNumber(value: unknown, path: string): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value)) {
        throw new Error(`${path} must be an integer`);
    }
    return value as number;
}

function normalizeRequiredInteger(value: unknown, path: string): number {
    const normalized = normalizeOptionalNumber(value, path);
    if (normalized === undefined) {
        throw new Error(`${path} is required`);
    }
    return normalized;
}

function normalizeRequiredStringArray(value: unknown, path: string): string[] {
    const normalized = normalizeStringArray(value, path);
    if (normalized.length === 0) {
        throw new Error(`${path} must contain at least one string`);
    }
    return normalized;
}

function findEnumToken(tokens: string[], allowed: string[]): string | undefined {
    for (const token of tokens) {
        const matched = allowed.find(candidate => canonicalToken(candidate) === token);
        if (matched) {
            return matched;
        }
    }
    return undefined;
}

function normalizeConstraints(value: unknown, options: SemanticFlowParseOptions): ModuleConstraint[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        throw new Error("decision.summary.relations.constraints must be an array");
    }
    const out: ModuleConstraint[] = [];
    for (let index = 0; index < value.length; index++) {
        if (shouldIgnoreConstraintHint(value[index])) {
            continue;
        }
        const obj = expectRecord(value[index], `decision.summary.relations.constraints[${index}]`);
        const kind = normalizeRequiredEnum(
            obj.kind,
            `decision.summary.relations.constraints[${index}].kind`,
            ["same_receiver", "same_address"],
        );
        if (kind === "same_receiver") {
            out.push({
                kind: "same_receiver",
            });
            continue;
        }
        out.push({
            kind: "same_address",
            left: normalizeModuleAddress(
                obj.left,
                `decision.summary.relations.constraints[${index}].left`,
                options,
            ) as any,
            right: normalizeModuleAddress(
                obj.right,
                `decision.summary.relations.constraints[${index}].right`,
                options,
            ) as any,
        } as ModuleConstraint);
    }
    return out;
}

function normalizeInlineModuleSpec(value: unknown): ModuleSpec | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.semantics)) {
        return undefined;
    }
    const kind = typeof obj.kind === "string" ? obj.kind.trim() : "";
    if (!kind) {
        return undefined;
    }
    return {
        id: "semanticflow.inline",
        description: "",
        enabled: true,
        semantics: [obj as unknown as ModuleSemantic],
    };
}

function shouldIgnoreConstraintHint(value: unknown): boolean {
    if (typeof value === "string") {
        return value.trim().length > 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    if (obj.kind !== undefined) {
        return false;
    }
    return [
        "description",
        "condition",
        "effect",
        "reason",
        "note",
        "hint",
    ].some(key => typeof obj[key] === "string" && String(obj[key]).trim().length > 0);
}

function normalizeModuleAddress(value: unknown, path: string, options: SemanticFlowParseOptions): Record<string, unknown> {
    const obj = expectRecord(value, path);
    const kind = normalizeRequiredEnum(
        obj.kind,
        `${path}.kind`,
        ["literal", "endpoint", "decorated_field_meta"],
    );
    if (kind === "literal") {
        return {
            kind,
            value: expectString(obj.value, `${path}.value`),
        };
    }
    if (kind === "endpoint") {
        return {
            kind,
            endpoint: normalizeModuleEndpointAddress(obj.endpoint, `${path}.endpoint`, options),
        };
    }
    const surface = expectRecord(obj.surface, `${path}.surface`);
    return {
        kind,
        surface,
        source: normalizeRequiredEnum(
            obj.source,
            `${path}.source`,
            ["field_name", "decorator_param", "decorator_param_or_field_name"],
        ),
        decoratorKind: typeof obj.decoratorKind === "string" ? obj.decoratorKind.trim() || undefined : undefined,
    };
}

function normalizeModuleEndpointAddress(value: unknown, path: string, options: SemanticFlowParseOptions): Record<string, unknown> {
    const ref = normalizeSlotRef(value, path, options);
    return {
        surface: ref.surface || "semanticflow.address",
        slot: ref.slot,
        ...(ref.index !== undefined ? { index: ref.index } : {}),
        ...(ref.callbackArgIndex !== undefined ? { callbackArgIndex: ref.callbackArgIndex } : {}),
        ...(ref.paramIndex !== undefined ? { paramIndex: ref.paramIndex } : {}),
        ...(ref.fieldName ? { fieldName: ref.fieldName } : {}),
        ...(ref.fieldPath ? { fieldPath: ref.fieldPath } : {}),
    };
}

function normalizeSurfaceRef(value: unknown, path: string): SemanticFlowSurfaceSlotRef["surface"] | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "string") {
        return expectString(value, path);
    }
    const obj = expectRecord(value, path);
    const kind = normalizeRequiredEnum(obj.kind, `${path}.kind`, ["invoke", "method", "decorated_field"]);
    const selector = expectRecord(obj.selector, `${path}.selector`);
    return {
        kind,
        selector,
    } as SemanticFlowSurfaceSlotRef["surface"];
}

function normalizeFieldPathSpec(value: unknown, path: string): ModuleFieldPathSpec | undefined {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) {
        return value.map((part, index) => expectString(part, `${path}[${index}]`));
    }
    const obj = expectRecord(value, path);
    if (!Array.isArray(obj.parts)) {
        throw new Error(`${path}.parts must be an array`);
    }
    return {
        parts: obj.parts.map((part: unknown, index: number) => normalizeFieldPathPart(part, `${path}.parts[${index}]`)),
    } as ModuleFieldPathSpec;
}

function normalizeFieldPathPart(value: unknown, path: string): ModuleFieldPathPart {
    const obj = expectRecord(value, path);
    const kind = normalizeRequiredEnum(
        obj.kind,
        `${path}.kind`,
        ["literal", "current_field", "current_tail", "current_field_without_prefix"],
    );
    if (kind === "literal") {
        return {
            kind,
            value: expectString(obj.value, `${path}.value`),
        } as ModuleFieldPathPart;
    }
    if (kind === "current_field_without_prefix") {
        if (!Array.isArray(obj.prefixes)) {
            throw new Error(`${path}.prefixes must be an array`);
        }
        return {
            kind,
            prefixes: obj.prefixes.map((prefix: unknown, prefixIndex: number) => {
                if (!Array.isArray(prefix)) {
                    throw new Error(`${path}.prefixes[${prefixIndex}] must be an array`);
                }
                return prefix.map((part, partIndex) => expectString(
                    part,
                    `${path}.prefixes[${prefixIndex}][${partIndex}]`,
                ));
            }),
        } as ModuleFieldPathPart;
    }
    return { kind } as ModuleFieldPathPart;
}

function normalizeStringArray(value: unknown, path: string = "value"): string[] {
    if (value === undefined) return [];
    if (typeof value === "string") {
        return [expectString(value, path)];
    }
    if (!Array.isArray(value)) {
        throw new Error(`${path} must be an array`);
    }
    return value.map((item, index) => expectString(item, `${path}[${index}]`));
}

function normalizeDecisionStatus(value: unknown): "done" | "need-more-evidence" | "reject" {
    const text = canonicalToken(expectString(value, "decision.status"));
    if (text === "done") {
        return "done";
    }
    if (text === "need-more-evidence") {
        return "need-more-evidence";
    }
    if (text === "reject") {
        return "reject";
    }
    throw new Error(`decision.status must be "done", "need-more-evidence", or "reject". Got: ${text}`);
}

function validateSummaryInternalConsistency(summary: SemanticFlowSummary): void {
    if (summary.sourceKind && summary.ruleKind !== "source") {
        throw new Error("decision.summary.sourceKind requires decision.summary.ruleKind=source");
    }
}

function validateDoneDecisionConsistency(decision: Extract<SemanticFlowDecision, { status: "done" }>): void {
    const { classification, summary } = decision;
    if (decision.resolution !== "resolved") {
        validateNonArtifactDoneDecision(summary);
        return;
    }
    if (!classification) {
        return;
    }
    if (classification === "arkmain") {
        validateArkMainDoneDecision(summary);
        return;
    }
    if (classification === "rule") {
        validateRuleDoneDecision(summary);
        return;
    }
    validateModuleDoneDecision(summary);
}

function validateNonArtifactDoneDecision(summary: SemanticFlowSummary): void {
    if (summary.transfers.length > 0) {
        throw new Error("non-resolved decision must not include transfers; use resolution=resolved for artifact-bearing transfer summaries");
    }
}

function validateArkMainDoneDecision(summary: SemanticFlowSummary): void {
    if (!summary.relations?.entryPattern) {
        throw new Error("classification=arkmain requires decision.summary.relations.entryPattern");
    }
    if (summary.ruleKind || summary.sourceKind) {
        throw new Error("classification=arkmain must not include ruleKind/sourceKind");
    }
    if (summary.moduleKind || summary.moduleSpec) {
        throw new Error("classification=arkmain must not include moduleKind/moduleSpec");
    }
    if (summary.transfers.length > 0) {
        throw new Error("classification=arkmain must not include transfers");
    }
}

function validateRuleDoneDecision(summary: SemanticFlowSummary): void {
    if (!summary.ruleKind) {
        throw new Error("classification=rule requires decision.summary.ruleKind");
    }
    if (summary.moduleKind || summary.moduleSpec) {
        throw new Error("classification=rule must not include moduleKind/moduleSpec");
    }
    if (summary.relations?.entryPattern) {
        throw new Error("classification=rule must not include relations.entryPattern");
    }
    if (
        summary.relations?.companions?.length
        || summary.relations?.carrier
        || summary.relations?.trigger
        || summary.relations?.constraints?.length
    ) {
        throw new Error("classification=rule must not encode companion/carrier/trigger/constraint relations; use classification=module");
    }
    if (hasSurfaceQualifiedRuleSlots(summary)) {
        throw new Error("classification=rule must use anchor-local slots only; remove surface-qualified slot refs or use classification=module");
    }
    if (summary.ruleKind === "source") {
        if (summary.outputs.length === 0) {
            throw new Error("ruleKind=source requires at least one output slot");
        }
        if (summary.inputs.length > 0) {
            throw new Error("ruleKind=source must not include input slots");
        }
        if (summary.transfers.length > 0) {
            throw new Error("ruleKind=source must not include transfers");
        }
        return;
    }
    if (summary.ruleKind === "sink") {
        if (summary.inputs.length === 0) {
            throw new Error("ruleKind=sink requires at least one input slot");
        }
        if (summary.transfers.length > 0) {
            throw new Error("ruleKind=sink must not include transfers");
        }
        return;
    }
    if (summary.ruleKind === "sanitizer") {
        if (summary.inputs.length === 0 && summary.outputs.length === 0) {
            throw new Error("ruleKind=sanitizer requires at least one input or output slot");
        }
        if (summary.transfers.length > 0) {
            throw new Error("ruleKind=sanitizer must not include transfers");
        }
        return;
    }
    if (summary.transfers.length === 0) {
        throw new Error("ruleKind=transfer requires at least one transfer");
    }
    for (const transfer of summary.transfers) {
        if (transfer.relation && transfer.relation !== "direct") {
            throw new Error("ruleKind=transfer must not use companion/state/deferred/binding relations; use classification=module");
        }
        if (transfer.from.surface !== undefined || transfer.to.surface !== undefined) {
            throw new Error("ruleKind=transfer must not use cross-surface endpoints; use classification=module");
        }
    }
}

function validateModuleDoneDecision(summary: SemanticFlowSummary): void {
    if (summary.ruleKind || summary.sourceKind) {
        throw new Error("classification=module must not include ruleKind/sourceKind");
    }
    if (summary.relations?.entryPattern) {
        throw new Error("classification=module must not include relations.entryPattern");
    }
    if (summary.moduleSpec) {
        if (isRuleEncodableModuleSpec(summary.moduleSpec)) {
            throw new Error("classification=module must not use moduleSpec for one-surface direct bridge semantics that rules can already express");
        }
        return;
    }
    if (summary.moduleKind === "state" || summary.moduleKind === "declarative") {
        throw new Error(`classification=module with moduleKind=${summary.moduleKind} requires explicit moduleSpec`);
    }
    if (summary.transfers.length === 0) {
        throw new Error("classification=module without moduleSpec requires at least one transfer");
    }
    if (!isStructuralModuleSummary(summary)) {
        throw new Error("classification=module requires moduleSpec or module-only evidence such as companions, carrier, trigger, constraints, or cross-surface/deferred transfers");
    }
}

function isRuleEncodableModuleSpec(spec: any): boolean {
    if (!spec || typeof spec !== "object" || !Array.isArray(spec.semantics) || spec.semantics.length === 0) {
        return false;
    }
    return spec.semantics.every((semantic: any) => isRuleEncodableBridgeSemantic(semantic));
}

function isRuleEncodableBridgeSemantic(semantic: any): boolean {
    if (!semantic || semantic.kind !== "bridge") {
        return false;
    }
    if (semantic.dispatch || semantic.emit) {
        return false;
    }
    const constraints = Array.isArray(semantic.constraints) ? semantic.constraints : [];
    if (constraints.some((constraint: any) => constraint?.kind !== "same_receiver")) {
        return false;
    }
    if (!sameModuleSurface(semantic.from?.surface, semantic.to?.surface)) {
        return false;
    }
    return isRuleEncodableModuleEndpoint(semantic.from) && isRuleEncodableModuleEndpoint(semantic.to);
}

function isRuleEncodableModuleEndpoint(endpoint: any): boolean {
    if (!endpoint || typeof endpoint !== "object") {
        return false;
    }
    const slot = canonicalToken(expectString(endpoint.slot, "moduleSpec.semantic.endpoint.slot"));
    if (slot === "arg") {
        return Number.isInteger(endpoint.index);
    }
    if (slot === "base" || slot === "result") {
        return true;
    }
    if (slot === "field-load") {
        return typeof endpoint.fieldName === "string" && endpoint.fieldName.trim().length > 0;
    }
    return false;
}

function sameModuleSurface(left: unknown, right: unknown): boolean {
    if (left === undefined && right === undefined) {
        return true;
    }
    if (typeof left === "string" && typeof right === "string") {
        return left.trim() === right.trim();
    }
    if (!left || !right || typeof left !== "object" || typeof right !== "object") {
        return false;
    }
    return JSON.stringify(left) === JSON.stringify(right);
}

function hasSurfaceQualifiedRuleSlots(summary: SemanticFlowSummary): boolean {
    const refs = [
        ...summary.inputs,
        ...summary.outputs,
        ...summary.transfers.flatMap(transfer => [transfer.from, transfer.to]),
    ];
    return refs.some(ref => ref.surface !== undefined);
}

function isStructuralModuleSummary(summary: SemanticFlowSummary): boolean {
    if (summary.moduleKind && summary.moduleKind !== "bridge") {
        return true;
    }
    if (
        summary.relations?.companions?.length
        || summary.relations?.carrier
        || summary.relations?.trigger
        || summary.relations?.constraints?.length
    ) {
        return true;
    }
    return summary.transfers.some(transfer =>
        transfer.relation === "companion"
        || transfer.relation === "state"
        || transfer.relation === "deferred"
        || transfer.relation === "binding"
        || transfer.from.surface !== undefined
        || transfer.to.surface !== undefined
        || isModuleOnlySlot(transfer.from)
        || isModuleOnlySlot(transfer.to),
    );
}

function isModuleOnlySlot(ref: SemanticFlowSurfaceSlotRef): boolean {
    return ref.slot === "callback_param"
        || ref.slot === "method_this"
        || ref.slot === "method_param"
        || ref.slot === "decorated_field_value";
}

function normalizeResolution(
    value: unknown,
    classification?: SemanticFlowArtifactClass,
    ruleKind?: SemanticFlowSummary["ruleKind"],
): string {
    if (value === undefined && classification) {
        return "resolved";
    }
    const text = canonicalToken(expectString(value, "decision.resolution"));
    if (classification && ["rule", "module", "arkmain"].includes(text)) {
        return "resolved";
    }
    if (ruleKind && text === ruleKind) {
        return "resolved";
    }
    return text;
}

function canonicalToken(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
}

function parseTransferShorthand(value: string, path: string, options: SemanticFlowParseOptions): SemanticFlowTransfer {
    const normalized = String(value || "").trim();
    const arrowIndex = normalized.indexOf("->");
    if (arrowIndex < 0) {
        throw new Error(`${path} must contain '->'`);
    }
    const leftRaw = normalized.slice(0, arrowIndex).trim();
    const rightRaw = normalized.slice(arrowIndex + 2).trim();
    if (!leftRaw || !rightRaw) {
        throw new Error(`${path} must have both source and target around '->'`);
    }
    let relation: SemanticFlowTransfer["relation"] | undefined;
    let fromRaw = leftRaw;
    const relationMatch = leftRaw.match(/^(direct|companion|state|deferred|binding)\s*:(.+)$/i);
    if (relationMatch) {
        relation = canonicalToken(relationMatch[1]) as SemanticFlowTransfer["relation"];
        fromRaw = relationMatch[2].trim();
    }
    const from = parseSlotRefShorthand(fromRaw, `${path}.from`, options);
    const to = parseSlotRefShorthand(rightRaw, `${path}.to`, options);
    return {
        from,
        to,
        relation,
        companionSurface: relation === "companion" && typeof from.surface === "string" ? from.surface : undefined,
    };
}

function parseSlotRefShorthand(value: string, path: string, options: SemanticFlowParseOptions): SemanticFlowSurfaceSlotRef {
    const normalized = String(value || "").trim();
    const bare = parseBareSlotRef(normalized);
    if (bare) {
        return bare;
    }
    const alias = parseContextualSlotAliasRef(normalized, options);
    if (alias) {
        return alias;
    }
    for (let i = normalized.lastIndexOf("."); i > 0; i = normalized.lastIndexOf(".", i - 1)) {
        const surfaceText = normalized.slice(0, i).trim();
        const slotText = normalized.slice(i + 1).trim();
        if (!surfaceText || !slotText) {
            continue;
        }
        const suffix = parseBareSlotRef(slotText) || parseContextualSlotAliasRef(slotText, options);
        if (suffix) {
            return {
                ...suffix,
                surface: surfaceText,
            };
        }
    }
    throw new Error(`${path} shorthand invalid: ${normalized}`);
}

function parseContextualSlotAliasRef(
    value: string,
    options: SemanticFlowParseOptions,
): SemanticFlowSurfaceSlotRef | undefined {
    if (!options.slotAliases || options.slotAliases.size === 0) {
        return undefined;
    }
    const trimmed = String(value || "").trim();
    const exact = options.slotAliases.get(canonicalSlotAliasKey(trimmed));
    if (exact) {
        return cloneSlotRef(exact);
    }
    const fieldMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/);
    if (!fieldMatch) {
        return undefined;
    }
    const base = options.slotAliases.get(canonicalSlotAliasKey(fieldMatch[1]));
    if (!base) {
        return undefined;
    }
    const fieldPath = splitFieldPath(fieldMatch[2]);
    if (fieldPath.length === 0) {
        return undefined;
    }
    const out = cloneSlotRef(base);
    out.fieldPath = [
        ...(Array.isArray(out.fieldPath) ? out.fieldPath : []),
        ...fieldPath,
    ];
    return out;
}

function parseBareSlotRef(value: string): SemanticFlowSurfaceSlotRef | undefined {
    const normalized = canonicalToken(value);
    let match = normalized.match(/^arg(\d+)$/);
    if (match) {
        return { slot: "arg", index: Number(match[1]) };
    }
    match = value.trim().match(/^arg(\d+)\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/);
    if (match) {
        return {
            slot: "arg",
            index: Number(match[1]),
            fieldPath: splitFieldPath(match[2]),
        };
    }
    if (normalized === "ret" || normalized === "result") {
        return { slot: "result" };
    }
    match = value.trim().match(/^(?:ret|result)\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/i);
    if (match) {
        return {
            slot: "result",
            fieldPath: splitFieldPath(match[1]),
        };
    }
    if (normalized === "base" || normalized === "receiver" || normalized === "this") {
        return { slot: "base" };
    }
    match = value.trim().match(/^(?:base|receiver|this)\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/i);
    if (match) {
        return {
            slot: "base",
            fieldPath: splitFieldPath(match[1]),
        };
    }
    if (normalized === "method-this") {
        return { slot: "method_this" };
    }
    match = normalized.match(/^(?:method-)?param(\d+)$/);
    if (match) {
        return { slot: "method_param", paramIndex: Number(match[1]) };
    }
    match = normalized.match(/^(?:cb|callback)(\d+)\.param(\d+)$/);
    if (match) {
        return { slot: "callback_param", callbackArgIndex: Number(match[1]), paramIndex: Number(match[2]) };
    }
    match = normalized.match(/^callback\.param(\d+)$/);
    if (match) {
        return { slot: "callback_param", callbackArgIndex: 0, paramIndex: Number(match[1]) };
    }
    match = value.trim().match(/^field(?:_load)?:(.+)$/i);
    if (match) {
        const fieldPath = match[1].split(".").map(part => part.trim()).filter(Boolean);
        if (fieldPath.length === 0) {
            return undefined;
        }
        return {
            slot: "field_load",
            fieldName: fieldPath[0],
            fieldPath,
        };
    }
    if (normalized === "decorated-field-value") {
        return { slot: "decorated_field_value" };
    }
    return undefined;
}

function splitFieldPath(value: string): string[] {
    return String(value || "").split(".").map(part => part.trim()).filter(Boolean);
}

function expectRecord(value: unknown, path: string): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as Record<string, any>;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function expectString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${path} must be a non-empty string`);
    }
    return value.trim();
}

function stripJsonFences(text: string): string {
    const trimmed = String(text || "").trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced?.[1] ? fenced[1].trim() : trimmed;
}

function extractFirstJsonObject(text: string): string | undefined {
    const input = String(text || "");
    const start = input.indexOf("{");
    if (start < 0) {
        return undefined;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < input.length; index++) {
        const char = input[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === "{") {
            depth++;
            continue;
        }
        if (char === "}") {
            depth--;
            if (depth === 0) {
                return input.slice(start, index + 1).trim();
            }
        }
    }
    return undefined;
}

function truncateLlmRaw(raw: string, max = 800): string {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    return text.length <= max ? text : `${text.slice(0, max)}...(truncated)`;
}
