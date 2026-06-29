import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkPtrInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
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
    resolveMethodsFromCallable,
    type CalleeResolveOptions,
} from "../../substrate/queries/CalleeResolver";
import {
    resolveKnownControllerOptionCallbackRegistrationsFromStmt,
    type FrameworkResolvedCallbackRegistration,
} from "../../entry/shared/FrameworkCallbackClassifier";
import { isSdkBackedMethodSignature } from "../../substrate/queries/SdkProvenance";
import { materializeExactPagNodes, resolveExistingPagNodes } from "../contracts/PagNodeResolution";
import { collectCarrierNodeIdsForValueAtStmt } from "../ordinary/OrdinaryAliasPropagation";
import type {
    CallEdgeMaterializationLedgerRecord,
    SyntheticInvokeEdgeInfo,
} from "./SyntheticInvokeEdgeBuilder";

export interface SyntheticInvokeLookupStats {
    incomingLookupCalls: number;
    incomingDirectScanMs: number;
    incomingIndexBuildMs: number;
    incomingIndexBuilt: boolean;
    methodLookupCalls: number;
    methodLookupCacheHits: number;
    resolvedInvokeTargetCalls: number;
    resolvedInvokeTargetCacheHits: number;
    controllerOptionRegistrationCalls: number;
    controllerOptionRegistrationCacheHits: number;
    storedReceiverFieldCallbackCalls: number;
    storedReceiverFieldCallbackCacheHits: number;
    callbackArgMethodCalls: number;
    callbackArgMethodCacheHits: number;
}

export interface SyntheticInvokeLookupContext {
    incomingCallsiteIndexByCalleeSig?: Map<string, any[]>;
    thisOwnerNamesByMethodSignature?: Map<string, Set<string>>;
    methodLookupCacheByFileAndProperty: Map<string, any[]>;
    methodsByFileCache: Map<string, any[]>;
    resolvedInvokeTargetsByStmt: WeakMap<object, any[]>;
    controllerOptionRegistrationsByStmt: WeakMap<object, FrameworkResolvedCallbackRegistration[]>;
    storedReceiverFieldCallbackBindingsByStmt: WeakMap<object, AsyncCallbackBinding[]>;
    callbackMethodsByArgCallable: WeakMap<object, any[]>;
    callbackMethodsByArgSdk: WeakMap<object, any[]>;
    stats: SyntheticInvokeLookupStats;
}

