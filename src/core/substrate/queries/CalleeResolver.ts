import * as fs from "fs";
import * as ts from "typescript";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAwaitExpr, ArkCastExpr, ArkInstanceInvokeExpr, ArkNewExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ModelUtils } from "../../../../arkanalyzer/out/src/core/common/ModelUtils";
import { assertBuildStageBudget, BuildStageBudget } from "../../shared/BuildStageBudget";

export interface ResolvedCallee {
    method: any;
    reason: "exact" | "interface_dispatch" | "receiver_owner_dispatch" | "callable_dispatch";
}

export interface CalleeResolveOptions {
    maxNameMatchCandidates?: number;
    callableVisitKeys?: Set<string>;
    callableResolveDepth?: number;
    maxCallableResolveDepth?: number;
    enableDirectCallableTargets?: boolean;
    thisOwnerNames?: string[];
}

export interface CallableResolveOptions {
    maxCandidates?: number;
    enableLocalBacktrace?: boolean;
    maxBacktraceSteps?: number;
    maxVisitedDefs?: number;
    callableVisitKeys?: Set<string>;
    callableResolveDepth?: number;
    maxCallableResolveDepth?: number;
}

type CallableCarrierValue = ArkInstanceFieldRef | ClosureFieldRef | ArkArrayRef | ArkStaticFieldRef;

interface ConcreteOwnerResolveContext {
    declaringMethodSignature?: string;
    parameterOwnerBindings?: Map<number, string[]>;
}

interface SourceConstructorRegistry {
    byPropertyName: Map<string, Set<string>>;
}

export interface InvokeArgParamPair {
    arg: any;
    paramStmt: ArkAssignStmt;
    argIndex: number;
    paramIndex: number;
}

export interface VirtualDispatchUnresolvedDiagnostic {
    reasonCode: "virtual_dispatch_unresolved";
    invokeSignature: string;
    methodName: string;
    receiverOwner?: string;
    receiverType?: string;
    candidateCount: number;
    evidence: string[];
}

const DEFAULT_MAX_NAME_MATCH_CANDIDATES = 4;
const DEFAULT_MAX_BACKTRACE_STEPS = 5;
const DEFAULT_MAX_VISITED_DEFS = 16;
const DEFAULT_MAX_CALLABLE_RESOLVE_DEPTH = 8;
const DEFAULT_MAX_CONCRETE_OWNER_RESOLVE_DEPTH = 8;

interface SceneMethodIndex {
    bySignature: Map<string, any>;
    byNormalizedName: Map<string, any[]>;
    byInterfaceMethod: Map<string, any[]>;
}

const _sceneMethodIndexCache = new WeakMap<Scene, SceneMethodIndex>();
const _sceneConcreteOwnerNameCache = new WeakMap<Scene, Set<string>>();
const _sourceConstructorRegistryCache = new Map<string, SourceConstructorRegistry>();

function getSceneMethodIndex(scene: Scene): SceneMethodIndex {
    let index = _sceneMethodIndexCache.get(scene);
    if (index) return index;
    const bySignature = new Map<string, any>();
    const byNormalizedName = new Map<string, any[]>();
    const byInterfaceMethod = new Map<string, any[]>();
    for (const m of scene.getMethods()) {
        const sig = safeMethodSignatureText(m);
        if (sig) bySignature.set(sig, m);
        const name = normalizeMethodName(m.getName?.() || "");
        if (name) {
            let list = byNormalizedName.get(name);
            if (!list) { list = []; byNormalizedName.set(name, list); }
            list.push(m);
        }
    }
    for (const cls of scene.getClasses?.() || []) {
        const interfaceNames = safeImplementedInterfaceNames(cls);
        if (interfaceNames.length === 0) continue;
        for (const method of cls.getMethods?.() || []) {
            if (!method?.getCfg?.()) continue;
            if (isStaticMethod(method)) continue;
            const methodName = normalizeMethodName(method.getName?.() || "");
            if (!methodName) continue;
            const paramCount = getFormalParamCount(method);
            for (const interfaceName of interfaceNames) {
                const key = interfaceDispatchKey(interfaceName, methodName, paramCount);
                let list = byInterfaceMethod.get(key);
                if (!list) {
                    list = [];
                    byInterfaceMethod.set(key, list);
                }
                list.push(method);
            }
        }
    }
    index = { bySignature, byNormalizedName, byInterfaceMethod };
    _sceneMethodIndexCache.set(scene, index);
    return index;
}

export function resolveInvokeMethodName(invokeExpr: any): string {
    if (!invokeExpr) return "";
    const fromSubSig = safeInvokeMethodSubSignatureName(invokeExpr);
    if (fromSubSig) return normalizeMethodName(fromSubSig);
    const sig = safeInvokeSignatureText(invokeExpr);
    return extractMethodNameFromSignature(sig);
}

export function resolveCalleeCandidates(
    scene: Scene,
    invokeExpr: any,
    options: CalleeResolveOptions = {}
): ResolvedCallee[] {
    const maxNameMatchCandidates = options.maxNameMatchCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    const invokeSig = safeInvokeSignatureText(invokeExpr);
    const reflectDispatch = isReflectDispatchInvoke(invokeExpr);
    const idx = getSceneMethodIndex(scene);
    const exact = invokeSig ? idx.bySignature.get(invokeSig) : undefined;
    if (exact && !reflectDispatch && isInstanceInvokeLike(invokeExpr)) {
        const receiverOwners = resolveConcreteReceiverOwnersForInvoke(scene, invokeExpr, options);
        const methodName = resolveInvokeMethodName(invokeExpr);
        const argCount = invokeExpr?.getArgs ? invokeExpr.getArgs().length : 0;
        const ownerTargets = receiverOwners.length > 0 && methodName
            ? resolveInstanceTargetsForExactOwners(scene, idx, receiverOwners, methodName, argCount)
            : [];
        const exactSig = safeMethodSignatureText(exact);
        const exactTargetIncluded = ownerTargets.some(method => safeMethodSignatureText(method) === exactSig);
        if (ownerTargets.length > 0 && (receiverOwners.length > 1 || !exactTargetIncluded)) {
            return ownerTargets.map(method => ({ method, reason: "receiver_owner_dispatch" as const }));
        }
    }
    if (exact && !reflectDispatch && exact.getCfg?.()) {
        return [{ method: exact, reason: "exact" }];
    }

    if (exact && !reflectDispatch && isInstanceInvokeLike(invokeExpr)) {
        const interfaceTargets = resolveInterfaceDispatchTargets(scene, idx, exact, invokeExpr, maxNameMatchCandidates);
        if (interfaceTargets.length > 0) {
            const receiverOwners = resolveConcreteReceiverOwnersForInvoke(scene, invokeExpr, options);
            const narrowedByOwners = narrowTargetsByExactOwners(interfaceTargets, receiverOwners, true);
            if (narrowedByOwners.length > 0) {
                return narrowedByOwners.map(method => ({ method, reason: "interface_dispatch" as const }));
            }
            const receiverOwner = receiverOwners.length === 1 ? receiverOwners[0] : undefined;
            const interfaceOwner = extractOwnerNameFromSignature(safeMethodSignatureText(exact));
            if (!receiverOwner || ownerNamesEqual(receiverOwner, interfaceOwner)) {
                return interfaceTargets.length === 1
                    ? interfaceTargets.map(method => ({ method, reason: "interface_dispatch" as const }))
                    : [];
            }
            const narrowed = interfaceTargets.filter(method => methodOwnerMatches(method, receiverOwner));
            if (narrowed.length === 1) {
                return narrowed.map(method => ({ method, reason: "interface_dispatch" as const }));
            }
        }
    }

    if (reflectDispatch) {
        return [];
    }

    if (isInstanceInvokeLike(invokeExpr)) {
        const receiverOwners = resolveConcreteReceiverOwnersForInvoke(scene, invokeExpr, options);
        const methodName = resolveInvokeMethodName(invokeExpr);
        const argCount = invokeExpr?.getArgs ? invokeExpr.getArgs().length : 0;
        const ownerTargets = receiverOwners.length > 0 && methodName
            ? resolveInstanceTargetsForExactOwners(scene, idx, receiverOwners, methodName, argCount)
            : [];
        if (ownerTargets.length > 0) {
            return ownerTargets.map(method => ({ method, reason: "receiver_owner_dispatch" as const }));
        }
    }

    if (options.enableDirectCallableTargets !== false) {
        const typeTargets = resolveDirectCallableTargets(scene, invokeExpr, maxNameMatchCandidates, options);
        if (typeTargets.length === 1) {
            return typeTargets.map(method => ({ method, reason: "callable_dispatch" as const }));
        }
    }
    return [];
}

export function diagnoseUnresolvedVirtualDispatch(
    scene: Scene,
    invokeExpr: any,
    options: CalleeResolveOptions = {},
): VirtualDispatchUnresolvedDiagnostic | undefined {
    if (!isInstanceInvokeLike(invokeExpr) || isReflectDispatchInvoke(invokeExpr)) return undefined;

    const methodName = resolveInvokeMethodName(invokeExpr);
    if (!methodName) return undefined;

    const maxNameMatchCandidates = options.maxNameMatchCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    const idx = getSceneMethodIndex(scene);
    const invokeSignature = safeInvokeSignatureText(invokeExpr);
    const exact = invokeSignature ? idx.bySignature.get(invokeSignature) : undefined;
    const receiverOwner = resolveConcreteReceiverOwnerForInvoke(scene, invokeExpr, options);
    const receiverType = safeTypeText(safeGetValueType(invokeExpr.getBase?.()));
    const argCount = invokeExpr?.getArgs ? invokeExpr.getArgs().length : 0;
    const evidence: string[] = [];

    if (invokeSignature && !invokeSignature.includes("%unk")) evidence.push("invoke_signature");
    if (receiverType && !receiverType.includes("%unk")) evidence.push("receiver_type");
    if (receiverOwner) evidence.push("receiver_owner");

    const makeDiagnostic = (candidateCount: number, extraEvidence: string[]): VirtualDispatchUnresolvedDiagnostic => ({
        reasonCode: "virtual_dispatch_unresolved",
        invokeSignature,
        methodName,
        receiverOwner,
        receiverType,
        candidateCount,
        evidence: [...evidence, ...extraEvidence],
    });

    if (exact && !exact.getCfg?.()) {
        const interfaceTargets = resolveInterfaceDispatchTargets(scene, idx, exact, invokeExpr, maxNameMatchCandidates);
        if (interfaceTargets.length > 0) {
            const interfaceOwner = extractOwnerNameFromSignature(safeMethodSignatureText(exact));
            if (!receiverOwner || ownerNamesEqual(receiverOwner, interfaceOwner)) {
                return interfaceTargets.length === 1
                    ? undefined
                    : makeDiagnostic(interfaceTargets.length, ["interface_targets", "missing_concrete_receiver_owner"]);
            }
            const narrowed = interfaceTargets.filter(method => methodOwnerMatches(method, receiverOwner));
            if (narrowed.length !== 1) {
                return makeDiagnostic(narrowed.length, ["interface_targets", "receiver_owner_candidates_not_unique"]);
            }
            return undefined;
        }
    }

    const localNameCandidates = dedupeByMethodSignature(idx.byNormalizedName.get(methodName) || [])
        .filter(method => !!method?.getCfg?.())
        .filter(method => !isStaticMethod(method))
        .filter(method => isMethodArgCountConsistent(method, argCount, true));
    if (localNameCandidates.length === 0) return undefined;

    if (!receiverOwner) {
        const limitEvidence = localNameCandidates.length > maxNameMatchCandidates
            ? ["name_candidates_exceed_limit"]
            : ["name_candidates", "missing_concrete_receiver_owner"];
        return makeDiagnostic(localNameCandidates.length, limitEvidence);
    }

    const ownerTargets = localNameCandidates.filter(method => methodOwnerMatches(method, receiverOwner));
    if (ownerTargets.length !== 1) {
        return makeDiagnostic(ownerTargets.length, ["receiver_owner_candidates_not_unique"]);
    }

    return undefined;
}

export function isReflectDispatchInvoke(invokeExpr: any): boolean {
    return !!getReflectDispatchKind(invokeExpr);
}

