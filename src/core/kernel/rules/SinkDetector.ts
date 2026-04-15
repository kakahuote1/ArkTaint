import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagInstanceFieldNode, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkIfStmt, ArkInvokeStmt, ArkReturnStmt, ArkReturnVoidStmt, ArkThrowStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import {
    ArkCastExpr,
    ArkConditionExpr,
    ArkInstanceInvokeExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
    ArkNormalBinopExpr,
    ArkPtrInvokeExpr,
    ArkUnopExpr,
    NormalBinaryOperator,
    RelationalBinaryOperator,
    UnaryOperator,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { TaintTracker } from "../model/TaintTracker";
import { TaintFlow } from "../model/TaintFlow";
import { isCarrierFieldPathLiveAtStmt } from "../ordinary/OrdinaryObjectInvalidation";
import { collectAliasLocalsForCarrier, collectCarrierNodeIdsForValueAtStmt } from "../ordinary/OrdinaryAliasPropagation";
import { resolveOrdinaryArraySlotName } from "../ordinary/OrdinaryLanguagePropagation";
import {
    normalizeEndpoint,
    RuleEndpoint,
    RuleInvokeKind,
    RuleScopeConstraint,
    RuleStringConstraint,
    SanitizerRule
} from "../../rules/RuleSchema";
import { filterBestTierRulesByFamily } from "../../rules/RulePriority";
import { resolveReceiverGetterReturnFieldPath } from "../propagation/WorklistFieldPropagation";

export interface SinkDetectOptions {
    targetEndpoint?: RuleEndpoint;
    targetPath?: string[];
    invokeKind?: RuleInvokeKind;
    argCount?: number;
    typeHint?: string;
    signatureMatchMode?: "contains" | "equals";
    fieldToVarIndex?: Map<string, Set<number>>;
    allowedMethodSignatures?: Set<string>;
    orderedMethodSignatures?: string[];
    interproceduralTaintTargetNodeIds?: Set<number>;
    sanitizerRules?: SanitizerRule[];
    onProfile?: (profile: SinkDetectProfile) => void;
}

interface SinkCandidate {
    value: any;
    kind: "arg" | "base" | "result";
    endpoint: string;
}

interface FieldPathDetectResult {
    source: string;
    nodeId?: number;
    fieldPath?: string[];
}

interface IndexedInvokeSite {
    method: any;
    stmt: any;
    invokeExpr: any;
    calleeSignature: string;
}

interface SinkCallsiteIndex {
    methodCount: number;
    reachableMethodCount: number;
    stmtCount: number;
    invokeStmtCount: number;
    sites: IndexedInvokeSite[];
    signatureMatchCache: Map<string, IndexedInvokeSite[]>;
}

const sinkCallsiteIndexCache: WeakMap<Scene, Map<string, SinkCallsiteIndex>> = new WeakMap();

export interface SinkDetectProfile {
    detectCallCount: number;
    methodsVisited: number;
    reachableMethodsVisited: number;
    stmtsVisited: number;
    invokeStmtsVisited: number;
    signatureMatchedInvokeCount: number;
    constraintRejectedInvokeCount: number;
    sinksChecked: number;
    candidateCount: number;
    taintCheckCount: number;
    defReachabilityCheckCount: number;
    fieldPathCheckCount: number;
    fieldPathHitCount: number;
    sanitizerGuardCheckCount: number;
    sanitizerGuardHitCount: number;
    signatureMatchMs: number;
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
        signatureMatchedInvokeCount: 0,
        constraintRejectedInvokeCount: 0,
        sinksChecked: 0,
        candidateCount: 0,
        taintCheckCount: 0,
        defReachabilityCheckCount: 0,
        fieldPathCheckCount: 0,
        fieldPathHitCount: 0,
        sanitizerGuardCheckCount: 0,
        sanitizerGuardHitCount: 0,
        signatureMatchMs: 0,
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
        signatureMatchedInvokeCount: base.signatureMatchedInvokeCount + extra.signatureMatchedInvokeCount,
        constraintRejectedInvokeCount: base.constraintRejectedInvokeCount + extra.constraintRejectedInvokeCount,
        sinksChecked: base.sinksChecked + extra.sinksChecked,
        candidateCount: base.candidateCount + extra.candidateCount,
        taintCheckCount: base.taintCheckCount + extra.taintCheckCount,
        defReachabilityCheckCount: base.defReachabilityCheckCount + extra.defReachabilityCheckCount,
        fieldPathCheckCount: base.fieldPathCheckCount + extra.fieldPathCheckCount,
        fieldPathHitCount: base.fieldPathHitCount + extra.fieldPathHitCount,
        sanitizerGuardCheckCount: base.sanitizerGuardCheckCount + extra.sanitizerGuardCheckCount,
        sanitizerGuardHitCount: base.sanitizerGuardHitCount + extra.sanitizerGuardHitCount,
        signatureMatchMs: base.signatureMatchMs + extra.signatureMatchMs,
        candidateResolveMs: base.candidateResolveMs + extra.candidateResolveMs,
        taintEvalMs: base.taintEvalMs + extra.taintEvalMs,
        sanitizerGuardMs: base.sanitizerGuardMs + extra.sanitizerGuardMs,
        traversalMs: base.traversalMs + extra.traversalMs,
        totalMs: base.totalMs + extra.totalMs,
    };
}

