import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagInstanceFieldNode, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkInvokeStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkNewArrayExpr, ArkNewExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { TaintTracker } from "../model/TaintTracker";
import { TaintFlow } from "../model/TaintFlow";
import { isCarrierFieldPathLiveAtStmt } from "../ordinary/OrdinaryObjectInvalidation";
import { collectAliasLocalsForCarrier, collectCarrierNodeIdsForValueAtStmt } from "../ordinary/OrdinaryAliasPropagation";
import {
    collectOrdinaryCopyLikeConsumedLocals,
    resolveOrdinaryArraySlotName,
} from "../ordinary/OrdinaryLanguagePropagation";
import {
    normalizeEndpoint,
    RuleEndpoint,
    RuleEndpointTaintScope,
    SanitizerRule,
    SinkRule,
    TransferRule
} from "../../rules/RuleSchema";
import { orderRulesForSameFamilySelection } from "../../rules/RuleOrdering";
import { resolveReceiverGetterReturnFieldPath } from "../propagation/WorklistFieldPropagation";
import { hasApiEffectIdentity } from "../../api/ApiOccurrenceIdentity";
import type { ApiEffectRuntimeIndexLike } from "../../api/effects";
import type { SemanticEffectSite } from "../../api/effects/SemanticEffectSite";
import { fromContainerFieldKey } from "../model/ContainerSlotKeys";
import {
    isConsumableSemanticEndpointProjection,
    projectSemanticEffectEndpoint,
    type SemanticEndpointProjection,
} from "../contracts/PagNodeResolution";

export interface SinkDetectOptions {
    sinkRuleId?: string;
    targetEndpoint?: RuleEndpoint;
    targetPath?: string[];
    targetTaintScope?: RuleEndpointTaintScope;
    fieldToVarIndex?: Map<string, Set<number>>;
    allowedMethodSignatures?: Set<string>;
    orderedMethodSignatures?: string[];
    classBySignature?: Map<string, any>;
    /** PAG node ids that receive capture / synthetic / module-fan-in taint; exempts locals from strict const-reassignment kill. */
    interproceduralTaintTargetNodeIds?: Set<number>;
    sanitizerRules?: SanitizerRule[];
    transferRules?: TransferRule[];
    apiIdentityRule?: SinkRule;
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike;
    onProfile?: (profile: SinkDetectProfile) => void;
    onAudit?: (entry: SinkDetectAuditEntry) => void;
}

export interface SinkDetectAuditEntry {
    kind: "callsite" | "candidate" | "hit" | "sanitized" | "rejected";
    ruleId?: string;
    effectIdentity: string;
    calleeSignature?: string;
    ownerMethodSignature?: string;
    ownerMethodName?: string;
    sinkText?: string;
    endpoint?: string;
    candidateKind?: string;
    candidateNodeIds?: number[];
    source?: string;
    sourceRuleId?: string;
    sinkNodeId?: number;
    sinkFieldPath?: string[];
    reason: string;
}

interface SinkCandidate {
    value: any;
    kind: "arg" | "base" | "result";
    endpoint: string;
    targetPath?: string[];
    targetTaintScope?: RuleEndpointTaintScope;
    endpointResolution: SemanticEndpointProjection;
}

interface SinkCandidateResolution {
    candidates: SinkCandidate[];
    diagnostics: SinkEndpointDiagnostic[];
}

interface SinkEndpointDiagnostic {
    projection: SemanticEndpointProjection;
    reason: string;
}

interface FieldPathDetectResult {
    source: string;
    nodeId?: number;
    fieldPath?: string[];
    transferRuleIds?: string[];
}

interface IndexedInvokeSite {
    method: any;
    stmt: any;
    invokeExpr?: any;
    fieldRef?: ArkInstanceFieldRef;
    calleeSignature: string;
    semanticEffectSites: readonly SemanticEffectSite[];
}

interface SinkCallsiteIndex {
    methodCount: number;
    reachableMethodCount: number;
    stmtCount: number;
    invokeStmtCount: number;
    sites: IndexedInvokeSite[];
}

const sinkCallsiteIndexCache: WeakMap<Scene, Map<string, SinkCallsiteIndex>> = new WeakMap();

export interface SinkDetectProfile {
    detectCallCount: number;
    methodsVisited: number;
    reachableMethodsVisited: number;
    stmtsVisited: number;
    invokeStmtsVisited: number;
    effectMatchedInvokeCount: number;
    constraintRejectedInvokeCount: number;
    sinksChecked: number;
    candidateCount: number;
    taintCheckCount: number;
    defReachabilityCheckCount: number;
    fieldPathCheckCount: number;
    fieldPathHitCount: number;
    sanitizerGuardCheckCount: number;
    sanitizerGuardHitCount: number;
    effectMatchMs: number;
    candidateResolveMs: number;
    taintEvalMs: number;
    sanitizerGuardMs: number;
    traversalMs: number;
    totalMs: number;
}

export function createEmptySinkDetectProfile(): SinkDetectProfile {
    return {
        detectCallCount: 0,
        methodsVisited: 0,
        reachableMethodsVisited: 0,
        stmtsVisited: 0,
        invokeStmtsVisited: 0,
        effectMatchedInvokeCount: 0,
        constraintRejectedInvokeCount: 0,
        sinksChecked: 0,
        candidateCount: 0,
        taintCheckCount: 0,
        defReachabilityCheckCount: 0,
        fieldPathCheckCount: 0,
        fieldPathHitCount: 0,
        sanitizerGuardCheckCount: 0,
        sanitizerGuardHitCount: 0,
        effectMatchMs: 0,
        candidateResolveMs: 0,
        taintEvalMs: 0,
        sanitizerGuardMs: 0,
        traversalMs: 0,
        totalMs: 0,
    };
}

export function mergeSinkDetectProfiles(base: SinkDetectProfile, extra: SinkDetectProfile): SinkDetectProfile {
    return {
        detectCallCount: base.detectCallCount + extra.detectCallCount,
        methodsVisited: base.methodsVisited + extra.methodsVisited,
        reachableMethodsVisited: base.reachableMethodsVisited + extra.reachableMethodsVisited,
        stmtsVisited: base.stmtsVisited + extra.stmtsVisited,
        invokeStmtsVisited: base.invokeStmtsVisited + extra.invokeStmtsVisited,
        effectMatchedInvokeCount: base.effectMatchedInvokeCount + extra.effectMatchedInvokeCount,
        constraintRejectedInvokeCount: base.constraintRejectedInvokeCount + extra.constraintRejectedInvokeCount,
        sinksChecked: base.sinksChecked + extra.sinksChecked,
        candidateCount: base.candidateCount + extra.candidateCount,
        taintCheckCount: base.taintCheckCount + extra.taintCheckCount,
        defReachabilityCheckCount: base.defReachabilityCheckCount + extra.defReachabilityCheckCount,
        fieldPathCheckCount: base.fieldPathCheckCount + extra.fieldPathCheckCount,
        fieldPathHitCount: base.fieldPathHitCount + extra.fieldPathHitCount,
        sanitizerGuardCheckCount: base.sanitizerGuardCheckCount + extra.sanitizerGuardCheckCount,
        sanitizerGuardHitCount: base.sanitizerGuardHitCount + extra.sanitizerGuardHitCount,
        effectMatchMs: base.effectMatchMs + extra.effectMatchMs,
        candidateResolveMs: base.candidateResolveMs + extra.candidateResolveMs,
        taintEvalMs: base.taintEvalMs + extra.taintEvalMs,
        sanitizerGuardMs: base.sanitizerGuardMs + extra.sanitizerGuardMs,
        traversalMs: base.traversalMs + extra.traversalMs,
        totalMs: base.totalMs + extra.totalMs,
    };
}