export function collectParameterAssignStmts(calleeMethod: any): ArkAssignStmt[] {
    const cfg = calleeMethod?.getCfg?.();
    if (!cfg) return [];
    return cfg.getStmts()
        .filter((s: any) => s instanceof ArkAssignStmt && s.getRightOp() instanceof ArkParameterRef)
        .sort((a: ArkAssignStmt, b: ArkAssignStmt) => {
            const aIdx = (a.getRightOp() as ArkParameterRef).getIndex();
            const bIdx = (b.getRightOp() as ArkParameterRef).getIndex();
            return aIdx - bIdx;
        });
}

export function mapInvokeArgsToParamAssigns(
    invokeExpr: any,
    explicitArgs: any[],
    paramStmts: ArkAssignStmt[]
): InvokeArgParamPair[] {
    if (!paramStmts || paramStmts.length === 0) return [];
    const normalizedArgs = normalizeActualArgsForInvoke(invokeExpr, explicitArgs || [], paramStmts);
    const spreadToFirstParam = paramStmts.length === 1 && normalizedArgs.length > 1;
    const limit = spreadToFirstParam ? normalizedArgs.length : Math.min(normalizedArgs.length, paramStmts.length);
    const pairs: InvokeArgParamPair[] = [];
    for (let i = 0; i < limit; i++) {
        const arg = normalizedArgs[i];
        const paramIndex = spreadToFirstParam ? 0 : i;
        if (arg === undefined) continue;
        pairs.push({ arg, paramStmt: paramStmts[paramIndex], argIndex: i, paramIndex });
    }
    return pairs;
}

export function resolveMethodsFromCallable(
    scene: Scene,
    callableValue: any,
    options: CallableResolveOptions = {}
): any[] {
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    const visitKeys = options.callableVisitKeys || new Set<string>();
    const methods = resolveMethodsFromCallableValue(
        scene,
        callableValue,
        {
            ...options,
            callableVisitKeys: visitKeys,
        },
        visitKeys,
    );
    if (methods.length === 0 || methods.length > maxCandidates) {
        return [];
    }
    return methods;
}

export function analyzeInvokedParams(method: any): Set<number> {
    const cfg = method?.getCfg?.();
    if (!cfg) return new Set<number>();

    const localToParamIndex = new Map<string, number>();
    for (const paramStmt of collectParameterAssignStmts(method)) {
        const left = paramStmt.getLeftOp();
        const right = paramStmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof ArkParameterRef)) continue;
        localToParamIndex.set(left.getName(), right.getIndex());
    }

    // Follow simple local aliases so `const f = cb; f()` still marks `cb` as invoked.
    let changed = true;
    let rounds = 0;
    while (changed && rounds < 4) {
        changed = false;
        rounds += 1;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local) || !(right instanceof Local)) continue;
            const paramIndex = localToParamIndex.get(right.getName());
            if (paramIndex === undefined || localToParamIndex.get(left.getName()) === paramIndex) continue;
            localToParamIndex.set(left.getName(), paramIndex);
            changed = true;
        }
    }

    const invoked = new Set<number>();
    const maybeMarkInvoked = (value: any): void => {
        if (!(value instanceof Local) || !isCallableValue(value)) return;
        const paramIndex = localToParamIndex.get(value.getName());
        if (paramIndex !== undefined) {
            invoked.add(paramIndex);
        }
    };

    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!invokeExpr) continue;

        maybeMarkInvoked(getInvokeCallableBase(invokeExpr));

        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            const invokeName = resolveInvokeMethodName(invokeExpr);
            if (invokeName === "call" || invokeName === "apply") {
                maybeMarkInvoked(invokeExpr.getBase?.());
            }
        }
    }

    const storedFieldsByParamIndex = collectStoredThisFieldsByParamIndex(cfg.getStmts(), localToParamIndex);
    if (storedFieldsByParamIndex.size === 0) {
        return invoked;
    }

    const declaringClass = method?.getDeclaringArkClass?.();
    const siblingMethods = declaringClass?.getMethods?.() || [];
    const invokedStoredFields = new Set<string>();
    for (const siblingMethod of siblingMethods) {
        const siblingCfg = siblingMethod?.getCfg?.();
        if (!siblingCfg) continue;
        for (const fieldName of collectInvokedThisFields(siblingCfg.getStmts(), storedFieldsByParamIndex)) {
            invokedStoredFields.add(fieldName);
        }
    }

    for (const [paramIndex, fieldNames] of storedFieldsByParamIndex.entries()) {
        for (const fieldName of fieldNames) {
            if (invokedStoredFields.has(fieldName)) {
                invoked.add(paramIndex);
            }
        }
    }

    return invoked;
}

function collectStoredThisFieldsByParamIndex(
    stmts: any[],
    localToParamIndex: Map<string, number>
): Map<number, Set<string>> {
    const result = new Map<number, Set<string>>();
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkInstanceFieldRef) || !(right instanceof Local)) continue;
        const base = left.getBase?.();
        if (!(base instanceof Local) || base.getName() !== "this") continue;

        const paramIndex = localToParamIndex.get(right.getName());
        if (paramIndex === undefined) continue;

        const fieldName = left.getFieldSignature?.().getFieldName?.();
        if (!fieldName) continue;
        if (!result.has(paramIndex)) result.set(paramIndex, new Set<string>());
        result.get(paramIndex)!.add(fieldName);
    }
    return result;
}

function collectInvokedThisFields(
    stmts: any[],
    storedFieldsByParamIndex: Map<number, Set<string>>
): Set<string> {
    const trackedFields = new Set<string>();
    for (const fieldNames of storedFieldsByParamIndex.values()) {
        for (const fieldName of fieldNames) {
            trackedFields.add(fieldName);
        }
    }
    if (trackedFields.size === 0) return new Set<string>();

    const localToFieldName = new Map<string, string>();
    let changed = true;
    let rounds = 0;
    while (changed && rounds < 4) {
        changed = false;
        rounds += 1;
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local)) continue;

            if (right instanceof ArkInstanceFieldRef) {
                const base = right.getBase?.();
                const fieldName = right.getFieldSignature?.().getFieldName?.();
                if (!(base instanceof Local) || base.getName() !== "this" || !fieldName || !trackedFields.has(fieldName)) {
                    continue;
                }
                if (localToFieldName.get(left.getName()) === fieldName) continue;
                localToFieldName.set(left.getName(), fieldName);
                changed = true;
                continue;
            }

            if (right instanceof Local) {
                const fieldName = localToFieldName.get(right.getName());
                if (!fieldName || localToFieldName.get(left.getName()) === fieldName) continue;
                localToFieldName.set(left.getName(), fieldName);
                changed = true;
            }
        }
    }

    const invokedFields = new Set<string>();
    const maybeMarkInvokedField = (value: any): void => {
        if (value instanceof Local) {
            const fieldName = localToFieldName.get(value.getName());
            if (fieldName && isCallableValue(value)) {
                invokedFields.add(fieldName);
            }
            return;
        }
        if (value instanceof ArkInstanceFieldRef) {
            const base = value.getBase?.();
            const fieldName = value.getFieldSignature?.().getFieldName?.();
            if ((base instanceof Local) && base.getName() === "this" && fieldName && trackedFields.has(fieldName)) {
                invokedFields.add(fieldName);
            }
        }
    };

    for (const stmt of stmts) {
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!invokeExpr) continue;

        maybeMarkInvokedField(getInvokeCallableBase(invokeExpr));

        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            const invokeName = resolveInvokeMethodName(invokeExpr);
            if (invokeName === "call" || invokeName === "apply") {
                maybeMarkInvokedField(invokeExpr.getBase?.());
            }
        }
    }

    return invokedFields;
}

export function resolveConcreteReceiverOwnerName(
    scene: Scene,
    invokeExpr: any,
    options: CalleeResolveOptions = {},
): string | undefined {
    return resolveConcreteReceiverOwnerForInvoke(scene, invokeExpr, options);
}

export function resolveConcreteReceiverOwnerNames(
    scene: Scene,
    invokeExpr: any,
    options: CalleeResolveOptions = {},
): string[] {
    return resolveConcreteReceiverOwnersForInvoke(scene, invokeExpr, options);
}

export function buildMethodThisOwnerContextIndex(
    scene: Scene,
    seedMethods?: any[],
    options: {
        budget?: BuildStageBudget;
        log?: (msg: string) => void;
        progressInterval?: number;
    } = {},
): Map<string, Set<string>> {
    const budget = options.budget;
    const log = options.log;
    const progressInterval = options.progressInterval ?? 1000;
    const index = getSceneMethodIndex(scene);
    const contextByMethod = new Map<string, Set<string>>();
    const queue: string[] = [];

    const addContext = (methodSignature: string | undefined, ownerName: string | undefined): boolean => {
        const normalizedOwner = normalizeOwnerName(ownerName || "");
        if (!methodSignature || !normalizedOwner || !hasConcreteOwnerInScene(scene, normalizedOwner)) return false;
        let owners = contextByMethod.get(methodSignature);
        if (!owners) {
            owners = new Set<string>();
            contextByMethod.set(methodSignature, owners);
        }
        if (owners.has(normalizedOwner)) return false;
        owners.add(normalizedOwner);
        queue.push(methodSignature);
        return true;
    };

    const methods = seedMethods && seedMethods.length > 0 ? seedMethods : scene.getMethods();
    let seededCount = 0;
    for (const method of methods) {
        seededCount++;
        if (seededCount % progressInterval === 0) {
            assertBuildStageBudget(budget, `this_owner_context.seed(method=${seededCount})`);
            log?.(`[thisOwnerContext] seed progress methods=${seededCount} queued=${queue.length}`);
        }
        if (!method?.getCfg?.()) continue;
        addContext(safeMethodSignatureText(method), method.getDeclaringArkClass?.()?.getName?.());
    }
    assertBuildStageBudget(budget, `this_owner_context.seed.done(methods=${seededCount},queued=${queue.length})`);
    log?.(`[thisOwnerContext] seed done methods=${seededCount} queued=${queue.length}`);

    const processedContextKeys = new Map<string, string>();
    for (let head = 0; head < queue.length; head += 1) {
        if (head % progressInterval === 0) {
            assertBuildStageBudget(budget, `this_owner_context.queue(head=${head},queue=${queue.length})`);
            log?.(`[thisOwnerContext] queue progress head=${head} queue=${queue.length} contexts=${contextByMethod.size}`);
        }
        const methodSignature = queue[head];
        const method = index.bySignature.get(methodSignature);
        const cfg = method?.getCfg?.();
        if (!cfg) continue;
        const ownerNames = [...(contextByMethod.get(methodSignature) || [])].sort();
        const contextKey = ownerNames.join("|");
        if (processedContextKeys.get(methodSignature) === contextKey) continue;
        processedContextKeys.set(methodSignature, contextKey);

        const optionSets = ownerNames.length > 0 ? ownerNames : [undefined];
        for (const stmt of cfg.getStmts?.() || []) {
            assertBuildStageBudget(budget, `this_owner_context.stmt(head=${head},queue=${queue.length})`);
            if (!stmt?.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!invokeExpr || !isInstanceInvokeLike(invokeExpr)) continue;

            for (const ownerName of optionSets) {
                assertBuildStageBudget(budget, `this_owner_context.owner(head=${head},owners=${optionSets.length})`);
                const options: CalleeResolveOptions = {
                    maxNameMatchCandidates: 8,
                    enableDirectCallableTargets: false,
                    thisOwnerNames: ownerName ? [ownerName] : undefined,
                };
                const receiverOwners = resolveConcreteReceiverOwnersForInvoke(scene, invokeExpr, options);
                if (receiverOwners.length === 0) continue;
                const callees = resolveCalleeCandidates(scene, invokeExpr, options);
                for (const resolved of callees) {
                    const calleeSignature = safeMethodSignatureText(resolved.method);
                    for (const receiverOwner of receiverOwners) {
                        addContext(calleeSignature, receiverOwner);
                    }
                }
            }
        }
    }
    assertBuildStageBudget(budget, `this_owner_context.done(queue=${queue.length},contexts=${contextByMethod.size})`);
    log?.(`[thisOwnerContext] done queue=${queue.length} contexts=${contextByMethod.size}`);

    return contextByMethod;
}

