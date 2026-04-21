import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import {
    ArkParameterRef,
    ArkInstanceFieldRef,
    ClosureFieldRef,
} from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { CallEdgeType } from "../context/TaintContext";
import { resolveCallbackMethodsFromValueWithReturns } from "../../substrate/queries/CallbackBindingQuery";
import {
    analyzeInvokedParams,
    collectParameterAssignStmts,
    isAnonymousObjectCarrierClassSignature,
    isCallableValue,
    isReflectDispatchInvoke,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
    resolveInvokeMethodName,
    resolveMethodsFromAnonymousObjectCarrier,
    resolveMethodsFromAnonymousObjectCarrierByField,
    resolveMethodsFromCallable
} from "../../substrate/queries/CalleeResolver";
import { isSdkBackedMethodSignature } from "../../substrate/queries/SdkProvenance";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import type { SyntheticInvokeEdgeInfo } from "./SyntheticInvokeEdgeBuilder";

export interface SyntheticInvokeLookupStats {
    incomingLookupCalls: number;
    incomingDirectScanMs: number;
    incomingIndexBuildMs: number;
    incomingIndexBuilt: boolean;
    methodLookupCalls: number;
    methodLookupCacheHits: number;
}

export interface SyntheticInvokeLookupContext {
    incomingCallsiteIndexByCalleeSig?: Map<string, any[]>;
    methodLookupCacheByFileAndProperty: Map<string, any[]>;
    methodsByFileCache: Map<string, any[]>;
    stats: SyntheticInvokeLookupStats;
}

export interface AsyncCallbackBinding {
    method: any;
    sourceMethod: any;
    reason: "direct" | "one_hop" | "name_fallback";
}

export function collectAsyncCallbackBindingsForStmt(
    scene: Scene,
    cg: CallGraph,
    caller: any,
    stmt: any,
    invokeExpr: any,
    lookupContext: SyntheticInvokeLookupContext
): AsyncCallbackBinding[] {
    const invokeName = resolveInvokeMethodName(invokeExpr);
    const asyncNames = new Set(["setTimeout", "setInterval", "queueMicrotask", "requestAnimationFrame"]);
    if (!asyncNames.has(invokeName)) return [];
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (args.length === 0) return [];
    const callbackArg = args[0];
    const callsiteLine = stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0;
    return resolveAsyncCallbackBindings(scene, cg, caller, callbackArg, callsiteLine, lookupContext);
}

export function collectResolvedCallbackBindingsForStmt(
    scene: Scene,
    cg: CallGraph,
    caller: any,
    stmt: any,
    invokeExpr: any,
    invokedParamCache: Map<string, Set<number>>
): AsyncCallbackBinding[] {
    const out: AsyncCallbackBinding[] = [];
    const seen = new Set<string>();
    const resolvedCallees = collectResolvedInvokeTargets(scene, cg, stmt, invokeExpr);
    for (const callee of resolvedCallees) {
        const isSdk = isSdkBackedMethodSignature(scene, callee.getSignature?.(), {
            sourceMethod: caller,
            invokeExpr,
        });
        const paramStmts = collectParameterAssignStmts(callee);
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];

        if (paramStmts.length > 0) {
            const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);
            const invokedParams = isSdk ? undefined : getCachedInvokedParams(callee, invokedParamCache);

            for (const pair of pairs) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, pair.arg, isSdk)
                    .filter(method => !!method?.getCfg?.());
                if (callbackMethods.length === 0) continue;
                if (!isSdk && (!invokedParams || !invokedParams.has(pair.paramIndex))) continue;

                for (const callbackMethod of callbackMethods) {
                    const callbackSig = callbackMethod.getSignature?.().toString?.() || "";
                    if (!callbackSig || seen.has(callbackSig)) continue;
                    seen.add(callbackSig);
                    out.push({
                        method: callbackMethod,
                        sourceMethod: caller,
                        reason: "direct",
                    });
                }
            }
        } else if (isSdk) {
            for (const arg of explicitArgs) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, arg, true)
                    .filter(method => !!method?.getCfg?.());
                for (const callbackMethod of callbackMethods) {
                    const callbackSig = callbackMethod.getSignature?.().toString?.() || "";
                    if (!callbackSig || seen.has(callbackSig)) continue;
                    seen.add(callbackSig);
                    out.push({
                        method: callbackMethod,
                        sourceMethod: caller,
                        reason: "direct",
                    });
                }
            }
        }
    }
    return out;
}