export function detectSinks(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    tracker: TaintTracker,
    sinkSignature: string,
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
    const fieldToVarIndex = options.targetPath && options.targetPath.length > 0
        ? (options.fieldToVarIndex || buildFieldToVarIndexFromPag(pag))
        : undefined;
    let fallbackFieldToVarIndex: Map<string, Set<number>> | undefined;

    log(`\n=== Detecting sinks for: "${sinkSignature}" ===`);
    let sinksChecked = 0;

    const index = getOrBuildSinkCallsiteIndex(scene, options.allowedMethodSignatures);
    profile.methodsVisited += index.methodCount;
    profile.reachableMethodsVisited += index.reachableMethodCount;
    profile.stmtsVisited += index.stmtCount;
    profile.invokeStmtsVisited += index.invokeStmtCount;
    const matchedSites = getOrBuildSignatureMatchedSites(index, sinkSignature, options.signatureMatchMode || "contains");
    profile.signatureMatchedInvokeCount += matchedSites.length;

    for (const site of matchedSites) {
        const method = site.method;
        const stmt = site.stmt;
        const invokeExpr = site.invokeExpr;
        const calleeSignature = site.calleeSignature;
        log(`Checking method "${method.getName()}" for sinks...`);

        const constraintT0 = process.hrtime.bigint();
        if (!matchesInvokeConstraints(invokeExpr, calleeSignature, options)) {
            profile.signatureMatchMs += elapsedMsSince(constraintT0);
            profile.constraintRejectedInvokeCount++;
            continue;
        }
        profile.signatureMatchMs += elapsedMsSince(constraintT0);

        sinksChecked++;
        profile.sinksChecked++;
        log(`  Found sink call: ${calleeSignature}`);

        const resolveT0 = process.hrtime.bigint();
        const candidates = resolveSinkCandidates(stmt, invokeExpr, options.targetEndpoint);
        profile.candidateResolveMs += elapsedMsSince(resolveT0);
        if (candidates.length === 0) {
            continue;
        }
        profile.candidateCount += candidates.length;
        let sinkDetected = false;
        for (const candidate of candidates) {
            if (options.targetPath && options.targetPath.length > 0 && fieldToVarIndex) {
                profile.fieldPathCheckCount++;
                const fieldPathT0 = process.hrtime.bigint();
                const fieldPathResult = detectFieldPathSource(candidate.value, options.targetPath, stmt, pag, tracker, fieldToVarIndex);
                profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                if (fieldPathResult) {
                    profile.sanitizerGuardCheckCount++;
                    const sanitizerT0 = process.hrtime.bigint();
                    const sanitizerResult = isSinkCandidateSanitizedByRules(
                        method,
                        stmt,
                        candidate,
                        options.sanitizerRules || [],
                        log
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        continue;
                    }
                    profile.fieldPathHitCount++;
                    log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (field path: ${options.targetPath.join(".")}) ***`);
                    flows.push(new TaintFlow(fieldPathResult.source, stmt, {
                        sinkEndpoint: candidate.endpoint,
                        sinkNodeId: fieldPathResult.nodeId,
                        sinkFieldPath: fieldPathResult.fieldPath,
                    }));
                    sinkDetected = true;
                    break;
                }
                continue;
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
                fallbackFieldToVarIndex,
            );
            fallbackFieldToVarIndex = preciseCandidate.fallbackFieldToVarIndex;
            if (preciseCandidate.result) {
                profile.sanitizerGuardCheckCount++;
                const sanitizerT0 = process.hrtime.bigint();
                const sanitizerResult = isSinkCandidateSanitizedByRules(
                    method,
                    stmt,
                    candidate,
                    options.sanitizerRules || [],
                    log
                );
                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                if (sanitizerResult.sanitized) {
                    profile.sanitizerGuardHitCount++;
                    continue;
                }
                log(`    *** TAINT FLOW DETECTED! Source: ${preciseCandidate.result.source} (precise sink semantics) ***`);
                flows.push(new TaintFlow(preciseCandidate.result.source, stmt, {
                    sinkEndpoint: candidate.endpoint,
                    sinkNodeId: preciseCandidate.result.nodeId,
                    sinkFieldPath: preciseCandidate.result.fieldPath,
                }));
                sinkDetected = true;
                break;
            }
            if (preciseCandidate.blockGenericNodeTaint) {
                continue;
            }

            const pagLookupT0 = process.hrtime.bigint();
            const pagNodes = pag.getNodesByValue(candidate.value);
            profile.taintEvalMs += elapsedMsSince(pagLookupT0);
            if (!pagNodes || pagNodes.size === 0) {
                if (candidate.value instanceof Local) {
                    const declStmt = candidate.value.getDeclaringStmt?.();
                    if (declStmt instanceof ArkAssignStmt && declStmt.getLeftOp() === candidate.value) {
                        const rightOp = declStmt.getRightOp();
                        if (rightOp instanceof ArkInstanceFieldRef) {
                            const fieldName = rightOp.getFieldSignature().getFieldName();
                            if (!fallbackFieldToVarIndex) {
                                fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
                            }
                            const fieldPathT0 = process.hrtime.bigint();
                            const fieldPathResult = detectFieldPathSource(
                                rightOp,
                                [fieldName],
                                declStmt,
                                pag,
                                tracker,
                                fallbackFieldToVarIndex
                            );
                            profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                            if (fieldPathResult) {
                                profile.sanitizerGuardCheckCount++;
                                const sanitizerT0 = process.hrtime.bigint();
                                const sanitizerResult = isSinkCandidateSanitizedByRules(
                                    method,
                                    stmt,
                                    candidate,
                                    options.sanitizerRules || [],
                                    log
                                );
                                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                                if (sanitizerResult.sanitized) {
                                    profile.sanitizerGuardHitCount++;
                                    continue;
                                }
                                log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (local-from-field fallback: ${fieldName}) ***`);
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
                                    options.sanitizerRules || [],
                                    log
                                );
                                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                                if (sanitizerResult.sanitized) {
                                    profile.sanitizerGuardHitCount++;
                                    continue;
                                }
                                log(`    *** TAINT FLOW DETECTED! Source: ${carrierFieldResult.source} (local-from-array fallback: ${slotName}) ***`);
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
                    if (!fallbackFieldToVarIndex) {
                        fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
                    }
                    const fieldPathT0 = process.hrtime.bigint();
                    const fieldPathResult = detectFieldPathSource(
                        candidate.value,
                        [fieldName],
                        stmt,
                        pag,
                        tracker,
                        fallbackFieldToVarIndex
                    );
                    profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                    if (fieldPathResult) {
                        profile.sanitizerGuardCheckCount++;
                        const sanitizerT0 = process.hrtime.bigint();
                        const sanitizerResult = isSinkCandidateSanitizedByRules(
                            method,
                            stmt,
                            candidate,
                            options.sanitizerRules || [],
                            log
                        );
                        profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                        if (sanitizerResult.sanitized) {
                            profile.sanitizerGuardHitCount++;
                            continue;
                        }
                        log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (field fallback: ${fieldName}) ***`);
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
                if (declStmt instanceof ArkAssignStmt && declStmt.getLeftOp() === candidate.value) {
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
                                options.sanitizerRules || [],
                                log
                            );
                            profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                            if (sanitizerResult.sanitized) {
                                profile.sanitizerGuardHitCount++;
                                continue;
                            }
                            log(`    *** TAINT FLOW DETECTED! Source: ${carrierFieldResult.source} (loaded-field carrier fallback: ${fieldName}) ***`);
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
                                options.sanitizerRules || [],
                                log
                            );
                            profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                            if (sanitizerResult.sanitized) {
                                profile.sanitizerGuardHitCount++;
                                continue;
                            }
                            log(`    *** TAINT FLOW DETECTED! Source: ${carrierFieldResult.source} (loaded-array carrier fallback: ${slotName}) ***`);
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
                if (!isTainted) continue;
                const source = tracker.getSourceAnyContext(nodeId)!;

                profile.sanitizerGuardCheckCount++;
                const sanitizerT0 = process.hrtime.bigint();
                const sanitizerResult = isSinkCandidateSanitizedByRules(
                    method,
                    stmt,
                    candidate,
                    options.sanitizerRules || [],
                    log
                );
                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                if (sanitizerResult.sanitized) {
                    profile.sanitizerGuardHitCount++;
                    continue;
                }
                log(`    *** TAINT FLOW DETECTED! Source: ${source} ***`);
                flows.push(new TaintFlow(source, stmt, {
                    sinkEndpoint: candidate.endpoint,
                    sinkNodeId: nodeId,
                }));
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
                        if (!isTainted) continue;
                        const source = tracker.getSourceAnyContext(carrierNodeId);
                        if (!source) continue;

                        profile.sanitizerGuardCheckCount++;
                        const sanitizerT0 = process.hrtime.bigint();
                        const sanitizerResult = isSinkCandidateSanitizedByRules(
                            method,
                            stmt,
                            candidate,
                            options.sanitizerRules || [],
                            log
                        );
                        profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                        if (sanitizerResult.sanitized) {
                            profile.sanitizerGuardHitCount++;
                            continue;
                        }
                        log(`    *** TAINT FLOW DETECTED! Source: ${source} (local carrier fallback) ***`);
                        flows.push(new TaintFlow(source, stmt, {
                            sinkEndpoint: candidate.endpoint,
                            sinkNodeId: carrierNodeId,
                        }));
                        sinkDetected = true;
                        break;
                    }
                }
            }
            if (!sinkDetected && candidate.value instanceof ArkInstanceFieldRef) {
                const fieldName = candidate.value.getFieldSignature().getFieldName();
                if (!fallbackFieldToVarIndex) {
                    fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
                }
                const fieldPathT0 = process.hrtime.bigint();
                const fieldPathResult = detectFieldPathSource(
                    candidate.value,
                    [fieldName],
                    stmt,
                    pag,
                    tracker,
                    fallbackFieldToVarIndex
                );
                profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                if (fieldPathResult) {
                    profile.sanitizerGuardCheckCount++;
                    const sanitizerT0 = process.hrtime.bigint();
                    const sanitizerResult = isSinkCandidateSanitizedByRules(
                        method,
                        stmt,
                        candidate,
                        options.sanitizerRules || [],
                        log
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        continue;
                    }
                    log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (field fallback: ${fieldName}) ***`);
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
                        options.sanitizerRules || [],
                        log
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        continue;
                    }
                    log(`    *** TAINT FLOW DETECTED! Source: ${arrayCarrierResult.source} (array-container fallback) ***`);
                    flows.push(new TaintFlow(arrayCarrierResult.source, stmt, {
                        sinkEndpoint: candidate.endpoint,
                        sinkNodeId: arrayCarrierResult.nodeId,
                        sinkFieldPath: arrayCarrierResult.fieldPath,
                    }));
                    sinkDetected = true;
                }
            }
            if (sinkDetected) break;
        }
    }

    profile.totalMs = elapsedMsSince(detectStart);
    const profiledDetailMs = profile.signatureMatchMs
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
    fallbackFieldToVarIndex?: Map<string, Set<number>>;
}

