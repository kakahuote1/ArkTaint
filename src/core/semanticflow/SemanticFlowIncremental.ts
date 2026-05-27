import { createHash } from "crypto";
import type {
    SemanticFlowAnchor,
    SemanticFlowAssetDraft,
    SemanticFlowBudgetClass,
    SemanticFlowDeficit,
    SemanticFlowDelta,
    SemanticFlowDraftId,
    SemanticFlowExpandPlan,
    SemanticFlowExpansionRequest,
    SemanticFlowMarker,
    SemanticFlowRequestKind,
    SemanticFlowSlicePackage,
} from "./SemanticFlowTypes";

export function createSemanticFlowDraftId(anchor: SemanticFlowAnchor): SemanticFlowDraftId {
    return `draft.${anchor.id}`;
}

export function materializeSemanticFlowDeficit(
    anchor: SemanticFlowAnchor,
    request: SemanticFlowExpansionRequest,
): SemanticFlowDeficit {
    const scope = canonicalizeValue({
        owner: request.scope?.owner || anchor.owner,
        importSource: request.scope?.importSource || anchor.importSource,
        locality: request.scope?.locality || defaultLocalityForKind(request.kind),
        sharedSymbols: request.scope?.sharedSymbols || anchor.stringLiterals,
        surface: request.scope?.surface || anchor.surface,
    }) as SemanticFlowDeficit["scope"];
    const focus = request.focus ? canonicalizeValue(request.focus) as SemanticFlowExpansionRequest["focus"] : undefined;
    return {
        ...request,
        focus,
        scope,
        budgetClass: request.budgetClass || defaultBudgetClassForKind(request.kind),
        id: stableHash({
            anchorId: anchor.id,
            kind: request.kind,
            focus,
            scope,
        }),
    };
}

export function createSemanticFlowExpandPlan(
    anchor: SemanticFlowAnchor,
    deficit: SemanticFlowDeficit,
): SemanticFlowExpandPlan {
    const seed = (() => {
        if (deficit.kind === "q_relation" || deficit.kind === "q_evidence") {
            if (deficit.scope.importSource) {
                return { mode: "import" as const, value: deficit.scope.importSource };
            }
            if (anchor.owner) {
                return { mode: "owner" as const, value: anchor.owner };
            }
        }
        return { mode: "anchor" as const, value: anchor.surface };
    })();
    return {
        kind: deficit.kind,
        seed,
        edges: expandEdgesForKind(deficit.kind),
        budgetClass: deficit.budgetClass,
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
        budgetClass: deficit.budgetClass,
    };
}

export function protectedMergeSemanticFlowDraft(
    previous: SemanticFlowAssetDraft | undefined,
    next: SemanticFlowAssetDraft | undefined,
): SemanticFlowAssetDraft | undefined {
    if (!previous) {
        return cloneUnknown(next);
    }
    if (!next) {
        return cloneUnknown(previous);
    }
    return mergeObjects(previous, next);
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

function defaultBudgetClassForKind(kind: SemanticFlowRequestKind): SemanticFlowBudgetClass {
    switch (kind) {
        case "q_surface":
        case "q_role":
        case "q_endpoint":
        case "q_effect":
            return "body_local";
        case "q_relation":
        case "q_evidence":
            return "owner_local";
        default:
            return "body_local";
    }
}

function defaultLocalityForKind(kind: SemanticFlowRequestKind): SemanticFlowDeficit["scope"]["locality"] {
    switch (kind) {
        case "q_relation":
        case "q_evidence":
            return "owner";
        default:
            return "method";
    }
}

function expandEdgesForKind(kind: SemanticFlowRequestKind): string[] {
    switch (kind) {
        case "q_surface":
            return ["E_scope"];
        case "q_role":
            return ["E_recv", "E_scope"];
        case "q_endpoint":
            return ["E_arg", "E_ret", "E_scope"];
        case "q_effect":
            return ["E_ret", "E_arg", "E_recv"];
        case "q_relation":
            return ["E_carrier", "E_scope", "E_sym"];
        case "q_evidence":
            return ["E_meta", "E_scope"];
        default:
            return ["E_scope"];
    }
}

function stopConditionForKind(kind: SemanticFlowRequestKind): string {
    switch (kind) {
        case "q_surface":
            return "surface-identity-evidence-or-scope-exhausted";
        case "q_role":
            return "role-evidence-or-scope-exhausted";
        case "q_endpoint":
            return "endpoint-evidence-or-scope-exhausted";
        case "q_effect":
            return "effect-template-evidence-or-scope-exhausted";
        case "q_relation":
            return "relation-evidence-or-scope-exhausted";
        case "q_evidence":
            return "requested-evidence-or-scope-exhausted";
        default:
            return "scope-exhausted";
    }
}

function stableHash(value: unknown): string {
    const payload = JSON.stringify(canonicalizeValue(value));
    return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

function cloneUnknown<T>(value: T): T {
    return canonicalizeValue(value) as T;
}

function mergeObjects<T extends Record<string, unknown>>(left: T, right: T): T {
    const out: Record<string, unknown> = { ...cloneUnknown(left) as Record<string, unknown> };
    for (const [key, value] of Object.entries(cloneUnknown(right) as Record<string, unknown>)) {
        if (value === undefined) continue;
        if (
            value
            && typeof value === "object"
            && !Array.isArray(value)
            && out[key]
            && typeof out[key] === "object"
            && !Array.isArray(out[key])
        ) {
            out[key] = mergeObjects(out[key] as Record<string, unknown>, value as Record<string, unknown>);
        } else {
            out[key] = value;
        }
    }
    return out as T;
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