function resolveInterfaceDispatchTargets(
    _scene: Scene,
    index: SceneMethodIndex,
    interfaceMethod: any,
    invokeExpr: any,
    maxCandidates: number,
): any[] {
    const methodName = normalizeMethodName(interfaceMethod?.getName?.() || "");
    const interfaceMethodSig = safeMethodSignatureText(interfaceMethod);
    const ownerNames = [
        extractOwnerScopeKeyFromSignature(interfaceMethodSig),
        extractOwnerNameFromSignature(interfaceMethodSig),
    ].filter((name): name is string => !!name);
    if (!methodName || ownerNames.length === 0) return [];
    const argCount = invokeExpr?.getArgs ? invokeExpr.getArgs().length : 0;
    const candidates: any[] = [];
    for (const ownerName of ownerNames) {
        const exactKey = interfaceDispatchKey(ownerName, methodName, argCount);
        candidates.push(...(index.byInterfaceMethod.get(exactKey) || []));
    }
    if (candidates.length === 0) {
        for (const ownerName of ownerNames) {
            candidates.push(...(index.byInterfaceMethod.get(interfaceDispatchKey(ownerName, methodName, -1)) || [])
                .filter(method => isArgCountConsistent(getFormalParamCount(method), argCount)));
        }
    }
    const dedup = dedupeByMethodSignature(candidates)
        .filter(method => !!method?.getCfg?.())
        .filter(method => !isStaticMethod(method));
    if (dedup.length === 0 || dedup.length > maxCandidates) return [];
    return dedup;
}

function interfaceDispatchKey(interfaceName: string, methodName: string, paramCount: number): string {
    return `${normalizeDispatchOwnerName(interfaceName)}#${normalizeMethodName(methodName)}#${paramCount}`;
}

function resolveInstanceTargetsForExactOwners(
    scene: Scene,
    index: SceneMethodIndex,
    ownerNames: string[],
    methodName: string,
    argCount: number,
): any[] {
    const candidates = dedupeByMethodSignature(index.byNormalizedName.get(methodName) || [])
        .filter(method => !!method?.getCfg?.())
        .filter(method => !isStaticMethod(method))
        .filter(method => isMethodArgCountConsistent(method, argCount, true));
    return narrowTargetsByExactOwnersOrAncestors(scene, candidates, ownerNames, false);
}

function narrowTargetsByExactOwnersOrAncestors(
    scene: Scene,
    methods: any[],
    ownerNames: string[],
    allowSubset: boolean,
): any[] {
    const uniqueOwners = dedupeOwnerNames(ownerNames);
    if (uniqueOwners.length === 0) return [];
    const out: any[] = [];
    for (const owner of uniqueOwners) {
        let found: any[] = [];
        for (const candidateOwner of collectOwnerAndAncestorNames(scene, owner)) {
            const matches = dedupeByMethodSignature(methods.filter(method => methodOwnerMatches(method, candidateOwner)));
            if (matches.length === 0) continue;
            if (matches.length !== 1) {
                if (!allowSubset) return [];
                found = [];
                break;
            }
            found = matches;
            break;
        }
        if (found.length !== 1) {
            if (!allowSubset) return [];
            continue;
        }
        out.push(found[0]);
    }
    if (out.length === 0) return [];
    if (!allowSubset && out.length !== uniqueOwners.length) return [];
    return dedupeByMethodSignature(out);
}

const _sceneClassOwnerCache = new WeakMap<Scene, Map<string, any>>();

function collectOwnerAndAncestorNames(scene: Scene, ownerName: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (name: string | undefined): boolean => {
        const normalized = normalizeOwnerName(name || "");
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        out.push(normalized);
        return true;
    };
    add(ownerName);
    let current = findClassByOwnerName(scene, ownerName);
    let depth = 0;
    while (current && depth < 16) {
        const superClass = current.getSuperClass?.();
        if (!superClass || superClass === current) break;
        add(superClass.getName?.() || extractOwnerNameFromSignature(safeClassSignatureText(superClass)) || "");
        current = superClass;
        depth++;
    }
    return out;
}

function findClassByOwnerName(scene: Scene, ownerName: string): any | undefined {
    let cache = _sceneClassOwnerCache.get(scene);
    if (!cache) {
        cache = new Map<string, any>();
        for (const cls of scene.getClasses?.() || []) {
            const className = normalizeOwnerName(cls?.getName?.() || "");
            const signatureOwner = normalizeOwnerName(extractOwnerNameFromSignature(safeClassSignatureText(cls)) || "");
            if (className && !cache.has(className)) cache.set(className, cls);
            if (signatureOwner && !cache.has(signatureOwner)) cache.set(signatureOwner, cls);
        }
        _sceneClassOwnerCache.set(scene, cache);
    }
    return cache.get(normalizeOwnerName(ownerName));
}

function narrowTargetsByExactOwners(
    methods: any[],
    ownerNames: string[],
    allowSubset: boolean,
): any[] {
    const uniqueOwners = dedupeOwnerNames(ownerNames);
    if (uniqueOwners.length === 0) return [];
    const out: any[] = [];
    for (const owner of uniqueOwners) {
        const matches = dedupeByMethodSignature(methods.filter(method => methodOwnerMatches(method, owner)));
        if (matches.length !== 1) {
            if (!allowSubset) return [];
            continue;
        }
        out.push(matches[0]);
    }
    if (out.length === 0) return [];
    if (!allowSubset && out.length !== uniqueOwners.length) return [];
    return dedupeByMethodSignature(out);
}

