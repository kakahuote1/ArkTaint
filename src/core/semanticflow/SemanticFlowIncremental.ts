import { createHash } from "crypto";
import type {
    SemanticFlowAnchor,
    SemanticFlowBudgetClass,
    SemanticFlowDeficit,
    SemanticFlowDeficitFocus,
    SemanticFlowDeficitScope,
    SemanticFlowDelta,
    SemanticFlowDraftId,
    SemanticFlowExpandPlan,
    SemanticFlowExpansionRequest,
    SemanticFlowMarker,
    SemanticFlowRequestKind,
    SemanticFlowSlicePackage,
    SemanticFlowSummary,
} from "./SemanticFlowTypes";

type EditableSummaryKey =
    | "inputs"
    | "outputs"
    | "transfers"
    | "confidence"
    | "ruleKind"
    | "sourceKind"
    | "moduleKind"
    | "moduleSpec";

type EditableRelationKey = "companions" | "carrier" | "trigger" | "constraints" | "entryPattern";

interface SemanticFlowEditableSet {
    summary: Set<EditableSummaryKey>;
    relations: Set<EditableRelationKey>;
}

export function createSemanticFlowDraftId(anchor: SemanticFlowAnchor): SemanticFlowDraftId {
    return `draft.${anchor.id}`;
}

export function materializeSemanticFlowDeficit(
    anchor: SemanticFlowAnchor,
    request: SemanticFlowExpansionRequest,
): SemanticFlowDeficit {
    const normalizedFocus = canonicalizeDeficitFocus(request.focus);
    const normalizedScope = canonicalizeDeficitScope({
        owner: request.scope.owner || anchor.owner,
        importSource: request.scope.importSource || anchor.importSource,
        locality: request.scope.locality || defaultLocalityForKind(request.kind),
        sharedSymbols: request.scope.sharedSymbols || anchor.stringLiterals,
        surface: request.scope.surface || anchor.surface,
    });
    return {
        ...request,
        focus: normalizedFocus,
        scope: normalizedScope,
        budgetClass: request.budgetClass || defaultBudgetClassForKind(request.kind),
        id: stableHash({
            anchorId: anchor.id,
            kind: request.kind,
            focus: normalizedFocus,
            scope: normalizedScope,
        }),
    };
}

export function createSemanticFlowExpandPlan(
    anchor: SemanticFlowAnchor,
    deficit: SemanticFlowDeficit,
): SemanticFlowExpandPlan {
    const seed = (() => {
        if (deficit.kind === "q_comp" || deficit.kind === "q_meta") {
            if (deficit.scope.importSource) {
                return { mode: "import" as const, value: deficit.scope.importSource };
            }
            if (anchor.owner) {
                return { mode: "owner" as const, value: anchor.owner };
            }
        }
        if (deficit.kind === "q_cb" && anchor.owner) {
            return { mode: "owner" as const, value: anchor.owner };
        }
        return { mode: "anchor" as const, value: anchor.surface };
    })();
    const edges = expandEdgesForKind(deficit.kind);
    return {
        kind: deficit.kind,
        seed,
        edges,
        budgetClass: deficit.budgetClass || defaultBudgetClassForKind(deficit.kind),
        stopCondition: stopConditionForKind(deficit.kind),
    };
}

export function createSemanticFlowDelta(
    anchor: SemanticFlowAnchor,
    round: number,
    deficit: SemanticFlowDeficit,
    additions: {
        observations?: string[];
        snippets?: SemanticFlowSlicePackage["snippets"];
        companions?: string[];
    },
): SemanticFlowDelta {
    const newObservations = dedupeStrings(additions.observations || []);
    const newSnippets = dedupeSnippets(additions.snippets || []);
    const newCompanions = dedupeStrings(additions.companions || []);
    return {
        id: stableHash({
            anchorId: anchor.id,
            round,
            deficitId: deficit.id,
            observations: newObservations,
            snippetLabels: newSnippets.map(item => item.label),
            companions: newCompanions,
        }),
        newObservations,
        newSnippets,
        newCompanions,
        effective: newObservations.length > 0 || newSnippets.length > 0 || newCompanions.length > 0,
    };
}