type PathSensitiveLocalTaintState = "tainted" | "clean" | "unknown";

type PathSensitiveConstValue =
    | { kind: "unknown" }
    | { kind: "boolean"; value: boolean }
    | { kind: "number"; value: number }
    | { kind: "string"; value: string }
    | { kind: "undefined" }
    | { kind: "null" };

interface PathSensitiveLocalTaintResult {
    resolved: boolean;
    tainted: boolean;
}

interface PathSensitiveExecState {
    block: any;
    constEnv: Map<string, PathSensitiveConstValue>;
    taintEnv: Map<string, PathSensitiveLocalTaintState>;
    symbolEnv: Map<string, string>;
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
    fallbackFieldToVarIndex?: Map<string, Set<number>>,
): PreciseCandidateDetectResult {
    const value = candidate.value;
    if (value instanceof ArkInstanceFieldRef) {
        return detectReceiverFieldCandidateSource(
            method,
            sinkStmt,
            value.getBase(),
            [value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.()].filter((name): name is string => !!name),
            scene,
            pag,
            tracker,
            orderedMethodSignatures,
            fallbackFieldToVarIndex,
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
                fallbackFieldToVarIndex,
            );
        }
    }
    if (!(value instanceof Local)) {
        return {
            blockGenericNodeTaint: false,
            fallbackFieldToVarIndex,
        };
    }

    const pathSensitiveLocalTaint = resolvePathSensitiveLocalTaintAtStmt(
        scene,
        method,
        value,
        sinkStmt,
        pag,
        tracker,
    );
    const allowInterproceduralGenericNodeTaint = hasInterproceduralTaintTargetNode(
        value,
        pag,
        interproceduralTaintTargetNodeIds,
    );
    if (pathSensitiveLocalTaint.resolved && !pathSensitiveLocalTaint.tainted) {
        return {
            blockGenericNodeTaint: !allowInterproceduralGenericNodeTaint,
            fallbackFieldToVarIndex,
        };
    }

    const latestAssign = findLatestAssignStmtForLocalBefore(method, value, sinkStmt);
    if (!(latestAssign instanceof ArkAssignStmt)) {
        return {
            blockGenericNodeTaint: false,
            fallbackFieldToVarIndex,
        };
    }
    const hasNonConstantReachingAssign = hasNonConstantReachingAssignAtStmt(method, value, sinkStmt, latestAssign);

    const rightOp = latestAssign.getRightOp();
    if (rightOp instanceof Constant || rightOp === undefined || rightOp === null) {
        return {
            blockGenericNodeTaint: allowInterproceduralGenericNodeTaint
                ? false
                : pathSensitiveLocalTaint.resolved
                ? !pathSensitiveLocalTaint.tainted
                : !hasNonConstantReachingAssign && collectReachingAssignStmtsForLocalAtStmt(method, value, sinkStmt).length > 0,
            fallbackFieldToVarIndex,
        };
    }

    if (rightOp instanceof ArkInstanceInvokeExpr) {
        const getterFieldPath = resolveReceiverGetterReturnFieldPath(
            scene,
            rightOp.getMethodSignature?.()?.toString?.() || "",
        );
        if (!getterFieldPath || getterFieldPath.length === 0) {
            return {
                blockGenericNodeTaint: false,
                fallbackFieldToVarIndex,
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
                    fallbackFieldToVarIndex,
                };
            }
            if (!hasPriorStore && hasFutureStore) {
                if (!fallbackFieldToVarIndex) {
                    fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
                }
                const earlyFieldPathResult = detectFieldPathSource(
                    receiverBase,
                    getterFieldPath,
                    sinkStmt,
                    pag,
                    tracker,
                    fallbackFieldToVarIndex,
                );
                if (earlyFieldPathResult) {
                    return {
                        result: earlyFieldPathResult,
                        blockGenericNodeTaint: false,
                        fallbackFieldToVarIndex,
                    };
                }
                return {
                    blockGenericNodeTaint: true,
                    fallbackFieldToVarIndex,
                };
            }
            if (hasOrderedConstantOverwrite && !hasPriorStore) {
                return {
                    blockGenericNodeTaint: true,
                    fallbackFieldToVarIndex,
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
                fallbackFieldToVarIndex,
            };
        }
        const allDead = carrierIds.length > 0
            && carrierIds.every(carrierId => !isCarrierFieldPathLiveAtStmt(pag, tracker, carrierId, getterFieldPath, sinkStmt));
        if (allDead) {
            return {
                // Field-path fallback must not revive a carrier path that was already
                // proven dead at the sink due to delete/overwrite invalidation.
                blockGenericNodeTaint: hasPriorStore || hasOrderedConstantOverwrite,
                fallbackFieldToVarIndex,
            };
        }
        if (!fallbackFieldToVarIndex) {
            fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
        }
        const getterFieldPathResult = detectFieldPathSource(
            receiverBase,
            getterFieldPath,
            sinkStmt,
            pag,
            tracker,
            fallbackFieldToVarIndex,
        );
        if (getterFieldPathResult) {
            return {
                result: getterFieldPathResult,
                blockGenericNodeTaint: false,
                fallbackFieldToVarIndex,
            };
        }
        return {
            // Only suppress generic node taint when this method itself establishes
            // a prior store for the same receiver field and the field path is now dead.
            // If there is no local store evidence, the value may come from cross-method
            // object state that ordinary propagation already modeled correctly.
            blockGenericNodeTaint: hasOrderedConstantOverwrite || (allDead && hasPriorStore),
            fallbackFieldToVarIndex,
        };
    }

    if (rightOp instanceof ArkInstanceFieldRef) {
        const fieldName = rightOp.getFieldSignature?.().getFieldName?.() || rightOp.getFieldName?.();
        if (!fieldName) {
            return {
                blockGenericNodeTaint: false,
                fallbackFieldToVarIndex,
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
                fallbackFieldToVarIndex,
            };
        }
        if (!hasPriorStore && hasFutureStore) {
            if (!fallbackFieldToVarIndex) {
                fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
            }
            const earlyFieldPathResult = detectFieldPathSource(
                receiverBase,
                [fieldName],
                sinkStmt,
                pag,
                tracker,
                fallbackFieldToVarIndex,
            );
            if (earlyFieldPathResult) {
                return {
                    result: earlyFieldPathResult,
                    blockGenericNodeTaint: false,
                    fallbackFieldToVarIndex,
                };
            }
            return {
                blockGenericNodeTaint: true,
                fallbackFieldToVarIndex,
            };
        }
        if (hasOrderedConstantOverwrite && !hasPriorStore) {
            return {
                blockGenericNodeTaint: true,
                fallbackFieldToVarIndex,
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
                fallbackFieldToVarIndex,
            };
        }
        const allDead = carrierIds.length > 0
            && carrierIds.every(carrierId => !isCarrierFieldPathLiveAtStmt(pag, tracker, carrierId, [fieldName], sinkStmt));
        if (allDead) {
            return {
                blockGenericNodeTaint: hasPriorStore || hasOrderedConstantOverwrite,
                fallbackFieldToVarIndex,
            };
        }
        if (!fallbackFieldToVarIndex) {
            fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
        }
        const fieldPathResult = detectFieldPathSource(
            receiverBase,
            [fieldName],
            sinkStmt,
            pag,
            tracker,
            fallbackFieldToVarIndex,
        );
        if (fieldPathResult) {
            return {
                result: fieldPathResult,
                blockGenericNodeTaint: false,
                fallbackFieldToVarIndex,
            };
        }
        return {
            blockGenericNodeTaint: hasOrderedConstantOverwrite || (allDead && hasPriorStore),
            fallbackFieldToVarIndex,
        };
    }

    return {
        blockGenericNodeTaint: false,
        fallbackFieldToVarIndex,
    };
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