function dedupeOwnerNames(ownerNames: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const ownerName of ownerNames) {
        const normalized = normalizeOwnerName(ownerName);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

function safeImplementedInterfaceNames(arkClass: any): string[] {
    try {
        const names = arkClass?.getImplementedInterfaceNames?.() || [];
        return [...new Set<string>(
            names.flatMap((name: unknown) => {
                const simple = normalizeOwnerName(String(name || ""));
                if (!simple) return [];
                const scoped = resolveImportedInterfaceScopeKey(arkClass, simple);
                return scoped ? [simple, scoped] : [simple];
            }).filter((name: string): name is string => name.length > 0),
        )];
    } catch {
        return [];
    }
}

function resolveImportedInterfaceScopeKey(arkClass: any, simpleName: string): string | undefined {
    const arkFile = arkClass?.getDeclaringArkFile?.();
    const importInfo = arkFile?.getImportInfoBy?.(simpleName);
    if (!importInfo) return undefined;
    const exportInfo = importInfo.getLazyExportInfo?.() || importInfo.getExportInfo?.();
    const file = normalizeFileSignatureText(
        exportInfo?.getDeclaringArkFile?.()?.getFileSignature?.()?.toString?.(),
    );
    if (!file) return undefined;
    return `${file}:${simpleName}`;
}

function normalizeDispatchOwnerName(ownerName: string): string {
    return String(ownerName || "").replace(/\[static\]/g, "").replace(/^@/, "").trim();
}

function normalizeOwnerName(ownerName: string): string {
    const text = String(ownerName || "").replace(/\[static\]/g, "").trim();
    if (!text) return "";
    const slashIdx = text.lastIndexOf("/");
    const dotIdx = text.lastIndexOf(".");
    const cutIdx = Math.max(slashIdx, dotIdx);
    return cutIdx >= 0 ? text.slice(cutIdx + 1).trim() : text;
}

function dedupeByMethodSignature(methods: any[]): any[] {
    const out = new Map<string, any>();
    for (const method of methods) {
        const sig = safeMethodSignatureText(method);
        if (!sig || out.has(sig)) continue;
        out.set(sig, method);
    }
    return [...out.values()];
}

function getFormalParamCount(method: any): number {
    return collectParameterAssignStmts(method).length;
}

function isMethodArgCountConsistent(method: any, argCount: number, isInstanceInvoke: boolean): boolean {
    const paramStmts = collectParameterAssignStmts(method);
    if (isArgCountConsistent(paramStmts.length, argCount)) return true;
    if (!isInstanceInvoke || paramStmts.length === 0) return false;
    const firstParam = paramStmts[0].getRightOp();
    const firstLooksLikeThis = firstParam instanceof ArkParameterRef && firstParam.getIndex() === 0;
    return firstLooksLikeThis && isArgCountConsistent(paramStmts.length - 1, argCount);
}

function isArgCountConsistent(paramCount: number, argCount: number): boolean {
    if (paramCount === argCount) return true;
    return paramCount === 1 && argCount > 1;
}

function isStaticMethod(method: any): boolean {
    const sig = safeMethodSignatureText(method);
    const openIdx = sig.indexOf("(");
    const methodHeader = openIdx >= 0 ? sig.slice(0, openIdx) : sig;
    return methodHeader.includes(".[static]");
}

function isInstanceInvokeLike(invokeExpr: any): boolean {
    if (!invokeExpr) return false;
    if (invokeExpr instanceof ArkInstanceInvokeExpr) return true;
    return typeof invokeExpr.getBase === "function";
}

function getInvokeCallableBase(invokeExpr: any): any {
    if (!invokeExpr) return undefined;
    if (typeof invokeExpr.getBase === "function") {
        return invokeExpr.getBase();
    }
    if (invokeExpr instanceof ArkPtrInvokeExpr && typeof invokeExpr.getFuncPtrLocal === "function") {
        return invokeExpr.getFuncPtrLocal();
    }
    return undefined;
}

function isStaticInvokeLike(invokeExpr: any): boolean {
    if (!invokeExpr) return false;
    if (invokeExpr instanceof ArkStaticInvokeExpr) return true;
    return !isInstanceInvokeLike(invokeExpr);
}

function normalizeActualArgsForInvoke(
    invokeExpr: any,
    explicitArgs: any[],
    paramStmts: ArkAssignStmt[]
): any[] {
    const reflectKind = getReflectDispatchKind(invokeExpr);
    if (reflectKind === "reflect_call") {
        // Reflect.call(fn, thisArg, ...args) -> map ...args to callee params
        if (explicitArgs.length >= 2) return explicitArgs.slice(2);
    } else if (reflectKind === "reflect_apply") {
        // Reflect.apply(fn, thisArg, argsArray) -> try unpack array elements
        if (explicitArgs.length >= 3) return resolveApplyArgs(explicitArgs[2]);
    } else if (reflectKind === "function_call") {
        // fn.call(thisArg, ...args) -> map ...args to callee params
        if (explicitArgs.length >= 1) return explicitArgs.slice(1);
    } else if (reflectKind === "function_apply") {
        // fn.apply(thisArg, argsArray) -> try unpack array elements
        if (explicitArgs.length >= 2) return resolveApplyArgs(explicitArgs[1]);
    }

    if (!isInstanceInvokeLike(invokeExpr)) return explicitArgs;
    if (!paramStmts || paramStmts.length === 0) return explicitArgs;

    const firstParam = paramStmts[0].getRightOp();
    const firstLooksLikeThis = firstParam instanceof ArkParameterRef && firstParam.getIndex() === 0;
    if (!firstLooksLikeThis) return explicitArgs;
    if (explicitArgs.length + 1 !== paramStmts.length) return explicitArgs;

    const base = invokeExpr.getBase?.();
    if (!base) return explicitArgs;
    if (explicitArgs.length > 0 && explicitArgs[0] === base) return explicitArgs;
    return [base, ...explicitArgs];
}

function normalizeMethodName(name: string): string {
    return String(name || "").replace(/^\[static\]/, "").trim();
}

function extractMethodNameFromSignature(signature: string): string {
    if (!signature) return "";
    const openIdx = signature.indexOf("(");
    if (openIdx < 0) return "";
    const left = signature.slice(0, openIdx);
    const dotIdx = left.lastIndexOf(".");
    if (dotIdx < 0 || dotIdx + 1 >= left.length) return "";
    return normalizeMethodName(left.slice(dotIdx + 1));
}

function extractOwnerNameFromSignature(signature: string): string | undefined {
    if (!signature || signature.includes("%unk")) return undefined;
    const colonIdx = signature.indexOf(":");
    if (colonIdx < 0) return undefined;
    const openIdx = signature.indexOf("(");
    if (openIdx < 0) return undefined;
    const left = signature.slice(colonIdx + 1, openIdx).trim();
    const dotIdx = left.lastIndexOf(".");
    if (dotIdx <= 0) return undefined;
    const owner = left.slice(0, dotIdx).replace(/\[static\]/g, "").trim();
    return owner || undefined;
}

function resolveExpectedOwnerForInvoke(invokeExpr: any, invokeSig: string): string | undefined {
    const ownerFromSig = extractOwnerNameFromSignature(invokeSig);
    if (ownerFromSig) return ownerFromSig;

    if (!isInstanceInvokeLike(invokeExpr)) return undefined;
    const base = invokeExpr.getBase?.();
    const baseType = base?.getType?.();
    const classSig = baseType?.getClassSignature?.();
    if (!classSig) return undefined;
    const text = safeValueText(classSig);
    if (!text) return undefined;

    const normalized = text.replace(/^@/, "").trim();
    if (!normalized || normalized.includes("%unk")) return undefined;
    return normalized;
}

function resolveSymbolicReceiverOwnerForInvoke(invokeExpr: any): string | undefined {
    if (!isInstanceInvokeLike(invokeExpr)) return undefined;
    const base = invokeExpr.getBase?.();
    if (!base) return undefined;
    if (base instanceof Local && safeGetDeclaringStmt(base)) return undefined;

    const candidates = [
        typeof base.getName === "function" ? base.getName() : "",
        safeValueText(base),
    ];
    for (const candidate of candidates) {
        const owner = normalizeSymbolicReceiverOwner(candidate);
        if (owner) return owner;
    }
    return undefined;
}

function normalizeSymbolicReceiverOwner(value: unknown): string | undefined {
    const text = normalizeOwnerName(String(value || "").trim());
    if (!text || text === "this" || text.includes("%unk") || text.startsWith("%")) return undefined;
    if (!/^[A-Z][A-Za-z0-9_$]*$/.test(text)) return undefined;
    return text;
}

function extractOwnerScopeKeyFromSignature(signature: string): string | undefined {
    const owner = extractOwnerNameFromSignature(signature);
    const file = extractDeclaringFileFromSignature(signature);
    if (!owner) return undefined;
    const simpleOwner = normalizeOwnerName(owner);
    if (!simpleOwner) return undefined;
    return file ? `${file}:${simpleOwner}` : simpleOwner;
}

function extractDeclaringFileFromSignature(signature: string | undefined): string | undefined {
    const text = String(signature || "").trim();
    if (!text || text.includes("%unk")) return undefined;
    const colonIdx = text.indexOf(":");
    if (colonIdx <= 0) return undefined;
    const file = normalizeFileSignatureText(text.slice(0, colonIdx));
    return file || undefined;
}

function normalizeFileSignatureText(value: string | undefined): string | undefined {
    const text = String(value || "").trim();
    if (!text || text.includes("%unk")) return undefined;
    return text
        .replace(/^@/, "")
        .replace(/:\s*$/g, "")
        .replace(/\\/g, "/")
        .trim() || undefined;
}

function resolveConcreteReceiverOwnerForInvoke(
    scene: Scene,
    invokeExpr: any,
    options: CalleeResolveOptions = {},
): string | undefined {
    const owners = resolveConcreteReceiverOwnersForInvoke(scene, invokeExpr, options);
    return owners.length === 1 ? owners[0] : undefined;
}

function resolveConcreteReceiverOwnersForInvoke(
    scene: Scene,
    invokeExpr: any,
    options: CalleeResolveOptions = {},
): string[] {
    if (!isInstanceInvokeLike(invokeExpr)) return [];
    const base = invokeExpr.getBase?.();
    if (!base) return [];
    if (isThisReceiverValue(base) && options.thisOwnerNames && options.thisOwnerNames.length > 0) {
        return dedupeOwnerNames(options.thisOwnerNames)
            .filter(owner => hasConcreteOwnerInScene(scene, owner));
    }
    return resolveConcreteOwnersFromValue(scene, base, options, new Set<string>(), {});
}

function isThisReceiverValue(value: any): boolean {
    return value instanceof Local && value.getName?.() === "this";
}

function resolveConcreteOwnerFromValue(
    scene: Scene,
    value: any,
    options: CalleeResolveOptions,
    visiting: Set<string>,
): string | undefined {
    const owners = resolveConcreteOwnersFromValue(scene, value, options, visiting, {});
    return owners.length === 1 ? owners[0] : undefined;
}

function resolveConcreteOwnersFromValue(
    scene: Scene,
    value: any,
    options: CalleeResolveOptions,
    visiting: Set<string>,
    context: ConcreteOwnerResolveContext,
): string[] {
    if (!value) return [];
    if (visiting.size > (options.maxCallableResolveDepth ?? DEFAULT_MAX_CONCRETE_OWNER_RESOLVE_DEPTH)) {
        return [];
    }

    const visitKey = getConcreteOwnerVisitKey(value);
    if (visitKey) {
        if (visiting.has(visitKey)) return [];
        visiting.add(visitKey);
    }

    try {
        if (value instanceof Local) {
            if (isThisReceiverValue(value) && context.declaringMethodSignature) {
                return asOwnerList(extractOwnerNameFromSignature(context.declaringMethodSignature))
                    .filter(owner => hasConcreteOwnerInScene(scene, owner));
            }
            const decl = safeGetDeclaringStmt(value);
            const localMethodSig = getDeclaringMethodSignatureFromLocal(value) || context.declaringMethodSignature;
            const nestedContext = withDeclaringMethodSignature(context, localMethodSig);
            if (decl instanceof ArkAssignStmt && decl.getLeftOp() === value) {
                const rightOp = decl.getRightOp();
                const owners = resolveConcreteOwnersFromValue(scene, rightOp, options, visiting, nestedContext);
                if (owners.length > 0) return owners;
            }
            const siblingAssignmentOwners = resolveConcreteOwnersFromSameMethodLocalAssignments(
                scene,
                value,
                options,
                visiting,
                nestedContext,
                decl,
            );
            if (siblingAssignmentOwners.length > 0) return siblingAssignmentOwners;
            return dedupeOwnerNames([
                ...asOwnerList(resolveConcreteOwnerFromImportedBinding(scene, value, options, visiting)),
                ...asOwnerList(resolveConcreteOwnerFromLocalExactType(scene, value)),
            ]);
        }
        if (value instanceof ArkParameterRef) {
            const boundOwners = context.parameterOwnerBindings?.get(value.getIndex()) || [];
            return dedupeOwnerNames(boundOwners).filter(owner => hasConcreteOwnerInScene(scene, owner));
        }
        if (value instanceof ArkNewExpr) {
            return dedupeOwnerNames([
                ...resolveOwnersFromSourceConstructorRegistry(scene, value, context),
                ...asOwnerList(resolveOwnerFromNewExpr(value)),
            ]).filter(owner => hasConcreteOwnerInScene(scene, owner));
        }
        if (value instanceof ArkCastExpr) {
            return resolveConcreteOwnersFromValue(scene, value.getOp?.(), options, visiting, context);
        }
        if (value instanceof ArkAwaitExpr) {
            return resolveConcreteOwnersFromValue(scene, value.getPromise?.(), options, visiting, context);
        }
        if (value instanceof ArkInstanceInvokeExpr || value instanceof ArkStaticInvokeExpr) {
            const strictConstructorOwner = resolveStrictConstructorOwnerFromInvoke(value);
            if (strictConstructorOwner) return [strictConstructorOwner].filter(owner => hasConcreteOwnerInScene(scene, owner));
            const factoryOwners = resolveConcreteOwnersFromFactoryInvoke(scene, value, options, visiting, context);
            if (factoryOwners.length > 0) return factoryOwners;
            if (value instanceof ArkInstanceInvokeExpr) {
                const fluentOwners = resolveFluentThisReturnOwnersFromInvoke(scene, value, options, visiting, context);
                if (fluentOwners.length > 0) return fluentOwners;
            }
            return [];
        }
        const ownerFromType = extractOwnerFromTypeText(safeTypeText(safeGetValueType(value)));
        if (ownerFromType) {
            return [ownerFromType].filter(owner => hasConcreteOwnerInScene(scene, owner));
        }
        return [];
    } finally {
        if (visitKey) visiting.delete(visitKey);
    }
}

function resolveConcreteOwnersFromSameMethodLocalAssignments(
    scene: Scene,
    value: Local,
    options: CalleeResolveOptions,
    visiting: Set<string>,
    context: ConcreteOwnerResolveContext,
    primaryDecl: any,
): string[] {
    const methodSig = context.declaringMethodSignature || getDeclaringMethodSignatureFromLocal(value);
    if (!methodSig) return [];
    const method = getSceneMethodIndex(scene).bySignature.get(methodSig);
    const stmts = method?.getCfg?.()?.getStmts?.() || [];
    if (stmts.length === 0) return [];
    const localName = safeLocalName(value);
    if (!localName) return [];
    const siblingVisitKey = `sibling:${methodSig}:${localName}`;
    if (visiting.has(siblingVisitKey)) return [];
    visiting.add(siblingVisitKey);
    const owners: string[] = [];
    try {
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt) || stmt === primaryDecl) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof Local) || safeLocalName(left) !== localName) continue;
            const rightOp = stmt.getRightOp();
            if (rightOp === value) continue;
            owners.push(...resolveConcreteOwnersFromValue(scene, rightOp, options, visiting, context));
        }
    } finally {
        visiting.delete(siblingVisitKey);
    }
    return dedupeOwnerNames(owners).filter(owner => hasConcreteOwnerInScene(scene, owner));
}

function resolveConcreteOwnerFromImportedBinding(
    scene: Scene,
    value: Local,
    options: CalleeResolveOptions,
    visiting: Set<string>,
): string | undefined {
    for (const file of scene.getFiles?.() || []) {
        for (const importInfo of file.getImportInfos?.() || []) {
            const importLocal = safeGetImportLocal(file, importInfo);
            if (!(importLocal instanceof Local)) continue;
            if (!isSameExactLocal(importLocal, value)) continue;

            const exportValue = importInfo.getLazyExportInfo?.()?.getArkExport?.()
                || importInfo.getExportInfo?.()?.getArkExport?.();
            if (!exportValue) continue;

            const owner = resolveConcreteOwnerFromValue(scene, exportValue, options, visiting);
            if (owner && hasConcreteOwnerInScene(scene, owner)) {
                return owner;
            }
        }
    }
    return undefined;
}

function resolveConcreteOwnerFromLocalExactType(scene: Scene, value: Local): string | undefined {
    const owner = extractOwnerFromTypeText(safeTypeText(safeGetValueType(value)));
    if (!owner || !hasConcreteOwnerInScene(scene, owner)) return undefined;
    return owner;
}

function resolveFluentThisReturnOwnersFromInvoke(
    scene: Scene,
    invokeExpr: ArkInstanceInvokeExpr,
    options: CalleeResolveOptions,
    visiting: Set<string>,
    context: ConcreteOwnerResolveContext,
): string[] {
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (!methodName) return [];
    const base = invokeExpr.getBase?.();
    const receiverOwners = resolveConcreteOwnersFromValue(scene, base, options, visiting, context);
    if (receiverOwners.length === 0) return [];
    const argCount = invokeExpr.getArgs ? invokeExpr.getArgs().length : 0;
    const targets = resolveInstanceTargetsForExactOwners(
        scene,
        getSceneMethodIndex(scene),
        receiverOwners,
        methodName,
        argCount,
    );
    if (targets.length === 0) return [];
    if (!targets.every(methodReturnsThis)) return [];
    return dedupeOwnerNames(receiverOwners).filter(owner => hasConcreteOwnerInScene(scene, owner));
}

function methodReturnsThis(method: any): boolean {
    const returns = method?.getReturnStmt?.() || [];
    if (returns.length === 0) return false;
    return returns.some((stmt: any) => stmt instanceof ArkReturnStmt && isThisReceiverValue(stmt.getOp?.()));
}

function safeGetImportLocal(file: any, importInfo: any): Local | undefined {
    try {
        const clauseName = importInfo?.getImportClauseName?.();
        if (!clauseName) return undefined;
        return ModelUtils.getLocalInImportInfoWithName(clauseName, file);
    } catch {
        return undefined;
    }
}

function isSameExactLocal(left: Local, right: Local): boolean {
    if (left === right) return true;
    return safeLocalName(left) === safeLocalName(right)
        && getDeclaringStmtIdentity(safeGetDeclaringStmt(left)) === getDeclaringStmtIdentity(safeGetDeclaringStmt(right))
        && (getDeclaringMethodSignatureFromLocal(left) || "") === (getDeclaringMethodSignatureFromLocal(right) || "");
}