export function collectCallbackBindingTriggerNodeIds(
    pag: Pag,
    stmt: any,
    cbMethod: any,
    sourceMethod: any
): Set<number> {
    const sourceBody = sourceMethod?.getBody?.();
    const sourceLocals = sourceBody?.getLocals?.();
    const out = new Set<number>();
    if (!sourceLocals) return out;

    const paramStmts = collectParameterAssignStmts(cbMethod);
    for (const paramStmt of paramStmts) {
        const paramLocal = paramStmt.getLeftOp();
        if (!(paramLocal instanceof Local)) continue;
        const callerLocal = sourceLocals.get(paramLocal.getName());
        if (!(callerLocal instanceof Local)) continue;
        for (const nodeId of safeGetOrCreatePagNodes(pag, callerLocal, stmt)?.values?.() || []) {
            out.add(nodeId);
        }
    }

    const capturedLocalMappings = collectCallbackCapturedLocalMappings(cbMethod, paramStmts);
    for (const mapping of capturedLocalMappings) {
        const callerLocal = sourceLocals.get(mapping.callerLocalName);
        if (!(callerLocal instanceof Local)) continue;
        for (const nodeId of safeGetOrCreatePagNodes(pag, callerLocal, stmt)?.values?.() || []) {
            out.add(nodeId);
        }
    }

    return out;
}

export function injectResolvedCallbackParameterEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    caller: any,
    stmt: any,
    invokeExpr: any,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    invokedParamCache: Map<string, Set<number>>
): number {
    const resolvedCallees = collectResolvedInvokeTargets(scene, cg, stmt, invokeExpr);
    if (resolvedCallees.length === 0) return 0;

    let count = 0;
    const seenBindings = new Set<string>();
    for (const callee of resolvedCallees) {
        const isSdk = isSdkBackedMethodSignature(scene, callee.getSignature?.(), {
            sourceMethod: caller,
            invokeExpr,
        });
        const paramStmts = collectParameterAssignStmts(callee);
        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];

        if (paramStmts.length > 0) {
            const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts);
            const invokedParams = isSdk ? undefined : getCachedInvokedParams(callee, invokedParamCache);

            for (const pair of pairs) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, pair.arg, isSdk)
                    .filter(method => !!method?.getCfg?.());
                if (callbackMethods.length === 0) continue;
                if (!isSdk && (!invokedParams || !invokedParams.has(pair.paramIndex))) continue;

                for (const callbackMethod of callbackMethods) {
                    const callbackSig = callbackMethod.getSignature?.().toString?.() || "";
                    if (!callbackSig) continue;
                    const bindingKey = `${stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0}`
                        + `#${callee.getSignature?.().toString?.() || ""}`
                        + `#${pair.paramIndex}`
                        + `#${callbackSig}`;
                    if (seenBindings.has(bindingKey)) continue;
                    seenBindings.add(bindingKey);
                    count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, callbackMethod, caller);
                }
            }
        } else if (isSdk) {
            for (let argIdx = 0; argIdx < explicitArgs.length; argIdx++) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, explicitArgs[argIdx], true)
                    .filter(method => !!method?.getCfg?.());
                for (const callbackMethod of callbackMethods) {
                    const callbackSig = callbackMethod.getSignature?.().toString?.() || "";
                    if (!callbackSig) continue;
                    const bindingKey = `${stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0}`
                        + `#${callee.getSignature?.().toString?.() || ""}`
                        + `#${argIdx}`
                        + `#${callbackSig}`;
                    if (seenBindings.has(bindingKey)) continue;
                    seenBindings.add(bindingKey);
                    count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, callbackMethod, caller);
                }
            }
        }
    }

    return count;
}

export function injectAsyncCallbackCaptureEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    caller: any,
    stmt: any,
    invokeExpr: any,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    context?: SyntheticInvokeLookupContext
): number {
    const invokeName = resolveInvokeMethodName(invokeExpr);
    const asyncNames = new Set(["setTimeout", "setInterval", "queueMicrotask", "requestAnimationFrame"]);
    if (!asyncNames.has(invokeName)) return 0;

    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (args.length === 0) return 0;
    const callbackArg = args[0];
    const callsiteLine = stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0;
    const callbackBindings = resolveAsyncCallbackBindings(scene, cg, caller, callbackArg, callsiteLine, context);
    if (callbackBindings.length === 0) return 0;

    let count = 0;
    for (const binding of callbackBindings) {
        count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, binding.method, binding.sourceMethod || caller);
    }

    return count;
}

export function resolveReflectDispatchOneHopFallbackCallees(
    scene: Scene,
    cg: CallGraph,
    callerMethod: any,
    invokeExpr: any,
    context?: SyntheticInvokeLookupContext
): Array<{ method: any; reason: "type_fallback" }> {
    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const base = invokeExpr?.getBase?.();
    const candidateValues: any[] = [];
    if (args.length > 0) candidateValues.push(args[0]);
    if (base !== undefined && base !== null) candidateValues.push(base);

    const out: Array<{ method: any; reason: "type_fallback" }> = [];
    const seen = new Set<string>();
    for (const candidate of candidateValues) {
        const paramIndex = resolveCallbackParameterIndexInCurrentMethod(callerMethod, candidate);
        if (paramIndex === undefined || paramIndex < 0) continue;

        const bindings = resolveOneHopCallbackBindingsFromParamIndex(scene, cg, callerMethod, paramIndex, 8, context);
        for (const binding of bindings) {
            const method = binding.method;
            const sig = method?.getSignature?.().toString?.();
            if (!sig || seen.has(sig)) continue;
            seen.add(sig);
            out.push({ method, reason: "type_fallback" });
        }
    }

    if (out.length > 8) return [];
    return out;
}