function resolvePathSensitiveLocalTaintAtStmt(
    scene: Scene,
    method: any,
    local: Local,
    anchorStmt: any,
    pag: Pag,
    tracker: TaintTracker,
): PathSensitiveLocalTaintResult {
    const cfg = method?.getCfg?.() || anchorStmt?.getCfg?.();
    const startBlock = cfg?.getStartingBlock?.();
    const anchorBlock = cfg?.getStmtToBlock?.()?.get?.(anchorStmt);
    if (!cfg || !startBlock || !anchorBlock) {
        return { resolved: false, tainted: false };
    }
    const anchorGraphReachable = isPathSensitiveBlockGraphReachable(startBlock, anchorBlock);

    const worklist: PathSensitiveExecState[] = [{
        block: startBlock,
        constEnv: new Map<string, PathSensitiveConstValue>(),
        taintEnv: new Map<string, PathSensitiveLocalTaintState>(),
        symbolEnv: new Map<string, string>(),
    }];
    const visited = new Set<string>();
    const targetLocalName = local.getName?.() || "";
    let reachedAnchor = false;
    let sawTainted = false;
    let sawUnknown = false;
    let encounteredUnknownBranch = false;
    let processedStates = 0;
    const maxStates = 1024;

    while (worklist.length > 0) {
        if (processedStates++ > maxStates) {
            return { resolved: false, tainted: false };
        }

        const state = worklist.pop()!;
        const stateKey = serializePathSensitiveExecState(state, targetLocalName);
        if (visited.has(stateKey)) {
            continue;
        }
        visited.add(stateKey);

        const stmts: any[] = state.block.getStmts?.() || [];
        let terminated = false;

        for (const stmt of stmts) {
            if (stmt === anchorStmt) {
                reachedAnchor = true;
                const taintState = state.taintEnv.get(targetLocalName) || "clean";
                if (taintState === "tainted") {
                    sawTainted = true;
                } else if (taintState === "unknown") {
                    sawUnknown = true;
                }
                continue;
            }

            if (stmt instanceof ArkAssignStmt) {
                const left = stmt.getLeftOp?.();
                if (left instanceof Local) {
                    const resolved = resolveAssignedLocalState(
                        scene,
                        method,
                        left,
                        stmt.getRightOp?.(),
                        state,
                        pag,
                        tracker,
                    );
                    state.constEnv.set(left.getName(), resolved.constValue);
                    state.taintEnv.set(left.getName(), resolved.taintState);
                    if (resolved.symbolId) {
                        state.symbolEnv.set(left.getName(), resolved.symbolId);
                    } else {
                        state.symbolEnv.delete(left.getName());
                    }
                }
                continue;
            }

            if (stmt instanceof ArkIfStmt) {
                const successors = state.block.getSuccessors?.() || [];
                const conditionValue = resolveConditionExprValue(
                    stmt.getConditionExpr?.(),
                    state.constEnv,
                    state.symbolEnv,
                );
                if (conditionValue.kind === "boolean") {
                    const chosen = conditionValue.value ? successors[0] : successors[1];
                    if (chosen) {
                        worklist.push(clonePathSensitiveExecState(state, chosen));
                    }
                } else {
                    encounteredUnknownBranch = true;
                    for (const successor of successors) {
                        worklist.push(clonePathSensitiveExecState(state, successor));
                    }
                }
                terminated = true;
                break;
            }

            if (stmt instanceof ArkThrowStmt) {
                const exceptionalSuccessors = state.block.getExceptionalSuccessorBlocks?.() || [];
                for (const successor of exceptionalSuccessors) {
                    worklist.push(clonePathSensitiveExecState(state, successor));
                }
                terminated = true;
                break;
            }

            if (stmt instanceof ArkReturnStmt || stmt instanceof ArkReturnVoidStmt) {
                terminated = true;
                break;
            }
        }

        if (terminated) {
            continue;
        }

        for (const successor of state.block.getSuccessors?.() || []) {
            worklist.push(clonePathSensitiveExecState(state, successor));
        }
    }

    if (sawTainted) {
        return { resolved: true, tainted: true };
    }
    if (sawUnknown) {
        return { resolved: false, tainted: false };
    }
    if (reachedAnchor) {
        return { resolved: true, tainted: false };
    }
    if (encounteredUnknownBranch) {
        return { resolved: false, tainted: false };
    }
    if (!anchorGraphReachable) {
        return { resolved: false, tainted: false };
    }
    return { resolved: true, tainted: false };
}