function hasConcreteOwnerInScene(scene: Scene, ownerName: string): boolean {
    const expected = normalizeOwnerName(ownerName);
    if (!expected) return false;
    return getConcreteOwnerNameSet(scene).has(expected);
}

function getConcreteOwnerNameSet(scene: Scene): Set<string> {
    let cached = _sceneConcreteOwnerNameCache.get(scene);
    if (cached) return cached;
    cached = new Set<string>();
    const add = (owner: string | undefined): void => {
        const normalized = normalizeOwnerName(owner || "");
        if (normalized) cached!.add(normalized);
    };
    for (const cls of scene.getClasses?.() || []) {
        if (!(cls.getMethods?.() || []).some((method: any) => !!method?.getCfg?.())) continue;
        const className = normalizeOwnerName(cls?.getName?.() || "");
        const signatureOwner = normalizeOwnerName(extractOwnerNameFromSignature(safeClassSignatureText(cls)) || "");
        add(className);
        add(signatureOwner);
    }
    for (const method of scene.getMethods()) {
        if (!method?.getCfg?.()) continue;
        const cls = method.getDeclaringArkClass?.();
        add(cls?.getName?.());
        add(extractOwnerNameFromSignature(safeMethodSignatureText(method)));
        add(extractOwnerNameFromSignature(safeClassSignatureText(cls)));
    }
    _sceneConcreteOwnerNameCache.set(scene, cached);
    return cached;
}

function resolveConcreteOwnerFromFactoryInvoke(
    scene: Scene,
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr,
    options: CalleeResolveOptions,
    visiting: Set<string>,
): string | undefined {
    const owners = resolveConcreteOwnersFromFactoryInvoke(scene, invokeExpr, options, visiting, {});
    return owners.length === 1 ? owners[0] : undefined;
}

function resolveConcreteOwnersFromFactoryInvoke(
    scene: Scene,
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr,
    options: CalleeResolveOptions,
    visiting: Set<string>,
    context: ConcreteOwnerResolveContext,
): string[] {
    const methods = resolveFactoryInvokeTargetMethods(scene, invokeExpr, options, visiting, context);
    if (methods.length === 0) return [];
    const owners: string[] = [];
    for (const method of methods) {
        owners.push(...resolveConcreteOwnersFromFactoryTargetMethod(scene, invokeExpr, method, options, visiting, context));
    }
    return dedupeOwnerNames(owners).filter(owner => hasConcreteOwnerInScene(scene, owner));
}

function resolveConcreteOwnersFromFactoryTargetMethod(
    scene: Scene,
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr,
    method: any,
    options: CalleeResolveOptions,
    visiting: Set<string>,
    context: ConcreteOwnerResolveContext,
): string[] {
    const methodSig = safeMethodSignatureText(method);
    if (methodSig) {
        const methodKey = `factory:${methodSig}`;
        if (visiting.has(methodKey)) return [];
        visiting.add(methodKey);
    }
    try {
        const owners: string[] = [];
        const nestedContext = withFactoryParameterOwnerBindings(scene, invokeExpr, method, options, visiting, methodSig, context);
        for (const retStmt of method.getReturnStmt?.() || []) {
            if (!(retStmt instanceof ArkReturnStmt)) continue;
            const returnedValue = retStmt.getOp?.();
            owners.push(...resolveConcreteOwnersFromValue(scene, returnedValue, options, visiting, nestedContext));
        }
        owners.push(...resolveConstructorArgumentOwnersForFactoryInvoke(scene, invokeExpr, method, options, visiting, context));
        return dedupeOwnerNames(owners).filter(owner => hasConcreteOwnerInScene(scene, owner));
    } finally {
        if (methodSig) visiting.delete(`factory:${methodSig}`);
    }
}

function resolveFactoryInvokeTargetMethods(
    scene: Scene,
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr,
    options: CalleeResolveOptions,
    visiting: Set<string>,
    context: ConcreteOwnerResolveContext,
): any[] {
    if (invokeExpr instanceof ArkInstanceInvokeExpr) {
        const methodName = resolveInvokeMethodName(invokeExpr);
        const base = invokeExpr.getBase?.();
        const receiverOwners = resolveConcreteOwnersFromValue(scene, base, options, visiting, context);
        const argCount = invokeExpr.getArgs ? invokeExpr.getArgs().length : 0;
        const receiverTargets = receiverOwners.length > 0 && methodName
            ? resolveInstanceTargetsForExactOwners(
                scene,
                getSceneMethodIndex(scene),
                receiverOwners,
                methodName,
                argCount,
            )
            : [];
        if (receiverTargets.length > 0) return dedupeByMethodSignature(receiverTargets);
    }

    const sig = safeInvokeSignatureText(invokeExpr);
    if (!sig) return [];
    const exact = getSceneMethodIndex(scene).bySignature.get(sig);
    return exact?.getCfg?.() ? [exact] : [];
}

function withFactoryParameterOwnerBindings(
    scene: Scene,
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr,
    method: any,
    options: CalleeResolveOptions,
    visiting: Set<string>,
    declaringMethodSignature: string | undefined,
    context: ConcreteOwnerResolveContext,
): ConcreteOwnerResolveContext {
    const paramStmts = collectParameterAssignStmts(method);
    if (paramStmts.length === 0) {
        return withDeclaringMethodSignature(context, declaringMethodSignature);
    }
    const args = invokeExpr.getArgs?.() || [];
    const bindings = new Map<number, string[]>();
    for (const [index, owners] of context.parameterOwnerBindings?.entries?.() || []) {
        bindings.set(index, [...owners]);
    }
    for (const pair of mapInvokeArgsToParamAssigns(invokeExpr, args, paramStmts)) {
        const paramRef = pair.paramStmt.getRightOp();
        if (!(paramRef instanceof ArkParameterRef)) continue;
        const owners = resolveConcreteOwnersFromValue(scene, pair.arg, options, visiting, context);
        if (owners.length === 0) continue;
        bindings.set(paramRef.getIndex(), dedupeOwnerNames([
            ...(bindings.get(paramRef.getIndex()) || []),
            ...owners,
        ]));
    }
    return withDeclaringMethodSignature({
        ...context,
        parameterOwnerBindings: bindings.size > 0 ? bindings : context.parameterOwnerBindings,
    }, declaringMethodSignature);
}

function resolveConstructorArgumentOwnersForFactoryInvoke(
    scene: Scene,
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr,
    method: any,
    options: CalleeResolveOptions,
    visiting: Set<string>,
    context: ConcreteOwnerResolveContext,
): string[] {
    if (!isProjectLocalMethod(method)) return [];
    const paramStmts = collectParameterAssignStmts(method);
    if (paramStmts.length === 0) return [];
    if (!methodHasNonVoidReturn(method)) return [];
    const args = invokeExpr.getArgs?.() || [];
    const owners: string[] = [];
    for (const pair of mapInvokeArgsToParamAssigns(invokeExpr, args, paramStmts)) {
        if (!isConstructorCarrierParam(pair.paramStmt)) continue;
        owners.push(...resolveConcreteOwnersFromValue(scene, pair.arg, options, visiting, context));
    }
    return dedupeOwnerNames(owners).filter(owner => hasConcreteOwnerInScene(scene, owner));
}