export function detectSinkEffects(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    tracker: TaintTracker,
    effectIdentity: string,
    log: (msg: string) => void,
    options: SinkDetectOptions = {}
): TaintFlow[] {
    const detectStart = process.hrtime.bigint();
    const profile = createEmptySinkDetectProfile();
    profile.detectCallCount = 1;
    const flows: TaintFlow[] = [];
    if (!cg) {
        profile.totalMs = elapsedMsSince(detectStart);
        options.onProfile?.(profile);
        return flows;
    }
    let fieldToVarIndex = options.targetPath && options.targetPath.length > 0
        ? (options.fieldToVarIndex || buildFieldToVarIndexFromPag(pag))
        : undefined;
    let fieldProjectionIndex: Map<string, Set<number>> | undefined;

    log(`\n=== Detecting sink effects for: "${effectIdentity}" ===`);
    let sinksChecked = 0;
    const emitAudit = (entry: Omit<SinkDetectAuditEntry, "ruleId" | "effectIdentity">): void => {
        options.onAudit?.({
            ...entry,
            ruleId: options.sinkRuleId,
            effectIdentity,
        });
    };

    const apiIdentityRule = options.apiIdentityRule && hasApiEffectIdentity(options.apiIdentityRule)
        ? options.apiIdentityRule
        : undefined;
    if (!apiIdentityRule) {
        profile.totalMs = elapsedMsSince(detectStart);
        options.onProfile?.(profile);
        return flows;
    }
    const matchedSites = resolveApiEffectSinkSites(options);
    profile.effectMatchedInvokeCount += matchedSites.length;

    for (const site of matchedSites) {
        const method = site.method;
        const stmt = site.stmt;
        const invokeExpr = site.invokeExpr;
        const calleeSignature = site.calleeSignature;
        log(`Checking method "${method.getName()}" for sinks...`);

        const constraintT0 = process.hrtime.bigint();
        if (!matchesInvokeConstraints(scene, stmt, invokeExpr, calleeSignature, options, method)) {
            profile.effectMatchMs += elapsedMsSince(constraintT0);
            profile.constraintRejectedInvokeCount++;
            continue;
        }
        profile.effectMatchMs += elapsedMsSince(constraintT0);

        sinksChecked++;
        profile.sinksChecked++;
        log(`  Found sink call: ${calleeSignature}`);
        emitAudit({
            kind: "callsite",
            calleeSignature,
            ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
            ownerMethodName: method.getName?.() || "",
            sinkText: stmt.toString?.() || "",
            reason: "sink_callsite_matched",
        });

        const resolveT0 = process.hrtime.bigint();
        const candidateResolution = resolveSinkCandidates(site, pag);
        const candidates = candidateResolution.candidates;
        profile.candidateResolveMs += elapsedMsSince(resolveT0);
        for (const diagnostic of candidateResolution.diagnostics) {
            const projection = diagnostic.projection;
            emitAudit({
                kind: "candidate",
                calleeSignature,
                ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                ownerMethodName: method.getName?.() || "",
                sinkText: stmt.toString?.() || "",
                endpoint: projection.endpointPath,
                candidateKind: sinkCandidateKindFromProjection(projection),
                candidateNodeIds: projection.nodeIds,
                reason: diagnostic.reason,
            });
        }
        if (candidates.length === 0) {
            emitAudit({
                kind: "rejected",
                calleeSignature,
                ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                ownerMethodName: method.getName?.() || "",
                sinkText: stmt.toString?.() || "",
                reason: candidateResolution.diagnostics[0]?.reason || "sink_endpoint_unresolved",
            });
            continue;
        }
        profile.candidateCount += candidates.length;
        let sinkDetected = false;
        for (const candidate of candidates) {
            const candidateFlowStart = flows.length;
            const candidateTargetPath = candidate.targetPath || options.targetPath;
            const candidateTaintScope = candidate.targetTaintScope || options.targetTaintScope;
            if (candidateTargetPath && candidateTargetPath.length > 0) {
                if (!fieldToVarIndex) {
                    fieldToVarIndex = options.fieldToVarIndex || buildFieldToVarIndexFromPag(pag);
                }
                profile.fieldPathCheckCount++;
                const fieldPathT0 = process.hrtime.bigint();
                const fieldPathResults = detectFieldPathSources(candidate.value, candidateTargetPath, stmt, pag, tracker, fieldToVarIndex);
                profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                if (fieldPathResults.length > 0) {
                    profile.sanitizerGuardCheckCount++;
                    const sanitizerT0 = process.hrtime.bigint();
                    const sanitizerResult = isSinkCandidateSanitizedByRules(
                        method,
                        stmt,
                        candidate,
                        pag,
                        options.sanitizerRules || [],
                        log,
                        scene,
                        options.apiEffectRuntimeIndex
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        emitAudit({
                            kind: "sanitized",
                            calleeSignature,
                            ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                            ownerMethodName: method.getName?.() || "",
                            sinkText: stmt.toString?.() || "",
                            endpoint: candidate.endpoint,
                            candidateKind: candidate.kind,
                            reason: "sink_candidate_sanitized",
                        });
                        continue;
                    }
                    profile.fieldPathHitCount += fieldPathResults.length;
                    for (const fieldPathResult of fieldPathResults) {
                        log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (field path: ${candidateTargetPath.join(".")}) ***`);
                        emitAudit({
                            kind: "hit",
                            calleeSignature,
                            ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                            ownerMethodName: method.getName?.() || "",
                            sinkText: stmt.toString?.() || "",
                            endpoint: candidate.endpoint,
                            candidateKind: candidate.kind,
                            source: fieldPathResult.source,
                            sourceRuleId: parseSourceRuleId(fieldPathResult.source),
                            sinkNodeId: fieldPathResult.nodeId,
                            sinkFieldPath: fieldPathResult.fieldPath ? [...fieldPathResult.fieldPath] : undefined,
                            reason: "sink_field_path_tainted",
                        });
                        flows.push(new TaintFlow(fieldPathResult.source, stmt, {
                            sinkEndpoint: candidate.endpoint,
                            sinkNodeId: fieldPathResult.nodeId,
                            sinkFieldPath: fieldPathResult.fieldPath,
                        }));
                    }
                    sinkDetected = true;
                    break;
                }
                emitAudit({
                    kind: "candidate",
                    calleeSignature,
                    ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                    ownerMethodName: method.getName?.() || "",
                    sinkText: stmt.toString?.() || "",
                    endpoint: candidate.endpoint,
                    candidateKind: candidate.kind,
                    reason: "target_path_candidate_not_tainted",
                });
                continue;
            }

            if (candidateTaintScope === "contained-values") {
                profile.fieldPathCheckCount++;
                const containedT0 = process.hrtime.bigint();
                const containedResults = detectContainedValueSources(
                    candidate.value,
                    stmt,
                    pag,
                    tracker,
                    options.classBySignature,
                );
                profile.taintEvalMs += elapsedMsSince(containedT0);
                if (containedResults.length > 0) {
                    profile.sanitizerGuardCheckCount++;
                    const sanitizerT0 = process.hrtime.bigint();
                    const sanitizerResult = isSinkCandidateSanitizedByRules(
                        method,
                        stmt,
                        candidate,
                        pag,
                        options.sanitizerRules || [],
                        log,
                        scene,
                        options.apiEffectRuntimeIndex
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        emitAudit({
                            kind: "sanitized",
                            calleeSignature,
                            ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                            ownerMethodName: method.getName?.() || "",
                            sinkText: stmt.toString?.() || "",
                            endpoint: candidate.endpoint,
                            candidateKind: candidate.kind,
                            reason: "sink_candidate_sanitized",
                        });
                        continue;
                    }
                    profile.fieldPathHitCount += containedResults.length;
                    for (const containedResult of containedResults) {
                        log(`    *** TAINT FLOW DETECTED! Source: ${containedResult.source} (contained value field: ${containedResult.fieldPath?.join(".")}) ***`);
                        flows.push(new TaintFlow(containedResult.source, stmt, {
                            sinkEndpoint: candidate.endpoint,
                            sinkNodeId: containedResult.nodeId,
                            sinkFieldPath: containedResult.fieldPath,
                        }));
                    }
                    sinkDetected = true;
                    break;
                }
            }

            let preciseCandidate = detectPreciseCandidateSource(
                scene,
                method,
                stmt,
                candidate,
                pag,
                tracker,
                options.orderedMethodSignatures,
                options.interproceduralTaintTargetNodeIds,
                options.transferRules,
                options.apiEffectRuntimeIndex,
                fieldProjectionIndex,
            );
            fieldProjectionIndex = preciseCandidate.fieldProjectionIndex;
            if (preciseCandidate.result) {
                profile.sanitizerGuardCheckCount++;
                const sanitizerT0 = process.hrtime.bigint();
                const sanitizerResult = isSinkCandidateSanitizedByRules(
                    method,
                    stmt,
                    candidate,
                    pag,
                    options.sanitizerRules || [],
                    log,
                    scene,
                    options.apiEffectRuntimeIndex
                );
                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                if (sanitizerResult.sanitized) {
                    profile.sanitizerGuardHitCount++;
                    emitAudit({
                        kind: "sanitized",
                        calleeSignature,
                        ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                        ownerMethodName: method.getName?.() || "",
                        sinkText: stmt.toString?.() || "",
                        endpoint: candidate.endpoint,
                        candidateKind: candidate.kind,
                        source: preciseCandidate.result.source,
                        sourceRuleId: parseSourceRuleId(preciseCandidate.result.source),
                        sinkNodeId: preciseCandidate.result.nodeId,
                        sinkFieldPath: preciseCandidate.result.fieldPath ? [...preciseCandidate.result.fieldPath] : undefined,
                        reason: "sink_candidate_sanitized",
                    });
                    continue;
                }
                log(`    *** TAINT FLOW DETECTED! Source: ${preciseCandidate.result.source} (precise sink semantics) ***`);
                emitAudit({
                    kind: "hit",
                    calleeSignature,
                    ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                    ownerMethodName: method.getName?.() || "",
                    sinkText: stmt.toString?.() || "",
                    endpoint: candidate.endpoint,
                    candidateKind: candidate.kind,
                    source: preciseCandidate.result.source,
                    sourceRuleId: parseSourceRuleId(preciseCandidate.result.source),
                    sinkNodeId: preciseCandidate.result.nodeId,
                    sinkFieldPath: preciseCandidate.result.fieldPath ? [...preciseCandidate.result.fieldPath] : undefined,
                    reason: "sink_precise_candidate_tainted",
                });
                flows.push(new TaintFlow(preciseCandidate.result.source, stmt, {
                    sinkEndpoint: candidate.endpoint,
                    sinkNodeId: preciseCandidate.result.nodeId,
                    sinkFieldPath: preciseCandidate.result.fieldPath,
                    transferRuleIds: preciseCandidate.result.transferRuleIds,
                }));
                sinkDetected = true;
                break;
            }
            if (preciseCandidate.blockGenericNodeTaint) {
                continue;
            }

            const pagLookupT0 = process.hrtime.bigint();
            const pagNodes = resolveCandidatePagNodes(pag, method, candidate.value);
            profile.taintEvalMs += elapsedMsSince(pagLookupT0);
            if (!pagNodes || pagNodes.size === 0) {
                emitAudit({
                    kind: "candidate",
                    calleeSignature,
                    ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                    ownerMethodName: method.getName?.() || "",
                    sinkText: stmt.toString?.() || "",
                    endpoint: candidate.endpoint,
                    candidateKind: candidate.kind,
                    candidateNodeIds: candidate.endpointResolution.nodeIds,
                    reason: candidate.endpointResolution.diagnosticKind || candidate.endpointResolution.reason,
                });
                if (candidate.value instanceof Local) {
                    const declStmt = candidate.value.getDeclaringStmt?.();
                    if (declStmt instanceof ArkAssignStmt && sameValueLike(declStmt.getLeftOp(), candidate.value)) {
                        const rightOp = declStmt.getRightOp();
                        if (rightOp instanceof ArkInstanceFieldRef) {
                            const fieldName = rightOp.getFieldSignature().getFieldName();
                            if (!fieldProjectionIndex) {
                                fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
                            }
                            const fieldPathT0 = process.hrtime.bigint();
                            const fieldPathResult = detectFieldPathSource(
                                rightOp,
                                [fieldName],
                                declStmt,
                                pag,
                                tracker,
                                fieldProjectionIndex
                            );
                            profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                            if (fieldPathResult) {
                                profile.sanitizerGuardCheckCount++;
                                const sanitizerT0 = process.hrtime.bigint();
                                const sanitizerResult = isSinkCandidateSanitizedByRules(
                                    method,
                                    stmt,
                                    candidate,
                                    pag,
                                    options.sanitizerRules || [],
                                    log,
                                    scene,
                                    options.apiEffectRuntimeIndex
                                );
                                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                                if (sanitizerResult.sanitized) {
                                    profile.sanitizerGuardHitCount++;
                                    continue;
                                }
                                log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (local field projection: ${fieldName}) ***`);
                                flows.push(new TaintFlow(fieldPathResult.source, stmt, {
                                    sinkEndpoint: candidate.endpoint,
                                    sinkNodeId: fieldPathResult.nodeId,
                                    sinkFieldPath: fieldPathResult.fieldPath,
                                }));
                                sinkDetected = true;
                                break;
                            }
                        }
                        if (rightOp instanceof ArkArrayRef) {
                            const slotName = resolveOrdinaryArraySlotName(rightOp.getIndex());
                            const carrierFieldResult = detectLoadedLocalCarrierFieldSource(
                                rightOp.getBase?.(),
                                [slotName],
                                declStmt,
                                pag,
                                tracker,
                            );
                            if (carrierFieldResult) {
                                profile.sanitizerGuardCheckCount++;
                                const sanitizerT0 = process.hrtime.bigint();
                                const sanitizerResult = isSinkCandidateSanitizedByRules(
                                    method,
                                    stmt,
                                    candidate,
                                    pag,
                                    options.sanitizerRules || [],
                                    log,
                                    scene,
                                    options.apiEffectRuntimeIndex
                                );
                                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                                if (sanitizerResult.sanitized) {
                                    profile.sanitizerGuardHitCount++;
                                    continue;
                                }
                                log(`    *** TAINT FLOW DETECTED! Source: ${carrierFieldResult.source} (local array projection: ${slotName}) ***`);
                                flows.push(new TaintFlow(carrierFieldResult.source, stmt, {
                                    sinkEndpoint: candidate.endpoint,
                                    sinkNodeId: carrierFieldResult.nodeId,
                                    sinkFieldPath: carrierFieldResult.fieldPath,
                                }));
                                sinkDetected = true;
                                break;
                            }
                        }
                    }
                }
                if (candidate.value instanceof ArkInstanceFieldRef) {
                    const fieldName = candidate.value.getFieldSignature().getFieldName();
                    if (!fieldProjectionIndex) {
                        fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
                    }
                    const fieldPathT0 = process.hrtime.bigint();
                    const fieldPathResult = detectFieldPathSource(
                        candidate.value,
                        [fieldName],
                        stmt,
                        pag,
                        tracker,
                        fieldProjectionIndex
                    );
                    profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                    if (fieldPathResult) {
                        profile.sanitizerGuardCheckCount++;
                        const sanitizerT0 = process.hrtime.bigint();
                        const sanitizerResult = isSinkCandidateSanitizedByRules(
                            method,
                            stmt,
                            candidate,
                            pag,
                            options.sanitizerRules || [],
                            log,
                            scene,
                            options.apiEffectRuntimeIndex
                        );
                        profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                        if (sanitizerResult.sanitized) {
                            profile.sanitizerGuardHitCount++;
                            continue;
                        }
                        log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (field projection: ${fieldName}) ***`);
                        flows.push(new TaintFlow(fieldPathResult.source, stmt, {
                            sinkEndpoint: candidate.endpoint,
                            sinkNodeId: fieldPathResult.nodeId,
                            sinkFieldPath: fieldPathResult.fieldPath,
                        }));
                        sinkDetected = true;
                        break;
                    }
                }
                continue;
            }

            if (candidate.value instanceof Local) {
                const declStmt = candidate.value.getDeclaringStmt?.();
                if (declStmt instanceof ArkAssignStmt && sameValueLike(declStmt.getLeftOp(), candidate.value)) {
                    const rightOp = declStmt.getRightOp();
                    if (rightOp instanceof ArkInstanceFieldRef) {
                        const fieldName = rightOp.getFieldSignature().getFieldName();
                        const carrierFieldResult = detectLoadedLocalCarrierFieldSource(
                            rightOp.getBase?.(),
                            [fieldName],
                            declStmt,
                            pag,
                            tracker,
                        );
                        if (carrierFieldResult) {
                            profile.sanitizerGuardCheckCount++;
                            const sanitizerT0 = process.hrtime.bigint();
                            const sanitizerResult = isSinkCandidateSanitizedByRules(
                                method,
                                stmt,
                                candidate,
                                pag,
                                options.sanitizerRules || [],
                                log,
                                scene,
                                options.apiEffectRuntimeIndex
                            );
                            profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                            if (sanitizerResult.sanitized) {
                                profile.sanitizerGuardHitCount++;
                                continue;
                            }
                            log(`    *** TAINT FLOW DETECTED! Source: ${carrierFieldResult.source} (loaded-field carrier projection: ${fieldName}) ***`);
                            flows.push(new TaintFlow(carrierFieldResult.source, stmt, {
                                sinkEndpoint: candidate.endpoint,
                                sinkNodeId: carrierFieldResult.nodeId,
                                sinkFieldPath: carrierFieldResult.fieldPath,
                            }));
                            sinkDetected = true;
                            break;
                        }
                    }
                    if (rightOp instanceof ArkArrayRef) {
                        const slotName = resolveOrdinaryArraySlotName(rightOp.getIndex());
                        const carrierFieldResult = detectLoadedLocalCarrierFieldSource(
                            rightOp.getBase?.(),
                            [slotName],
                            declStmt,
                            pag,
                            tracker,
                        );
                        if (carrierFieldResult) {
                            profile.sanitizerGuardCheckCount++;
                            const sanitizerT0 = process.hrtime.bigint();
                            const sanitizerResult = isSinkCandidateSanitizedByRules(
                                method,
                                stmt,
                                candidate,
                                pag,
                                options.sanitizerRules || [],
                                log,
                                scene,
                                options.apiEffectRuntimeIndex
                            );
                            profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                            if (sanitizerResult.sanitized) {
                                profile.sanitizerGuardHitCount++;
                                continue;
                            }
                            log(`    *** TAINT FLOW DETECTED! Source: ${carrierFieldResult.source} (loaded-array carrier projection: ${slotName}) ***`);
                            flows.push(new TaintFlow(carrierFieldResult.source, stmt, {
                                sinkEndpoint: candidate.endpoint,
                                sinkNodeId: carrierFieldResult.nodeId,
                                sinkFieldPath: carrierFieldResult.fieldPath,
                            }));
                            sinkDetected = true;
                            break;
                        }
                    }
                }
            }

            const checkedNodeIds = new Set<number>();
            for (const nodeId of pagNodes.values()) {
                checkedNodeIds.add(nodeId);
                profile.taintCheckCount++;
                const taintCheckT0 = process.hrtime.bigint();
                const isTainted = tracker.isTaintedAnyContext(nodeId);
                profile.taintEvalMs += elapsedMsSince(taintCheckT0);
                log(`    Checking ${candidate.endpoint}, node ${nodeId}, tainted: ${isTainted}`);
                if (!isTainted) {
                    profile.fieldPathCheckCount++;
                    const nodeFieldT0 = process.hrtime.bigint();
                    const nodeFieldResults = detectCarrierFieldSources(
                        nodeId,
                        stmt,
                        pag,
                        tracker,
                    );
                    profile.taintEvalMs += elapsedMsSince(nodeFieldT0);
                    if (nodeFieldResults.length === 0) continue;

                    profile.sanitizerGuardCheckCount++;
                    const sanitizerT0 = process.hrtime.bigint();
                    const sanitizerResult = isSinkCandidateSanitizedByRules(
                        method,
                        stmt,
                        candidate,
                        pag,
                        options.sanitizerRules || [],
                        log,
                        scene,
                        options.apiEffectRuntimeIndex
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        continue;
                    }
                    profile.fieldPathHitCount += nodeFieldResults.length;
                    for (const nodeFieldResult of nodeFieldResults) {
                        log(`    *** TAINT FLOW DETECTED! Source: ${nodeFieldResult.source} (node field projection: ${nodeFieldResult.fieldPath?.join(".")}) ***`);
                        flows.push(new TaintFlow(nodeFieldResult.source, stmt, {
                            sinkEndpoint: candidate.endpoint,
                            sinkNodeId: nodeFieldResult.nodeId,
                            sinkFieldPath: nodeFieldResult.fieldPath,
                        }));
                    }
                    sinkDetected = true;
                    break;
                }
                const sources = tracker.getSourcesAnyContext(nodeId);
                if (sources.length === 0) {
                    continue;
                }

                profile.sanitizerGuardCheckCount++;
                const sanitizerT0 = process.hrtime.bigint();
                const sanitizerResult = isSinkCandidateSanitizedByRules(
                    method,
                    stmt,
                    candidate,
                    pag,
                    options.sanitizerRules || [],
                    log,
                    scene,
                    options.apiEffectRuntimeIndex
                );
                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                if (sanitizerResult.sanitized) {
                    profile.sanitizerGuardHitCount++;
                    continue;
                }
                for (const source of sources) {
                    log(`    *** TAINT FLOW DETECTED! Source: ${source} ***`);
                    flows.push(new TaintFlow(source, stmt, {
                        sinkEndpoint: candidate.endpoint,
                        sinkNodeId: nodeId,
                    }));
                }
                sinkDetected = true;
                break;
            }
            if (!sinkDetected && candidate.value instanceof Local) {
                if (!isLoadedFieldOrArrayLocal(candidate.value)) {
                    const carrierNodeIds = collectCarrierNodeIdsForValueAtStmt(
                        pag,
                        candidate.value,
                        stmt,
                    );
                    for (const carrierNodeId of carrierNodeIds) {
                        if (checkedNodeIds.has(carrierNodeId)) continue;
                        profile.taintCheckCount++;
                        const taintCheckT0 = process.hrtime.bigint();
                        const isTainted = tracker.isTaintedAnyContext(carrierNodeId);
                        profile.taintEvalMs += elapsedMsSince(taintCheckT0);
                        log(`    Checking ${candidate.endpoint} carrier, node ${carrierNodeId}, tainted: ${isTainted}`);
                        if (isTainted) {
                            const sources = tracker.getSourcesAnyContext(carrierNodeId);
                            if (sources.length === 0) continue;

                            profile.sanitizerGuardCheckCount++;
                            const sanitizerT0 = process.hrtime.bigint();
                            const sanitizerResult = isSinkCandidateSanitizedByRules(
                                method,
                                stmt,
                                candidate,
                                pag,
                                options.sanitizerRules || [],
                                log,
                                scene,
                                options.apiEffectRuntimeIndex
                            );
                            profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                            if (sanitizerResult.sanitized) {
                                profile.sanitizerGuardHitCount++;
                                continue;
                            }
                            for (const source of sources) {
                                log(`    *** TAINT FLOW DETECTED! Source: ${source} (local carrier projection) ***`);
                                flows.push(new TaintFlow(source, stmt, {
                                    sinkEndpoint: candidate.endpoint,
                                    sinkNodeId: carrierNodeId,
                                }));
                            }
                            sinkDetected = true;
                            break;
                        }

                        profile.fieldPathCheckCount++;
                        const carrierFieldT0 = process.hrtime.bigint();
                        const carrierFieldResults = detectCarrierFieldSources(
                            carrierNodeId,
                            stmt,
                            pag,
                            tracker,
                        );
                        profile.taintEvalMs += elapsedMsSince(carrierFieldT0);
                        if (carrierFieldResults.length === 0) continue;

                        profile.sanitizerGuardCheckCount++;
                        const sanitizerT0 = process.hrtime.bigint();
                        const sanitizerResult = isSinkCandidateSanitizedByRules(
                            method,
                            stmt,
                            candidate,
                            pag,
                            options.sanitizerRules || [],
                            log,
                            scene,
                            options.apiEffectRuntimeIndex
                        );
                        profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                        if (sanitizerResult.sanitized) {
                            profile.sanitizerGuardHitCount++;
                            continue;
                        }
                        profile.fieldPathHitCount += carrierFieldResults.length;
                        for (const carrierFieldResult of carrierFieldResults) {
                            log(`    *** TAINT FLOW DETECTED! Source: ${carrierFieldResult.source} (local carrier field projection: ${carrierFieldResult.fieldPath?.join(".")}) ***`);
                            flows.push(new TaintFlow(carrierFieldResult.source, stmt, {
                                sinkEndpoint: candidate.endpoint,
                                sinkNodeId: carrierFieldResult.nodeId,
                                sinkFieldPath: carrierFieldResult.fieldPath,
                            }));
                        }
                        sinkDetected = true;
                        break;
                    }
                }
            }
            if (!sinkDetected && candidate.value instanceof ArkInstanceFieldRef) {
                const fieldAccess = decomposeInstanceFieldAccess(candidate.value);
                const fieldName = fieldAccess.fieldPath[fieldAccess.fieldPath.length - 1] || "";
                if (!fieldProjectionIndex) {
                    fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
                }
                const fieldPathT0 = process.hrtime.bigint();
                const fieldPathResult = detectFieldPathSource(
                    fieldAccess.rootBase,
                    fieldAccess.fieldPath,
                    stmt,
                    pag,
                    tracker,
                    fieldProjectionIndex
                );
                profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                if (fieldPathResult) {
                    profile.sanitizerGuardCheckCount++;
                    const sanitizerT0 = process.hrtime.bigint();
                    const sanitizerResult = isSinkCandidateSanitizedByRules(
                        method,
                        stmt,
                        candidate,
                        pag,
                        options.sanitizerRules || [],
                        log,
                        scene,
                        options.apiEffectRuntimeIndex
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        continue;
                    }
                    log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (field projection: ${fieldName}) ***`);
                    flows.push(new TaintFlow(fieldPathResult.source, stmt, {
                        sinkEndpoint: candidate.endpoint,
                        sinkNodeId: fieldPathResult.nodeId,
                        sinkFieldPath: fieldPathResult.fieldPath,
                    }));
                    sinkDetected = true;
                }
            }
            if (!sinkDetected) {
                const arrayCarrierResult = detectArrayContainerCarrierSource(candidate.value, pag, tracker);
                if (arrayCarrierResult) {
                    profile.sanitizerGuardCheckCount++;
                    const sanitizerT0 = process.hrtime.bigint();
                    const sanitizerResult = isSinkCandidateSanitizedByRules(
                        method,
                        stmt,
                        candidate,
                        pag,
                        options.sanitizerRules || [],
                        log,
                        scene,
                        options.apiEffectRuntimeIndex
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        continue;
                    }
                    log(`    *** TAINT FLOW DETECTED! Source: ${arrayCarrierResult.source} (array-container projection) ***`);
                    flows.push(new TaintFlow(arrayCarrierResult.source, stmt, {
                        sinkEndpoint: candidate.endpoint,
                        sinkNodeId: arrayCarrierResult.nodeId,
                        sinkFieldPath: arrayCarrierResult.fieldPath,
                    }));
                    sinkDetected = true;
                }
            }
            if (flows.length > candidateFlowStart) {
                for (const flow of flows.slice(candidateFlowStart)) {
                    emitAudit({
                        kind: "hit",
                        calleeSignature,
                        ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                        ownerMethodName: method.getName?.() || "",
                        sinkText: stmt.toString?.() || "",
                        endpoint: flow.sinkEndpoint || candidate.endpoint,
                        candidateKind: candidate.kind,
                        source: flow.source,
                        sourceRuleId: parseSourceRuleId(flow.source),
                        sinkNodeId: flow.sinkNodeId,
                        sinkFieldPath: flow.sinkFieldPath ? [...flow.sinkFieldPath] : undefined,
                        reason: "sink_candidate_tainted",
                    });
                }
            } else if (!sinkDetected) {
                emitAudit({
                    kind: "candidate",
                    calleeSignature,
                    ownerMethodSignature: method.getSignature?.()?.toString?.() || "",
                    ownerMethodName: method.getName?.() || "",
                    sinkText: stmt.toString?.() || "",
                    endpoint: candidate.endpoint,
                    candidateKind: candidate.kind,
                    reason: "candidate_not_tainted",
                });
            }
            if (sinkDetected) break;
        }
    }

    profile.totalMs = elapsedMsSince(detectStart);
    const profiledDetailMs = profile.effectMatchMs
        + profile.candidateResolveMs
        + profile.taintEvalMs
        + profile.sanitizerGuardMs;
    profile.traversalMs = Math.max(0, profile.totalMs - profiledDetailMs);
    options.onProfile?.(profile);
    log(`Checked ${sinksChecked} sink call(s), found ${flows.length} flow(s)`);
    return flows;
}