export function resolveDynamicPropertyOneHopFallbackCallees(
    scene: Scene,
    cg: CallGraph,
    calleeMethod: any,
    invokeExpr: any,
    context?: SyntheticInvokeLookupContext
): Array<{ method: any; reason: "type_fallback" }> {
    const invokeSig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    if (!invokeSig.includes("%unk")) return [];

    const base = invokeExpr?.getBase?.();
    if (!(base instanceof Local)) return [];

    const calleeParamStmts = collectParameterAssignStmts(calleeMethod);
    if (calleeParamStmts.length === 0) return [];

    const paramLocalNameToIndex = new Map<string, number>();
    for (let i = 0; i < calleeParamStmts.length; i++) {
        const left = calleeParamStmts[i]?.getLeftOp?.();
        if (!(left instanceof Local)) continue;
        paramLocalNameToIndex.set(left.getName(), i);
    }
    const baseParamIndex = paramLocalNameToIndex.get(base.getName());
    if (baseParamIndex === undefined) return [];

    const forwardedParamIndexes = new Set<number>();
    const invokeArgs = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of invokeArgs) {
        if (!(arg instanceof Local)) continue;
        const idx = paramLocalNameToIndex.get(arg.getName());
        if (idx !== undefined) forwardedParamIndexes.add(idx);
    }

    const keyParamIndexes: number[] = [];
    for (let i = 0; i < calleeParamStmts.length; i++) {
        if (i === baseParamIndex) continue;
        if (forwardedParamIndexes.has(i)) continue;
        keyParamIndexes.push(i);
    }
    if (keyParamIndexes.length === 0) return [];

    const incomingCallSitesStable = collectIncomingCallSitesForCallee(scene, cg, calleeMethod, context);
    if (incomingCallSitesStable.length === 0) return [];

    const out: Array<{ method: any; reason: "type_fallback" }> = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        if (!method || !method.getCfg || !method.getCfg()) return;
        const sig = method.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push({ method, reason: "type_fallback" });
    };

    const multipleKeyCandidates = keyParamIndexes.length >= 2;
    for (const cs of incomingCallSitesStable) {
        const callStmt = cs.callStmt;
        const callInvokeExpr = callStmt?.getInvokeExpr?.();
        if (!callInvokeExpr) continue;

        const explicitArgs = cs.args || (callInvokeExpr.getArgs ? callInvokeExpr.getArgs() : []);
        const argToParamPairs = mapInvokeArgsToParamAssigns(callInvokeExpr, explicitArgs, calleeParamStmts);
        if (argToParamPairs.length === 0) continue;

        const argByParamIndex = new Map<number, any>();
        for (const pair of argToParamPairs) {
            if (!argByParamIndex.has(pair.paramIndex)) {
                argByParamIndex.set(pair.paramIndex, pair.arg);
            }
        }
        const objectArg = argByParamIndex.get(baseParamIndex);
        if (!objectArg) continue;

        const callerMethodSig = cs.callStmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        const callerFile = extractFilePathFromSignature(callerMethodSig);

        const orderedCandidates = rankKeyParamCandidates(keyParamIndexes, argByParamIndex);
        for (const keyCandidate of orderedCandidates) {
            const keyParamIndex = keyCandidate.paramIndex;
            if (multipleKeyCandidates && keyCandidate.evidenceScore <= 0) {
                continue;
            }
            const keyArg = argByParamIndex.get(keyParamIndex);
            const keyLiteral = resolveStringLiteralByLocalBacktrace(keyArg);
            let methods: any[] = [];
            if (keyLiteral) {
                methods = resolveMethodsByPropertyName(scene, keyLiteral, callerFile, context);
                if (methods.length === 0) {
                    methods = resolveMethodsFromAnonymousObjectCarrierByField(scene, objectArg, keyLiteral);
                }
            }
            if (methods.length === 0 && !multipleKeyCandidates) {
                methods = resolveMethodsFromAnonymousObjectCarrier(scene, objectArg);
            }
            for (const m of methods) addMethod(m);
        }
    }

    if (out.length > 8) return [];
    return out;
}