function isConstructorCarrierParam(paramStmt: ArkAssignStmt): boolean {
    const text = `${paramStmt.toString?.() || ""} ${safeTypeText(safeGetValueType(paramStmt.getLeftOp?.()))}`;
    return text.includes("%AC") || /\bnew\s*\(/.test(text) || /\bconstruct-signature\b/.test(text);
}

function methodHasNonVoidReturn(method: any): boolean {
    for (const retStmt of method.getReturnStmt?.() || []) {
        if (!(retStmt instanceof ArkReturnStmt)) continue;
        const opText = safeValueText(retStmt.getOp?.());
        if (opText && opText !== "undefined" && opText !== "void 0") return true;
    }
    return false;
}

function isProjectLocalMethod(method: any): boolean {
    const sig = safeMethodSignatureText(method).replace(/\\/g, "/");
    if (!sig || sig.includes("@%unk/%unk")) return false;
    if (sig.includes("/interface_sdk-js/") || sig.includes("/node_modules/") || sig.includes("/oh_modules/")) return false;
    if (sig.includes("@ohos.") || sig.includes("@internal/component/ets") || sig.includes("typescript/lib/")) return false;
    return !!method?.getCfg?.();
}

function resolveOwnerFromNewExpr(expr: ArkNewExpr): string | undefined {
    const typeText = safeValueText(safeGetValueType(expr));
    const fromType = extractOwnerFromTypeText(typeText);
    if (fromType) return fromType;
    return extractOwnerFromTypeText(safeValueText(expr));
}

function resolveConstructorOwnerFromInvoke(invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr): string | undefined {
    const sig = safeInvokeSignatureText(invokeExpr);
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (methodName !== "constructor" && !sig.includes(".constructor(")) {
        return undefined;
    }
    return normalizeOwnerName(extractOwnerNameFromSignature(sig) || extractOwnerFromTypeText(sig) || "");
}

function resolveStrictConstructorOwnerFromInvoke(invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr): string | undefined {
    const sigOwner = resolveConstructorOwnerFromInvoke(invokeExpr);
    if (!sigOwner) return undefined;
    const base = invokeExpr instanceof ArkInstanceInvokeExpr ? invokeExpr.getBase?.() : undefined;
    const baseOwner = extractOwnerFromTypeText(safeTypeText(safeGetValueType(base)));
    if (!baseOwner) return undefined;
    return ownerNamesEqual(sigOwner, baseOwner) ? sigOwner : undefined;
}

function asOwnerList(owner: string | undefined): string[] {
    const normalized = normalizeOwnerName(owner || "");
    return normalized ? [normalized] : [];
}

function withDeclaringMethodSignature(
    context: ConcreteOwnerResolveContext,
    declaringMethodSignature?: string,
): ConcreteOwnerResolveContext {
    if (!declaringMethodSignature) return context;
    if (context.declaringMethodSignature === declaringMethodSignature) return context;
    return { ...context, declaringMethodSignature };
}

function resolveOwnersFromSourceConstructorRegistry(
    scene: Scene,
    expr: ArkNewExpr,
    context: ConcreteOwnerResolveContext,
): string[] {
    const propertyName = extractDynamicConstructorPropertyName(expr);
    if (!propertyName || !context.declaringMethodSignature) return [];
    const filePath = resolveSourceFilePathFromMethodSignature(scene, context.declaringMethodSignature);
    if (!filePath) return [];
    const registry = getSourceConstructorRegistry(filePath);
    const owners = registry.byPropertyName.get(propertyName);
    if (!owners || owners.size === 0) return [];
    return [...owners]
        .map(owner => normalizeOwnerName(owner))
        .filter((owner): owner is string => !!owner && hasConcreteOwnerInScene(scene, owner));
}

function extractDynamicConstructorPropertyName(expr: ArkNewExpr): string | undefined {
    const text = `${safeValueText(expr)} ${safeTypeText(safeGetValueType(expr))}`;
    if (!text.includes("%unk")) return undefined;
    const matches = [...text.matchAll(/(?:^|[^A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)/g)];
    if (matches.length === 0) return undefined;
    return matches[matches.length - 1][2];
}

function resolveSourceFilePathFromMethodSignature(scene: Scene, methodSignature: string): string | undefined {
    const declaringFile = extractDeclaringFileFromSignature(methodSignature);
    if (!declaringFile) return undefined;
    const normalizedDeclaringFile = declaringFile.replace(/\\/g, "/").replace(/^@/, "");
    for (const file of scene.getFiles?.() || []) {
        const filePath = String(file?.getFilePath?.() || "").replace(/\\/g, "/");
        const fileSig = normalizeFileSignatureText(file?.getFileSignature?.()?.toString?.()) || "";
        if (filePath && (filePath.endsWith(normalizedDeclaringFile) || filePath.includes(`/${normalizedDeclaringFile}`))) {
            return filePath;
        }
        if (fileSig && fileSig.endsWith(normalizedDeclaringFile)) {
            return filePath || undefined;
        }
    }
    return undefined;
}

function getSourceConstructorRegistry(filePath: string): SourceConstructorRegistry {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const cached = _sourceConstructorRegistryCache.get(normalizedPath);
    if (cached) return cached;
    const registry: SourceConstructorRegistry = { byPropertyName: new Map() };
    try {
        const sourceText = fs.readFileSync(normalizedPath, "utf8");
        const sourceFile = ts.createSourceFile(normalizedPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const add = (propertyName: string, ownerName: string): void => {
            const normalizedOwner = normalizeOwnerName(ownerName);
            if (!propertyName || !normalizedOwner) return;
            let owners = registry.byPropertyName.get(propertyName);
            if (!owners) {
                owners = new Set<string>();
                registry.byPropertyName.set(propertyName, owners);
            }
            owners.add(normalizedOwner);
        };
        const visit = (node: ts.Node): void => {
            if (ts.isObjectLiteralExpression(node)) {
                for (const prop of node.properties) {
                    if (!ts.isPropertyAssignment(prop)) continue;
                    const propertyName = getObjectLiteralPropertyName(prop.name);
                    const ownerName = getConstructorIdentifierText(prop.initializer);
                    if (propertyName && ownerName) add(propertyName, ownerName);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    } catch {
        // Missing source text is a hard lack of evidence for this resolver; callers keep the site unresolved.
    }
    _sourceConstructorRegistryCache.set(normalizedPath, registry);
    return registry;
}

function getObjectLiteralPropertyName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return undefined;
}

function getConstructorIdentifierText(expr: ts.Expression): string | undefined {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    return undefined;
}

function extractOwnerFromTypeText(text: string | undefined): string | undefined {
    const raw = String(text || "").trim();
    if (!raw || raw.includes("%unk")) return undefined;
    const colonIdx = raw.lastIndexOf(":");
    const candidate = colonIdx >= 0 ? raw.slice(colonIdx + 1).trim() : raw;
    const normalized = normalizeOwnerName(candidate.replace(/[<>].*$/g, "").trim());
    return normalized || undefined;
}

function methodOwnerMatches(method: any, ownerName: string): boolean {
    const expected = normalizeOwnerName(ownerName);
    if (!expected) return false;
    const actual = normalizeOwnerName(extractOwnerNameFromSignature(safeMethodSignatureText(method)) || "");
    return actual === expected;
}

function ownerNamesEqual(left: string | undefined, right: string | undefined): boolean {
    const normalizedLeft = normalizeOwnerName(left || "");
    const normalizedRight = normalizeOwnerName(right || "");
    return !!normalizedLeft && !!normalizedRight && normalizedLeft === normalizedRight;
}

function getConcreteOwnerVisitKey(value: any): string | undefined {
    if (value instanceof Local) {
        return `local:${getDeclaringMethodSignatureFromLocal(value) || ""}:${safeLocalName(value)}#${getDeclaringStmtIdentity(safeGetDeclaringStmt(value))}`;
    }
    const text = safeValueText(value);
    return text ? `value:${text}` : undefined;
}

function resolveReflectDispatchTargets(
    scene: Scene,
    invokeExpr: any,
    maxCandidates: number,
    options: CalleeResolveOptions = {},
): any[] {
    const kind = getReflectDispatchKind(invokeExpr);
    if (!kind) return [];
    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const callableValue = kind.startsWith("reflect_")
        ? (args.length > 0 ? args[0] : undefined)
        : getInvokeCallableBase(invokeExpr);
    const visitKeys = options.callableVisitKeys || new Set<string>();
    const methods = resolveMethodsFromCallableValue(scene, callableValue, {
        maxCandidates,
        callableVisitKeys: visitKeys,
        callableResolveDepth: options.callableResolveDepth,
        maxCallableResolveDepth: options.maxCallableResolveDepth,
    }, visitKeys);
    if (methods.length === 0 || methods.length > maxCandidates) return [];
    return methods;
}

function resolveMethodsFromCallableValue(
    scene: Scene,
    callableValue: any,
    options: CallableResolveOptions = {},
    visitingFactoryMethods: Set<string> = new Set<string>(),
): any[] {
    if (!callableValue) return [];
    const maxDepth = options.maxCallableResolveDepth ?? DEFAULT_MAX_CALLABLE_RESOLVE_DEPTH;
    const currentDepth = options.callableResolveDepth ?? 0;
    if (currentDepth > maxDepth) {
        return [];
    }
    const visitKeys = options.callableVisitKeys || visitingFactoryMethods;
    const valueVisitKey = getCallableResolveVisitKey(callableValue, options);
    if (valueVisitKey) {
        if (visitKeys.has(valueVisitKey)) {
            return [];
        }
        visitKeys.add(valueVisitKey);
    }
    const resolvedCallable = resolveCallableValueByLocalBacktrace(callableValue, options);
    const callableVisitKey = getCallableResolveVisitKey(resolvedCallable, options);
    if (callableVisitKey && callableVisitKey !== valueVisitKey) {
        if (visitKeys.has(callableVisitKey)) {
            if (valueVisitKey) {
                visitKeys.delete(valueVisitKey);
            }
            return [];
        }
        visitKeys.add(callableVisitKey);
    }
    const nestedOptions = nextCallableResolveOptions(options, visitKeys);

    const candidates: any[] = [];
    const seen = new Set<string>();
    const idx = getSceneMethodIndex(scene);
    const addMethod = (m: any): void => {
        if (!m || !m.getCfg || !m.getCfg()) return;
        const sig = safeMethodSignatureText(m);
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        candidates.push(m);
    };

    try {
        const type = safeGetValueType(resolvedCallable);
        let methodSigText = "";
        try {
            const methodSig = type?.getMethodSignature?.();
            methodSigText = safeValueText(methodSig);
        } catch {
            methodSigText = "";
        }
        if (methodSigText) {
            addMethod(idx.bySignature.get(methodSigText));
            if (candidates.length > 0) {
                return candidates;
            }
        }

        for (const returnedMethod of resolveMethodsFromReturnedCallableFactory(
            scene,
            resolvedCallable,
            nestedOptions,
            visitKeys,
        )) {
            addMethod(returnedMethod);
        }
        if (candidates.length > 0) {
            return candidates;
        }

        for (const boundMethod of resolveMethodsFromBoundCallableFactory(
            scene,
            resolvedCallable,
            nestedOptions,
            visitKeys,
        )) {
            addMethod(boundMethod);
        }
        if (candidates.length > 0) {
            return candidates;
        }

        for (const memberMethod of resolveMethodsFromCallableCarrierValue(
            scene,
            resolvedCallable,
            nestedOptions,
            visitKeys,
        )) {
            addMethod(memberMethod);
        }
        if (candidates.length > 0) {
            return candidates;
        }

        if (!isCallableValue(resolvedCallable)) {
            return candidates;
        }

        const localName = resolvedCallable instanceof Local
            ? safeLocalName(resolvedCallable)
            : (() => {
                try {
                    return resolvedCallable?.getName?.() || "";
                } catch {
                    return "";
                }
            })();
        if (localName) {
            for (const m of idx.byNormalizedName.get(normalizeMethodName(localName)) || []) {
                addMethod(m);
            }
        }

        const rawText = safeValueText(resolvedCallable);
        if (rawText && rawText !== localName) {
            for (const m of idx.byNormalizedName.get(normalizeMethodName(rawText)) || []) {
                addMethod(m);
            }
        }

        return candidates;
    } finally {
        if (callableVisitKey && callableVisitKey !== valueVisitKey) {
            visitKeys.delete(callableVisitKey);
        }
        if (valueVisitKey) {
            visitKeys.delete(valueVisitKey);
        }
    }
}

function resolveMethodsFromBoundCallableFactory(
    scene: Scene,
    callableValue: any,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    if (!(callableValue instanceof Local)) return [];
    const declStmt = safeGetDeclaringStmt(callableValue);
    if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== callableValue) {
        return [];
    }

    const rightOp = declStmt.getRightOp();
    if (!(rightOp instanceof ArkInstanceInvokeExpr) && !(rightOp instanceof ArkPtrInvokeExpr)) {
        return [];
    }
    if (resolveInvokeMethodName(rightOp) !== "bind") {
        return [];
    }

    const base = getInvokeCallableBase(rightOp);
    if (!base || isReflectBase(base)) {
        return [];
    }
    return resolveMethodsFromCallableValue(
        scene,
        base,
        options,
        visitingFactoryMethods,
    );
}

function resolveMethodsFromCallableCarrierValue(
    scene: Scene,
    callableValue: any,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    if (callableValue instanceof ArkInstanceFieldRef || callableValue instanceof ClosureFieldRef) {
        return resolveMethodsFromCallableFieldCarrier(scene, callableValue, options, visitingFactoryMethods);
    }
    if (callableValue instanceof ArkArrayRef) {
        return resolveMethodsFromCallableArrayCarrier(scene, callableValue, options, visitingFactoryMethods);
    }
    if (callableValue instanceof ArkStaticFieldRef) {
        return resolveMethodsFromCallableStaticFieldCarrier(scene, callableValue, options, visitingFactoryMethods);
    }
    return [];
}

export function resolveMethodsFromAnonymousObjectCarrier(
    scene: Scene,
    objectValue: any,
    options: CallableResolveOptions = {},
    visitingFactoryMethods: Set<string> = new Set<string>(),
): any[] {
    const classSig = safeValueText(objectValue?.getType?.()?.getClassSignature?.());
    if (!classSig || !isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        const declaringClassSig = safeClassSignatureText(method.getDeclaringArkClass?.());
        if (declaringClassSig !== classSig) continue;
        const name = method.getName?.() || "";
        if (!isAnonymousObjectCallableMethodName(name)) continue;
        const sig = safeMethodSignatureText(method);
        if (!sig || seen.has(sig) || !method.getCfg?.()) continue;
        seen.add(sig);
        out.push(method);
    }
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    if (out.length > maxCandidates) return [];
    return out;
}

export function resolveMethodsFromAnonymousObjectCarrierByField(
    scene: Scene,
    objectValue: any,
    fieldName: string,
    options: CallableResolveOptions = {},
    visitingFactoryMethods: Set<string> = new Set<string>(),
): any[] {
    const classSig = safeValueText(objectValue?.getType?.()?.getClassSignature?.());
    if (!classSig || !isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    const addResolvedMethods = (callable: any): void => {
        for (const method of resolveMethodsFromCallableValue(scene, callable, options, visitingFactoryMethods)) {
            const sig = safeMethodSignatureText(method);
            if (!sig || seen.has(sig)) continue;
            seen.add(sig);
            out.push(method);
        }
    };

    for (const method of scene.getMethods()) {
        const declaringClassSig = safeClassSignatureText(method.getDeclaringArkClass?.());
        if (declaringClassSig !== classSig) continue;
        const name = method.getName?.() || "";
        if (matchesAnonymousCarrierFieldMethod(name, fieldName)) {
                const sig = safeMethodSignatureText(method);
            if (sig && !seen.has(sig) && method.getCfg?.()) {
                seen.add(sig);
                out.push(method);
            }
        }
        if (!(name.includes("constructor(") || name.includes("%instInit"))) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            const leftBase = left.getBase?.();
            if (!(leftBase instanceof Local) || leftBase.getName() !== "this") continue;
            const leftFieldName = left.getFieldSignature?.().getFieldName?.() || "";
            if (leftFieldName !== fieldName) continue;
            addResolvedMethods(stmt.getRightOp());
        }
    }

    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    if (out.length > maxCandidates) return [];
    return out;
}

function resolveMethodsFromSameFileAnonymousObjectFieldInitializers(
    scene: Scene,
    fieldRef: ArkInstanceFieldRef | ClosureFieldRef,
    fieldName: string,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    const fileHint = extractCarrierFileHint(fieldRef);
    if (!fileHint) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    const addResolvedMethods = (callable: any): void => {
        for (const method of resolveMethodsFromCallableValue(scene, callable, options, visitingFactoryMethods)) {
            const sig = safeMethodSignatureText(method);
            if (!sig || seen.has(sig)) continue;
            seen.add(sig);
            out.push(method);
        }
    };

    for (const method of scene.getMethods()) {
        const declaringClassSig = safeClassSignatureText(method.getDeclaringArkClass?.());
        if (!declaringClassSig || !isAnonymousObjectCarrierClassSignature(declaringClassSig)) continue;
        if (!signatureMatchesFileHint(declaringClassSig, fileHint)) continue;

        const name = method.getName?.() || "";
        if (!(name.includes("constructor(") || name.includes("%instInit"))) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            const leftBase = left.getBase?.();
            if (!(leftBase instanceof Local) || leftBase.getName() !== "this") continue;
            const leftFieldName = left.getFieldSignature?.().getFieldName?.() || "";
            if (leftFieldName !== fieldName) continue;
            addResolvedMethods(stmt.getRightOp());
        }
    }

    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    if (out.length > maxCandidates) return [];
    return out;
}

function resolveMethodsFromCallableFieldCarrier(
    scene: Scene,
    fieldRef: ArkInstanceFieldRef | ClosureFieldRef,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        const sig = safeMethodSignatureText(method);
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    const base = fieldRef.getBase?.();
    const fieldName = fieldRef instanceof ClosureFieldRef
        ? fieldRef.getFieldName?.()
        : fieldRef.getFieldSignature?.().getFieldName?.();
    if (!fieldName) return out;

    if (base) {
        for (const method of resolveMethodsFromAnonymousObjectCarrierByField(
            scene,
            base,
            fieldName,
            options,
            visitingFactoryMethods,
        )) {
            addMethod(method);
        }
    }

    const assignedValues = collectAssignedFieldCarrierValues(fieldRef, options);
    for (const assignedValue of assignedValues) {
        for (const method of resolveMethodsFromCallableValue(scene, assignedValue, options, visitingFactoryMethods)) {
            addMethod(method);
        }
    }

    if (out.length === 0) {
        for (const method of resolveMethodsFromSameFileAnonymousObjectFieldInitializers(
            scene,
            fieldRef,
            fieldName,
            options,
            visitingFactoryMethods,
        )) {
            addMethod(method);
        }
    }

    return out;
}

function resolveMethodsFromCallableArrayCarrier(
    scene: Scene,
    arrayRef: ArkArrayRef,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        const sig = safeMethodSignatureText(method);
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    for (const assignedValue of collectAssignedArrayCarrierValues(arrayRef, options)) {
        for (const method of resolveMethodsFromCallableValue(scene, assignedValue, options, visitingFactoryMethods)) {
            addMethod(method);
        }
    }

    return out;
}

function resolveMethodsFromCallableStaticFieldCarrier(
    scene: Scene,
    fieldRef: ArkStaticFieldRef,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const fieldSigText = safeValueText(fieldRef.getFieldSignature?.());
    if (!fieldSigText) return out;

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkStaticFieldRef)) continue;
            const leftFieldSigText = safeValueText(left.getFieldSignature?.());
            if (leftFieldSigText !== fieldSigText) continue;
            for (const candidate of resolveMethodsFromCallableValue(scene, stmt.getRightOp(), options, visitingFactoryMethods)) {
                const sig = safeMethodSignatureText(candidate);
                if (!sig || seen.has(sig)) continue;
                seen.add(sig);
                out.push(candidate);
            }
        }
    }

    return out;
}