function elapsedMsSince(t0: bigint): number {
    return Number(process.hrtime.bigint() - t0) / 1_000_000;
}

function detectLoadedLocalCarrierFieldSource(
    baseValue: any,
    fieldPath: string[],
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult | undefined {
    if (!baseValue || !fieldPath.length) return undefined;
    const carrierNodeIds = collectCarrierNodeIdsForValueAtStmt(pag, baseValue, anchorStmt);
    for (const carrierNodeId of carrierNodeIds) {
        if (!isCarrierFieldPathLiveAtStmt(pag, tracker, carrierNodeId, fieldPath, anchorStmt)) {
            continue;
        }
        const source = tracker.getSourceAnyContext(carrierNodeId, fieldPath);
        if (!source) continue;
        return {
            source,
            nodeId: carrierNodeId,
            fieldPath: [...fieldPath],
        };
    }
    return undefined;
}

function detectAnyCarrierFieldSourceFromValue(
    baseValue: any,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult | undefined {
    if (!baseValue) return undefined;
    const carrierNodeIds = collectCarrierNodeIdsForValueAtStmt(pag, baseValue, anchorStmt);
    for (const carrierNodeId of carrierNodeIds) {
        const fieldSource = detectAnyCarrierFieldSource(carrierNodeId, anchorStmt, pag, tracker);
        if (fieldSource) return fieldSource;
    }
    return undefined;
}

function detectWholeOrFieldValueSource(
    value: any,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult | undefined {
    const nodes = pag.getNodesByValue(value);
    if (nodes) {
        for (const nodeId of nodes.values()) {
            const source = tracker.getSourceAnyContext(nodeId);
            if (source) {
                return { source, nodeId };
            }
        }
    }
    return detectAnyCarrierFieldSourceFromValue(value, anchorStmt, pag, tracker);
}

function detectOrdinaryCopyLikeInvokeSource(
    invokeExpr: any,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult | undefined {
    for (const local of collectOrdinaryCopyLikeConsumedLocals(invokeExpr)) {
        const source = detectWholeOrFieldValueSource(local, anchorStmt, pag, tracker);
        if (source) return source;
    }
    return undefined;
}

function isLoadedFieldOrArrayLocal(value: any): boolean {
    if (!(value instanceof Local)) return false;
    const declStmt = value.getDeclaringStmt?.();
    if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== value) {
        return false;
    }
    const rightOp = declStmt.getRightOp();
    return rightOp instanceof ArkInstanceFieldRef || rightOp instanceof ArkArrayRef;
}

interface PreciseCandidateDetectResult {
    result?: FieldPathDetectResult;
    blockGenericNodeTaint: boolean;
    fieldProjectionIndex?: Map<string, Set<number>>;
}

function detectFieldPathSourceOrBlockGenericTaint(
    rootValue: any,
    fieldPath: string[],
    sinkStmt: any,
    pag: Pag,
    tracker: TaintTracker,
    fieldProjectionIndex?: Map<string, Set<number>>,
): PreciseCandidateDetectResult {
    if (!fieldProjectionIndex) {
        fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
    }
    const fieldPathResult = detectFieldPathSource(
        rootValue,
        fieldPath,
        sinkStmt,
        pag,
        tracker,
        fieldProjectionIndex,
    );
    if (fieldPathResult) {
        return {
            result: fieldPathResult,
            blockGenericNodeTaint: false,
            fieldProjectionIndex,
        };
    }
    return {
        blockGenericNodeTaint: true,
        fieldProjectionIndex,
    };
}

function detectInlineInvokeTransferCandidateSource(
    scene: Scene,
    method: any,
    sinkStmt: any,
    invokeExpr: ArkInstanceInvokeExpr,
    pag: Pag,
    tracker: TaintTracker,
    transferRules: TransferRule[],
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike,
    fieldProjectionIndex?: Map<string, Set<number>>,
): PreciseCandidateDetectResult {
    if (!transferRules || transferRules.length === 0) {
        return {
            blockGenericNodeTaint: false,
            fieldProjectionIndex,
        };
    }

    const viable: Array<{ rule: TransferRule; result: FieldPathDetectResult }> = [];
    for (const rule of transferRules) {
        if (rule.enabled === false) continue;
        const to = normalizeEndpoint(rule.to);
        if (to.endpoint !== "result" || to.path || to.pathFrom) continue;
        if (!matchesTransferRuleInvoke(rule, sinkStmt, invokeExpr, method, scene, apiEffectRuntimeIndex)) continue;

        const from = normalizeEndpoint(rule.from);
        const endpointValue = resolveInvokeEndpointValue(sinkStmt, invokeExpr, from.endpoint);
        if (!endpointValue) continue;

        let sourceResult: FieldPathDetectResult | undefined;
        const resolvedPath = resolveRuleEndpointPath(from, sinkStmt, invokeExpr);
        if (resolvedPath && resolvedPath.length > 0) {
            if (!fieldProjectionIndex) {
                fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
            }
            sourceResult = detectFieldPathSource(
                endpointValue,
                resolvedPath,
                sinkStmt,
                pag,
                tracker,
                fieldProjectionIndex,
            );
        } else {
            sourceResult = detectWholeOrFieldValueSource(endpointValue, sinkStmt, pag, tracker);
        }

        if (sourceResult) {
            viable.push({ rule, result: sourceResult });
        }
    }

    if (viable.length > 0) {
        const bestByMatch = filterBestTransferMatchSpecificity(viable);
        const bestRules = new Set(orderRulesForSameFamilySelection(bestByMatch.map(item => item.rule)));
        const selected = bestByMatch.find(item => bestRules.has(item.rule)) || bestByMatch[0];
        return {
            result: {
                ...selected.result,
                transferRuleIds: [selected.rule.id],
            },
            blockGenericNodeTaint: false,
            fieldProjectionIndex,
        };
    }

    return {
        blockGenericNodeTaint: false,
        fieldProjectionIndex,
    };
}

function filterBestTransferMatchSpecificity<T extends { rule: TransferRule }>(candidates: T[]): T[] {
    if (candidates.length <= 1) return candidates;
    const best = Math.max(...candidates.map(item => transferMatchSpecificity(item.rule)));
    return candidates.filter(item => transferMatchSpecificity(item.rule) === best);
}

function transferMatchSpecificity(rule: TransferRule): number {
    void rule;
    return 1;
}

function hasTaintedInlineInvokeOperand(
    invokeExpr: ArkInstanceInvokeExpr,
    sinkStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): boolean {
    const operands: any[] = [];
    operands.push(invokeExpr.getBase());
    for (const arg of invokeExpr.getArgs ? invokeExpr.getArgs() : []) {
        operands.push(arg);
    }
    return operands.some(operand => !!detectWholeOrFieldValueSource(operand, sinkStmt, pag, tracker));
}

function isLocalResultAlreadyTainted(
    value: Local,
    pag: Pag,
    tracker: TaintTracker,
): boolean {
    const nodes = pag.getNodesByValue(value);
    if (!nodes || nodes.size === 0) return false;
    for (const nodeId of nodes.values()) {
        if (tracker.isTaintedAnyContext(nodeId)) {
            return true;
        }
        if (tracker.hasAnyFieldTaintAnyContext(nodeId)) {
            return true;
        }
    }
    return false;
}

function isSelfConstructorInitialization(assignStmt: ArkAssignStmt, invokeExpr: ArkInstanceInvokeExpr): boolean {
    const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.()
        || extractMethodNameFromSignature(invokeExpr.getMethodSignature?.().toString?.() || "");
    if (methodName !== "constructor" && !String(invokeExpr.getMethodSignature?.().toString?.() || "").includes(".constructor(")) {
        return false;
    }
    const left = assignStmt.getLeftOp?.();
    const base = invokeExpr.getBase?.();
    return left instanceof Local && base instanceof Local && left.getName?.() === base.getName?.();
}

function resolveRuleEndpointPath(
    endpoint: ReturnType<typeof normalizeEndpoint>,
    stmt: any,
    invokeExpr: any,
): string[] | undefined {
    if (endpoint.path && endpoint.path.length > 0) {
        return [...endpoint.path];
    }
    if (!endpoint.pathFrom || !endpoint.slotKind) {
        return undefined;
    }
    const pathValue = resolveInvokeEndpointValue(stmt, invokeExpr, endpoint.pathFrom);
    const key = resolveRuntimePathKey(pathValue);
    if (key === undefined) return undefined;
    return [`${endpoint.slotKind}:${key}`];
}

function resolveRuntimePathKey(value: any): string | undefined {
    if (!value) return undefined;
    const text = value.toString?.();
    if (typeof text !== "string" || text.length === 0) return undefined;
    if (/^['"`].*['"`]$/.test(text)) return text.slice(1, -1);
    if (value instanceof Constant) {
        return text.replace(/^['"`]/, "").replace(/['"`]$/, "");
    }
    if (value instanceof Local) {
        const decl = value.getDeclaringStmt?.();
        if (decl instanceof ArkAssignStmt) {
            const right = decl.getRightOp?.();
            const rightText = right?.toString?.();
            if (typeof rightText === "string" && /^['"`].*['"`]$/.test(rightText)) {
                return rightText.slice(1, -1);
            }
        }
        return value.getName?.();
    }
    return undefined;
}

function matchesTransferRuleInvoke(
    rule: TransferRule,
    stmt: any,
    invokeExpr: ArkInstanceInvokeExpr,
    sourceMethod?: any,
    scene?: Scene,
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike,
): boolean {
    if (hasApiEffectIdentity(rule)) {
        void invokeExpr;
        void sourceMethod;
        void scene;
        return !!apiEffectRuntimeIndex?.hasRuleSiteAtStmt(rule, stmt, "transfer");
    }
    void stmt;
    void invokeExpr;
    void sourceMethod;
    void scene;
    void apiEffectRuntimeIndex;
    return false;
}

function hasInterproceduralTaintTargetNode(
    value: Local,
    pag: Pag,
    interproceduralTaintTargetNodeIds: ReadonlySet<number> | undefined,
): boolean {
    if (!interproceduralTaintTargetNodeIds || interproceduralTaintTargetNodeIds.size === 0) {
        return false;
    }
    const nodeIds = pag.getNodesByValue(value);
    if (!nodeIds || nodeIds.size === 0) {
        return false;
    }
    for (const nodeId of nodeIds.values()) {
        if (interproceduralTaintTargetNodeIds.has(nodeId)) {
            return true;
        }
    }
    return false;
}

function detectPreciseCandidateSource(
    scene: Scene,
    method: any,
    sinkStmt: any,
    candidate: SinkCandidate,
    pag: Pag,
    tracker: TaintTracker,
    orderedMethodSignatures?: string[],
    interproceduralTaintTargetNodeIds?: Set<number>,
    transferRules?: TransferRule[],
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike,
    fieldProjectionIndex?: Map<string, Set<number>>,
): PreciseCandidateDetectResult {
    const value = candidate.value;
    if (value instanceof ArkInstanceFieldRef) {
        const fieldAccess = decomposeInstanceFieldAccess(value);
        return detectReceiverFieldCandidateSource(
            method,
            sinkStmt,
            fieldAccess.rootBase,
            fieldAccess.fieldPath,
            scene,
            pag,
            tracker,
            orderedMethodSignatures,
            fieldProjectionIndex,
        );
    }
    if (value instanceof ArkInstanceInvokeExpr) {
        const getterFieldPath = resolveReceiverGetterReturnFieldPath(
            scene,
            value.getMethodSignature?.()?.toString?.() || "",
        );
        if (getterFieldPath && getterFieldPath.length > 0) {
            return detectReceiverFieldCandidateSource(
                method,
                sinkStmt,
                value.getBase(),
                getterFieldPath,
                scene,
                pag,
                tracker,
                orderedMethodSignatures,
                fieldProjectionIndex,
            );
        }
        const transferResult = detectInlineInvokeTransferCandidateSource(
            scene,
            method,
            sinkStmt,
            value,
            pag,
            tracker,
            transferRules || [],
            apiEffectRuntimeIndex,
            fieldProjectionIndex,
        );
        if (transferResult.result || transferResult.fieldProjectionIndex) {
            return transferResult;
        }
        const copyLikeSource = detectOrdinaryCopyLikeInvokeSource(value, sinkStmt, pag, tracker);
        if (copyLikeSource) {
            return {
                result: copyLikeSource,
                blockGenericNodeTaint: false,
                fieldProjectionIndex,
            };
        }
        if (hasTaintedInlineInvokeOperand(value, sinkStmt, pag, tracker)) {
            return {
                blockGenericNodeTaint: true,
                fieldProjectionIndex,
            };
        }
    }
    if (!(value instanceof Local)) {
        return {
            blockGenericNodeTaint: false,
            fieldProjectionIndex,
        };
    }

    const latestAssign = findLatestAssignStmtForLocalBefore(method, value, sinkStmt);
    if (!(latestAssign instanceof ArkAssignStmt)) {
        return {
            blockGenericNodeTaint: false,
            fieldProjectionIndex,
        };
    }
    const hasNonConstantReachingAssign = hasNonConstantReachingAssignAtStmt(method, value, sinkStmt, latestAssign);

    const rightOp = latestAssign.getRightOp();
    if (rightOp instanceof Constant || rightOp === undefined || rightOp === null) {
        const allowInterprocedural = hasInterproceduralTaintTargetNode(value, pag, interproceduralTaintTargetNodeIds);
        return {
            // A later constant assignment in the same method is a strong local kill.
            // Keep lone constant initialization eligible so source probes can still seed it.
            blockGenericNodeTaint: !allowInterprocedural && hasEarlierAssignBefore(method, value, latestAssign),
            fieldProjectionIndex,
        };
    }

    if (rightOp instanceof ArkInstanceInvokeExpr) {
        const getterFieldPath = resolveReceiverGetterReturnFieldPath(
            scene,
            rightOp.getMethodSignature?.()?.toString?.() || "",
        );
        if (!getterFieldPath || getterFieldPath.length === 0) {
            if (isSelfConstructorInitialization(latestAssign, rightOp)) {
                return {
                    blockGenericNodeTaint: false,
                    fieldProjectionIndex,
                };
            }
            const transferResult = detectInlineInvokeTransferCandidateSource(
                scene,
                method,
                latestAssign,
                rightOp,
                pag,
                tracker,
                transferRules || [],
                apiEffectRuntimeIndex,
                fieldProjectionIndex,
            );
            if (transferResult.result || transferResult.fieldProjectionIndex) {
                return transferResult;
            }
            const copyLikeSource = detectOrdinaryCopyLikeInvokeSource(rightOp, latestAssign, pag, tracker);
            if (copyLikeSource) {
                return {
                    result: copyLikeSource,
                    blockGenericNodeTaint: false,
                    fieldProjectionIndex,
                };
            }
            if (hasTaintedInlineInvokeOperand(rightOp, latestAssign, pag, tracker)) {
                if (isLocalResultAlreadyTainted(value, pag, tracker)) {
                    return {
                        blockGenericNodeTaint: false,
                        fieldProjectionIndex,
                    };
                }
                return {
                    blockGenericNodeTaint: true,
                    fieldProjectionIndex,
                };
            }
            return {
                blockGenericNodeTaint: false,
                fieldProjectionIndex,
            };
        }
        const receiverBase = rightOp.getBase();
        const fieldName = getterFieldPath.length === 1 ? getterFieldPath[0] : undefined;
        let hasPriorStore = false;
        let hasFutureStore = false;
        let hasOrderedConstantOverwrite = false;
        const orderedSafeOverwrite = fieldName
            ? findLatestOrderedThisFieldStoreBeforeMethod(scene, orderedMethodSignatures, method, fieldName)
            : undefined;
        if (fieldName) {
            hasPriorStore = hasObservedReceiverFieldStoreBeforeStmt(pag, method, receiverBase, fieldName, sinkStmt);
            hasFutureStore = hasObservedReceiverFieldStoreAfterStmt(pag, method, receiverBase, fieldName, sinkStmt);
            hasOrderedConstantOverwrite = !hasPriorStore && orderedSafeOverwrite?.kind === "constant";
            if (!hasPriorStore && hasFutureStore && isFreshAllocatedReceiverAtStmt(receiverBase, sinkStmt)) {
                return {
                    blockGenericNodeTaint: true,
                    fieldProjectionIndex,
                };
            }
            if (!hasPriorStore && hasFutureStore) {
                if (!fieldProjectionIndex) {
                    fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
                }
                const earlyFieldPathResult = detectFieldPathSource(
                    receiverBase,
                    getterFieldPath,
                    sinkStmt,
                    pag,
                    tracker,
                    fieldProjectionIndex,
                );
                if (earlyFieldPathResult) {
                    return {
                        result: earlyFieldPathResult,
                        blockGenericNodeTaint: false,
                        fieldProjectionIndex,
                    };
                }
                return {
                    blockGenericNodeTaint: true,
                    fieldProjectionIndex,
                };
            }
            if (hasOrderedConstantOverwrite && !hasPriorStore) {
                if (isInstanceInitializerStore(orderedSafeOverwrite)) {
                    return detectFieldPathSourceOrBlockGenericTaint(
                        receiverBase,
                        getterFieldPath,
                        sinkStmt,
                        pag,
                        tracker,
                        fieldProjectionIndex,
                    );
                }
                return {
                    blockGenericNodeTaint: true,
                    fieldProjectionIndex,
                };
            }
        }
        const carrierIds = collectCarrierNodeIdsForValueAtStmt(
            pag,
            receiverBase,
            latestAssign,
        );
        for (const carrierId of carrierIds) {
            if (!isCarrierFieldPathLiveAtStmt(pag, tracker, carrierId, getterFieldPath, sinkStmt)) continue;
            const source = tracker.getSourceAnyContext(carrierId, getterFieldPath);
            if (!source) continue;
            return {
                result: {
                    source,
                    nodeId: carrierId,
                    fieldPath: getterFieldPath,
                },
                blockGenericNodeTaint: false,
                fieldProjectionIndex,
            };
        }
        const allDead = carrierIds.length > 0
            && carrierIds.every(carrierId => !isCarrierFieldPathLiveAtStmt(pag, tracker, carrierId, getterFieldPath, sinkStmt));
        if (allDead) {
            return {
                // Field-path projection must not revive a carrier path that was already
                // proven dead at the sink due to delete/overwrite invalidation.
                blockGenericNodeTaint: hasPriorStore || hasOrderedConstantOverwrite,
                fieldProjectionIndex,
            };
        }
        if (!fieldProjectionIndex) {
            fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
        }
        const getterFieldPathResult = detectFieldPathSource(
            receiverBase,
            getterFieldPath,
            sinkStmt,
            pag,
            tracker,
            fieldProjectionIndex,
        );
        if (getterFieldPathResult) {
            return {
                result: getterFieldPathResult,
                blockGenericNodeTaint: false,
                fieldProjectionIndex,
            };
        }
        return {
            // Only suppress generic node taint when this method itself establishes
            // a prior store for the same receiver field and the field path is now dead.
            // If there is no local store evidence, the value may come from cross-method
            // object state that ordinary propagation already modeled correctly.
            blockGenericNodeTaint: hasOrderedConstantOverwrite || (allDead && hasPriorStore),
            fieldProjectionIndex,
        };
    }

    if (rightOp instanceof ArkInstanceFieldRef) {
        const fieldName = rightOp.getFieldSignature?.().getFieldName?.() || rightOp.getFieldName?.();
        if (!fieldName) {
            return {
                blockGenericNodeTaint: false,
                fieldProjectionIndex,
            };
        }
        const receiverBase = rightOp.getBase();
        const orderedSafeOverwrite = findLatestOrderedThisFieldStoreBeforeMethod(
            scene,
            orderedMethodSignatures,
            method,
            fieldName,
        );
        const hasPriorStore = hasObservedReceiverFieldStoreBeforeStmt(pag, method, receiverBase, fieldName, sinkStmt);
        const hasFutureStore = hasObservedReceiverFieldStoreAfterStmt(pag, method, receiverBase, fieldName, sinkStmt);
        const hasOrderedConstantOverwrite = !hasPriorStore && orderedSafeOverwrite?.kind === "constant";
        if (!hasPriorStore && hasFutureStore && isFreshAllocatedReceiverAtStmt(receiverBase, sinkStmt)) {
            return {
                blockGenericNodeTaint: true,
                fieldProjectionIndex,
            };
        }
        if (!hasPriorStore && hasFutureStore) {
            if (!fieldProjectionIndex) {
                fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
            }
            const earlyFieldPathResult = detectFieldPathSource(
                receiverBase,
                [fieldName],
                sinkStmt,
                pag,
                tracker,
                fieldProjectionIndex,
            );
            if (earlyFieldPathResult) {
                return {
                    result: earlyFieldPathResult,
                    blockGenericNodeTaint: false,
                    fieldProjectionIndex,
                };
            }
            return {
                blockGenericNodeTaint: true,
                fieldProjectionIndex,
            };
        }
        if (hasOrderedConstantOverwrite && !hasPriorStore) {
            if (isInstanceInitializerStore(orderedSafeOverwrite)) {
                return detectFieldPathSourceOrBlockGenericTaint(
                    receiverBase,
                    [fieldName],
                    sinkStmt,
                    pag,
                    tracker,
                    fieldProjectionIndex,
                );
            }
            return {
                blockGenericNodeTaint: true,
                fieldProjectionIndex,
            };
        }
        const carrierIds = collectCarrierNodeIdsForValueAtStmt(
            pag,
            receiverBase,
            latestAssign,
        );
        for (const carrierId of carrierIds) {
            if (!isCarrierFieldPathLiveAtStmt(pag, tracker, carrierId, [fieldName], sinkStmt)) continue;
            const source = tracker.getSourceAnyContext(carrierId, [fieldName]);
            if (!source) continue;
            return {
                result: {
                    source,
                    nodeId: carrierId,
                    fieldPath: [fieldName],
                },
                blockGenericNodeTaint: false,
                fieldProjectionIndex,
            };
        }
        const allDead = carrierIds.length > 0
            && carrierIds.every(carrierId => !isCarrierFieldPathLiveAtStmt(pag, tracker, carrierId, [fieldName], sinkStmt));
        if (allDead) {
            return {
                blockGenericNodeTaint: hasPriorStore || hasOrderedConstantOverwrite,
                fieldProjectionIndex,
            };
        }
        if (!fieldProjectionIndex) {
            fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
        }
        const fieldPathResult = detectFieldPathSource(
            receiverBase,
            [fieldName],
            sinkStmt,
            pag,
            tracker,
            fieldProjectionIndex,
        );
        if (fieldPathResult) {
            return {
                result: fieldPathResult,
                blockGenericNodeTaint: false,
                fieldProjectionIndex,
            };
        }
        return {
            blockGenericNodeTaint: hasOrderedConstantOverwrite || (allDead && hasPriorStore),
            fieldProjectionIndex,
        };
    }

    return {
        blockGenericNodeTaint: false,
        fieldProjectionIndex,
    };
}

function detectReceiverFieldCandidateSource(
    method: any,
    sinkStmt: any,
    receiverBase: any,
    fieldPath: string[],
    scene: Scene,
    pag: Pag,
    tracker: TaintTracker,
    orderedMethodSignatures?: string[],
    fieldProjectionIndex?: Map<string, Set<number>>,
): PreciseCandidateDetectResult {
    if (fieldPath.length === 0) {
        return {
            blockGenericNodeTaint: false,
            fieldProjectionIndex,
        };
    }
    const fieldName = fieldPath.length === 1 ? fieldPath[0] : undefined;
    let hasPriorStore = false;
    let hasFutureStore = false;
    let hasOrderedConstantOverwrite = false;
    const orderedSafeOverwrite = fieldName
        ? findLatestOrderedThisFieldStoreBeforeMethod(scene, orderedMethodSignatures, method, fieldName)
        : undefined;
    if (fieldName) {
        hasPriorStore = hasObservedReceiverFieldStoreBeforeStmt(pag, method, receiverBase, fieldName, sinkStmt);
        hasFutureStore = hasObservedReceiverFieldStoreAfterStmt(pag, method, receiverBase, fieldName, sinkStmt);
        hasOrderedConstantOverwrite = !hasPriorStore && orderedSafeOverwrite?.kind === "constant";
        if (!hasPriorStore && hasFutureStore && isFreshAllocatedReceiverAtStmt(receiverBase, sinkStmt)) {
            return {
                blockGenericNodeTaint: true,
                fieldProjectionIndex,
            };
        }
        if (!hasPriorStore && hasFutureStore) {
            if (!fieldProjectionIndex) {
                fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
            }
            const earlyFieldPathResult = detectFieldPathSource(
                receiverBase,
                fieldPath,
                sinkStmt,
                pag,
                tracker,
                fieldProjectionIndex,
            );
            if (earlyFieldPathResult) {
                return {
                    result: earlyFieldPathResult,
                    blockGenericNodeTaint: false,
                    fieldProjectionIndex,
                };
            }
            return {
                blockGenericNodeTaint: true,
                fieldProjectionIndex,
            };
        }
        if (hasOrderedConstantOverwrite && !hasPriorStore) {
            if (isInstanceInitializerStore(orderedSafeOverwrite)) {
                return detectFieldPathSourceOrBlockGenericTaint(
                    receiverBase,
                    fieldPath,
                    sinkStmt,
                    pag,
                    tracker,
                    fieldProjectionIndex,
                );
            }
            return {
                blockGenericNodeTaint: true,
                fieldProjectionIndex,
            };
        }
    }

    const carrierIds = collectCarrierNodeIdsForValueAtStmt(
        pag,
        receiverBase,
        sinkStmt,
    );
    for (const carrierId of carrierIds) {
        if (!isCarrierFieldPathLiveAtStmt(pag, tracker, carrierId, fieldPath, sinkStmt)) continue;
        const source = tracker.getSourceAnyContext(carrierId, fieldPath);
        if (!source) continue;
        return {
            result: {
                source,
                nodeId: carrierId,
                fieldPath,
            },
            blockGenericNodeTaint: false,
            fieldProjectionIndex,
        };
    }
    const allDead = carrierIds.length > 0
        && carrierIds.every(carrierId => !isCarrierFieldPathLiveAtStmt(pag, tracker, carrierId, fieldPath, sinkStmt));
    if (allDead) {
        return {
            blockGenericNodeTaint: hasPriorStore || hasOrderedConstantOverwrite,
            fieldProjectionIndex,
        };
    }

    if (!fieldProjectionIndex) {
        fieldProjectionIndex = buildFieldToVarIndexFromPag(pag);
    }
    const fieldPathResult = detectFieldPathSource(
        receiverBase,
        fieldPath,
        sinkStmt,
        pag,
        tracker,
        fieldProjectionIndex,
    );
    if (fieldPathResult) {
        return {
            result: fieldPathResult,
            blockGenericNodeTaint: false,
            fieldProjectionIndex,
        };
    }

    return {
        blockGenericNodeTaint: hasOrderedConstantOverwrite || (allDead && hasPriorStore),
        fieldProjectionIndex,
    };
}

function decomposeInstanceFieldAccess(value: ArkInstanceFieldRef): { rootBase: any; fieldPath: string[] } {
    const reversedPath: string[] = [];
    let current: any = value;
    while (current instanceof ArkInstanceFieldRef) {
        const fieldName = current.getFieldSignature?.().getFieldName?.() || current.getFieldName?.();
        if (!fieldName) break;
        reversedPath.push(String(fieldName));
        current = current.getBase?.();
    }
    return {
        rootBase: current,
        fieldPath: reversedPath.reverse(),
    };
}

interface OrderedFieldStore {
    kind: "constant" | "nonconstant";
    methodName?: string;
    methodSignature?: string;
}

function findLatestAssignStmtForLocalBefore(method: any, local: Local, anchorStmt: any): ArkAssignStmt | undefined {
    const cfg = method?.getCfg?.() || anchorStmt?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let latest: ArkAssignStmt | undefined;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) break;
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (stmt.getLeftOp() !== local) continue;
        latest = stmt;
    }
    return latest;
}

function hasEarlierAssignBefore(method: any, local: Local, anchorStmt: any): boolean {
    const cfg = method?.getCfg?.() || anchorStmt?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return false;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) break;
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (stmt.getLeftOp() !== local) continue;
        return true;
    }
    return false;
}

function isFreshAllocatedReceiverAtStmt(receiverBase: any, anchorStmt: any, visiting: Set<string> = new Set<string>()): boolean {
    if (!(receiverBase instanceof Local)) return false;
    const key = `${receiverBase.getName?.() || ""}@${anchorStmt?.toString?.() || ""}`;
    if (visiting.has(key)) return false;
    visiting.add(key);

    const latestAssign = findLatestAssignStmtForLocalBefore(undefined, receiverBase, anchorStmt);
    if (!(latestAssign instanceof ArkAssignStmt)) return false;
    const rightOp = latestAssign.getRightOp?.();
    if (rightOp instanceof ArkNewExpr || rightOp instanceof ArkNewArrayExpr) {
        return true;
    }
    if (rightOp instanceof Local) {
        return isFreshAllocatedReceiverAtStmt(rightOp, latestAssign, visiting);
    }
    if (rightOp instanceof ArkInstanceInvokeExpr) {
        const methodName = rightOp.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.()
            || extractMethodNameFromSignature(rightOp.getMethodSignature?.().toString?.() || "");
        if (methodName === "constructor") {
            return isFreshAllocatedReceiverAtStmt(rightOp.getBase?.(), latestAssign, visiting);
        }
    }
    return false;
}

function hasNonConstantReachingAssignAtStmt(
    method: any,
    local: Local,
    anchorStmt: any,
    latestAssign?: ArkAssignStmt,
): boolean {
    for (const stmt of collectReachingAssignStmtsForLocalAtStmt(method, local, anchorStmt)) {
        if (stmt === latestAssign) continue;
        const rightOp = stmt.getRightOp?.();
        if (!(rightOp instanceof Constant) && rightOp !== undefined && rightOp !== null) {
            return true;
        }
    }
    return false;
}

function collectReachingAssignStmtsForLocalAtStmt(method: any, local: Local, anchorStmt: any): ArkAssignStmt[] {
    const cfg = method?.getCfg?.() || anchorStmt?.getCfg?.();
    const stmtToBlock = cfg?.getStmtToBlock?.();
    const anchorBlock = stmtToBlock?.get?.(anchorStmt);
    if (!anchorBlock) {
        const linear = findLatestAssignStmtForLocalBefore(method, local, anchorStmt);
        return linear ? [linear] : [];
    }

    const out: ArkAssignStmt[] = [];
    const visited = new Set<any>();
    const queue = [anchorBlock];

    while (queue.length > 0) {
        const block = queue.shift();
        if (!block || visited.has(block)) continue;
        visited.add(block);

        const stmts: any[] = block.stmts || block.getStmts?.() || [];
        for (const stmt of stmts) {
            if (block === anchorBlock && stmt === anchorStmt) break;
            if (!(stmt instanceof ArkAssignStmt)) continue;
            if (stmt.getLeftOp() !== local) continue;
            out.push(stmt);
        }

        const predecessors: any[] = block.predecessorBlocks || block.getPredecessors?.() || [];
        for (const predecessor of predecessors) {
            if (!visited.has(predecessor)) {
                queue.push(predecessor);
            }
        }
    }

    return out;
}

function hasObservedReceiverFieldStoreBeforeStmt(pag: Pag, method: any, receiverValue: any, fieldName: string, anchorStmt: any): boolean {
    const cfg = method?.getCfg?.() || anchorStmt?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return false;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) break;
        if (isReceiverFieldStoreLikeStmt(pag, stmt, receiverValue, fieldName)) {
            return true;
        }
    }
    return false;
}

function hasObservedReceiverFieldStoreAfterStmt(pag: Pag, method: any, receiverValue: any, fieldName: string, anchorStmt: any): boolean {
    const cfg = method?.getCfg?.() || anchorStmt?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return false;
    let seenAnchor = false;
    for (const stmt of stmts) {
        if (!seenAnchor) {
            seenAnchor = stmt === anchorStmt;
            continue;
        }
        if (isReceiverFieldStoreLikeStmt(pag, stmt, receiverValue, fieldName)) {
            return true;
        }
    }
    return false;
}

function isReceiverFieldStoreLikeStmt(pag: Pag, stmt: any, receiverValue: any, fieldName: string): boolean {
    if (stmt instanceof ArkAssignStmt) {
        const left = stmt.getLeftOp();
        if (left instanceof ArkInstanceFieldRef) {
            const leftField = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
            if (leftField === fieldName && sameReceiverLike(pag, left.getBase(), receiverValue)) {
                return true;
            }
        }
    }
    if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) {
        return false;
    }
    const invokeExpr = stmt.getInvokeExpr();
    if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) {
        return false;
    }
    if (!sameReceiverLike(pag, invokeExpr.getBase(), receiverValue)) {
        return false;
    }
    const methodName = invokeExpr.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.()
        || extractMethodNameFromSignature(invokeExpr.getMethodSignature?.().toString?.() || "");
    return methodName === setterNameForField(fieldName);
}