export interface AsyncCallbackBinding {
    method: any;
    sourceMethod: any;
    reason: "direct" | "one_hop";
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
    invokedParamCache: Map<string, Set<number>>,
    lookupContext?: SyntheticInvokeLookupContext,
): AsyncCallbackBinding[] {
    const out: AsyncCallbackBinding[] = [];
    const seen = new Set<string>();
    const addBinding = (method: any, sourceMethod: any, reason: "direct" | "one_hop"): void => {
        const callbackSig = method?.getSignature?.().toString?.() || "";
        const sourceSig = sourceMethod?.getSignature?.().toString?.() || "";
        const key = `${sourceSig}=>${callbackSig}`;
        if (!callbackSig || seen.has(key)) return;
        seen.add(key);
        out.push({
            method,
            sourceMethod: sourceMethod || caller,
            reason,
        });
    };

    for (const reg of collectControllerOptionRegistrationsCached(stmt, scene, caller, lookupContext)) {
        addBinding(reg.callbackMethod, reg.sourceMethod || caller, "direct");
    }
    for (const binding of collectStoredReceiverFieldCallbackBindingsForStmt(scene, cg, caller, stmt, invokeExpr, lookupContext)) {
        addBinding(binding.method, binding.sourceMethod || caller, binding.reason);
    }

    const resolvedCallees = collectResolvedInvokeTargetsCached(scene, cg, stmt, invokeExpr, lookupContext);
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
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, pair.arg, isSdk, lookupContext)
                    .filter(method => !!method?.getCfg?.());
                if (callbackMethods.length === 0) continue;
                if (!isSdk && (!invokedParams || !invokedParams.has(pair.paramIndex))) continue;

                for (const callbackMethod of callbackMethods) {
                    addBinding(callbackMethod, caller, "direct");
                }
            }
        } else if (isSdk) {
            for (const arg of explicitArgs) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, arg, true, lookupContext)
                    .filter(method => !!method?.getCfg?.());
                for (const callbackMethod of callbackMethods) {
                    addBinding(callbackMethod, caller, "direct");
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
        for (const nodeId of resolveExistingPagNodes(pag, callerLocal, stmt)?.values?.() || []) {
            out.add(nodeId);
        }
    }

    const capturedLocalMappings = collectCallbackCapturedLocalMappings(cbMethod, paramStmts);
    for (const mapping of capturedLocalMappings) {
        const callerLocal = sourceLocals.get(mapping.callerLocalName);
        if (!(callerLocal instanceof Local)) continue;
        for (const nodeId of resolveExistingPagNodes(pag, callerLocal, stmt)?.values?.() || []) {
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
    invokedParamCache: Map<string, Set<number>>,
    materializationLedger?: CallEdgeMaterializationLedgerRecord[],
    lookupContext?: SyntheticInvokeLookupContext,
): number {
    const resolvedCallees = collectResolvedInvokeTargetsCached(scene, cg, stmt, invokeExpr, lookupContext);
    let count = 0;
    const seenBindings = new Set<string>();

    const injectKnownOptionCallbacks = (): void => {
        const optionRegs = collectControllerOptionRegistrationsCached(stmt, scene, caller, lookupContext);
        for (const reg of optionRegs) {
            const callbackSig = reg.callbackMethod.getSignature?.().toString?.() || "";
            if (!callbackSig) {
                continue;
            }
            const bindingKey = `option#${stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0}#${callbackSig}`;
            if (seenBindings.has(bindingKey)) {
                continue;
            }
            seenBindings.add(bindingKey);
            count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, reg.callbackMethod, reg.sourceMethod || caller, {
                explicitParamSourceValuesByIndex: collectInvokeArgsByCallbackParamIndex(invokeExpr, reg.callbackMethod),
                materializationLedger,
                registrationKind: "known_option_callback",
            });
        }
    };

    const injectStoredReceiverFieldCallbacks = (): void => {
        const bindings = collectStoredReceiverFieldCallbackBindingsForStmt(scene, cg, caller, stmt, invokeExpr, lookupContext);
        for (const binding of bindings) {
            const callbackSig = binding.method?.getSignature?.().toString?.() || "";
            if (!callbackSig) continue;
            const bindingKey = `receiver-field#${stmt.getOriginPositionInfo?.()?.getLineNo?.() || 0}#${callbackSig}`;
            if (seenBindings.has(bindingKey)) continue;
            seenBindings.add(bindingKey);
            count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, binding.method, binding.sourceMethod || caller, {
                materializationLedger,
                registrationKind: "stored_receiver_field_callback",
            });
        }
    };

    if (resolvedCallees.length === 0) {
        injectKnownOptionCallbacks();
        injectStoredReceiverFieldCallbacks();
        return count;
    }

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
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, pair.arg, isSdk, lookupContext)
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
                    const wrapperSources = isSdk
                        ? emptyCallbackParamSourceBindings()
                        : collectCallbackInvocationParamSourceBindings(callee, pair.paramStmt, callbackMethod);
                    count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, callbackMethod, isSdk ? caller : callee, {
                        explicitParamSourceValuesByIndex: wrapperSources.valuesByIndex,
                        explicitParamSourceAnchorStmtByIndex: wrapperSources.anchorStmtByIndex,
                        captureSourceMethod: caller,
                        materializationLedger,
                        registrationKind: isSdk ? "sdk_callback_arg" : "wrapper_callback_arg",
                    });
                }
            }
        } else if (isSdk) {
            for (let argIdx = 0; argIdx < explicitArgs.length; argIdx++) {
                const callbackMethods = resolveSyntheticCallbackMethodsForArg(scene, explicitArgs[argIdx], true, lookupContext)
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
                    count += injectCallbackBindingEdges(pag, caller, stmt, edgeMap, callbackMethod, caller, {
                        materializationLedger,
                        registrationKind: "sdk_callback_arg",
                    });
                }
            }
        }
    }

    injectKnownOptionCallbacks();
    injectStoredReceiverFieldCallbacks();
    return count;
}

