import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Stmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";

export type SemanticCarrierKind =
    | "same_lvalue"
    | "unique_slot"
    | "storage"
    | "event"
    | "route"
    | "task";

export type SemanticStateStatus =
    | "dirty"
    | "clean"
    | "written"
    | "cleared"
    | "bound"
    | "unbound"
    | "scheduled"
    | "resumed"
    | "active"
    | "inactive"
    | "version";

export type SemanticGuardKind =
    | "same_key"
    | "same_channel"
    | "same_callback"
    | "binding_active"
    | "route_target_match"
    | "delete_before_read"
    | "slot_initialized";

export interface SemanticCarrier {
    kind: SemanticCarrierKind;
    key: string;
    label: string;
    ownerKey?: string;
    slotKey?: string;
    channel?: string;
    callback?: string;
    routeId?: string;
    paramKey?: string;
    taskId?: string;
}

export interface SemanticSideState {
    storageState: SemanticStateStatus;
    eventState: SemanticStateStatus;
    asyncState: SemanticStateStatus;
    slotState: SemanticStateStatus;
    routeState: SemanticStateStatus;
}

export interface SemanticGuard {
    kind: SemanticGuardKind;
    enabled: boolean;
    left?: string;
    right?: string;
    description: string;
}

export interface SemanticFact {
    id: string;
    source: string;
    carrier: SemanticCarrier;
    tainted: boolean;
    state: SemanticStateStatus;
    sideState: SemanticSideState;
    contextId: number;
    nodeId?: number;
    fieldPath?: string[];
    methodSignature?: string;
    stmtText?: string;
    stmtIndex?: number;
    order: number;
    parentFactId?: string;
    transitionId?: string;
    reason?: string;
}

export interface SemanticProvenanceRecord {
    fromFactId: string;
    toFactId: string;
    transitionId: string;
    reason: string;
    methodSignature?: string;
    stmtText?: string;
    carrierKey: string;
    tainted: boolean;
}

export interface SemanticGapRecord {
    factId: string;
    carrierKey: string;
    transitionId: string;
    reason: string;
    blockedBy: string;
    methodSignature?: string;
    stmtText?: string;
}

export interface SemanticCandidateSeed {
    factId: string;
    carrierKey: string;
    source: string;
    reason: string;
    methodSignature?: string;
    stmtText?: string;
}

export interface SemanticSinkHit {
    factId: string;
    carrierKey: string;
    source: string;
    sinkSignature: string;
    sinkRuleId?: string;
    methodSignature?: string;
    stmtText?: string;
    argIndex?: number;
}

export interface SemanticSolveBudget {
    maxDequeues?: number;
    maxVisited?: number;
    maxElapsedMs?: number;
}

export interface SemanticStateStats {
    dequeues: number;
    visited: number;
    elapsedMs: number;
    transitionCounts: Record<string, number>;
}

export interface SemanticSolveOptions {
    sinkSignatures?: string[];
    sinkRuleIds?: string[];
    budget?: SemanticSolveBudget;
}

export interface SemanticSolveInput {
    scene: Scene;
    pag: Pag;
    seeds: SemanticFact[];
    transitions?: SemanticTransition[];
    sinkSignatures?: string[];
    sinkRuleIds?: string[];
    budget?: SemanticSolveBudget;
}

export interface SemanticSolveResult {
    enabled: boolean;
    truncated: boolean;
    stats: SemanticStateStats;
    seedCount: number;
    sinkHitCount: number;
    candidateSeedCount: number;
    provenanceCount: number;
    gapCount: number;
    sinkHits: SemanticSinkHit[];
    candidateSeeds: SemanticCandidateSeed[];
    derivedFacts: SemanticFact[];
    provenance: SemanticProvenanceRecord[];
    gaps: SemanticGapRecord[];
    truncation?: {
        reason: string;
        dequeues: number;
        visited: number;
        elapsedMs: number;
    };
}

export interface SemanticTransitionProjection {
    carrier?: SemanticCarrier;
    tainted?: boolean;
    state?: SemanticStateStatus;
    sideState?: Partial<SemanticSideState>;
    guard?: SemanticGuard;
    reason: string;
    sinkHit?: {
        sinkSignature: string;
        sinkRuleId?: string;
        argIndex?: number;
    };
    candidateSeed?: boolean;
    gap?: {
        blockedBy: string;
    };
}

export interface SemanticTransitionContext {
    scene: Scene;
    pag: Pag;
    method: ArkMethod;
    stmt: Stmt;
    stmtIndex: number;
    blockId: string;
    pathKey: string;
    sinkSignatures: Set<string>;
    sinkRuleIds: Set<string>;
}

export interface SemanticTransition {
    id: string;
    label: string;
    match(fact: SemanticFact, ctx: SemanticTransitionContext): boolean;
    project(fact: SemanticFact, ctx: SemanticTransitionContext): SemanticTransitionProjection[];
    check(fact: SemanticFact, ctx: SemanticTransitionContext, projection: SemanticTransitionProjection): boolean;
    update(fact: SemanticFact, ctx: SemanticTransitionContext, projection: SemanticTransitionProjection): SemanticFact | undefined;
    derive(fact: SemanticFact, ctx: SemanticTransitionContext, projection: SemanticTransitionProjection): SemanticFact[];
    record(
        fact: SemanticFact,
        ctx: SemanticTransitionContext,
        projection: SemanticTransitionProjection,
        derivedFacts: SemanticFact[],
        result: SemanticSolveResultMutable,
    ): void;
}