function findLatestOrderedThisFieldStoreBeforeMethod(
    scene: Scene,
    orderedMethodSignatures: string[] | undefined,
    anchorMethod: any,
    fieldName: string,
): OrderedFieldStore | undefined {
    if (!orderedMethodSignatures || orderedMethodSignatures.length === 0) return undefined;
    const anchorSig = anchorMethod?.getSignature?.()?.toString?.() || "";
    if (!anchorSig) return undefined;
    const anchorIdx = orderedMethodSignatures.indexOf(anchorSig);
    if (anchorIdx <= 0) return undefined;
    const anchorClassSig = anchorMethod?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
    if (!anchorClassSig) return undefined;

    const methodsBySig = new Map<string, any>();
    for (const method of scene.getMethods()) {
        const sig = method?.getSignature?.()?.toString?.() || "";
        if (sig) methodsBySig.set(sig, method);
    }

    for (let i = anchorIdx - 1; i >= 0; i--) {
        const method = methodsBySig.get(orderedMethodSignatures[i]);
        if (!method?.getCfg?.()) continue;
        const classSig = method?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
        if (classSig !== anchorClassSig) continue;
        const store = findLastThisFieldStoreInMethod(method, fieldName);
        if (store) return store;
    }
    return undefined;
}

function findLastThisFieldStoreInMethod(method: any, fieldName: string): OrderedFieldStore | undefined {
    const cfg = method?.getCfg?.();
    const stmts = cfg?.getStmts?.() || [];
    const storeMethodName = method?.getName?.()
        || method?.getSignature?.()?.getMethodSubSignature?.()?.getMethodName?.()
        || extractMethodNameFromSignature(method?.getSignature?.()?.toString?.() || "");
    const storeMethodSignature = method?.getSignature?.()?.toString?.() || "";
    for (let i = stmts.length - 1; i >= 0; i--) {
        const stmt = stmts[i];
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp?.();
            if (left instanceof ArkInstanceFieldRef) {
                const leftField = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
                const base = left.getBase?.();
                if (leftField === fieldName && base instanceof Local && base.getName?.() === "this") {
                    return {
                        kind: stmt.getRightOp?.() instanceof Constant ? "constant" : "nonconstant",
                        methodName: storeMethodName,
                        methodSignature: storeMethodSignature,
                    };
                }
            }
        }
        if (!stmt?.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const base = invokeExpr.getBase?.();
        if (!(base instanceof Local) || base.getName?.() !== "this") continue;
        const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.()
            || extractMethodNameFromSignature(invokeExpr.getMethodSignature?.().toString?.() || "");
        if (methodName !== setterNameForField(fieldName)) continue;
        const args = invokeExpr.getArgs?.() || [];
        return {
            kind: args[0] instanceof Constant ? "constant" : "nonconstant",
            methodName: storeMethodName,
            methodSignature: storeMethodSignature,
        };
    }
    return undefined;
}