function collectAssignedFieldCarrierValues(
    fieldRef: ArkInstanceFieldRef | ClosureFieldRef,
    options: CallableResolveOptions,
): any[] {
    const base = fieldRef.getBase?.();
    const method = resolveDeclaringMethodForCarrierBase(base);
    const cfg = method?.getCfg?.();
    if (!cfg) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!matchesCallableFieldCarrier(left, fieldRef, options)) continue;
        pushUniqueCarrierValue(out, seen, stmt.getRightOp());
    }
    return out;
}

function collectAssignedArrayCarrierValues(
    arrayRef: ArkArrayRef,
    options: CallableResolveOptions,
): any[] {
    const base = arrayRef.getBase?.();
    if (!(base instanceof Local)) return [];
    const method = resolveDeclaringMethodForCarrierBase(base);
    const cfg = method?.getCfg?.();
    if (!cfg) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (!matchesCallableArrayCarrier(left, arrayRef, options)) continue;
        pushUniqueCarrierValue(out, seen, stmt.getRightOp());
    }
    return out;
}

function resolveDeclaringMethodForCarrierBase(base: any): any | undefined {
    if (base instanceof Local) {
        return base.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.();
    }
    if (base instanceof ArkInstanceFieldRef || base instanceof ClosureFieldRef || base instanceof ArkArrayRef) {
        return resolveDeclaringMethodForCarrierBase(base.getBase?.());
    }
    return undefined;
}

function matchesCallableFieldCarrier(
    candidate: any,
    target: ArkInstanceFieldRef | ClosureFieldRef,
    options: CallableResolveOptions,
): boolean {
    if (!(candidate instanceof ArkInstanceFieldRef) && !(candidate instanceof ClosureFieldRef)) {
        return false;
    }
    const targetIdentity = getCallableFieldIdentity(target);
    const candidateIdentity = getCallableFieldIdentity(candidate);
    if (!targetIdentity || !candidateIdentity || targetIdentity !== candidateIdentity) {
        return false;
    }
    return areEquivalentCarrierBases(candidate.getBase?.(), target.getBase?.(), options);
}

function matchesCallableArrayCarrier(
    candidate: ArkArrayRef,
    target: ArkArrayRef,
    options: CallableResolveOptions,
): boolean {
    if (!areEquivalentCarrierBases(candidate.getBase?.(), target.getBase?.(), options)) {
        return false;
    }
    return normalizeCarrierArrayIndex(candidate.getIndex?.(), options)
        === normalizeCarrierArrayIndex(target.getIndex?.(), options);
}

function areEquivalentCarrierBases(
    candidateBase: any,
    targetBase: any,
    options: CallableResolveOptions,
): boolean {
    if (candidateBase === targetBase) return true;
    if (candidateBase instanceof Local && targetBase instanceof Local) {
        return getAliasRootLocalIdentity(candidateBase, options)
            === getAliasRootLocalIdentity(targetBase, options);
    }
    return String(candidateBase?.toString?.() || "")
        === String(targetBase?.toString?.() || "");
}

function getAliasRootLocalIdentity(local: Local, options: CallableResolveOptions): string {
    const root = resolveAliasRootLocal(local, options);
    const methodSig = getDeclaringMethodSignatureFromLocal(root) || "__unknown_method__";
    const declIdentity = getDeclaringStmtIdentity(safeGetDeclaringStmt(root));
    return `${methodSig}::${safeLocalName(root)}::${declIdentity}`;
}

function resolveAliasRootLocal(local: Local, options: CallableResolveOptions): Local {
    if (options.enableLocalBacktrace === false) return local;
    const maxBacktraceSteps = options.maxBacktraceSteps ?? DEFAULT_MAX_BACKTRACE_STEPS;
    const maxVisitedDefs = options.maxVisitedDefs ?? DEFAULT_MAX_VISITED_DEFS;
    const rootMethodSig = getDeclaringMethodSignatureFromLocal(local);
    if (!rootMethodSig) return local;

    let current: Local = local;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < maxBacktraceSteps) {
        const key = `${current.getName?.() || ""}#${getDeclaringStmtIdentity(current.getDeclaringStmt?.())}`;
        if (visitedDefs.has(key)) break;
        visitedDefs.add(key);
        if (visitedDefs.size > maxVisitedDefs) break;

        const declStmt = safeGetDeclaringStmt(current);
        if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== current) break;
        const declMethodSig = getDeclaringMethodSignatureFromStmt(declStmt) || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const rightOp = declStmt.getRightOp();
        const next = resolveBacktraceAliasLocal(rightOp, rootMethodSig);
        if (!(next instanceof Local)) break;
        current = next;
        steps += 1;
    }
    return current;
}

function resolveBacktraceAliasLocal(value: any, rootMethodSig: string): Local | undefined {
    if (value instanceof Local) {
        const rightMethodSig = getDeclaringMethodSignatureFromLocal(value);
        if (!rightMethodSig || rightMethodSig !== rootMethodSig) return undefined;
        return value;
    }
    if (value instanceof ArkCastExpr) {
        return resolveBacktraceAliasLocal(value.getOp?.(), rootMethodSig);
    }
    if (value instanceof ArkAwaitExpr) {
        return resolveBacktraceAliasLocal(value.getPromise?.(), rootMethodSig);
    }
    return undefined;
}

function normalizeCarrierArrayIndex(indexValue: any, options: CallableResolveOptions): string {
    const resolved = resolveSimpleAliasValue(indexValue, options);
    if (resolved instanceof Local) {
        return `local:${getAliasRootLocalIdentity(resolved, options)}`;
    }
    const parsed = parseArrayIndex(resolved);
    if (parsed !== undefined) {
        return `const:${parsed}`;
    }
    return `text:${String(resolved?.toString?.() || "")}`;
}

function resolveSimpleAliasValue(value: any, options: CallableResolveOptions): any {
    if (options.enableLocalBacktrace === false || !(value instanceof Local)) {
        return value;
    }
    const maxBacktraceSteps = options.maxBacktraceSteps ?? DEFAULT_MAX_BACKTRACE_STEPS;
    const maxVisitedDefs = options.maxVisitedDefs ?? DEFAULT_MAX_VISITED_DEFS;
    const rootMethodSig = getDeclaringMethodSignatureFromLocal(value);
    if (!rootMethodSig) return value;

    let current: any = value;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < maxBacktraceSteps && current instanceof Local) {
        const key = `${current.getName?.() || ""}#${getDeclaringStmtIdentity(current.getDeclaringStmt?.())}`;
        if (visitedDefs.has(key)) break;
        visitedDefs.add(key);
        if (visitedDefs.size > maxVisitedDefs) break;

        const declStmt = safeGetDeclaringStmt(current);
        if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== current) break;
        const declMethodSig = getDeclaringMethodSignatureFromStmt(declStmt) || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const rightOp = declStmt.getRightOp();
        const nextLocal = resolveBacktraceAliasLocal(rightOp, rootMethodSig);
        if (nextLocal instanceof Local) {
            current = nextLocal;
            steps += 1;
            continue;
        }
        return rightOp;
    }
    return current;
}

function getCallableFieldIdentity(fieldRef: ArkInstanceFieldRef | ClosureFieldRef): string | undefined {
    if (fieldRef instanceof ClosureFieldRef) {
        const fieldName = fieldRef.getFieldName?.();
        return fieldName ? `closure:${fieldName}` : undefined;
    }
    const fieldSigText = safeValueText(fieldRef.getFieldSignature?.());
    if (fieldSigText) return `field_sig:${fieldSigText}`;
    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.();
    return fieldName ? `field_name:${fieldName}` : undefined;
}

function pushUniqueCarrierValue(out: any[], seen: Set<string>, value: any): void {
    if (value === undefined || value === null) return;
    const key = describeCallableCarrierValue(value);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
}

function nextCallableResolveOptions(
    options: CallableResolveOptions,
    visitKeys: Set<string>,
): CallableResolveOptions {
    return {
        ...options,
        callableVisitKeys: visitKeys,
        callableResolveDepth: (options.callableResolveDepth ?? 0) + 1,
    };
}

function getCallableResolveVisitKey(value: any, options: CallableResolveOptions): string | undefined {
    if (!value) return undefined;
    if (value instanceof Local) {
        const name = safeLocalName(value);
        const methodSig = getDeclaringMethodSignatureFromLocal(value) || "__unknown_method__";
        const stmtId = getDeclaringStmtIdentity(safeGetDeclaringStmt(value));
        return `local:${methodSig}:${name}:${stmtId}`;
    }
    if (isCallableCarrierValue(value)) {
        return `carrier:${describeCallableCarrierValue(value)}`;
    }
    const text = safeValueText(value);
    if (!text) return undefined;
    const typeText = safeValueText(safeGetValueType(value));
    return `value:${text}:${typeText}`;
}

function describeCallableCarrierValue(value: any): string {
    if (value instanceof Local) {
        return getAliasRootLocalIdentity(value, {});
    }
    if (value instanceof ArkInstanceFieldRef || value instanceof ClosureFieldRef || value instanceof ArkArrayRef || value instanceof ArkStaticFieldRef) {
        return safeValueText(value);
    }
    return safeValueText(value);
}

function isCallableCarrierValue(value: any): value is CallableCarrierValue {
    return value instanceof ArkInstanceFieldRef
        || value instanceof ClosureFieldRef
        || value instanceof ArkArrayRef
        || value instanceof ArkStaticFieldRef;
}