export function createSemanticFlowMarker(
    draftId: SemanticFlowDraftId,
    deficit: SemanticFlowDeficit,
    delta: SemanticFlowDelta,
): SemanticFlowMarker {
    return {
        draftId,
        deficitId: deficit.id,
        deltaId: delta.id,
        kind: deficit.kind,
        focus: deficit.focus,
        scope: deficit.scope,
        budgetClass: deficit.budgetClass || defaultBudgetClassForKind(deficit.kind),
    };
}

export function protectedMergeSemanticFlowDraft(
    previous: SemanticFlowSummary | undefined,
    next: SemanticFlowSummary,
    requestKind?: SemanticFlowRequestKind,
): SemanticFlowSummary {
    if (!previous || !requestKind) {
        return cloneSummary(next);
    }
    const editable = editableFieldsForKind(requestKind);
    const out: SemanticFlowSummary = cloneSummary(previous);
    for (const key of editable.summary) {
        setSummaryField(out, key, cloneUnknown(getSummaryField(next, key)));
    }
    const previousRelations = previous.relations || {};
    const nextRelations = next.relations || {};
    const mergedRelations: Record<string, unknown> = cloneUnknown(previousRelations) as Record<string, unknown>;
    for (const key of editable.relations) {
        const value = (nextRelations as Record<string, unknown>)[key];
        if (value === undefined) {
            delete mergedRelations[key];
        } else {
            mergedRelations[key] = cloneUnknown(value);
        }
    }
    out.relations = Object.keys(mergedRelations).length > 0
        ? mergedRelations as SemanticFlowSummary["relations"]
        : undefined;
    return out;
}

export function stableSemanticFlowSliceKey(slice: SemanticFlowSlicePackage): string {
    return JSON.stringify(canonicalizeValue({
        template: slice.template,
        observations: slice.observations,
        snippets: slice.snippets,
        companions: slice.companions,
        notes: slice.notes,
    }));
}

export function canonicalizeDeficitFocus(focus: SemanticFlowDeficitFocus): SemanticFlowDeficitFocus {
    return canonicalizeValue(focus || {}) as SemanticFlowDeficitFocus;
}

export function canonicalizeDeficitScope(scope: SemanticFlowDeficitScope): SemanticFlowDeficitScope {
    return canonicalizeValue(scope || {}) as SemanticFlowDeficitScope;
}

function defaultBudgetClassForKind(kind: SemanticFlowRequestKind): SemanticFlowBudgetClass {
    switch (kind) {
        case "q_ret":
        case "q_recv":
        case "q_wrap":
            return "body_local";
        case "q_comp":
        case "q_cb":
        case "q_meta":
            return "owner_local";
        default:
            return "body_local";
    }
}

function defaultLocalityForKind(kind: SemanticFlowRequestKind): SemanticFlowDeficitScope["locality"] {
    switch (kind) {
        case "q_ret":
        case "q_recv":
        case "q_wrap":
            return "method";
        case "q_comp":
        case "q_cb":
        case "q_meta":
            return "owner";
        default:
            return "method";
    }
}

function expandEdgesForKind(kind: SemanticFlowRequestKind): string[] {
    switch (kind) {
        case "q_ret":
            return ["E_ret"];
        case "q_recv":
            return ["E_recv", "E_scope"];
        case "q_cb":
            return ["E_arg", "E_scope"];
        case "q_comp":
            return ["E_scope", "E_sym"];
        case "q_meta":
            return ["E_meta", "E_scope"];
        case "q_wrap":
            return ["E_scope"];
        default:
            return ["E_scope"];
    }
}