function detectContainedValueSources(
    value: any,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
    classBySignature?: Map<string, any>,
): FieldPathDetectResult[] {
    if (!value) return [];
    const out = new Map<string, FieldPathDetectResult>();
    const add = (result: FieldPathDetectResult): void => {
        const key = `${result.source}|${result.nodeId ?? ""}|${(result.fieldPath || []).join(".")}`;
        if (!out.has(key)) {
            out.set(key, result);
        }
    };
    const carrierNodeIds = collectCarrierNodeIdsForValueAtStmt(
        pag,
        value,
        anchorStmt,
        classBySignature,
    );
    for (const carrierNodeId of carrierNodeIds) {
        for (const fieldSource of detectCarrierFieldSources(
            carrierNodeId,
            anchorStmt,
            pag,
            tracker,
            classBySignature,
        )) {
            add(fieldSource);
        }
    }
    return [...out.values()];
}

function detectAnyCarrierFieldSource(
    carrierNodeId: number,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult | undefined {
    return detectCarrierFieldSources(carrierNodeId, anchorStmt, pag, tracker)[0];
}

function detectCarrierFieldSources(
    carrierNodeId: number,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
    classBySignature?: Map<string, any>,
): FieldPathDetectResult[] {
    const out: FieldPathDetectResult[] = [];
    for (const fieldSource of tracker.getFieldSourcesAnyContext(carrierNodeId)) {
        if (!isCarrierFieldPathLiveAtStmt(pag, tracker, carrierNodeId, fieldSource.fieldPath, anchorStmt, classBySignature)) {
            continue;
        }
        out.push({
            source: fieldSource.source,
            nodeId: carrierNodeId,
            fieldPath: fieldSource.fieldPath,
        });
    }
    return out;
}

function isInstanceInitializerStore(store: OrderedFieldStore | undefined): boolean {
    return store?.methodName === "%instInit"
        || !!store?.methodSignature?.includes(".%instInit(");
}

function setterNameForField(fieldName: string): string {
    if (!fieldName) return "set";
    return `set${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`;
}

function sameReceiverLike(pag: Pag, left: any, right: any): boolean {
    if (sameValueLike(left, right)) return true;
    const leftNodes = pag.getNodesByValue(left);
    const rightNodes = pag.getNodesByValue(right);
    if (!leftNodes || !rightNodes) return false;
    const leftPts = new Set<number>();
    const rightPts = new Set<number>();
    for (const nodeId of leftNodes.values()) {
        const node = pag.getNode(nodeId) as PagNode;
        if (!node) continue;
        for (const objId of node.getPointTo()) leftPts.add(objId);
    }
    for (const nodeId of rightNodes.values()) {
        const node = pag.getNode(nodeId) as PagNode;
        if (!node) continue;
        for (const objId of node.getPointTo()) rightPts.add(objId);
    }
    for (const objId of leftPts) {
        if (rightPts.has(objId)) return true;
    }
    return false;
}

function getOrBuildSinkCallsiteIndex(scene: Scene, allowedMethodSignatures?: Set<string>): SinkCallsiteIndex {
    const key = buildAllowedMethodSignatureKey(allowedMethodSignatures);
    let byKey = sinkCallsiteIndexCache.get(scene);
    if (!byKey) {
        byKey = new Map<string, SinkCallsiteIndex>();
        sinkCallsiteIndexCache.set(scene, byKey);
    }
    const cached = byKey.get(key);
    if (cached) {
        return cached;
    }

    let methodCount = 0;
    let reachableMethodCount = 0;
    let stmtCount = 0;
    let invokeStmtCount = 0;
    const sites: IndexedInvokeSite[] = [];
    for (const method of scene.getMethods()) {
        methodCount++;
        const methodSignature = method.getSignature().toString();
        if (allowedMethodSignatures && allowedMethodSignatures.size > 0 && !allowedMethodSignatures.has(methodSignature)) {
            continue;
        }
        const cfg = method.getCfg();
        if (!cfg) continue;
        reachableMethodCount++;
        for (const stmt of cfg.getStmts()) {
            stmtCount++;
            if (!stmt.containsInvokeExpr()) continue;
            invokeStmtCount++;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;
            const calleeSignature = invokeExpr.getMethodSignature().toString();
            sites.push({
                method,
                stmt,
                invokeExpr,
                calleeSignature,
                semanticEffectSites: [],
            });
        }
    }

    const built: SinkCallsiteIndex = {
        methodCount,
        reachableMethodCount,
        stmtCount,
        invokeStmtCount,
        sites,
    };
    byKey.set(key, built);
    return built;
}

function buildAllowedMethodSignatureKey(allowedMethodSignatures?: Set<string>): string {
    if (!allowedMethodSignatures || allowedMethodSignatures.size === 0) return "__all__";
    return [...allowedMethodSignatures].sort().join("||");
}

function resolveApiEffectSinkSites(options: SinkDetectOptions): IndexedInvokeSite[] {
    const rule = options.apiIdentityRule;
    if (!rule || !hasApiEffectIdentity(rule)) return [];
    const sites = options.apiEffectRuntimeIndex?.getSitesForRule(rule, "sink") || [];
    const out: IndexedInvokeSite[] = [];
    for (const site of sites) {
        if (!site.effect.acceptedForPropagation) continue;
        const methodSignature = site.method.getSignature?.()?.toString?.() || "";
        if (options.allowedMethodSignatures && !options.allowedMethodSignatures.has(methodSignature)) continue;
        const semanticEffectSites = site.semanticEffectSites.filter(semanticSite => semanticSite.capability === "sink");
        if (semanticEffectSites.length === 0) continue;
        out.push({
            method: site.method,
            stmt: site.stmt,
            invokeExpr: site.invokeExpr,
            fieldRef: site.fieldRef,
            calleeSignature: site.calleeSignature,
            semanticEffectSites,
        });
    }
    return out;
}

function resolveSinkCandidates(
    site: IndexedInvokeSite,
    pag: Pag,
): SinkCandidateResolution {
    const candidates: SinkCandidate[] = [];
    const diagnostics: SinkEndpointDiagnostic[] = [];
    for (const semanticSite of site.semanticEffectSites) {
        const projection = projectSemanticEffectEndpoint({
            pag,
            semanticSite,
            stmt: site.stmt,
            invokeExpr: site.invokeExpr,
            fieldRef: site.fieldRef,
            // Sink endpoints are gated by accepted canonical identity and the
            // declarative endpoint binding. If PAG did not prebuild a node for
            // that exact runtime argument/value, materialize only this exact
            // endpoint so sink detection can consume the same semantic site.
            allowNodeCreation: true,
            exactMaterializationEvidence: {
                kind: "semantic_effect_endpoint_ir",
                reason: `accepted sink endpoint ${semanticSite.effectSiteId}`,
                endpointBindingRef: semanticSite.endpointBindingRef,
            },
            consumer: "sink",
        });
        if (!isExactEndpointProjection(projection)) {
            diagnostics.push({
                projection,
                reason: endpointProjectionRejectReason(projection, "sink_endpoint_projection_not_exact"),
            });
            continue;
        }
        if (projection.values.length === 0) {
            diagnostics.push({
                projection,
                reason: "sink_endpoint_resolved_without_usable_value",
            });
            continue;
        }
        for (const value of projection.values) {
            candidates.push({
                value,
                kind: sinkCandidateKindFromProjection(projection),
                endpoint: projection.endpointPath,
                targetPath: projection.fieldPath,
                targetTaintScope: projection.endpointSpec.taintScope,
                endpointResolution: projection,
            });
        }
    }
    return { candidates, diagnostics };
}

function isExactEndpointProjection(projection: SemanticEndpointProjection): boolean {
    return isConsumableSemanticEndpointProjection(projection);
}

function endpointProjectionRejectReason(
    projection: SemanticEndpointProjection,
    defaultReason: string,
): string {
    if (projection.diagnosticKind) return projection.diagnosticKind;
    if (projection.status !== "resolved") return projection.reason || projection.status;
    if (projection.materializedExact !== true) return "endpoint_projection_not_exact";
    if (projection.nodeIds.length === 0) return "endpoint_projection_missing_pag_nodes";
    if (projection.carrierNodeIds.length === 0) return "endpoint_projection_missing_carrier_nodes";
    return projection.reason || defaultReason;
}

function sinkCandidateKindFromProjection(projection: SemanticEndpointProjection): SinkCandidate["kind"] {
    switch (projection.endpointBaseKind) {
        case "receiver":
            return "base";
        case "return":
        case "promiseResult":
        case "promiseRejected":
        case "constructorResult":
        case "callbackReturn":
            return "result";
        default:
            return "arg";
    }
}

function matchesInvokeConstraints(
    scene: Scene,
    stmt: any,
    invokeExpr: any,
    calleeSignature: string,
    options: SinkDetectOptions,
    sourceMethod?: any,
): boolean {
    if (
        options.apiIdentityRule
        && hasApiEffectIdentity(options.apiIdentityRule)
    ) {
        void invokeExpr;
        void calleeSignature;
        void sourceMethod;
        void scene;
        return !!options.apiEffectRuntimeIndex?.hasRuleSiteAtStmt(options.apiIdentityRule, stmt, "sink");
    }
    void stmt;
    void invokeExpr;
    void calleeSignature;
    void sourceMethod;
    void scene;
    return false;
}

function isSinkCandidateSanitizedByRules(
    method: any,
    sinkStmt: any,
    candidate: SinkCandidate,
    pag: Pag,
    sanitizerRules: SanitizerRule[],
    log: (msg: string) => void,
    scene?: Scene,
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike,
): { sanitized: boolean; ruleId?: string } {
    if (!sanitizerRules || sanitizerRules.length === 0) {
        return { sanitized: false };
    }
    const cfg = method.getCfg();
    if (!cfg) return { sanitized: false };
    const stmts = cfg.getStmts();
    const sinkIndex = stmts.indexOf(sinkStmt);
    if (sinkIndex <= 0) return { sanitized: false };

    const candidateValue = candidate.value;
    if (!candidateValue) return { sanitized: false };

    for (let i = 0; i < sinkIndex; i++) {
        const stmt = stmts[i];
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!invokeExpr) continue;
        const calleeSignature = invokeExpr.getMethodSignature()?.toString?.() || "";
        if (!calleeSignature) continue;

        const matchedRules = orderRulesForSameFamilySelection(sanitizerRules.filter(rule => {
            if (!hasApiEffectIdentity(rule)) return false;
            void invokeExpr;
            void calleeSignature;
            void scene;
            return !!apiEffectRuntimeIndex?.hasRuleSiteAtStmt(rule, stmt, "sanitizer");
        }));
        for (const rule of matchedRules) {
            const projectedTargets = resolveExactSanitizerEndpointValues(
                rule,
                stmt,
                invokeExpr,
                pag,
                apiEffectRuntimeIndex,
            );
            for (const target of projectedTargets) {
                if (!sameValueLike(candidateValue, target.value)) continue;
                if (
                    target.value instanceof Local
                    && hasLocalReassignmentBetween(stmts, target.value.getName(), i, sinkIndex)
                ) {
                    continue;
                }
                log(`    [Sanitizer-Guard] skip sink by '${rule.id}' on endpoint '${target.projection.endpointPath}'.`);
                return { sanitized: true, ruleId: rule.id };
            }
        }
    }

    return { sanitized: false };
}