export function collectResolvedInvokeTargets(
    scene: Scene,
    cg: CallGraph,
    stmt: any,
    invokeExpr: any
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const add = (method: any): void => {
        if (!method || !method.getCfg?.()) return;
        const sig = method.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    const callSites = cg.getCallSiteByStmt(stmt) || [];
    for (const cs of callSites) {
        const calleeFuncID = cs.getCalleeFuncID?.();
        if (!calleeFuncID) continue;
        add(cg.getArkMethodByFuncID(calleeFuncID));
    }

    if (out.length > 0 && !isReflectDispatchInvoke(invokeExpr) && !String(invokeExpr?.getMethodSignature?.()?.toString?.() || "").includes("%unk")) {
        return out;
    }

    for (const resolved of resolveCalleeCandidates(scene, invokeExpr)) {
        add(resolved.method);
    }
    return out;
}

function getCachedInvokedParams(
    method: any,
    cache: Map<string, Set<number>>
): Set<number> {
    const sig = method?.getSignature?.().toString?.() || "";
    if (!sig) return new Set<number>();
    if (!cache.has(sig)) {
        cache.set(sig, analyzeInvokedParams(method));
    }
    return cache.get(sig)!;
}

function resolveSyntheticCallbackMethodsForArg(
    scene: Scene,
    arg: any,
    isSdk: boolean
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        if (!method?.getCfg?.()) return;
        const sig = method.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    if (isCallableValue(arg)) {
        for (const method of resolveMethodsFromCallable(scene, arg, { maxCandidates: 8 })) {
            addMethod(method);
        }
    }

    if (isSdk) {
        for (const method of resolveMethodsFromAnonymousObjectCarrier(scene, arg)) {
            addMethod(method);
        }
    }

    return out;
}

export function injectCallbackBindingEdges(
    pag: Pag,
    caller: any,
    stmt: any,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    cbMethod: any,
    sourceMethod: any,
    options?: {
        explicitParamSourceNodeIds?: Map<number, number>;
        allowFallback?: boolean;
    },
): number {
    const sourceBody = sourceMethod?.getBody?.();
    const sourceLocals = sourceBody?.getLocals?.();
    if (!sourceLocals) return 0;

    const paramStmts = collectParameterAssignStmts(cbMethod);
    const calleeSig = cbMethod.getSignature().toString();
    const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + simpleHash(calleeSig);
    const capturedLocalMappings = collectCallbackCapturedLocalMappings(cbMethod, paramStmts);

    let count = 0;
    if (paramStmts.length > 0) {
        for (const paramStmt of paramStmts) {
            const paramLocal = paramStmt.getLeftOp();
            if (!(paramLocal instanceof Local)) continue;
            let srcNodes = options?.explicitParamSourceNodeIds;
            if (!srcNodes || srcNodes.size === 0) {
                const callerLocal = sourceLocals.get(paramLocal.getName());
                if (!(callerLocal instanceof Local)) continue;
                srcNodes = safeGetOrCreatePagNodes(pag, callerLocal, stmt);
            }
            let dstNodes = safeGetOrCreatePagNodes(pag, paramLocal, paramStmt);
            if ((!dstNodes || dstNodes.size === 0) && paramStmt.getRightOp() instanceof ArkParameterRef) {
                dstNodes = safeGetOrCreatePagNodes(pag, paramStmt.getRightOp(), paramStmt);
            }
            if (!srcNodes || !dstNodes) continue;

            for (const srcNodeId of srcNodes.values()) {
                for (const dstNodeId of dstNodes.values()) {
                    pushEdge(edgeMap, srcNodeId, {
                        type: CallEdgeType.CALL,
                        srcNodeId,
                        dstNodeId,
                        callSiteId,
                        callerMethodName: sourceMethod.getName?.() || caller.getName(),
                        calleeMethodName: cbMethod.getName(),
                        callerSignature: sourceMethod.getSignature?.().toString?.() || caller.getSignature?.().toString?.(),
                        calleeSignature: calleeSig,
                    });
                    count++;
                }
            }
        }
    }

    for (const mapping of capturedLocalMappings) {
        const callerLocal = sourceLocals.get(mapping.callerLocalName);
        if (!(callerLocal instanceof Local)) continue;

        const srcNodes = safeGetOrCreatePagNodes(pag, callerLocal, stmt);
        const dstNodes = mapping.anchorStmt
            ? safeGetOrCreatePagNodes(pag, mapping.callbackValue, mapping.anchorStmt)
            : pag.getNodesByValue(mapping.callbackValue);
        if (!srcNodes || !dstNodes) continue;

        for (const srcNodeId of srcNodes.values()) {
            for (const dstNodeId of dstNodes.values()) {
                pushEdge(edgeMap, srcNodeId, {
                    type: CallEdgeType.CALL,
                    srcNodeId,
                    dstNodeId,
                    callSiteId,
                    callerMethodName: sourceMethod.getName?.() || caller.getName(),
                    calleeMethodName: cbMethod.getName(),
                    callerSignature: sourceMethod.getSignature?.().toString?.() || caller.getSignature?.().toString?.(),
                    calleeSignature: calleeSig,
                });
                count++;
            }
        }
    }

    if (count === 0 && options?.allowFallback !== false) {
        const srcNodeId = findAnyPagNodeForStmt(pag, stmt);
        const dstNodeId = findAnyPagNodeForMethod(pag, cbMethod);
        if (srcNodeId !== undefined && dstNodeId !== undefined) {
            pushEdge(edgeMap, srcNodeId, {
                type: CallEdgeType.CALL,
                srcNodeId,
                dstNodeId,
                callSiteId,
                callerMethodName: sourceMethod.getName?.() || caller.getName(),
                calleeMethodName: cbMethod.getName(),
                callerSignature: sourceMethod.getSignature?.().toString?.() || caller.getSignature?.().toString?.(),
                calleeSignature: calleeSig,
            });
            count = 1;
        }
    }

    return count;
}

function pushEdge(map: Map<number, SyntheticInvokeEdgeInfo[]>, key: number, edge: SyntheticInvokeEdgeInfo): void {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(edge);
}

function simpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

function findAnyPagNodeForStmt(pag: Pag, stmt: any): number | undefined {
    for (const value of [stmt.getLeftOp?.(), stmt.getRightOp?.(), stmt.getInvokeExpr?.()?.getBase?.()]) {
        if (!value) continue;
        const nodes = pag.getNodesByValue(value);
        if (nodes && nodes.size > 0) return nodes.values().next().value;
    }
    const args = stmt.getInvokeExpr?.()?.getArgs?.() || [];
    for (const arg of args) {
        const nodes = pag.getNodesByValue(arg);
        if (nodes && nodes.size > 0) return nodes.values().next().value;
    }
    return undefined;
}

function findAnyPagNodeForMethod(pag: Pag, method: any): number | undefined {
    const cfg = method.getCfg?.();
    if (!cfg) return undefined;
    for (const s of cfg.getStmts()) {
        const left = s.getLeftOp?.();
        if (left) {
            const nodes = pag.getNodesByValue(left);
            if (nodes && nodes.size > 0) return nodes.values().next().value;
        }
        const right = s.getRightOp?.();
        if (right) {
            const nodes = pag.getNodesByValue(right);
            if (nodes && nodes.size > 0) return nodes.values().next().value;
        }
    }
    return undefined;
}

function resolveAsyncCallbackBindings(
    scene: Scene,
    cg: CallGraph,
    callerMethod: any,
    callbackArg: any,
    callsiteLine: number = 0,
    context?: SyntheticInvokeLookupContext
): AsyncCallbackBinding[] {
    const LINE_NEARBY_WARNING_THRESHOLD = 50;
    const methods = resolveMethodsFromCallable(scene, callbackArg, { maxCandidates: 8 })
        .filter(m => (m.getName?.() || "").startsWith("%AM"));
    if (methods.length > 0) {
        return methods.map(method => ({
            method,
            sourceMethod: callerMethod,
            reason: "direct" as const,
        }));
    }

    const callbackParamIndex = resolveCallbackParameterIndexInCurrentMethod(callerMethod, callbackArg);
    if (callbackParamIndex !== undefined && callbackParamIndex >= 0) {
        return resolveAsyncCallbackBindingsFromOneHopCallers(scene, cg, callerMethod, callbackParamIndex, context);
    }

    const callerSig = callerMethod?.getSignature?.().toString?.() || "";
    const callerFile = extractFilePathFromSignature(callerSig);
    if (!callerFile) return [];
    const callerName = callerMethod?.getName?.() || "";
    const callbackCandidateNames = new Set<string>();
    const callbackArgName = callbackArg?.getName?.();
    if (callbackArgName) callbackCandidateNames.add(String(callbackArgName));
    const callbackArgText = callbackArg?.toString?.();
    if (callbackArgText) callbackCandidateNames.add(String(callbackArgText));

    const candidates = scene.getMethods().filter(m => {
        const name = m.getName?.() || "";
        if (!name.startsWith("%AM")) return false;
        const sig = m.getSignature?.().toString?.() || "";
        if (!sig) return false;
        return extractFilePathFromSignature(sig) === callerFile;
    });

    const strictMatches = candidates.filter(m => {
        const name = m.getName?.() || "";
        if (callerName && name.includes(`$${callerName}`)) return true;
        if (callbackCandidateNames.has(name)) return true;
        return false;
    });
    if (strictMatches.length > 0) {
        return strictMatches.slice(0, 8).map(method => ({
            method,
            sourceMethod: callerMethod,
            reason: "name_fallback" as const,
        }));
    }

    if (callsiteLine > 0) {
        const sorted = [...candidates].sort((a, b) => {
            const da = Math.abs(extractLineNoFromSignature(a.getSignature?.().toString?.() || "") - callsiteLine);
            const db = Math.abs(extractLineNoFromSignature(b.getSignature?.().toString?.() || "") - callsiteLine);
            return da - db;
        });
        const nearest = sorted[0];
        if (nearest) {
            const nearestLine = extractLineNoFromSignature(nearest.getSignature?.().toString?.() || "");
            if (nearestLine !== Number.MAX_SAFE_INTEGER) {
                const nearestDelta = Math.abs(nearestLine - callsiteLine);
                if (nearestDelta > LINE_NEARBY_WARNING_THRESHOLD) {
                    const callerSigText = callerMethod?.getSignature?.().toString?.() || "<unknown-caller>";
                    console.warn(`[arktaint][async-fallback] line-distance=${nearestDelta} (> ${LINE_NEARBY_WARNING_THRESHOLD}), caller=${callerSigText}, callbackArg=${String(callbackArg?.toString?.() || "")}`);
                }
            }
        }
        return sorted.slice(0, 8).map(method => ({
            method,
            sourceMethod: callerMethod,
            reason: "name_fallback" as const,
        }));
    }

    return candidates.slice(0, 8).map(method => ({
        method,
        sourceMethod: callerMethod,
        reason: "name_fallback" as const,
    }));
}

function resolveAsyncCallbackBindingsFromOneHopCallers(
    scene: Scene,
    cg: CallGraph,
    callerMethod: any,
    callbackParamIndex: number,
    context?: SyntheticInvokeLookupContext
): AsyncCallbackBinding[] {
    return resolveOneHopCallbackBindingsFromParamIndex(scene, cg, callerMethod, callbackParamIndex, 8, context);
}

function resolveOneHopCallbackBindingsFromParamIndex(
    scene: Scene,
    cg: CallGraph,
    calleeMethod: any,
    targetParamIndex: number,
    maxCandidates: number,
    context?: SyntheticInvokeLookupContext
): AsyncCallbackBinding[] {
    const incomingCallSites = collectIncomingCallSitesForCallee(scene, cg, calleeMethod, context);
    if (incomingCallSites.length === 0) return [];

    const calleeParamStmts = collectParameterAssignStmts(calleeMethod);
    const out: AsyncCallbackBinding[] = [];
    const seen = new Set<string>();
    const addMethod = (m: any, sourceMethod: any): void => {
        if (!m || !m.getCfg || !m.getCfg()) return;
        const sig = m.getSignature?.().toString?.();
        const sourceSig = sourceMethod?.getSignature?.()?.toString?.() || "";
        const key = `${sourceSig}=>${sig}`;
        if (!sig || seen.has(key)) return;
        seen.add(key);
        out.push({
            method: m,
            sourceMethod: sourceMethod || calleeMethod,
            reason: "one_hop",
        });
    };

    for (const cs of incomingCallSites) {
        const callStmt = cs.callStmt;
        const invokeExpr = callStmt?.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const sourceMethod = callStmt?.getCfg?.()?.getDeclaringMethod?.() || calleeMethod;

        const explicitArgs = cs.args || (invokeExpr.getArgs ? invokeExpr.getArgs() : []);
        const argToParamPairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, calleeParamStmts);
        for (const pair of argToParamPairs) {
            if (pair.paramIndex !== targetParamIndex) continue;

            const methods = resolveCallbackMethodsFromValueWithReturns(scene, pair.arg, { maxDepth: 6 });
            if (methods.length === 0 && !isCallableValue(pair.arg)) continue;
            for (const m of methods) addMethod(m, sourceMethod);
        }
    }

    if (out.length > maxCandidates) return [];
    return out;
}