export function isAnonymousObjectCarrierClassSignature(classSig: string): boolean {
    if (!classSig) return false;
    return /(^|[.: \t])%AC\d+\$/.test(classSig) || classSig.includes(": %AC");
}

function isAnonymousObjectCallableMethodName(name: string): boolean {
    if (!name) return false;
    if (name.startsWith("%AM")) return true;
    return !(name === "constructor" || name.includes("constructor(") || name === "%instInit");
}

function matchesAnonymousCarrierFieldMethod(methodName: string, fieldName: string): boolean {
    if (!isAnonymousObjectCallableMethodName(methodName)) return false;
    if (normalizeMethodName(methodName) === fieldName) return true;
    return methodName.startsWith("%AM") && methodName.includes(`$${fieldName}`);
}

function extractCarrierFileHint(fieldRef: ArkInstanceFieldRef | ClosureFieldRef): string | undefined {
    const candidates: string[] = [];
    if (fieldRef instanceof ArkInstanceFieldRef) {
        candidates.push(safeValueText(fieldRef.getFieldSignature?.()));
    }
    candidates.push(safeValueText(fieldRef));
    const base = fieldRef.getBase?.();
    const declaringMethodSig = resolveDeclaringMethodForCarrierBase(base);
    candidates.push(safeMethodSignatureText(declaringMethodSig));

    for (const candidate of candidates) {
        const file = extractFilePathFromSignatureText(candidate);
        if (file) return file;
    }
    return undefined;
}

function extractFilePathFromSignatureText(text: string): string | undefined {
    if (!text) return undefined;
    const match = text.match(/@([^:>]+):/);
    if (!match) return undefined;
    return normalizeSignatureFilePath(match[1]);
}

function signatureMatchesFileHint(signatureText: string, fileHint: string): boolean {
    const sigFile = extractFilePathFromSignatureText(signatureText);
    if (!sigFile || !fileHint) return false;
    return sigFile === normalizeSignatureFilePath(fileHint);
}

function normalizeSignatureFilePath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^@/, "").trim().toLowerCase();
}

type ReflectDispatchKind = "reflect_call" | "reflect_apply" | "function_call" | "function_apply";

function getReflectDispatchKind(invokeExpr: any): ReflectDispatchKind | undefined {
    if (!invokeExpr) return undefined;
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (methodName !== "call" && methodName !== "apply") return undefined;

    const base = getInvokeCallableBase(invokeExpr);
    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];

    const baseIsReflect = isReflectBase(base);
    const baseIsCallable = isCallableValue(base);
    const firstArgIsCallable = args.length > 0 ? isCallableValue(args[0]) : false;

    if (baseIsReflect || (!baseIsCallable && firstArgIsCallable)) {
        return methodName === "call" ? "reflect_call" : "reflect_apply";
    }
    if (baseIsCallable) {
        return methodName === "call" ? "function_call" : "function_apply";
    }
    return undefined;
}

function isReflectBase(value: any): boolean {
    let name = "";
    try {
        name = value?.getName?.() || value?.toString?.() || "";
    } catch {
        name = "";
    }
    return String(name).trim() === "Reflect";
}

export function isCallableValue(value: any): boolean {
    if (!value) return false;
    let localName = "";
    try {
        localName = String(value?.getName?.() || "");
    } catch {
        localName = "";
    }
    if (localName.startsWith("%AM")) {
        return true;
    }
    const rawText = safeValueText(value);
    if (rawText.startsWith("%AM")) {
        return true;
    }
    const type = safeGetValueType(value);
    if (!type) return false;
    try {
        if (typeof type.getMethodSignature === "function" && type.getMethodSignature()) {
            return true;
        }
        const methodSignatures = typeof type.getMethodSignatures === "function" ? type.getMethodSignatures() : undefined;
        if (Array.isArray(methodSignatures) && methodSignatures.length > 0) {
            return true;
        }
        const callSignature = type.getCallSignature?.() || type.getFunctionSignature?.() || type.getFuncSignature?.();
        if (callSignature) {
            return true;
        }
    } catch {
        return false;
    }
    return false;
}

function resolveApplyArgs(argsArrayValue: any): any[] {
    if (!(argsArrayValue instanceof Local)) {
        return [argsArrayValue];
    }

    const byIndex = new Map<number, any>();
    for (const stmt of argsArrayValue.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (left.getBase() !== argsArrayValue) continue;
        const idx = parseArrayIndex(left.getIndex());
        if (idx === undefined || idx < 0) continue;
        byIndex.set(idx, stmt.getRightOp());
    }

    if (byIndex.size === 0) {
        return [argsArrayValue];
    }

    return Array.from(byIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([_, value]) => value);
}

function parseArrayIndex(indexValue: any): number | undefined {
    const raw = indexValue?.toString?.() || "";
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) ? n : undefined;
}

function resolveDirectCallableTargets(
    scene: Scene,
    invokeExpr: any,
    maxCandidates: number,
    options: CalleeResolveOptions = {},
): any[] {
    if (!invokeExpr || isReflectDispatchInvoke(invokeExpr)) return [];
    const invokeSig = safeInvokeSignatureText(invokeExpr);
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (!(invokeExpr instanceof ArkPtrInvokeExpr) && !invokeSig.includes("%unk") && methodName) return [];

    const base = getInvokeCallableBase(invokeExpr);
    if (!base || isReflectBase(base)) return [];

    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const argCount = args.length;
    const visitKeys = options.callableVisitKeys || new Set<string>();
    const targets = resolveMethodsFromCallableValue(scene, base, {
        maxCandidates,
        callableVisitKeys: visitKeys,
        callableResolveDepth: options.callableResolveDepth,
        maxCallableResolveDepth: options.maxCallableResolveDepth,
    }, visitKeys)
        .filter(m => isArgCountConsistent(getFormalParamCount(m), argCount));
    if (targets.length === 0 || targets.length > maxCandidates) return [];
    return targets;
}

function resolveCallableValueByLocalBacktrace(
    callableValue: any,
    options: CallableResolveOptions
): any {
    if (!(callableValue instanceof Local)) return callableValue;
    if (options.enableLocalBacktrace === false) return callableValue;

    const maxBacktraceSteps = options.maxBacktraceSteps ?? DEFAULT_MAX_BACKTRACE_STEPS;
    const maxVisitedDefs = options.maxVisitedDefs ?? DEFAULT_MAX_VISITED_DEFS;
    if (maxBacktraceSteps <= 0 || maxVisitedDefs <= 0) return callableValue;

    const rootMethodSig = getDeclaringMethodSignatureFromLocal(callableValue);
    if (!rootMethodSig) return callableValue;

    let current: any = callableValue;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < maxBacktraceSteps && current instanceof Local && !isCallableValue(current)) {
        const key = `${current.getName?.() || ""}#${getDeclaringStmtIdentity(current.getDeclaringStmt?.())}`;
        if (visitedDefs.has(key)) break;
        visitedDefs.add(key);
        if (visitedDefs.size > maxVisitedDefs) break;

        const declStmt = safeGetDeclaringStmt(current);
        if (!(declStmt instanceof ArkAssignStmt)) break;
        if (declStmt.getLeftOp() !== current) break;
        const declMethodSig = getDeclaringMethodSignatureFromStmt(declStmt) || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const rightOp = declStmt.getRightOp();
        steps++;

        if (rightOp instanceof Local) {
            const rightMethodSig = getDeclaringMethodSignatureFromLocal(rightOp);
            if (!rightMethodSig || rightMethodSig !== rootMethodSig) break;
            current = rightOp;
            continue;
        }

        if (rightOp instanceof ArkCastExpr) {
            current = rightOp.getOp?.();
            continue;
        }

        if (rightOp instanceof ArkAwaitExpr) {
            current = rightOp.getPromise?.();
            continue;
        }

        if (isCallableCarrierValue(rightOp)) {
            return rightOp;
        }

        if (isCallableValue(rightOp)) {
            return rightOp;
        }

        // Only accept simple alias chains: Local <- Local / Local <- callable(%AM/FunctionType).
        break;
    }

    return current;
}

function resolveMethodsFromReturnedCallableFactory(
    scene: Scene,
    callableValue: any,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    if (!(callableValue instanceof Local)) return [];
    const declStmt = safeGetDeclaringStmt(callableValue);
    if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== callableValue) {
        return [];
    }

    const rightOp = declStmt.getRightOp();
    if (!(rightOp instanceof ArkStaticInvokeExpr)
        && !(rightOp instanceof ArkInstanceInvokeExpr)
        && !(rightOp instanceof ArkPtrInvokeExpr)) {
        return [];
    }

    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        if (!method?.getCfg?.()) return;
        const sig = safeMethodSignatureText(method);
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    const maxNameMatchCandidates = options.maxCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    const resolvedCallees = resolveCalleeCandidates(scene, rightOp, {
        maxNameMatchCandidates,
        callableVisitKeys: visitingFactoryMethods,
        callableResolveDepth: options.callableResolveDepth,
        maxCallableResolveDepth: options.maxCallableResolveDepth,
    });
    for (const resolved of resolvedCallees) {
        const calleeMethod = resolved.method;
        const calleeSig = safeMethodSignatureText(calleeMethod);
        if (!calleeSig || visitingFactoryMethods.has(calleeSig)) continue;
        visitingFactoryMethods.add(calleeSig);
        for (const returnedMethod of collectReturnedCallableMethods(
            scene,
            calleeMethod,
            options,
            visitingFactoryMethods,
        )) {
            addMethod(returnedMethod);
        }
        visitingFactoryMethods.delete(calleeSig);
    }

    return out;
}

function collectReturnedCallableMethods(
    scene: Scene,
    method: any,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (candidate: any): void => {
        if (!candidate?.getCfg?.()) return;
        const sig = safeMethodSignatureText(candidate);
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(candidate);
    };

    const returnStmts = method?.getReturnStmt?.() || [];
    for (const retStmt of returnStmts) {
        if (!(retStmt instanceof ArkReturnStmt)) continue;
        const returnedValue = retStmt.getOp?.();
        if (!returnedValue) continue;
        for (const candidate of resolveMethodsFromCallableValue(
            scene,
            returnedValue,
            options,
            visitingFactoryMethods,
        )) {
            addMethod(candidate);
        }
    }

    return out;
}

function getDeclaringMethodSignatureFromLocal(local: Local): string | undefined {
    return getDeclaringMethodSignatureFromStmt(safeGetDeclaringStmt(local));
}

function getDeclaringMethodSignatureFromStmt(stmt: any): string | undefined {
    try {
        return stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
    } catch {
        return undefined;
    }
}

function getDeclaringStmtIdentity(stmt: any): string {
    if (!stmt) return "null";
    let line = -1;
    let text = "";
    try {
        line = stmt.getOriginPositionInfo?.()?.getLineNo?.() ?? -1;
    } catch {
        line = -1;
    }
    try {
        text = stmt.toString?.() || "";
    } catch {
        text = "[unprintable_stmt]";
    }
    return `${line}:${text}`;
}

function safeGetDeclaringStmt(local: Local): any {
    try {
        return local.getDeclaringStmt?.();
    } catch {
        return undefined;
    }
}

function safeLocalName(local: Local): string {
    try {
        return local.getName?.() || "";
    } catch {
        return "";
    }
}

function safeValueText(value: any): string {
    try {
        return String(value?.toString?.() || value || "");
    } catch {
        return "[unprintable]";
    }
}

function safeTypeText(type: any): string {
    try {
        const classSignature = type?.getClassSignature?.()?.toString?.();
        if (classSignature) {
            return String(classSignature);
        }
        return String(type?.toString?.() || type || "");
    } catch {
        return "";
    }
}

function safeInvokeMethodSubSignatureName(invokeExpr: any): string {
    try {
        return invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    } catch {
        return "";
    }
}

function safeInvokeSignatureText(invokeExpr: any): string {
    try {
        return invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    } catch {
        return "";
    }
}

function safeMethodSignatureText(method: any): string {
    try {
        return method?.getSignature?.()?.toString?.() || "";
    } catch {
        return "";
    }
}

function safeClassSignatureText(arkClass: any): string {
    try {
        return arkClass?.getSignature?.()?.toString?.() || "";
    } catch {
        return "";
    }
}

function safeGetValueType(value: any): any {
    try {
        return value?.getType?.();
    } catch {
        return undefined;
    }
}