function resolveExactSanitizerEndpointValues(
    rule: SanitizerRule,
    stmt: any,
    invokeExpr: any,
    pag: Pag,
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike,
): Array<{ value: any; projection: SemanticEndpointProjection }> {
    if (!hasApiEffectIdentity(rule)) return [];
    const sites = apiEffectRuntimeIndex?.getSitesForRule(rule, "sanitizer") || [];
    const out: Array<{ value: any; projection: SemanticEndpointProjection }> = [];
    for (const site of sites) {
        if (site.stmt !== stmt) continue;
        if (!site.effect.acceptedForPropagation) continue;
        for (const semanticSite of site.semanticEffectSites) {
            if (semanticSite.capability !== "sanitizer") continue;
            const projection = projectSemanticEffectEndpoint({
                pag,
                semanticSite,
                stmt,
                invokeExpr,
                allowNodeCreation: false,
                consumer: "sanitizer",
            });
            if (!isExactEndpointProjection(projection)) continue;
            for (const value of projection.values) {
                if (value === undefined || value === null) continue;
                out.push({ value, projection });
            }
        }
    }
    return out;
}

function hasLocalReassignmentBetween(
    stmts: any[],
    localName: string,
    fromIndexInclusive: number,
    toIndexExclusive: number
): boolean {
    for (let i = fromIndexInclusive + 1; i < toIndexExclusive; i++) {
        const stmt = stmts[i];
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        if (left.getName() === localName) {
            return true;
        }
    }
    return false;
}

function resolveInvokeEndpointValue(stmt: any, invokeExpr: any, endpoint: RuleEndpoint): any | undefined {
    if (endpoint === "result") {
        if (stmt instanceof ArkAssignStmt) {
            return stmt.getLeftOp();
        }
        return undefined;
    }
    if (endpoint === "base") {
        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            return invokeExpr.getBase();
        }
        return undefined;
    }
    const m = /^arg(\d+)$/.exec(endpoint);
    if (!m) return undefined;
    const idx = Number(m[1]);
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (!Number.isFinite(idx) || idx < 0 || idx >= args.length) return undefined;
    return args[idx];
}