function isPathSensitiveBlockGraphReachable(
    startBlock: any,
    targetBlock: any,
): boolean {
    if (!startBlock || !targetBlock) {
        return false;
    }
    const worklist = [startBlock];
    const visited = new Set<any>();
    while (worklist.length > 0) {
        const block = worklist.pop();
        if (!block || visited.has(block)) {
            continue;
        }
        if (block === targetBlock) {
            return true;
        }
        visited.add(block);
        for (const successor of block.getSuccessors?.() || []) {
            worklist.push(successor);
        }
        for (const successor of block.getExceptionalSuccessorBlocks?.() || []) {
            worklist.push(successor);
        }
    }
    return false;
}

function clonePathSensitiveExecState(
    state: PathSensitiveExecState,
    nextBlock: any,
): PathSensitiveExecState {
    return {
        block: nextBlock,
        constEnv: new Map<string, PathSensitiveConstValue>(state.constEnv),
        taintEnv: new Map<string, PathSensitiveLocalTaintState>(state.taintEnv),
        symbolEnv: new Map<string, string>(state.symbolEnv),
    };
}

function serializePathSensitiveExecState(
    state: PathSensitiveExecState,
    targetLocalName: string,
): string {
    const blockId = state.block?.getId?.() ?? -1;
    const constKeys = [...state.constEnv.keys()].sort();
    const taintKeys = [...state.taintEnv.keys()].sort();
    const symbolKeys = [...state.symbolEnv.keys()].sort();
    const constPart = constKeys
        .map(key => `${key}:${serializePathSensitiveConstValue(state.constEnv.get(key) || { kind: "unknown" })}`)
        .join("|");
    const taintPart = taintKeys
        .map(key => `${key}:${state.taintEnv.get(key) || "clean"}`)
        .join("|");
    const symbolPart = symbolKeys
        .map(key => `${key}:${state.symbolEnv.get(key) || ""}`)
        .join("|");
    return `${blockId}#${targetLocalName}#${constPart}#${taintPart}#${symbolPart}`;
}

function serializePathSensitiveConstValue(value: PathSensitiveConstValue): string {
    switch (value.kind) {
        case "boolean":
            return value.value ? "true" : "false";
        case "number":
            return `num:${value.value}`;
        case "string":
            return `str:${value.value}`;
        case "undefined":
            return "undefined";
        case "null":
            return "null";
        default:
            return "unknown";
    }
}

function resolveAssignedLocalState(
    scene: Scene,
    method: any,
    left: Local,
    right: any,
    state: PathSensitiveExecState,
    pag: Pag,
    tracker: TaintTracker,
): {
    constValue: PathSensitiveConstValue;
    taintState: PathSensitiveLocalTaintState;
    symbolId?: string;
} {
    if (right instanceof Constant) {
        return {
            constValue: resolveConstantValue(right),
            taintState: "clean",
            symbolId: `const:${serializePathSensitiveConstValue(resolveConstantValue(right))}`,
        };
    }

    if (right instanceof Local) {
        return {
            constValue: state.constEnv.get(right.getName?.() || "") || { kind: "unknown" },
            taintState: state.taintEnv.get(right.getName?.() || "") || "clean",
            symbolId: state.symbolEnv.get(right.getName?.() || ""),
        };
    }

    if (right instanceof ArkParameterRef) {
        return {
            constValue: resolveParameterRefConstValue(scene, method, right.getIndex?.()),
            taintState: isLocalTaintedAnyContext(left, pag, tracker) ? "tainted" : "clean",
            symbolId: `param:${right.getIndex?.()}`,
        };
    }

    if (right instanceof ArkCastExpr) {
        return resolveAssignedLocalState(scene, method, left, right.getOp?.(), state, pag, tracker);
    }

    if (right instanceof ArkConditionExpr || right instanceof ArkNormalBinopExpr) {
        return resolveAssignedLocalStateFromExpr(left, right, state, pag, tracker);
    }

    if (right instanceof ArkUnopExpr) {
        return resolveAssignedLocalStateFromExpr(left, right, state, pag, tracker);
    }

    return {
        constValue: { kind: "unknown" },
        taintState: "unknown",
        symbolId: undefined,
    };
}

function resolveParameterRefConstValue(
    scene: Scene,
    method: any,
    paramIndex: number | undefined,
): PathSensitiveConstValue {
    if (!Number.isFinite(paramIndex)) {
        return { kind: "unknown" };
    }
    const methodSignature = method?.getSignature?.()?.toString?.() || "";
    if (!methodSignature) {
        return { kind: "unknown" };
    }

    let resolved: PathSensitiveConstValue | undefined;
    for (const candidateMethod of scene.getMethods()) {
        const cfg = candidateMethod.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt?.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            const calleeSignature = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
            if (calleeSignature !== methodSignature) continue;
            const args = invokeExpr.getArgs?.() || [];
            if (paramIndex! < 0 || paramIndex! >= args.length) continue;
            const constValue = resolveValueConstValue(
                args[paramIndex!],
                new Map<string, PathSensitiveConstValue>(),
                new Map<string, string>()
            );
            if (constValue.kind === "unknown") {
                return { kind: "unknown" };
            }
            if (!resolved) {
                resolved = constValue;
                continue;
            }
            if (serializePathSensitiveConstValue(resolved) !== serializePathSensitiveConstValue(constValue)) {
                return { kind: "unknown" };
            }
        }
    }

    return resolved || { kind: "unknown" };
}

function resolveAssignedLocalStateFromExpr(
    left: Local,
    expr: ArkConditionExpr | ArkNormalBinopExpr | ArkUnopExpr,
    state: PathSensitiveExecState,
    pag: Pag,
    tracker: TaintTracker,
): {
    constValue: PathSensitiveConstValue;
    taintState: PathSensitiveLocalTaintState;
    symbolId?: string;
} {
    const constValue = resolveExprConstValue(expr, state.constEnv, state.symbolEnv);
    const taintState = resolveExprTaintState(expr, state.taintEnv);
    if (taintState !== "unknown") {
        return { constValue, taintState };
    }
    return {
        constValue,
        taintState: isLocalTaintedAnyContext(left, pag, tracker) ? "tainted" : "unknown",
        symbolId: undefined,
    };
}

function resolveExprTaintState(
    expr: ArkConditionExpr | ArkNormalBinopExpr | ArkUnopExpr,
    taintEnv: Map<string, PathSensitiveLocalTaintState>,
): PathSensitiveLocalTaintState {
    const uses = expr.getUses?.() || [];
    let sawUnknown = false;
    for (const use of uses) {
        if (!(use instanceof Local)) {
            continue;
        }
        const state = taintEnv.get(use.getName?.() || "") || "clean";
        if (state === "tainted") {
            return "tainted";
        }
        if (state === "unknown") {
            sawUnknown = true;
        }
    }
    return sawUnknown ? "unknown" : "clean";
}