function collectIncomingCallSitesForCallee(
    scene: Scene,
    cg: CallGraph,
    calleeMethod: any,
    context?: SyntheticInvokeLookupContext
): any[] {
    const targetSig = calleeMethod?.getSignature?.()?.toString?.() || "";
    if (!targetSig) return [];

    if (context) {
        context.stats.incomingLookupCalls++;
        if (context.incomingCallsiteIndexByCalleeSig) {
            return context.incomingCallsiteIndexByCalleeSig.get(targetSig) || [];
        }
        if (context.stats.incomingLookupCalls >= 3) {
            const indexStart = Date.now();
            context.incomingCallsiteIndexByCalleeSig = buildIncomingCallsiteIndex(scene, cg);
            context.stats.incomingIndexBuildMs += (Date.now() - indexStart);
            context.stats.incomingIndexBuilt = true;
            return context.incomingCallsiteIndexByCalleeSig.get(targetSig) || [];
        }
    }

    const scanStart = Date.now();
    const out: any[] = [];
    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const callSites = cg.getCallSiteByStmt(stmt) || [];
            for (const cs of callSites) {
                const calleeFuncID = cs.getCalleeFuncID?.();
                if (calleeFuncID === undefined || calleeFuncID === null) continue;
                const csCalleeSig = cg.getMethodByFuncID(calleeFuncID)?.toString?.() || "";
                if (csCalleeSig !== targetSig) continue;
                const key = `${cs.callerFuncID || -1}#${calleeFuncID}#${stmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${stmt.toString?.() || ""}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(cs);
            }
        }
    }
    if (context) {
        context.stats.incomingDirectScanMs += (Date.now() - scanStart);
    }
    return out;
}

function buildIncomingCallsiteIndex(scene: Scene, cg: CallGraph): Map<string, any[]> {
    const out = new Map<string, any[]>();
    const dedup = new Map<string, Set<string>>();
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const callSites = cg.getCallSiteByStmt(stmt) || [];
            for (const cs of callSites) {
                const calleeFuncID = cs.getCalleeFuncID?.();
                if (calleeFuncID === undefined || calleeFuncID === null) continue;
                const calleeSig = cg.getMethodByFuncID(calleeFuncID)?.toString?.() || "";
                if (!calleeSig) continue;
                const key = `${cs.callerFuncID || -1}#${calleeFuncID}#${stmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${stmt.toString?.() || ""}`;
                if (!dedup.has(calleeSig)) dedup.set(calleeSig, new Set<string>());
                const seen = dedup.get(calleeSig)!;
                if (seen.has(key)) continue;
                seen.add(key);
                if (!out.has(calleeSig)) out.set(calleeSig, []);
                out.get(calleeSig)!.push(cs);
            }
        }
    }
    return out;
}