function resolveCandidatePagNodes(
    pag: Pag,
    method: any,
    value: any,
): Map<number, number> | undefined {
    const direct = pag.getNodesByValue(value);
    if (direct && direct.size > 0) {
        return direct;
    }
    if (!(value instanceof Local)) {
        return undefined;
    }
    const canonicalLocal = method?.getBody?.()?.getLocals?.()?.get?.(value.getName?.());
    if (!(canonicalLocal instanceof Local) || canonicalLocal === value) {
        return undefined;
    }
    return pag.getNodesByValue(canonicalLocal);
}

function sameValueLike(a: any, b: any): boolean {
    if (a === b) return true;
    if (a instanceof Local && b instanceof Local) {
        return a.getName() === b.getName();
    }
    const aText = a?.toString?.();
    const bText = b?.toString?.();
    return typeof aText === "string" && aText.length > 0 && aText === bText;
}

function extractMethodNameFromSignature(signature: string): string {
    const m = signature.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function buildFieldToVarIndexFromPag(pag: Pag): Map<string, Set<number>> {
    const index: Map<string, Set<number>> = new Map();

    for (const node of pag.getNodesIter()) {
        if (!(node instanceof PagInstanceFieldNode)) continue;

        const fieldRef = node.getValue() as ArkInstanceFieldRef;
        const fieldName = fieldRef.getFieldSignature().getFieldName();
        const baseLocal = fieldRef.getBase();
        const baseNodesMap = pag.getNodesByValue(baseLocal);
        if (!baseNodesMap) continue;

        for (const baseNodeId of baseNodesMap.values()) {
            const baseNode = pag.getNode(baseNodeId) as PagNode;
            for (const objId of baseNode.getPointTo()) {
                const key = `${objId}-${fieldName}`;
                const loadEdges = node.getOutgoingLoadEdges();
                if (!loadEdges) continue;
                if (!index.has(key)) {
                    index.set(key, new Set<number>());
                }
                const bucket = index.get(key)!;
                for (const edge of loadEdges) {
                    bucket.add(edge.getDstID());
                }
            }
        }
    }

    return index;
}

function detectFieldPathSource(
    rootValue: any,
    fieldPath: string[],
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
    fieldToVarIndex: Map<string, Set<number>>
) : FieldPathDetectResult | undefined {
    if (fieldPath.length === 0) return undefined;

    const rootCarrierIds = new Set<number>();
    const rootObjIds = new Set<number>();
    if (rootValue instanceof Local) {
        const preciseCarrierIds = collectCarrierNodeIdsForValueAtStmt(
            pag,
            rootValue,
            anchorStmt,
        );
        for (const carrierId of preciseCarrierIds) {
            rootCarrierIds.add(carrierId);
            const carrierNode = pag.getNode(carrierId) as PagNode;
            let hasPointTo = false;
            if (carrierNode && carrierNode.getPointTo) {
                for (const objId of carrierNode.getPointTo()) {
                    hasPointTo = true;
                    rootCarrierIds.add(objId);
                    rootObjIds.add(objId);
                }
            }
            if (hasPointTo) {
                continue;
            }
            rootObjIds.add(carrierId);
        }
    }

    if (rootCarrierIds.size === 0) {
        const rootNodes = pag.getNodesByValue(rootValue);
        if (!rootNodes || rootNodes.size === 0) return undefined;
        for (const rootNodeId of rootNodes.values()) {
            const rootNode = pag.getNode(rootNodeId) as PagNode;
            rootCarrierIds.add(rootNodeId);
            for (const objId of rootNode.getPointTo()) {
                rootCarrierIds.add(objId);
                rootObjIds.add(objId);
            }
        }
    }
    if (rootCarrierIds.size === 0) return undefined;

    if (rootObjIds.size === 0 && fieldPath.length === 1) {
        if (rootValue instanceof ArkInstanceFieldRef) {
            const baseNodes = pag.getNodesByValue(rootValue.getBase());
            if (baseNodes) {
                let hasLiveBase = false;
                for (const baseNodeId of baseNodes.values()) {
                    const baseNode = pag.getNode(baseNodeId) as PagNode;
                    for (const objId of baseNode.getPointTo()) {
                        if (isCarrierFieldPathLiveAtStmt(pag, tracker, objId, [fieldPath[0]], anchorStmt)) {
                            hasLiveBase = true;
                            break;
                        }
                    }
                    if (hasLiveBase) break;
                }
                if (!hasLiveBase) {
                    return undefined;
                }
            }
        }
        const source = tracker.getSourceAnyContext([...rootCarrierIds][0], [fieldPath[0]]);
        if (source) {
            return {
                source,
                nodeId: [...rootCarrierIds][0],
                fieldPath: [fieldPath[0]],
            };
        }
        const descendantSource = detectLiveDescendantFieldPathSource(
            [...rootCarrierIds][0],
            fieldPath,
            anchorStmt,
            pag,
            tracker,
        );
        if (descendantSource) {
            return descendantSource;
        }
    }

    let frontierObjIds = rootObjIds;
    for (let i = 0; i < fieldPath.length; i++) {
        const fieldName = fieldPath[i];
        const isLast = i === fieldPath.length - 1;

        if (isLast) {
            for (const objId of frontierObjIds) {
                if (!isCarrierFieldPathLiveAtStmt(pag, tracker, objId, fieldPath, anchorStmt)) continue;
                const directPathSource = tracker.getSourceAnyContext(objId, fieldPath);
                if (directPathSource) {
                    return {
                        source: directPathSource,
                        nodeId: objId,
                        fieldPath: [...fieldPath],
                    };
                }

                const descendantSource = detectLiveDescendantFieldPathSource(
                    objId,
                    fieldPath,
                    anchorStmt,
                    pag,
                    tracker,
                );
                if (descendantSource) {
                    return descendantSource;
                }

                const source = tracker.getSourceAnyContext(objId, [fieldName]);
                if (source) {
                    return {
                        source,
                        nodeId: objId,
                        fieldPath: [fieldName],
                    };
                }

                const storedValueSource = detectStoredFieldObjectSource(
                    objId,
                    fieldName,
                    anchorStmt,
                    pag,
                    tracker,
                );
                if (storedValueSource) {
                    return storedValueSource;
                }

                const loadTargets = fieldToVarIndex.get(`${objId}-${fieldName}`);
                if (!loadTargets) continue;
                for (const loadNodeId of loadTargets.values()) {
                    if (!fieldLoadTargetMayBelongToObjectAtRead(pag, loadNodeId, objId, fieldName, anchorStmt)) {
                        continue;
                    }
                    const loadSource = tracker.getSourceAnyContext(loadNodeId);
                    if (loadSource) {
                        return {
                            source: loadSource,
                            nodeId: loadNodeId,
                        };
                    }
                    const loadedObjectSource = detectAnyLiveFieldSourceOnLoadedValue(
                        loadNodeId,
                        anchorStmt,
                        pag,
                        tracker,
                    );
                    if (loadedObjectSource) {
                        return loadedObjectSource;
                    }
                }
            }
            return undefined;
        }

        const nextFrontier = new Set<number>();
        for (const objId of frontierObjIds) {
            if (!isCarrierFieldPathLiveAtStmt(pag, tracker, objId, fieldPath.slice(i), anchorStmt)) continue;
            const loadTargets = fieldToVarIndex.get(`${objId}-${fieldName}`);
            if (!loadTargets) continue;
            for (const loadNodeId of loadTargets.values()) {
                if (!fieldLoadTargetMayBelongToObjectAtRead(pag, loadNodeId, objId, fieldName, anchorStmt)) {
                    continue;
                }
                const loadNode = pag.getNode(loadNodeId) as PagNode;
                for (const nextObjId of loadNode.getPointTo()) {
                    nextFrontier.add(nextObjId);
                }
            }
        }

        if (nextFrontier.size === 0) {
            return undefined;
        }
        frontierObjIds = nextFrontier;
    }

    return undefined;
}

function detectFieldPathSources(
    rootValue: any,
    fieldPath: string[],
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
    fieldToVarIndex: Map<string, Set<number>>,
): FieldPathDetectResult[] {
    const results: FieldPathDetectResult[] = [];
    const add = (result: FieldPathDetectResult | undefined): void => {
        if (!result?.source) return;
        const key = `${result.source}|${result.nodeId ?? -1}|${(result.fieldPath || []).join(".")}`;
        if (results.some(item => `${item.source}|${item.nodeId ?? -1}|${(item.fieldPath || []).join(".")}` === key)) {
            return;
        }
        results.push(result);
    };

    add(detectFieldPathSource(rootValue, fieldPath, anchorStmt, pag, tracker, fieldToVarIndex));

    if (fieldPath.length === 1) {
        for (const objId of collectRootObjectIdsForFieldPathValue(rootValue, anchorStmt, pag)) {
            for (const result of detectStoredFieldObjectSources(objId, fieldPath[0], anchorStmt, pag, tracker)) {
                add(result);
            }
            const loadTargets = fieldToVarIndex.get(`${objId}-${fieldPath[0]}`);
            if (!loadTargets) continue;
            for (const loadNodeId of loadTargets.values()) {
                if (!fieldLoadTargetMayBelongToObjectAtRead(pag, loadNodeId, objId, fieldPath[0], anchorStmt)) {
                    continue;
                }
                for (const result of detectAllLiveFieldSourcesOnLoadedValue(loadNodeId, anchorStmt, pag, tracker)) {
                    add(result);
                }
            }
        }
    }

    return results;
}

function collectRootObjectIdsForFieldPathValue(rootValue: any, anchorStmt: any, pag: Pag): Set<number> {
    const out = new Set<number>();
    const addNodeAndPointsTo = (nodeId: number): void => {
        const node = pag.getNode(nodeId) as PagNode | undefined;
        if (!node) return;
        let hasPointTo = false;
        if (node.getPointTo) {
            for (const objId of node.getPointTo()) {
                hasPointTo = true;
                out.add(objId);
            }
        }
        if (!hasPointTo) out.add(nodeId);
    };

    if (rootValue instanceof Local) {
        for (const carrierId of collectCarrierNodeIdsForValueAtStmt(pag, rootValue, anchorStmt)) {
            addNodeAndPointsTo(carrierId);
        }
    }

    if (out.size === 0) {
        const rootNodes = pag.getNodesByValue(rootValue);
        if (rootNodes) {
            for (const rootNodeId of rootNodes.values()) {
                addNodeAndPointsTo(rootNodeId);
            }
        }
    }

    return out;
}

function detectStoredFieldObjectSource(
    ownerObjId: number,
    fieldName: string,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult | undefined {
    for (const rawNode of pag.getNodesIter()) {
        if (!(rawNode instanceof PagInstanceFieldNode)) continue;
        const fieldRef = rawNode.getValue() as ArkInstanceFieldRef;
        const candidateFieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
        if (candidateFieldName !== fieldName) continue;
        if (!fieldNodeHasMatchingOwnerWriteBefore(pag, fieldRef, ownerObjId, anchorStmt)) continue;

        const incomingWrites = rawNode.getIncomingWriteEdges?.();
        if (!incomingWrites) continue;
        for (const edge of incomingWrites) {
            const srcNodeId = edge.getSrcID?.();
            if (!Number.isFinite(srcNodeId)) continue;
            const directSource = tracker.getSourceAnyContext(srcNodeId);
            if (directSource) {
                return {
                    source: directSource,
                    nodeId: srcNodeId,
                };
            }
            const sourceFromStoredValue = detectAnyLiveFieldSourceOnLoadedValue(
                srcNodeId,
                anchorStmt,
                pag,
                tracker,
            );
            if (sourceFromStoredValue) {
                return sourceFromStoredValue;
            }
        }
    }
    return undefined;
}

function detectStoredFieldObjectSources(
    ownerObjId: number,
    fieldName: string,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult[] {
    const out: FieldPathDetectResult[] = [];
    for (const rawNode of pag.getNodesIter()) {
        if (!(rawNode instanceof PagInstanceFieldNode)) continue;
        const fieldRef = rawNode.getValue() as ArkInstanceFieldRef;
        const candidateFieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
        if (candidateFieldName !== fieldName) continue;
        if (!fieldNodeHasMatchingOwnerWriteBefore(pag, fieldRef, ownerObjId, anchorStmt)) continue;

        const incomingWrites = rawNode.getIncomingWriteEdges?.();
        if (!incomingWrites) continue;
        for (const edge of incomingWrites) {
            const srcNodeId = edge.getSrcID?.();
            if (!Number.isFinite(srcNodeId)) continue;
            const directSources = tracker.getSourcesAnyContext(srcNodeId);
            for (const source of directSources) {
                out.push({ source, nodeId: srcNodeId });
            }
            out.push(...detectAllLiveFieldSourcesOnLoadedValue(srcNodeId, anchorStmt, pag, tracker));
        }
    }
    return out;
}

function fieldNodeMayBelongToObject(pag: Pag, fieldRef: ArkInstanceFieldRef, ownerObjId: number): boolean {
    const baseNodes = pag.getNodesByValue(fieldRef.getBase());
    if (!baseNodes || baseNodes.size === 0) return false;
    for (const baseNodeId of baseNodes.values()) {
        if (baseNodeId === ownerObjId) return true;
        const baseNode = pag.getNode(baseNodeId) as PagNode | undefined;
        if (!baseNode?.getPointTo) continue;
        for (const objId of baseNode.getPointTo()) {
            if (objId === ownerObjId) return true;
        }
    }
    return false;
}

function fieldNodeMayBelongToObjectAtWrite(
    pag: Pag,
    fieldRef: ArkInstanceFieldRef,
    ownerObjId: number,
    anchorStmt: any,
): boolean {
    const base = fieldRef.getBase?.();
    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
    if (!(base instanceof Local) || !fieldName) {
        return fieldNodeMayBelongToObject(pag, fieldRef, ownerObjId);
    }

    const cfg = anchorStmt?.getCfg?.() || base.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    const order = new Map<any, number>();
    let anchorIndex = Number.POSITIVE_INFINITY;
    if (stmts) {
        let index = 0;
        for (const stmt of stmts) {
            order.set(stmt, index);
            if (stmt === anchorStmt) anchorIndex = index;
            index++;
        }
    }

    let sawMatchingFieldWrite = false;
    const usedStmts = base.getUsedStmts?.() || [];
    for (const stmt of usedStmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const stmtIndex = order.get(stmt);
        if (stmtIndex !== undefined && stmtIndex >= anchorIndex) continue;
        const left = stmt.getLeftOp?.();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        if (left.getBase?.() !== base) continue;
        const leftFieldName = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
        if (leftFieldName !== fieldName) continue;
        sawMatchingFieldWrite = true;
        const carrierIds = collectCarrierNodeIdsForValueAtStmt(pag, base, stmt);
        if (carrierIds.includes(ownerObjId)) {
            return true;
        }
    }

    return sawMatchingFieldWrite
        ? false
        : fieldNodeMayBelongToObject(pag, fieldRef, ownerObjId);
}

function fieldNodeHasMatchingOwnerWriteBefore(
    pag: Pag,
    fieldRef: ArkInstanceFieldRef,
    ownerObjId: number,
    anchorStmt: any,
): boolean {
    const base = fieldRef.getBase?.();
    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
    if (!(base instanceof Local) || !fieldName) return false;

    const cfg = anchorStmt?.getCfg?.() || base.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    const order = new Map<any, number>();
    let anchorIndex = Number.POSITIVE_INFINITY;
    if (stmts) {
        let index = 0;
        for (const stmt of stmts) {
            order.set(stmt, index);
            if (stmt === anchorStmt) anchorIndex = index;
            index++;
        }
    }

    const usedStmts = base.getUsedStmts?.() || [];
    for (const stmt of usedStmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const stmtIndex = order.get(stmt);
        if (stmtIndex !== undefined && stmtIndex >= anchorIndex) continue;
        const left = stmt.getLeftOp?.();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        if (left.getBase?.() !== base) continue;
        const leftFieldName = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
        if (leftFieldName !== fieldName) continue;
        const carrierIds = collectCarrierNodeIdsForValueAtStmt(pag, base, stmt);
        if (carrierIds.includes(ownerObjId)) return true;
    }

    return false;
}

function fieldLoadTargetMayBelongToObjectAtRead(
    pag: Pag,
    loadNodeId: number,
    ownerObjId: number,
    fieldName: string,
    anchorStmt: any,
): boolean {
    const loadRefInfo = resolveFieldLoadRefForNode(pag, loadNodeId);
    if (!loadRefInfo) return false;
    const { fieldRef, stmt } = loadRefInfo;
    const loadedFieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
    if (loadedFieldName !== fieldName) return false;

    const anchorCfg = anchorStmt?.getCfg?.();
    const loadCfg = stmt?.getCfg?.();
    if (anchorCfg && loadCfg && anchorCfg !== loadCfg) {
        return false;
    }
    if (anchorCfg && loadCfg && anchorCfg === loadCfg) {
        const stmts = anchorCfg.getStmts?.() || [];
        let anchorIndex = -1;
        let loadIndex = -1;
        for (let i = 0; i < stmts.length; i++) {
            if (stmts[i] === anchorStmt) anchorIndex = i;
            if (stmts[i] === stmt) loadIndex = i;
        }
        if (anchorIndex >= 0 && loadIndex >= 0 && loadIndex > anchorIndex) {
            return false;
        }
    }

    const base = fieldRef.getBase?.();
    if (!(base instanceof Local)) {
        return fieldNodeMayBelongToObject(pag, fieldRef, ownerObjId);
    }
    const carrierIds = collectCarrierNodeIdsForValueAtStmt(pag, base, stmt);
    return carrierIds.includes(ownerObjId);
}

function resolveFieldLoadRefForNode(
    pag: Pag,
    loadNodeId: number,
): { fieldRef: ArkInstanceFieldRef; stmt: any } | undefined {
    const node = pag.getNode(loadNodeId) as PagNode | undefined;
    if (!node) return undefined;
    const value = node.getValue?.();
    if (value instanceof ArkInstanceFieldRef) {
        return {
            fieldRef: value,
            stmt: node.getStmt?.(),
        };
    }
    if (value instanceof Local) {
        const declStmt = value.getDeclaringStmt?.();
        if (declStmt instanceof ArkAssignStmt && declStmt.getLeftOp?.() === value) {
            const right = declStmt.getRightOp?.();
            if (right instanceof ArkInstanceFieldRef) {
                return {
                    fieldRef: right,
                    stmt: declStmt,
                };
            }
        }
    }
    const stmt = node.getStmt?.();
    if (stmt instanceof ArkAssignStmt) {
        const right = stmt.getRightOp?.();
        if (right instanceof ArkInstanceFieldRef) {
            return {
                fieldRef: right,
                stmt,
            };
        }
    }
    return undefined;
}

function detectAllLiveFieldSourcesOnLoadedValue(
    loadNodeId: number,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult[] {
    const results: FieldPathDetectResult[] = [];
    const nodeCandidates = [loadNodeId];
    const loadNode = pag.getNode(loadNodeId) as PagNode | undefined;
    if (loadNode?.getPointTo) {
        for (const objId of loadNode.getPointTo()) {
            nodeCandidates.push(objId);
        }
    }

    for (const candidateNodeId of nodeCandidates) {
        const fieldSources = tracker.getFieldSourcesAnyContext(candidateNodeId)
            .sort((a, b) => a.fieldPath.length - b.fieldPath.length || a.fieldPath.join(".").localeCompare(b.fieldPath.join(".")));
        for (const item of fieldSources) {
            if (!isCarrierFieldPathLiveAtStmt(pag, tracker, candidateNodeId, item.fieldPath, anchorStmt)) continue;
            results.push({
                source: item.source,
                nodeId: candidateNodeId,
                fieldPath: [...item.fieldPath],
            });
        }
    }

    return results;
}

function detectAnyLiveFieldSourceOnLoadedValue(
    loadNodeId: number,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult | undefined {
    const nodeCandidates = [loadNodeId];
    const loadNode = pag.getNode(loadNodeId) as PagNode | undefined;
    if (loadNode?.getPointTo) {
        for (const objId of loadNode.getPointTo()) {
            nodeCandidates.push(objId);
        }
    }

    for (const candidateNodeId of nodeCandidates) {
        const fieldSources = tracker.getFieldSourcesAnyContext(candidateNodeId)
            .sort((a, b) => a.fieldPath.length - b.fieldPath.length || a.fieldPath.join(".").localeCompare(b.fieldPath.join(".")));
        for (const item of fieldSources) {
            if (!isCarrierFieldPathLiveAtStmt(pag, tracker, candidateNodeId, item.fieldPath, anchorStmt)) continue;
            return {
                source: item.source,
                nodeId: candidateNodeId,
                fieldPath: [...item.fieldPath],
            };
        }
    }

    return undefined;
}

function detectLiveDescendantFieldPathSource(
    nodeId: number,
    fieldPath: string[],
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult | undefined {
    const descendantSources = tracker.getFieldSourcesAnyContext(nodeId)
        .filter(item => isStrictFieldPathPrefix(fieldPath, item.fieldPath))
        .sort((a, b) => a.fieldPath.length - b.fieldPath.length || a.fieldPath.join(".").localeCompare(b.fieldPath.join(".")));
    for (const item of descendantSources) {
        if (!isCarrierFieldPathLiveAtStmt(pag, tracker, nodeId, item.fieldPath, anchorStmt)) continue;
        return {
            source: item.source,
            nodeId,
            fieldPath: [...item.fieldPath],
        };
    }
    return undefined;
}

function isStrictFieldPathPrefix(prefix: string[], fullPath: string[]): boolean {
    if (prefix.length === 0 || fullPath.length <= prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (prefix[i] !== fullPath[i]) return false;
    }
    return true;
}

function detectArrayContainerCarrierSource(
    rootValue: any,
    pag: Pag,
    tracker: TaintTracker,
): FieldPathDetectResult | undefined {
    const arrayRef = resolveArrayRefFromValue(rootValue);
    if (!arrayRef) return undefined;

    const candidatePaths = collectArrayRefPathKeys(arrayRef);
    if (candidatePaths.size === 0) return undefined;

    const rootNodes = pag.getNodesByValue(rootValue);
    if (!rootNodes || rootNodes.size === 0) return undefined;

    for (const rootNodeId of rootNodes.values()) {
        const rootNode = pag.getNode(rootNodeId) as PagNode;
        if (!rootNode) continue;
        for (const objId of rootNode.getPointTo()) {
            const fieldCarrier = selectArrayFieldSourceForCandidatePath(pag, tracker, objId, candidatePaths);
            if (!fieldCarrier) continue;
            return {
                source: fieldCarrier.source,
                nodeId: objId,
                fieldPath: fieldCarrier.fieldPath,
            };
        }
    }

    return undefined;
}

function selectArrayFieldSourceForCandidatePath(
    pag: Pag,
    tracker: TaintTracker,
    objId: number,
    candidatePaths: Set<string>,
): { source: string; fieldPath: string[] } | undefined {
    const objectPaths = collectArrayCarrierPathKeys(pag, objId);
    if (objectPaths.size === 0) return undefined;

    const fieldSources = tracker.getFieldSourcesAnyContext(objId);
    fieldSources.sort((a, b) => b.fieldPath.length - a.fieldPath.length);
    for (const fieldSource of fieldSources) {
        const sourcePaths = appendArrayFieldPathKeys(objectPaths, fieldSource.fieldPath);
        for (const candidatePath of candidatePaths) {
            for (const sourcePath of sourcePaths) {
                if (arrayPathCovers(candidatePath, sourcePath)) {
                    return fieldSource;
                }
            }
        }
    }

    return undefined;
}

function appendArrayFieldPathKeys(objectPaths: Set<string>, fieldPath: string[]): Set<string> {
    let keys = new Set<string>(objectPaths);
    let sawArraySlot = false;

    for (const segment of fieldPath) {
        const slot = fromContainerFieldKey(segment) || segment;
        if (!slot.startsWith("arr:")) continue;
        sawArraySlot = true;
        const index = slot.slice("arr:".length);
        const next = new Set<string>();
        for (const key of keys) {
            next.add(`${key}/${index}`);
        }
        keys = next;
    }

    return sawArraySlot ? keys : new Set<string>();
}

function arrayPathCovers(candidatePath: string, sourcePath: string): boolean {
    if (arrayPathPatternCovers(sourcePath, candidatePath)) return true;
    return arrayPathPatternCovers(candidatePath, sourcePath);
}

function arrayPathPatternCovers(pattern: string, concrete: string): boolean {
    if (pattern === concrete) return true;
    if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -2);
        return concrete === prefix || concrete.startsWith(`${prefix}/`);
    }
    return concrete.startsWith(`${pattern}/`);
}

function resolveArrayRefFromValue(value: any): ArkArrayRef | undefined {
    if (value instanceof ArkArrayRef) return value;
    if (!(value instanceof Local)) return undefined;
    const declStmt = value.getDeclaringStmt?.();
    if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== value) return undefined;
    const rightOp = declStmt.getRightOp();
    return rightOp instanceof ArkArrayRef ? rightOp : undefined;
}

function collectArrayCarrierPathKeys(pag: Pag, objId: number): Set<string> {
    const out = new Set<string>();
    for (const aliasLocal of collectAliasLocalsForCarrier(pag, objId)) {
        for (const key of collectArrayObjectPathKeys(aliasLocal, new Set<Local>())) {
            out.add(key);
        }
    }
    return out;
}

function collectArrayRefPathKeys(arrayRef: ArkArrayRef): Set<string> {
    const idx = resolveArrayValueKey(arrayRef.getIndex());
    if (idx === undefined) return new Set<string>();
    const base = arrayRef.getBase();
    if (!(base instanceof Local)) return new Set<string>();

    const out = new Set<string>();
    for (const key of collectArrayObjectPathKeys(base, new Set<Local>())) {
        out.add(`${key}/${idx}`);
    }
    return out;
}

function collectArrayObjectPathKeys(local: Local, visiting: Set<Local>): Set<string> {
    if (visiting.has(local)) {
        return new Set<string>([arrayRootPathKey(local)]);
    }
    visiting.add(local);

    const keys = new Set<string>();
    const decl = local.getDeclaringStmt?.();
    if (decl instanceof ArkAssignStmt && decl.getLeftOp() === local) {
        const right = decl.getRightOp();
        if (right instanceof Local) {
            mergeStringSet(keys, collectArrayObjectPathKeys(right, visiting));
        } else if (right instanceof ArkArrayRef) {
            const idx = resolveArrayValueKey(right.getIndex());
            if (idx !== undefined && right.getBase() instanceof Local) {
                for (const key of collectArrayObjectPathKeys(right.getBase(), visiting)) {
                    keys.add(`${key}/${idx}`);
                }
            } else {
                keys.add(arrayRootPathKey(local));
            }
        } else {
            keys.add(arrayRootPathKey(local));
        }
    } else {
        keys.add(arrayRootPathKey(local));
    }

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (stmt.getRightOp() !== local) continue;
        const idx = resolveArrayValueKey(left.getIndex());
        if (idx === undefined || !(left.getBase() instanceof Local)) continue;
        for (const key of collectArrayObjectPathKeys(left.getBase(), visiting)) {
            keys.add(`${key}/${idx}`);
        }
    }

    visiting.delete(local);
    return keys;
}

function arrayRootPathKey(local: Local): string {
    const line = local.getDeclaringStmt?.()?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1;
    const methodSig = local
        .getDeclaringStmt?.()
        ?.getCfg?.()
        ?.getDeclaringMethod?.()
        ?.getSignature?.()
        ?.toString?.() || "";
    return `${methodSig}::${local.getName?.() || local.toString?.() || ""}@${line}`;
}

function resolveArrayValueKey(value: any): string | undefined {
    if (typeof value?.toString !== "function") return undefined;
    const text = String(value.toString()).trim();
    if (!text) return undefined;
    if (/^-?\d+$/.test(text)) return text;
    if (/^['"`].*['"`]$/.test(text)) return text.slice(1, -1);
    if (value instanceof Local) {
        const decl = value.getDeclaringStmt?.();
        if (decl instanceof ArkAssignStmt) {
            const right = decl.getRightOp();
            if (typeof right?.toString === "function") {
                const rhsText = String(right.toString()).trim();
                if (/^-?\d+$/.test(rhsText)) return rhsText;
            }
        }
    }
    return undefined;
}

function mergeStringSet(target: Set<string>, src: Set<string>): void {
    for (const item of src) target.add(item);
}

function hasStringIntersection(a: Set<string>, b: Set<string>): boolean {
    for (const key of a) {
        if (b.has(key)) return true;
    }
    return false;
}

function parseSourceRuleId(source: string | undefined): string | undefined {
    if (!source || !source.startsWith("source_rule:")) return undefined;
    const raw = source.slice("source_rule:".length).trim();
    return raw.split("#occ=")[0]?.trim() || undefined;
}