function stopConditionForKind(kind: SemanticFlowRequestKind): string {
    switch (kind) {
        case "q_ret":
            return "next-surface-or-scope-exhausted";
        case "q_recv":
            return "receiver-write-or-scope-exhausted";
        case "q_cb":
            return "callback-dispatch-or-scope-exhausted";
        case "q_comp":
            return "companion-found-or-scope-exhausted";
        case "q_meta":
            return "binding-evidence-or-scope-exhausted";
        case "q_wrap":
            return "helper-body-or-scope-exhausted";
        default:
            return "scope-exhausted";
    }
}

function editableFieldsForKind(kind: SemanticFlowRequestKind): SemanticFlowEditableSet {
    const define = (
        summary: EditableSummaryKey[],
        relations: EditableRelationKey[],
    ): SemanticFlowEditableSet => ({
        summary: new Set(summary),
        relations: new Set(relations),
    });
    switch (kind) {
        case "q_ret":
            return define(["outputs", "transfers", "confidence"], ["companions", "carrier", "constraints"]);
        case "q_recv":
            return define(["inputs", "outputs", "transfers", "confidence", "moduleKind", "moduleSpec"], ["carrier", "constraints", "companions"]);
        case "q_cb":
            return define(["inputs", "outputs", "transfers", "confidence", "moduleKind", "moduleSpec"], ["companions", "trigger", "constraints", "carrier"]);
        case "q_comp":
            return define(["inputs", "outputs", "transfers", "confidence", "moduleKind", "moduleSpec"], ["companions", "carrier", "constraints", "trigger"]);
        case "q_meta":
            return define(["inputs", "outputs", "transfers", "confidence", "moduleKind", "moduleSpec"], ["entryPattern", "constraints", "companions", "carrier"]);
        case "q_wrap":
            return define(["inputs", "outputs", "transfers", "confidence", "ruleKind", "sourceKind", "moduleKind", "moduleSpec"], ["companions", "carrier", "constraints", "trigger"]);
        default:
            return define(["inputs", "outputs", "transfers", "confidence"], ["companions", "carrier", "constraints"]);
    }
}

function stableHash(value: unknown): string {
    const payload = JSON.stringify(canonicalizeValue(value));
    return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

function cloneSummary(summary: SemanticFlowSummary): SemanticFlowSummary {
    return cloneUnknown(summary) as SemanticFlowSummary;
}

function getSummaryField(summary: SemanticFlowSummary, key: EditableSummaryKey): unknown {
    return summary[key];
}

function setSummaryField(summary: SemanticFlowSummary, key: EditableSummaryKey, value: unknown): void {
    switch (key) {
        case "inputs":
            summary.inputs = value as SemanticFlowSummary["inputs"];
            return;
        case "outputs":
            summary.outputs = value as SemanticFlowSummary["outputs"];
            return;
        case "transfers":
            summary.transfers = value as SemanticFlowSummary["transfers"];
            return;
        case "confidence":
            summary.confidence = value as SemanticFlowSummary["confidence"];
            return;
        case "ruleKind":
            summary.ruleKind = value as SemanticFlowSummary["ruleKind"];
            return;
        case "sourceKind":
            summary.sourceKind = value as SemanticFlowSummary["sourceKind"];
            return;
        case "moduleKind":
            summary.moduleKind = value as SemanticFlowSummary["moduleKind"];
            return;
        case "moduleSpec":
            summary.moduleSpec = value as SemanticFlowSummary["moduleSpec"];
            return;
        default:
            return;
    }
}

function cloneUnknown<T>(value: T): T {
    return canonicalizeValue(value) as T;
}

function canonicalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(item => canonicalizeValue(item));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries) {
        out[key] = canonicalizeValue(item);
    }
    return out;
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.map(item => String(item || "").trim()).filter(Boolean))];
}

function dedupeSnippets(snippets: SemanticFlowSlicePackage["snippets"]): SemanticFlowSlicePackage["snippets"] {
    const seen = new Set<string>();
    const out: SemanticFlowSlicePackage["snippets"] = [];
    for (const snippet of snippets) {
        const label = String(snippet?.label || "").trim();
        const code = String(snippet?.code || "");
        const key = `${label}\n${code}`;
        if (!label || seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push({ label, code });
    }
    return out;
}