export function collectStoredReceiverFieldCallbackBindingsForStmt(
    scene: Scene,
    cg: CallGraph,
    caller: any,
    stmt: any,
    invokeExpr: any,
    lookupContext?: SyntheticInvokeLookupContext,
): AsyncCallbackBinding[] {
    if (lookupContext && isWeakMapKey(stmt)) {
        lookupContext.stats.storedReceiverFieldCallbackCalls++;
        const cached = lookupContext.storedReceiverFieldCallbackBindingsByStmt.get(stmt);
        if (cached) {
            lookupContext.stats.storedReceiverFieldCallbackCacheHits++;
            return [...cached];
        }
        const computed = collectStoredReceiverFieldCallbackBindingsForStmtUncached(scene, cg, caller, stmt, invokeExpr, lookupContext);
        lookupContext.storedReceiverFieldCallbackBindingsByStmt.set(stmt, [...computed]);
        return computed;
    }
    return collectStoredReceiverFieldCallbackBindingsForStmtUncached(scene, cg, caller, stmt, invokeExpr, lookupContext);
}

function collectStoredReceiverFieldCallbackBindingsForStmtUncached(
    scene: Scene,
    cg: CallGraph,
    caller: any,
    stmt: any,
    invokeExpr: any,
    lookupContext?: SyntheticInvokeLookupContext,
): AsyncCallbackBinding[] {
    const dispatchBase = invokeExpr?.getBase?.();
    if (!(dispatchBase instanceof Local)) return [];

    const resolvedDispatchMethods = collectResolvedInvokeTargetsCached(scene, cg, stmt, invokeExpr, lookupContext);
    const dispatchedFieldNames = new Set<string>();
    for (const method of resolvedDispatchMethods) {
        for (const fieldName of collectInvokedThisFieldCallbackNames(method)) {
            dispatchedFieldNames.add(fieldName);
        }
    }
    if (dispatchedFieldNames.size === 0) return [];

    const cfg = caller?.getCfg?.();
    if (!cfg) return [];
    const stmts = cfg.getStmts?.() || [];
    const currentIndex = stmts.indexOf(stmt);
    if (currentIndex < 0) return [];

    const out: AsyncCallbackBinding[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < currentIndex; i++) {
        const candidateStmt = stmts[i];
        const candidateInvoke = candidateStmt?.getInvokeExpr?.();
        if (!candidateInvoke) continue;
        const candidateBase = candidateInvoke.getBase?.();
        if (!(candidateBase instanceof Local)) continue;
        if (candidateBase.getName?.() !== dispatchBase.getName?.()) continue;

        const candidateArgs = candidateInvoke.getArgs?.() || [];
            for (const registrationMethod of collectResolvedInvokeTargetsCached(scene, cg, candidateStmt, candidateInvoke, lookupContext)) {
            for (const fieldName of dispatchedFieldNames) {
                const callbackParamIndexes = collectThisFieldCallbackStoreParamIndexes(registrationMethod, fieldName);
                for (const paramIndex of callbackParamIndexes) {
                    const callbackValue = candidateArgs[paramIndex];
                    if (!callbackValue) continue;
                    for (const callbackMethod of resolveCallbackMethodsFromValueWithReturns(scene, callbackValue, { maxDepth: 6 })) {
                        const callbackSig = callbackMethod?.getSignature?.().toString?.() || "";
                        if (!callbackSig || !callbackMethod?.getCfg?.()) continue;
                        const key = `${fieldName}#${callbackSig}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        out.push({
                            method: callbackMethod,
                            sourceMethod: caller,
                            reason: "direct",
                        });
                    }
                }
            }
        }
    }
    return out;
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

export function collectResolvedInvokeTargets(
    scene: Scene,
    cg: CallGraph,
    stmt: any,
    invokeExpr: any,
    options: CalleeResolveOptions = {},
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

    for (const resolved of resolveCalleeCandidates(scene, invokeExpr, options)) {
        add(resolved.method);
    }
    return out;
}

export function collectResolvedInvokeTargetsCached(
    scene: Scene,
    cg: CallGraph,
    stmt: any,
    invokeExpr: any,
    context?: SyntheticInvokeLookupContext,
): any[] {
    if (!context || !isWeakMapKey(stmt)) {
        return collectResolvedInvokeTargets(scene, cg, stmt, invokeExpr);
    }
    context.stats.resolvedInvokeTargetCalls++;
    const cached = context.resolvedInvokeTargetsByStmt.get(stmt);
    if (cached) {
        context.stats.resolvedInvokeTargetCacheHits++;
        return [...cached];
    }
    const resolved = collectResolvedInvokeTargets(scene, cg, stmt, invokeExpr);
    context.resolvedInvokeTargetsByStmt.set(stmt, [...resolved]);
    return resolved;
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
    isSdk: boolean,
    context?: SyntheticInvokeLookupContext,
): any[] {
    const cache = isSdk ? context?.callbackMethodsByArgSdk : context?.callbackMethodsByArgCallable;
    if (cache && isWeakMapKey(arg)) {
        context!.stats.callbackArgMethodCalls++;
        const cached = cache.get(arg);
        if (cached) {
            context!.stats.callbackArgMethodCacheHits++;
            return [...cached];
        }
        const resolved = resolveSyntheticCallbackMethodsForArgUncached(scene, arg, isSdk);
        cache.set(arg, [...resolved]);
        return resolved;
    }
    return resolveSyntheticCallbackMethodsForArgUncached(scene, arg, isSdk);
}

function resolveSyntheticCallbackMethodsForArgUncached(
    scene: Scene,
    arg: any,
    isSdk: boolean,
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

function collectControllerOptionRegistrationsCached(
    stmt: any,
    scene: Scene,
    caller: any,
    context?: SyntheticInvokeLookupContext,
): FrameworkResolvedCallbackRegistration[] {
    if (!context || !isWeakMapKey(stmt)) {
        return resolveKnownControllerOptionCallbackRegistrationsFromStmt(stmt, scene, caller);
    }
    context.stats.controllerOptionRegistrationCalls++;
    const cached = context.controllerOptionRegistrationsByStmt.get(stmt);
    if (cached) {
        context.stats.controllerOptionRegistrationCacheHits++;
        return [...cached];
    }
    const resolved = resolveKnownControllerOptionCallbackRegistrationsFromStmt(stmt, scene, caller);
    context.controllerOptionRegistrationsByStmt.set(stmt, [...resolved]);
    return resolved;
}

function isWeakMapKey(value: any): value is object {
    return value !== null && (typeof value === "object" || typeof value === "function");
}

function collectInvokeArgsByCallbackParamIndex(invokeExpr: any, callbackMethod: any): Map<number, any> {
    const explicitArgs = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const paramStmts = collectParameterAssignStmts(callbackMethod);
    const out = new Map<number, any>();
    for (const pair of mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts)) {
        if (!out.has(pair.paramIndex)) {
            out.set(pair.paramIndex, pair.arg);
        }
    }
    return out;
}

function emptyCallbackParamSourceBindings(): {
    valuesByIndex: Map<number, any>;
    anchorStmtByIndex: Map<number, any>;
} {
    return {
        valuesByIndex: new Map<number, any>(),
        anchorStmtByIndex: new Map<number, any>(),
    };
}

function collectCallbackInvocationParamSourceBindings(
    sourceMethod: any,
    callbackParamStmt: ArkAssignStmt,
    callbackMethod: any,
): {
    valuesByIndex: Map<number, any>;
    anchorStmtByIndex: Map<number, any>;
} {
    const out = emptyCallbackParamSourceBindings();
    const callbackParamLocal = callbackParamStmt.getLeftOp?.();
    if (!(callbackParamLocal instanceof Local)) return out;

    const callbackLocalNames = collectCallbackCallableLocalNames(sourceMethod, callbackParamLocal.getName?.() || "");
    if (callbackLocalNames.size === 0) return out;

    const callbackParamStmts = collectParameterAssignStmts(callbackMethod);
    if (callbackParamStmts.length === 0) return out;

    for (const stmt of sourceMethod?.getCfg?.()?.getStmts?.() || []) {
        if (!stmt?.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        const callable = getCallbackInvokeCallableValue(invokeExpr);
        if (!(callable instanceof Local)) continue;
        if (!callbackLocalNames.has(callable.getName?.() || "")) continue;

        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        for (const pair of mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, callbackParamStmts)) {
            if (!out.valuesByIndex.has(pair.paramIndex)) {
                out.valuesByIndex.set(pair.paramIndex, pair.arg);
                out.anchorStmtByIndex.set(pair.paramIndex, stmt);
            }
        }
    }

    return out;
}

function collectCallbackCallableLocalNames(sourceMethod: any, callbackParamName: string): Set<string> {
    const names = new Set<string>();
    if (!callbackParamName) return names;
    names.add(callbackParamName);

    let changed = true;
    let rounds = 0;
    while (changed && rounds < 4) {
        changed = false;
        rounds++;
        for (const stmt of sourceMethod?.getCfg?.()?.getStmts?.() || []) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local) || !(right instanceof Local)) continue;
            if (!names.has(right.getName?.() || "")) continue;
            const leftName = left.getName?.() || "";
            if (!leftName || names.has(leftName)) continue;
            names.add(leftName);
            changed = true;
        }
    }

    return names;
}

function getCallbackInvokeCallableValue(invokeExpr: any): any {
    if (!invokeExpr) return undefined;
    if (invokeExpr instanceof ArkPtrInvokeExpr && typeof invokeExpr.getFuncPtrLocal === "function") {
        return invokeExpr.getFuncPtrLocal();
    }
    if (typeof invokeExpr.getBase === "function") {
        return invokeExpr.getBase();
    }
    return undefined;
}

function resolveParamIndexFromAssignStmt(stmt: any): number | undefined {
    const right = stmt?.getRightOp?.();
    if (right instanceof ArkParameterRef) {
        return right.getIndex();
    }
    return undefined;
}

export function injectCallbackBindingEdges(
    pag: Pag,
    caller: any,
    stmt: any,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    cbMethod: any,
    sourceMethod: any,
    options?: {
        explicitParamSourceValuesByIndex?: Map<number, any>;
        explicitParamSourceAnchorStmtByIndex?: Map<number, any>;
        captureSourceMethod?: any;
        materializationLedger?: CallEdgeMaterializationLedgerRecord[];
        registrationKind?: string;
    },
): number {
    const sourceBody = sourceMethod?.getBody?.();
    const sourceLocals = sourceBody?.getLocals?.();
    if (!sourceLocals) {
        pushCallbackMaterializationRecord(options?.materializationLedger, caller, sourceMethod, stmt, cbMethod, 0, "missing_callback_source_body", options?.registrationKind);
        return 0;
    }

    const paramStmts = collectParameterAssignStmts(cbMethod);
    const calleeSig = cbMethod.getSignature().toString();
    const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + simpleHash(calleeSig);
    const capturedLocalMappings = collectCallbackCapturedLocalMappings(cbMethod, paramStmts);
    const captureSourceMethod = options?.captureSourceMethod || sourceMethod;
    const captureSourceLocals = captureSourceMethod?.getBody?.()?.getLocals?.();

    let count = 0;
    if (paramStmts.length > 0) {
        for (const paramStmt of paramStmts) {
            const paramLocal = paramStmt.getLeftOp();
            if (!(paramLocal instanceof Local)) continue;
            const paramIndex = resolveParamIndexFromAssignStmt(paramStmt);
            const explicitSource = paramIndex !== undefined
                ? options?.explicitParamSourceValuesByIndex?.get(paramIndex)
                : undefined;
            const explicitSourceAnchor = paramIndex !== undefined
                ? options?.explicitParamSourceAnchorStmtByIndex?.get(paramIndex)
                : undefined;
            let srcNodes = explicitSource !== undefined
                ? resolveExistingPagNodes(pag, explicitSource, explicitSourceAnchor || stmt)
                : undefined;
            if ((!srcNodes || srcNodes.size === 0) && explicitSource !== undefined) {
                srcNodes = materializeExactPagNodes(pag, explicitSource, explicitSourceAnchor || stmt, 0);
            }
            let callerLocalForCarrier: Local | undefined;
            if (!srcNodes || srcNodes.size === 0) {
                const callerLocal = sourceLocals.get(paramLocal.getName());
                if (!(callerLocal instanceof Local)) continue;
                callerLocalForCarrier = callerLocal;
                srcNodes = resolveExistingPagNodes(pag, callerLocal, stmt);
            } else if (explicitSource instanceof Local) {
                callerLocalForCarrier = explicitSource;
            }
            let dstNodes = resolveExistingPagNodes(pag, paramLocal, paramStmt);
            if ((!dstNodes || dstNodes.size === 0) && paramStmt.getRightOp() instanceof ArkParameterRef) {
                dstNodes = resolveExistingPagNodes(pag, paramStmt.getRightOp(), paramStmt);
            }
            if ((!dstNodes || dstNodes.size === 0) && srcNodes && srcNodes.size > 0) {
                dstNodes = materializeExactNodesForSourceContexts(pag, paramLocal, paramStmt, srcNodes);
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
            for (const srcNodeId of collectPointToNodeIds(pag, srcNodes.values())) {
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
                        originTag: "synthetic.callback.object_arg",
                        preserveFieldPath: true,
                    });
                    count++;
                }
            }
            if (callerLocalForCarrier) {
                for (const srcNodeId of collectCarrierNodeIdsForValueAtStmt(pag, callerLocalForCarrier, stmt)) {
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
                            originTag: "synthetic.callback.carrier_arg",
                            preserveFieldPath: true,
                        });
                        count++;
                    }
                }
            }
        }
    }

    for (const mapping of capturedLocalMappings) {
        const callerLocal = captureSourceLocals?.get?.(mapping.callerLocalName);
        if (!(callerLocal instanceof Local)) continue;

        const srcNodes = resolveExistingPagNodes(pag, callerLocal, stmt);
        const effectiveDstNodes = mapping.anchorStmt
            ? shouldMaterializeExactCallbackUseEndpoint(mapping.callbackValue, mapping.anchorStmt)
                ? materializeExactPagNodes(pag, mapping.callbackValue, mapping.anchorStmt, 0)
                : resolveExistingPagNodes(pag, mapping.callbackValue, mapping.anchorStmt)
            : pag.getNodesByValue(mapping.callbackValue);
        if (!srcNodes || !effectiveDstNodes) continue;

        for (const srcNodeId of srcNodes.values()) {
            for (const dstNodeId of effectiveDstNodes.values()) {
                pushEdge(edgeMap, srcNodeId, {
                    type: CallEdgeType.CALL,
                    srcNodeId,
                    dstNodeId,
                    callSiteId,
                    callerMethodName: captureSourceMethod.getName?.() || sourceMethod.getName?.() || caller.getName(),
                    calleeMethodName: cbMethod.getName(),
                    callerSignature: captureSourceMethod.getSignature?.().toString?.() || sourceMethod.getSignature?.().toString?.() || caller.getSignature?.().toString?.(),
                    calleeSignature: calleeSig,
                });
                count++;
            }
        }
    }

    pushCallbackMaterializationRecord(
        options?.materializationLedger,
        caller,
        sourceMethod,
        stmt,
        cbMethod,
        count,
        count > 0 ? undefined : "callback_binding_nodes_not_resolved",
        options?.registrationKind,
    );
    return count;
}

function pushCallbackMaterializationRecord(
    ledger: CallEdgeMaterializationLedgerRecord[] | undefined,
    caller: any,
    sourceMethod: any,
    stmt: any,
    cbMethod: any,
    builtEdgeCount: number,
    reason?: string,
    registrationKind?: string,
): void {
    if (!ledger) return;
    ledger.push({
        recordKind: "call_edge_materialization",
        builder: "synthetic_invoke",
        edgeKind: "callback_registration",
        status: builtEdgeCount > 0 ? "built" : "not_built",
        reason,
        callerMethodName: sourceMethod?.getName?.() || caller?.getName?.() || "",
        calleeMethodName: cbMethod?.getName?.() || "",
        callerSignature: sourceMethod?.getSignature?.()?.toString?.() || caller?.getSignature?.()?.toString?.(),
        calleeSignature: cbMethod?.getSignature?.()?.toString?.(),
        callbackSignature: cbMethod?.getSignature?.()?.toString?.(),
        callbackSourceSignature: sourceMethod?.getSignature?.()?.toString?.(),
        line: stmt?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1,
        stmtText: stmt?.toString?.() || "",
        builtEdgeCount,
        syntheticEdgeBuilt: builtEdgeCount > 0,
        evidence: registrationKind ? [registrationKind] : undefined,
    });
}

function shouldMaterializeExactCallbackUseEndpoint(value: any, anchorStmt: any): boolean {
    if (!(value instanceof Local)) return false;
    const localName = value.getName?.() || "";
    if (!localName || localName === "this" || localName.startsWith("%")) return false;
    const declaringStmt = value.getDeclaringStmt?.();
    if (!declaringStmt) return true;
    if (declaringStmt !== anchorStmt || !(declaringStmt instanceof ArkAssignStmt)) {
        return false;
    }
    const right = declaringStmt.getRightOp();
    if (right instanceof ClosureFieldRef) {
        return true;
    }
    if (right instanceof ArkInstanceFieldRef) {
        const base = right.getBase?.();
        return base instanceof Local && base.getName?.().startsWith("%closures");
    }
    return false;
}

function pushEdge(map: Map<number, SyntheticInvokeEdgeInfo[]>, key: number, edge: SyntheticInvokeEdgeInfo): void {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(edge);
}

function materializeExactNodesForSourceContexts(
    pag: Pag,
    value: any,
    anchorStmt: any,
    sourceNodes: Map<number, number>,
): Map<number, number> | undefined {
    const out = new Map<number, number>();
    for (const sourceNodeId of sourceNodes.values()) {
        const sourceNode = pag.getNode(Number(sourceNodeId)) as any;
        let cid = 0;
        try {
            cid = Number(sourceNode?.getCid?.() ?? 0);
        } catch {
            cid = 0;
        }
        const nodes = materializeExactPagNodes(pag, value, anchorStmt, cid);
        const nodeId = nodes?.values?.().next?.().value;
        if (typeof nodeId === "number") {
            out.set(cid, nodeId);
        }
    }
    return out.size > 0 ? out : undefined;
}

function collectPointToNodeIds(pag: Pag, nodeIds: Iterable<number>): Set<number> {
    const out = new Set<number>();
    for (const nodeId of nodeIds) {
        const node = pag.getNode(Number(nodeId));
        for (const objId of (node as any)?.getPointTo?.() || []) {
            out.add(Number(objId));
        }
    }
    return out;
}

function simpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

function resolveAsyncCallbackBindings(
    scene: Scene,
    cg: CallGraph,
    callerMethod: any,
    callbackArg: any,
    _callsiteLine: number = 0,
    context?: SyntheticInvokeLookupContext
): AsyncCallbackBinding[] {
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

    return [];
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

function collectInvokedThisFieldCallbackNames(method: any): Set<string> {
    const out = new Set<string>();
    const cfg = method?.getCfg?.();
    if (!cfg) return out;

    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeText = String(stmt.toString?.() || "");
        const directMatch = invokeText.match(/\bthis\.([A-Za-z_$][A-Za-z0-9_$]*)</);
        if (directMatch?.[1]) {
            out.add(directMatch[1]);
            continue;
        }
        const invokeExpr = stmt.getInvokeExpr?.();
        const invokeBase = invokeExpr?.getBase?.();
        if (invokeBase instanceof ArkInstanceFieldRef) {
            const base = invokeBase.getBase?.();
            if (base instanceof Local && base.getName?.() === "this") {
                const fieldName = invokeBase.getFieldSignature?.()?.getFieldName?.();
                if (fieldName) out.add(fieldName);
            }
        }
    }
    return out;
}

function collectThisFieldCallbackStoreParamIndexes(method: any, targetFieldName: string): Set<number> {
    const out = new Set<number>();
    const cfg = method?.getCfg?.();
    if (!cfg || !targetFieldName) return out;

    const paramIndexByLocalName = new Map<string, number>();
    for (const paramStmt of collectParameterAssignStmts(method)) {
        const left = paramStmt.getLeftOp();
        const right = paramStmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof ArkParameterRef)) continue;
        paramIndexByLocalName.set(left.getName(), right.getIndex());
    }

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkInstanceFieldRef) || !(right instanceof Local)) continue;
        const base = left.getBase?.();
        if (!(base instanceof Local) || base.getName?.() !== "this") continue;
        const fieldName = left.getFieldSignature?.()?.getFieldName?.();
        if (fieldName !== targetFieldName) continue;
        const paramIndex = paramIndexByLocalName.get(right.getName());
        if (paramIndex !== undefined) {
            out.add(paramIndex);
        }
    }
    return out;
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

            const fieldName = right instanceof ArkInstanceFieldRef
                ? right.getFieldSignature().getFieldName()
                : right.getFieldName();
            const callerLocalName = fieldName || left.getName();
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

            const fieldName = invokeArg instanceof ArkInstanceFieldRef
                ? invokeArg.getFieldSignature().getFieldName()
                : invokeArg.getFieldName();
            const callerLocalName = fieldName || String(invokeArg.toString?.() || "");
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