function resolveConditionExprValue(
    expr: ArkConditionExpr | undefined,
    constEnv: Map<string, PathSensitiveConstValue>,
    symbolEnv: Map<string, string>,
): PathSensitiveConstValue {
    if (!expr) {
        return { kind: "unknown" };
    }
    return resolveExprConstValue(expr, constEnv, symbolEnv);
}

function resolveExprConstValue(
    expr: ArkConditionExpr | ArkNormalBinopExpr | ArkUnopExpr,
    constEnv: Map<string, PathSensitiveConstValue>,
    symbolEnv: Map<string, string>,
): PathSensitiveConstValue {
    if (expr instanceof ArkConditionExpr || expr instanceof ArkNormalBinopExpr) {
        const leftValue = expr.getOp1?.();
        const rightValue = expr.getOp2?.();
        const left = resolveValueConstValue(leftValue, constEnv, symbolEnv);
        const right = resolveValueConstValue(rightValue, constEnv, symbolEnv);
        const direct = applyBinaryConstOperator(left, right, expr.getOperator?.());
        if (direct.kind !== "unknown") {
            return direct;
        }
        if (expr instanceof ArkConditionExpr) {
            const leftSymbol = resolveValueSymbolId(leftValue, symbolEnv);
            const rightSymbol = resolveValueSymbolId(rightValue, symbolEnv);
            if (leftSymbol && rightSymbol && leftSymbol === rightSymbol) {
                const operator = expr.getOperator?.();
                if (
                    operator === RelationalBinaryOperator.Equality
                    || operator === RelationalBinaryOperator.StrictEquality
                ) {
                    return { kind: "boolean", value: true };
                }
                if (
                    operator === RelationalBinaryOperator.InEquality
                    || operator === RelationalBinaryOperator.StrictInequality
                ) {
                    return { kind: "boolean", value: false };
                }
            }
        }
        return { kind: "unknown" };
    }
    if (expr instanceof ArkUnopExpr) {
        const operand = resolveValueConstValue(expr.getOp?.(), constEnv, symbolEnv);
        return applyUnaryConstOperator(operand, expr.getOperator?.());
    }
    return { kind: "unknown" };
}

function resolveValueConstValue(
    value: any,
    constEnv: Map<string, PathSensitiveConstValue>,
    symbolEnv: Map<string, string>,
): PathSensitiveConstValue {
    if (value instanceof Constant) {
        return resolveConstantValue(value);
    }
    if (value instanceof Local) {
        return constEnv.get(value.getName?.() || "") || { kind: "unknown" };
    }
    if (value instanceof ArkCastExpr) {
        return resolveValueConstValue(value.getOp?.(), constEnv, symbolEnv);
    }
    if (value instanceof ArkConditionExpr || value instanceof ArkNormalBinopExpr || value instanceof ArkUnopExpr) {
        return resolveExprConstValue(value, constEnv, symbolEnv);
    }
    return { kind: "unknown" };
}

function resolveValueSymbolId(
    value: any,
    symbolEnv: Map<string, string>,
): string | undefined {
    if (value instanceof Local) {
        return symbolEnv.get(value.getName?.() || "");
    }
    if (value instanceof Constant) {
        return `const:${serializePathSensitiveConstValue(resolveConstantValue(value))}`;
    }
    if (value instanceof ArkCastExpr) {
        return resolveValueSymbolId(value.getOp?.(), symbolEnv);
    }
    return undefined;
}