function resolveMethodsByPropertyName(
    scene: Scene,
    propertyName: string,
    sourceFile: string,
    context?: SyntheticInvokeLookupContext
): any[] {
    if (context) {
        context.stats.methodLookupCalls++;
    }
    const normalizedTarget = normalizeMethodNameForMatch(propertyName);
    const fileKey = sourceFile || "__all__";
    const lookupKey = `${fileKey}::${normalizedTarget}`;
    if (context?.methodLookupCacheByFileAndProperty.has(lookupKey)) {
        context.stats.methodLookupCacheHits++;
        return [...(context.methodLookupCacheByFileAndProperty.get(lookupKey) || [])];
    }

    const out: any[] = [];
    const seen = new Set<string>();
    const pushMethod = (m: any): void => {
        if (!m || !m.getCfg || !m.getCfg()) return;
        const sig = m.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(m);
    };

    const methods = getMethodsByFileCached(scene, sourceFile, context);
    for (const method of methods) {
        const sig = method.getSignature?.().toString?.() || "";
        if (!sig) continue;

        const methodName = method.getName?.() || "";
        const normalizedMethodName = normalizeMethodNameForMatch(methodName);
        if (normalizedMethodName === normalizedTarget) {
            pushMethod(method);
            continue;
        }
        if (methodName.startsWith("%AM") && methodName.includes(`$${propertyName}`)) {
            pushMethod(method);
        }
    }

    if (context) {
        context.methodLookupCacheByFileAndProperty.set(lookupKey, [...out]);
    }
    return out;
}