export interface SemanticSolveResultMutable extends SemanticSolveResult {
    sinkHits: SemanticSinkHit[];
    candidateSeeds: SemanticCandidateSeed[];
    derivedFacts: SemanticFact[];
    provenance: SemanticProvenanceRecord[];
    gaps: SemanticGapRecord[];
}

export function createDefaultSemanticSideState(): SemanticSideState {
    return {
        storageState: "clean",
        eventState: "inactive",
        asyncState: "inactive",
        slotState: "clean",
        routeState: "inactive",
    };
}

export function createSemanticCarrier(kind: SemanticCarrierKind, key: string, label: string, extra: Partial<SemanticCarrier> = {}): SemanticCarrier {
    return {
        kind,
        key,
        label,
        ownerKey: extra.ownerKey,
        slotKey: extra.slotKey,
        channel: extra.channel,
        callback: extra.callback,
        routeId: extra.routeId,
        paramKey: extra.paramKey,
        taskId: extra.taskId,
    };
}

function resolveMethodScope(method?: ArkMethod, nodeId?: number): string {
    const methodSignature = resolveMethodSignatureText(method);
    if (methodSignature) {
        return methodSignature;
    }
    if (nodeId !== undefined) {
        return `node:${nodeId}`;
    }
    return "unknown";
}

export function buildSemanticCarrierForValue(method?: ArkMethod, value?: any, stmt?: Stmt, nodeId?: number): SemanticCarrier | undefined {
    const scope = resolveMethodScope(method, nodeId);
    if (!value) {
        return nodeId === undefined
            ? undefined
            : createSemanticCarrier("same_lvalue", scope, String(nodeId));
    }
    if (value instanceof ArkParameterRef) {
        const index = String(value.getIndex());
        const key = `param:${scope}:${index}`;
        return createSemanticCarrier("same_lvalue", key, index, { paramKey: index });
    }
    if (value instanceof ArkInstanceFieldRef) {
        const baseName = String(value.getBase?.()?.getName?.() || "base");
        const fieldName = String(value.getFieldName?.() || value.toString());
        const key = `storage:${scope}:${baseName}.${fieldName}`;
        return createSemanticCarrier("storage", key, `${baseName}.${fieldName}`, { ownerKey: baseName, slotKey: fieldName });
    }
    if (value instanceof ArkStaticFieldRef) {
        const fieldName = String(value.getFieldName?.() || value.toString());
        const key = `storage:${scope}:static.${fieldName}`;
        return createSemanticCarrier("storage", key, fieldName, { ownerKey: "static", slotKey: fieldName });
    }
    if (value instanceof ArkArrayRef) {
        const baseName = String(value.getBase?.()?.getName?.() || "array");
        const indexText = String(value.getIndex?.()?.toString?.() || "?");
        const key = `slot:${scope}:${baseName}[${indexText}]`;
        return createSemanticCarrier("unique_slot", key, `${baseName}[${indexText}]`, { slotKey: `${baseName}[${indexText}]` });
    }
    if (typeof value.getName === "function" && typeof value.getDeclaringStmt === "function") {
        const localName = String(value.getName?.() || "");
        const key = `local:${scope}:${localName}`;
        return createSemanticCarrier("same_lvalue", key, localName);
    }
    if (typeof value.getName === "function") {
        const localName = String(value.getName?.() || "");
        const key = `local:${scope}:${localName}`;
        return createSemanticCarrier("same_lvalue", key, localName);
    }
    if (stmt && typeof stmt.containsInvokeExpr === "function" && stmt.containsInvokeExpr() && typeof stmt.getInvokeExpr === "function") {
        const invokeExpr = stmt.getInvokeExpr?.();
        const signature = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
        if (signature) {
            return createSemanticCarrier("task", `task:${scope}:invoke:${signature}`, signature, { taskId: signature });
        }
    }
    return nodeId === undefined
        ? undefined
        : createSemanticCarrier("same_lvalue", scope, String(nodeId));
}

export function cloneSemanticSideState(sideState: SemanticSideState): SemanticSideState {
    return { ...sideState };
}

export function cloneSemanticFact(fact: SemanticFact): SemanticFact {
    return {
        ...fact,
        carrier: { ...fact.carrier },
        sideState: cloneSemanticSideState(fact.sideState),
        fieldPath: fact.fieldPath ? [...fact.fieldPath] : undefined,
    };
}

export function semanticFactKey(fact: SemanticFact): string {
    return `${fact.carrier.key}|${fact.source}|${fact.contextId}|${fact.tainted ? "T" : "F"}|${fact.state}`;
}

export function semanticCarrierKeyFromNode(node?: PagNode, fieldPath?: string[]): string {
    const nodeId = node?.getID?.();
    const nodeKey = nodeId === undefined ? "unknown" : String(nodeId);
    if (!fieldPath || fieldPath.length === 0) {
        return nodeKey;
    }
    return `${nodeKey}.${fieldPath.join(".")}`;
}

export function normalizeSemanticFieldPath(fieldPath?: string[]): string[] | undefined {
    if (!fieldPath || fieldPath.length === 0) return undefined;
    const normalized = fieldPath.map(segment => String(segment || "").trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
}

export function semanticCarrierMatchesFact(carrier: SemanticCarrier, fact: SemanticFact): boolean {
    return carrier.key === fact.carrier.key;
}

export function resolveMethodSignatureText(method?: ArkMethod): string {
    try {
        return method?.getSignature?.()?.toString?.() || "";
    } catch {
        return "";
    }
}

export function resolveStmtText(stmt?: Stmt): string {
    try {
        return stmt?.toString?.() || "";
    } catch {
        return "";
    }
}