function resolveConstantValue(value: Constant): PathSensitiveConstValue {
    const text = String(value.toString?.() || "").trim();
    if (text === "true") {
        return { kind: "boolean", value: true };
    }
    if (text === "false") {
        return { kind: "boolean", value: false };
    }
    if (text === "undefined") {
        return { kind: "undefined" };
    }
    if (text === "null") {
        return { kind: "null" };
    }
    if (/^-?\d+(?:\.\d+)?$/.test(text)) {
        return { kind: "number", value: Number(text) };
    }
    const stringMatch = text.match(/^['"`](.*)['"`]$/);
    if (stringMatch) {
        return { kind: "string", value: stringMatch[1] };
    }
    return { kind: "unknown" };
}

function applyBinaryConstOperator(
    left: PathSensitiveConstValue,
    right: PathSensitiveConstValue,
    operator: NormalBinaryOperator | RelationalBinaryOperator | undefined,
): PathSensitiveConstValue {
    if (!operator) {
        return { kind: "unknown" };
    }

    if (left.kind === "unknown" || right.kind === "unknown") {
        return { kind: "unknown" };
    }

    switch (operator) {
        case NormalBinaryOperator.Addition:
            if (left.kind === "number" && right.kind === "number") {
                return { kind: "number", value: left.value + right.value };
            }
            if (left.kind === "string" && right.kind === "string") {
                return { kind: "string", value: left.value + right.value };
            }
            return { kind: "unknown" };
        case NormalBinaryOperator.Subtraction:
            if (left.kind === "number" && right.kind === "number") {
                return { kind: "number", value: left.value - right.value };
            }
            return { kind: "unknown" };
        case NormalBinaryOperator.Multiplication:
            if (left.kind === "number" && right.kind === "number") {
                return { kind: "number", value: left.value * right.value };
            }
            return { kind: "unknown" };
        case NormalBinaryOperator.Division:
            if (left.kind === "number" && right.kind === "number" && right.value !== 0) {
                return { kind: "number", value: left.value / right.value };
            }
            return { kind: "unknown" };
        case NormalBinaryOperator.Remainder:
            if (left.kind === "number" && right.kind === "number" && right.value !== 0) {
                return { kind: "number", value: left.value % right.value };
            }
            return { kind: "unknown" };
        case RelationalBinaryOperator.LessThan:
            if (left.kind === "number" && right.kind === "number") {
                return { kind: "boolean", value: left.value < right.value };
            }
            return { kind: "unknown" };
        case RelationalBinaryOperator.LessThanOrEqual:
            if (left.kind === "number" && right.kind === "number") {
                return { kind: "boolean", value: left.value <= right.value };
            }
            return { kind: "unknown" };
        case RelationalBinaryOperator.GreaterThan:
            if (left.kind === "number" && right.kind === "number") {
                return { kind: "boolean", value: left.value > right.value };
            }
            return { kind: "unknown" };
        case RelationalBinaryOperator.GreaterThanOrEqual:
            if (left.kind === "number" && right.kind === "number") {
                return { kind: "boolean", value: left.value >= right.value };
            }
            return { kind: "unknown" };
        case RelationalBinaryOperator.Equality:
        case RelationalBinaryOperator.StrictEquality:
            return { kind: "boolean", value: compareConstValues(left, right) === 0 };
        case RelationalBinaryOperator.InEquality:
        case RelationalBinaryOperator.StrictInequality:
            return { kind: "boolean", value: compareConstValues(left, right) !== 0 };
        default:
            return { kind: "unknown" };
    }
}

function applyUnaryConstOperator(
    operand: PathSensitiveConstValue,
    operator: UnaryOperator | undefined,
): PathSensitiveConstValue {
    if (!operator || operand.kind === "unknown") {
        return { kind: "unknown" };
    }
    switch (operator) {
        case UnaryOperator.LogicalNot:
            if (operand.kind === "boolean") {
                return { kind: "boolean", value: !operand.value };
            }
            return { kind: "unknown" };
        case UnaryOperator.Neg:
            if (operand.kind === "number") {
                return { kind: "number", value: -operand.value };
            }
            return { kind: "unknown" };
        default:
            return { kind: "unknown" };
    }
}

function compareConstValues(
    left: PathSensitiveConstValue,
    right: PathSensitiveConstValue,
): number {
    if (left.kind !== right.kind) {
        return Number.NaN;
    }
    switch (left.kind) {
        case "boolean":
            return left.value === (right as typeof left).value ? 0 : 1;
        case "number":
            return left.value === (right as typeof left).value ? 0 : 1;
        case "string":
            return left.value === (right as typeof left).value ? 0 : 1;
        case "undefined":
        case "null":
            return 0;
        default:
            return Number.NaN;
    }
}

function isLocalTaintedAnyContext(
    local: Local,
    pag: Pag,
    tracker: TaintTracker,
): boolean {
    const nodes = pag.getNodesByValue(local);
    if (!nodes || nodes.size === 0) {
        return false;
    }
    for (const nodeId of nodes.values()) {
        if (tracker.isTaintedAnyContext(nodeId)) {
            return true;
        }
    }
    return false;
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
    fallbackFieldToVarIndex?: Map<string, Set<number>>,
): PreciseCandidateDetectResult {
    if (fieldPath.length === 0) {
        return {
            blockGenericNodeTaint: false,
            fallbackFieldToVarIndex,
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
                fallbackFieldToVarIndex,
            };
        }
        if (!hasPriorStore && hasFutureStore) {
            if (!fallbackFieldToVarIndex) {
                fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
            }
            const earlyFieldPathResult = detectFieldPathSource(
                receiverBase,
                fieldPath,
                sinkStmt,
                pag,
                tracker,
                fallbackFieldToVarIndex,
            );
            if (earlyFieldPathResult) {
                return {
                    result: earlyFieldPathResult,
                    blockGenericNodeTaint: false,
                    fallbackFieldToVarIndex,
                };
            }
            return {
                blockGenericNodeTaint: true,
                fallbackFieldToVarIndex,
            };
        }
        if (hasOrderedConstantOverwrite && !hasPriorStore) {
            return {
                blockGenericNodeTaint: true,
                fallbackFieldToVarIndex,
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
            fallbackFieldToVarIndex,
        };
    }
    const allDead = carrierIds.length > 0
        && carrierIds.every(carrierId => !isCarrierFieldPathLiveAtStmt(pag, tracker, carrierId, fieldPath, sinkStmt));
    if (allDead) {
        return {
            blockGenericNodeTaint: hasPriorStore || hasOrderedConstantOverwrite,
            fallbackFieldToVarIndex,
        };
    }

    if (!fallbackFieldToVarIndex) {
        fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
    }
    const fieldPathResult = detectFieldPathSource(
        receiverBase,
        fieldPath,
        sinkStmt,
        pag,
        tracker,
        fallbackFieldToVarIndex,
    );
    if (fieldPathResult) {
        return {
            result: fieldPathResult,
            blockGenericNodeTaint: false,
            fallbackFieldToVarIndex,
        };
    }

    return {
        blockGenericNodeTaint: hasOrderedConstantOverwrite || (allDead && hasPriorStore),
        fallbackFieldToVarIndex,
    };
}

interface OrderedFieldStore {
    kind: "constant" | "nonconstant";
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
        };
    }
    return undefined;
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
            });
        }
    }

    const built: SinkCallsiteIndex = {
        methodCount,
        reachableMethodCount,
        stmtCount,
        invokeStmtCount,
        sites,
        signatureMatchCache: new Map<string, IndexedInvokeSite[]>(),
    };
    byKey.set(key, built);
    return built;
}

function getOrBuildSignatureMatchedSites(
    index: SinkCallsiteIndex,
    sinkSignature: string,
    mode: "contains" | "equals"
): IndexedInvokeSite[] {
    const cacheKey = `${mode}|${sinkSignature}`;
    const cached = index.signatureMatchCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const matched = index.sites.filter(site => {
        if (mode === "equals") {
            return site.calleeSignature === sinkSignature;
        }
        return site.calleeSignature.includes(sinkSignature);
    });
    index.signatureMatchCache.set(cacheKey, matched);
    return matched;
}

function buildAllowedMethodSignatureKey(allowedMethodSignatures?: Set<string>): string {
    if (!allowedMethodSignatures || allowedMethodSignatures.size === 0) return "__all__";
    return [...allowedMethodSignatures].sort().join("||");
}

function resolveSinkCandidates(
    stmt: any,
    invokeExpr: any,
    targetEndpoint?: RuleEndpoint
): SinkCandidate[] {
    if (!targetEndpoint) {
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        return args.map((arg: any, idx: number) => ({
            value: arg,
            kind: "arg" as const,
            endpoint: `arg${idx}`,
        }));
    }

    if (targetEndpoint === "base") {
        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            return [{
                value: invokeExpr.getBase(),
                kind: "base",
                endpoint: "base",
            }];
        }
        return [];
    }

    if (targetEndpoint === "result") {
        if (stmt instanceof ArkAssignStmt) {
            return [{
                value: stmt.getLeftOp(),
                kind: "result",
                endpoint: "result",
            }];
        }
        return [];
    }

    const m = /^arg(\d+)$/.exec(targetEndpoint);
    if (!m) return [];
    const argIndex = Number(m[1]);
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (!Number.isFinite(argIndex) || argIndex < 0 || argIndex >= args.length) return [];

    return [{
        value: args[argIndex],
        kind: "arg",
        endpoint: `arg${argIndex}`,
    }];
}

function matchesInvokeConstraints(
    invokeExpr: any,
    calleeSignature: string,
    options: SinkDetectOptions
): boolean {
    if (options.invokeKind && options.invokeKind !== "any") {
        const actualKind: RuleInvokeKind = invokeExpr instanceof ArkInstanceInvokeExpr ? "instance" : "static";
        if (actualKind !== options.invokeKind) {
            return false;
        }
    }

    if (options.argCount !== undefined) {
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length !== options.argCount) {
            return false;
        }
    }

    if (options.typeHint && options.typeHint.trim().length > 0) {
        const hint = options.typeHint.trim().toLowerCase();
        const declaringClass = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
        const baseText = invokeExpr instanceof ArkInstanceInvokeExpr ? (invokeExpr.getBase()?.toString?.() || "") : "";
        const ptrText = invokeExpr instanceof ArkPtrInvokeExpr ? (invokeExpr.toString?.() || "") : "";
        const haystack = `${calleeSignature} ${declaringClass} ${baseText} ${ptrText}`.toLowerCase();
        if (!haystack.includes(hint)) {
            return false;
        }
    }

    return true;
}