function getMethodsByFileCached(
    scene: Scene,
    sourceFile: string,
    context?: SyntheticInvokeLookupContext
): any[] {
    if (!context) {
        return scene.getMethods().filter(m => {
            if (!sourceFile) return true;
            const sig = m.getSignature?.().toString?.() || "";
            return !!sig && extractFilePathFromSignature(sig) === sourceFile;
        });
    }
    const fileKey = sourceFile || "__all__";
    if (context.methodsByFileCache.has(fileKey)) {
        return context.methodsByFileCache.get(fileKey)!;
    }
    const list = scene.getMethods().filter(m => {
        if (!sourceFile) return true;
        const sig = m.getSignature?.().toString?.() || "";
        return !!sig && extractFilePathFromSignature(sig) === sourceFile;
    });
    context.methodsByFileCache.set(fileKey, list);
    return list;
}

function rankKeyParamCandidates(
    keyParamIndexes: number[],
    argByParamIndex: Map<number, any>
): Array<{ paramIndex: number; evidenceScore: number }> {
    const scored = keyParamIndexes.map(paramIndex => {
        const arg = argByParamIndex.get(paramIndex);
        const literal = resolveStringLiteralByLocalBacktrace(arg);
        let evidenceScore = 0;
        if (literal) evidenceScore += 10;
        if (hasStringTypeHint(arg)) evidenceScore += 3;
        return { paramIndex, evidenceScore };
    });
    scored.sort((a, b) => b.evidenceScore - a.evidenceScore || a.paramIndex - b.paramIndex);
    return scored;
}

function hasStringTypeHint(value: any): boolean {
    const typeText = String(value?.getType?.()?.toString?.() || "").toLowerCase();
    if (!typeText) return false;
    return typeText.includes("string");
}

function normalizeMethodNameForMatch(name: string): string {
    return String(name || "").replace(/^\[static\]/, "").trim();
}

function resolveStringLiteralByLocalBacktrace(value: any): string | undefined {
    const direct = extractStringLiteral(value);
    if (direct) return direct;
    if (!(value instanceof Local)) return undefined;

    const MAX_BACKTRACE_STEPS = 5;
    const MAX_VISITED_DEFS = 16;
    const rootMethodSig = value.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
    if (!rootMethodSig) return undefined;

    let current: any = value;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < MAX_BACKTRACE_STEPS && current instanceof Local) {
        const declStmt = current.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt)) break;
        if (declStmt.getLeftOp() !== current) break;

        const declMethodSig = declStmt.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const identity = `${current.getName?.() || ""}#${declStmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${declStmt.toString?.() || ""}`;
        if (visitedDefs.has(identity)) break;
        visitedDefs.add(identity);
        if (visitedDefs.size > MAX_VISITED_DEFS) break;

        const rightOp = declStmt.getRightOp();
        const lit = extractStringLiteral(rightOp);
        if (lit) return lit;
        if (!(rightOp instanceof Local)) break;
        current = rightOp;
        steps++;
    }
    return undefined;
}

