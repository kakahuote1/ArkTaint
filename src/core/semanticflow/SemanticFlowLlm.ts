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
    SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION,
    buildSemanticFlowPrompt,
    buildSemanticFlowRepairPrompt,
} from "./SemanticFlowPrompt";
import {
    buildSemanticFlowDecisionCacheKey,
    type SemanticFlowSessionCache,
} from "./SemanticFlowSessionCache";
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
export const SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION = 1;

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
            const cachedDecision = decisionCacheKey ? cache.lookupDecision(decisionCacheKey) : undefined;
            if (cachedDecision) {
                return cachedDecision;
            }
            let raw = await options.modelInvoker({
                system: prompt.system,
                user: prompt.user,
                model: options.model,
            });
            let initialError: string | undefined;
            for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
                try {
                    const decision = parseSemanticFlowDecision(raw);
                    if (decisionCacheKey) {
                        cache.storeDecision(decisionCacheKey, decision);
                    }
                    return decision;
                } catch (error) {
                    const detail = String((error as any)?.message || error);
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

export function parseSemanticFlowDecision(raw: string): SemanticFlowDecision {
    const parsed = JSON.parse(stripJsonFences(raw));
    return normalizeDecision(parsed);
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

function normalizeDecision(value: unknown): SemanticFlowDecision {
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
            draft: normalizeSummary(obj.draft),
            request: normalizeRequest(obj.request),
        };
    }

    if (status !== "done") {
        throw new Error(`decision.status must be "done", "need-more-evidence", or "reject". Got: ${status}`);
    }

    const resolutionText = normalizeResolution(obj.resolution);
    if (!new Set(["resolved", "irrelevant", "no-transfer", "wrapper-only", "need-human-check"]).has(resolutionText)) {
        throw new Error(`decision.resolution invalid: ${resolutionText}`);
    }
    const resolution = resolutionText as Exclude<SemanticFlowResolution, "rejected" | "unresolved">;

    const decision: SemanticFlowDecision = {
        status: "done",
        resolution,
        classification: normalizeClassification(obj.classification),
        summary: normalizeSummary(obj.summary),
        rationale: normalizeStringArray(obj.rationale),
    };
    if (resolution === "resolved" && !decision.classification) {
        throw new Error("decision.classification is required when decision.resolution=resolved");
    }
    validateDoneDecisionConsistency(decision);
    return decision;
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

function normalizeRequest(value: unknown): SemanticFlowExpansionRequest {
    const obj = expectRecord(value, "decision.request");
    const kind = expectString(obj.kind, "decision.request.kind");
    if (!new Set(["q_ret", "q_recv", "q_cb", "q_comp", "q_meta", "q_wrap"]).has(kind)) {
        throw new Error(`decision.request.kind invalid: ${kind}`);
    }
    return {
        kind: kind as SemanticFlowExpansionRequest["kind"],
        focus: normalizeDeficitFocus(obj.focus),
        scope: normalizeDeficitScope(obj.scope),
        budgetClass: normalizeBudgetClass(obj.budgetClass),
        why: normalizeRequiredStringArray(obj.why, "decision.request.why"),
        ask: expectString(obj.ask, "decision.request.ask"),
    };
}

function normalizeDeficitFocus(value: unknown): SemanticFlowDeficitFocus {
    const obj = expectRecord(value, "decision.request.focus");
    const focus: SemanticFlowDeficitFocus = {
        from: obj.from ? normalizeSlotRef(obj.from, "decision.request.focus.from") : undefined,
        to: obj.to ? normalizeSlotRef(obj.to, "decision.request.focus.to") : undefined,
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

function normalizeSummary(value: unknown): SemanticFlowSummary {
    const obj = expectRecord(value, "decision.summary");
    const summary: SemanticFlowSummary = {
        inputs: normalizeSlotRefs(obj.inputs, "decision.summary.inputs"),
        outputs: normalizeSlotRefs(obj.outputs, "decision.summary.outputs"),
        transfers: normalizeTransfers(obj.transfers, "decision.summary.transfers"),
        confidence: normalizeConfidence(obj.confidence),
        ruleKind: normalizeOptionalEnum(obj.ruleKind, "decision.summary.ruleKind", [
            "source",
            "sink",
            "sanitizer",
            "transfer",
        ]) as SemanticFlowSummary["ruleKind"],
        sourceKind: normalizeOptionalEnum(obj.sourceKind, "decision.summary.sourceKind", [
            "entry_param",
            "call_return",
            "call_arg",
            "field_read",
            "callback_param",
        ]) as SemanticFlowSummary["sourceKind"],
        moduleKind: normalizeOptionalEnum(obj.moduleKind, "decision.summary.moduleKind", [
            "state",
            "pair",
            "bridge",
            "deferred",
            "declarative",
        ]) as SemanticFlowSummary["moduleKind"],
        relations: normalizeRelations(obj.relations),
        moduleSpec: normalizeModuleSpec(obj.moduleSpec),
    };
    validateSummaryInternalConsistency(summary);
    return summary;
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

function normalizeRelations(value: unknown): SemanticFlowRelations | undefined {
    if (value === undefined) return undefined;
    const obj = expectRecord(value, "decision.summary.relations");
    return {
        companions: normalizeStringArray(obj.companions),
        carrier: normalizeCarrier(obj.carrier),
        trigger: normalizeDispatchHint(obj.trigger),
        constraints: normalizeConstraints(obj.constraints),
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

function normalizeDispatchHint(value: unknown): SemanticFlowDispatchHint | undefined {
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
        via: obj.via ? normalizeSlotRef(obj.via, "decision.summary.relations.trigger.via") : undefined,
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

function normalizeTransfers(value: unknown, path: string): SemanticFlowTransfer[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new Error(`${path} must be an array`);
    }
    return value.map((item, index) => {
        if (typeof item === "string") {
            return parseTransferShorthand(item, `${path}[${index}]`);
        }
        const obj = expectRecord(item, `${path}[${index}]`);
        return {
            from: normalizeSlotRef(obj.from, `${path}[${index}].from`),
            to: normalizeSlotRef(obj.to, `${path}[${index}].to`),
            relation: normalizeOptionalEnum(
                obj.relation,
                `${path}[${index}].relation`,
                [...SEMANTIC_FLOW_TRANSFER_RELATIONS],
            ) as SemanticFlowTransfer["relation"],
            companionSurface: typeof obj.companionSurface === "string" ? obj.companionSurface : undefined,
        };
    });
}

function normalizeSlotRefs(value: unknown, path: string): SemanticFlowSurfaceSlotRef[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new Error(`${path} must be an array`);
    }
    return value.map((item, index) => normalizeSlotRef(item, `${path}[${index}]`));
}

function normalizeSlotRef(value: unknown, path: string): SemanticFlowSurfaceSlotRef {
    if (typeof value === "string") {
        return parseSlotRefShorthand(value, path);
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

function normalizeConstraints(value: unknown): ModuleConstraint[] | undefined {
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
            ) as any,
            right: normalizeModuleAddress(
                obj.right,
                `decision.summary.relations.constraints[${index}].right`,
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
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    return typeof obj.description === "string" && obj.kind === undefined;
}

function normalizeModuleAddress(value: unknown, path: string): Record<string, unknown> {
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
            endpoint: normalizeModuleEndpointAddress(obj.endpoint, `${path}.endpoint`),
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

function normalizeModuleEndpointAddress(value: unknown, path: string): Record<string, unknown> {
    const ref = normalizeSlotRef(value, path);
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
        || transfer.to.surface !== undefined,
    );
}

function normalizeResolution(value: unknown): string {
    return canonicalToken(expectString(value, "decision.resolution"));
}

function canonicalToken(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
}

function parseTransferShorthand(value: string, path: string): SemanticFlowTransfer {
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
    const from = parseSlotRefShorthand(fromRaw, `${path}.from`);
    const to = parseSlotRefShorthand(rightRaw, `${path}.to`);
    return {
        from,
        to,
        relation,
        companionSurface: relation === "companion" && typeof from.surface === "string" ? from.surface : undefined,
    };
}

function parseSlotRefShorthand(value: string, path: string): SemanticFlowSurfaceSlotRef {
    const normalized = String(value || "").trim();
    const bare = parseBareSlotRef(normalized);
    if (bare) {
        return bare;
    }
    for (let i = normalized.lastIndexOf("."); i >= 0; i = normalized.lastIndexOf(".", i - 1)) {
        const surfaceText = normalized.slice(0, i).trim();
        const slotText = normalized.slice(i + 1).trim();
        if (!surfaceText || !slotText) {
            continue;
        }
        const suffix = parseBareSlotRef(slotText);
        if (suffix) {
            return {
                ...suffix,
                surface: surfaceText,
            };
        }
    }
    throw new Error(`${path} shorthand invalid: ${normalized}`);
}

function parseBareSlotRef(value: string): SemanticFlowSurfaceSlotRef | undefined {
    const normalized = canonicalToken(value);
    let match = normalized.match(/^arg(\d+)$/);
    if (match) {
        return { slot: "arg", index: Number(match[1]) };
    }
    if (normalized === "ret" || normalized === "result") {
        return { slot: "result" };
    }
    if (normalized === "base" || normalized === "receiver" || normalized === "this") {
        return { slot: "base" };
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

function expectRecord(value: unknown, path: string): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as Record<string, any>;
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

function truncateLlmRaw(raw: string, max = 800): string {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    return text.length <= max ? text : `${text.slice(0, max)}...(truncated)`;
}