function isSinkCandidateSanitizedByRules(
    method: any,
    sinkStmt: any,
    candidate: SinkCandidate,
    sanitizerRules: SanitizerRule[],
    log: (msg: string) => void
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

        const matchedRules = filterBestTierRulesByFamily(sanitizerRules.filter(rule => {
            if (!matchesScope(method, rule.scope)) return false;
            if (!matchesSanitizerRule(rule, stmt, invokeExpr, calleeSignature)) return false;
            return true;
        }));
        for (const rule of matchedRules) {
            const targetNorm = rule.target ? normalizeEndpoint(rule.target) : undefined;
            const targetEndpoint = targetNorm ? targetNorm.endpoint : "result";
            if (targetNorm?.pathFrom) continue;
            const targetValue = resolveInvokeEndpointValue(stmt, invokeExpr, targetEndpoint);
            if (!targetValue) continue;
            if (!sameValueLike(candidateValue, targetValue)) continue;
            if (
                targetValue instanceof Local
                && hasLocalReassignmentBetween(stmts, targetValue.getName(), i, sinkIndex)
            ) {
                continue;
            }
            log(`    [Sanitizer-Guard] skip sink by '${rule.id}' on endpoint '${targetEndpoint}'.`);
            return { sanitized: true, ruleId: rule.id };
        }
    }

    return { sanitized: false };
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

function sameValueLike(a: any, b: any): boolean {
    if (a === b) return true;
    if (a instanceof Local && b instanceof Local) {
        return a.getName() === b.getName();
    }
    const aText = a?.toString?.();
    const bText = b?.toString?.();
    return typeof aText === "string" && aText.length > 0 && aText === bText;
}

function matchesSanitizerRule(
    rule: SanitizerRule,
    stmt: any,
    invokeExpr: any,
    calleeSignature: string
): boolean {
    const m = rule.match;
    if (m.invokeKind && m.invokeKind !== "any") {
        const actualKind: RuleInvokeKind = invokeExpr instanceof ArkInstanceInvokeExpr ? "instance" : "static";
        if (actualKind !== m.invokeKind) return false;
    }
    if (m.argCount !== undefined) {
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length !== m.argCount) return false;
    }
    if (m.typeHint && m.typeHint.trim().length > 0) {
        const hint = m.typeHint.trim().toLowerCase();
        const declaringClass = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
        const baseText = invokeExpr instanceof ArkInstanceInvokeExpr ? (invokeExpr.getBase()?.toString?.() || "") : "";
        const ptrText = invokeExpr instanceof ArkPtrInvokeExpr ? (invokeExpr.toString?.() || "") : "";
        const haystack = `${calleeSignature} ${declaringClass} ${baseText} ${ptrText}`.toLowerCase();
        if (!haystack.includes(hint)) return false;
    }

    const matchValue = m.value || "";
    const methodName = invokeExpr.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.()
        || extractMethodNameFromSignature(calleeSignature);
    switch (m.kind) {
        case "signature_contains":
            return calleeSignature.includes(matchValue);
        case "signature_equals":
            return exactTextMatch(calleeSignature, matchValue);
        case "signature_regex":
            try {
                return new RegExp(matchValue).test(calleeSignature);
            } catch {
                return false;
            }
        case "declaring_class_equals": {
            const classSignature = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
            const className = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.getClassName?.() || "";
            return exactDeclaringClassMatch(classSignature, className, matchValue);
        }
        case "method_name_equals":
            return methodName === matchValue;
        case "method_name_regex":
            try {
                return new RegExp(matchValue).test(methodName);
            } catch {
                return false;
            }
        case "local_name_regex": {
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const texts = args.map((arg: any) => arg?.toString?.() || "");
            if (invokeExpr instanceof ArkInstanceInvokeExpr) {
                texts.push(invokeExpr.getBase()?.toString?.() || "");
            }
            if (stmt instanceof ArkAssignStmt) {
                texts.push(stmt.getLeftOp()?.toString?.() || "");
            }
            try {
                const re = new RegExp(matchValue);
                return texts.some((t: string) => re.test(t));
            } catch {
                return false;
            }
        }
        default:
            return false;
    }
}

function extractMethodNameFromSignature(signature: string): string {
    const m = signature.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function normalizeExactMatchText(value: string): string {
    return value.trim();
}

function exactTextMatch(actual: string, expected: string): boolean {
    return normalizeExactMatchText(actual) === normalizeExactMatchText(expected);
}

function exactDeclaringClassMatch(classSignature: string, className: string, expected: string): boolean {
    const normalizedExpected = normalizeExactMatchText(expected);
    if (!normalizedExpected) return false;
    return normalizeExactMatchText(classSignature) === normalizedExpected
        || normalizeExactMatchText(className) === normalizedExpected;
}

function matchesScope(method: any, scope?: RuleScopeConstraint): boolean {
    if (!scope) return true;
    const sig = method.getSignature().toString();
    const filePath = extractFilePathFromSignature(sig);
    const classText = method.getDeclaringArkClass?.()?.getName?.() || sig;
    const moduleText = filePath || sig;

    if (!matchStringConstraint(scope.file, filePath)) return false;
    if (!matchStringConstraint(scope.module, moduleText)) return false;
    if (!matchStringConstraint(scope.className, classText)) return false;
    if (!matchStringConstraint(scope.methodName, method.getName())) return false;
    return true;
}

function extractFilePathFromSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : signature;
}

function matchStringConstraint(constraint: RuleStringConstraint | undefined, text: string): boolean {
    if (!constraint) return true;
    const value = constraint.value || "";
    if (constraint.mode === "equals") return text === value;
    if (constraint.mode === "contains") return text.includes(value);
    try {
        return new RegExp(value).test(text);
    } catch {
        return false;
    }
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

                const source = tracker.getSourceAnyContext(objId, [fieldName]);
                if (source) {
                    return {
                        source,
                        nodeId: objId,
                        fieldPath: [fieldName],
                    };
                }

                const loadTargets = fieldToVarIndex.get(`${objId}-${fieldName}`);
                if (!loadTargets) continue;
                for (const loadNodeId of loadTargets.values()) {
                    const loadSource = tracker.getSourceAnyContext(loadNodeId);
                    if (loadSource) {
                        return {
                            source: loadSource,
                            nodeId: loadNodeId,
                        };
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
            const directFieldCarrier = tracker.getAnyFieldSourceAnyContext(objId);
            if (directFieldCarrier) {
                return {
                    source: directFieldCarrier.source,
                    nodeId: objId,
                    fieldPath: directFieldCarrier.fieldPath,
                };
            }
            const objectPaths = collectArrayCarrierPathKeys(pag, objId);
            if (!hasStringIntersection(candidatePaths, objectPaths)) continue;
            const fieldCarrier = tracker.getAnyFieldSourceAnyContext(objId);
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