function extractStringLiteral(value: any): string | undefined {
    if (value === undefined || value === null) return undefined;
    const text = String(value?.toString?.() || "").trim();
    if (!text) return undefined;
    const m = text.match(/^["'`](.+)["'`]$/);
    if (!m) return undefined;
    return m[1];
}

function resolveCallbackParameterIndexInCurrentMethod(callerMethod: any, callbackArg: any): number | undefined {
    if (callbackArg instanceof ArkParameterRef) {
        return callbackArg.getIndex();
    }
    if (!(callbackArg instanceof Local)) return undefined;

    const rootMethodSig = callerMethod?.getSignature?.().toString?.() || "";
    if (!rootMethodSig) return undefined;

    const MAX_BACKTRACE_STEPS = 5;
    const MAX_VISITED_DEFS = 16;
    let current: any = callbackArg;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < MAX_BACKTRACE_STEPS && current instanceof Local) {
        const declStmt = current.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt)) break;
        if (declStmt.getLeftOp() !== current) break;

        const declMethodSig = declStmt.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const defIdentity = `${current.getName?.() || ""}#${declStmt.getOriginPositionInfo?.()?.getLineNo?.() || -1}#${declStmt.toString?.() || ""}`;
        if (visitedDefs.has(defIdentity)) break;
        visitedDefs.add(defIdentity);
        if (visitedDefs.size > MAX_VISITED_DEFS) break;

        const rightOp = declStmt.getRightOp();
        if (rightOp instanceof ArkParameterRef) return rightOp.getIndex();
        if (!(rightOp instanceof Local)) break;

        current = rightOp;
        steps++;
    }

    return undefined;
}

function extractFilePathFromSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : "";
}

function extractLineNoFromSignature(signature: string): number {
    const m = signature.match(/@[^:>]+:(\d+):\d+>/);
    if (!m) return Number.MAX_SAFE_INTEGER;
    const parsed = Number(m[1]);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

interface CallbackCapturedValueMapping {
    callbackValue: any;
    callerLocalName: string;
    anchorStmt?: any;
}

function collectCallbackCapturedLocalMappings(
    callbackMethod: any,
    paramStmts: ArkAssignStmt[]
): CallbackCapturedValueMapping[] {
    const cfg = callbackMethod.getCfg?.();
    if (!cfg) return [];
    const callbackClassSig = callbackMethod.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
    const allowDirectCapturedLocals = isAnonymousObjectCarrierClassSignature(callbackClassSig);

    const carrierLocalNames = new Set<string>();
    for (const pStmt of paramStmts) {
        const left = pStmt.getLeftOp();
        if (left instanceof Local) {
            carrierLocalNames.add(left.getName());
        }
    }

    const out: CallbackCapturedValueMapping[] = [];
    const seen = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local) || (!(right instanceof ArkInstanceFieldRef) && !(right instanceof ClosureFieldRef))) continue;

            const base = right.getBase();
            if (!(base instanceof Local)) continue;
            const isLikelyClosureCarrier = base.getName().startsWith("%closures") || (right instanceof ClosureFieldRef);
            if (!carrierLocalNames.has(base.getName()) && !isLikelyClosureCarrier) continue;

            const fallbackName = right instanceof ArkInstanceFieldRef
                ? right.getFieldSignature().getFieldName()
                : right.getFieldName();
            const callerLocalName = fallbackName || left.getName();
            const key = `assign|${left.getName()}|${callerLocalName}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                callbackValue: left,
                callerLocalName,
                anchorStmt: stmt,
            });
            continue;
        }

        if (allowDirectCapturedLocals && stmt instanceof ArkAssignStmt) {
            const right = stmt.getRightOp();
            if (right instanceof Local && isDirectCapturedLocalReference(right)) {
                const callerLocalName = right.getName();
                const key = `assign-local|${callerLocalName}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    out.push({
                        callbackValue: right,
                        callerLocalName,
                        anchorStmt: stmt,
                    });
                }
            }
        }

        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        for (const invokeArg of invokeArgs) {
            if (!(invokeArg instanceof ArkInstanceFieldRef) && !(invokeArg instanceof ClosureFieldRef)) continue;
            const base = invokeArg.getBase?.();
            if (!(base instanceof Local)) continue;
            const isLikelyClosureCarrier = base.getName().startsWith("%closures") || (invokeArg instanceof ClosureFieldRef);
            if (!carrierLocalNames.has(base.getName()) && !isLikelyClosureCarrier) continue;

            const fallbackName = invokeArg instanceof ArkInstanceFieldRef
                ? invokeArg.getFieldSignature().getFieldName()
                : invokeArg.getFieldName();
            const callerLocalName = fallbackName || String(invokeArg.toString?.() || "");
            const key = `invoke|${String(invokeArg.toString?.() || "")}|${callerLocalName}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                callbackValue: invokeArg,
                callerLocalName,
                anchorStmt: stmt,
            });
        }

        if (!allowDirectCapturedLocals) continue;
        for (const invokeArg of invokeArgs) {
            if (!(invokeArg instanceof Local) || !isDirectCapturedLocalReference(invokeArg)) continue;
            const callerLocalName = invokeArg.getName();
            const key = `invoke-local|${callerLocalName}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                callbackValue: invokeArg,
                callerLocalName,
                anchorStmt: stmt,
            });
        }
    }
    return out;
}

function isDirectCapturedLocalReference(value: Local): boolean {
    const localName = value.getName?.() || "";
    if (!localName || localName === "this" || localName.startsWith("%")) return false;
    return !value.getDeclaringStmt?.();
}
