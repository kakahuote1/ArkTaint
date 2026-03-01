import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { Constant } from "../../../arkanalyzer/out/src/core/base/Constant";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { collectParameterAssignStmts, resolveMethodsFromCallable } from "../engine/CalleeResolver";
import { addMapSetValue, resolveClassKeyFromMethodSig, resolveHarmonyMethods } from "./HarmonyModelingUtils";

export interface EmitterModel {
    forwardTargetNodeIdsBySourceNodeId: Map<number, Set<number>>;
    onRegistrationCount: number;
    emitCount: number;
    bridgeCount: number;
    dynamicEventSkipCount: number;
}

export interface BuildEmitterModelArgs {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
}

const ON_METHOD_NAME = "on";
const EMIT_METHOD_NAME = "emit";
const MAX_EVENT_BACKTRACE_STEPS = 6;
const MAX_EVENT_BACKTRACE_VISITED = 24;

interface EmitterClassProfile {
    hasOn: boolean;
    hasEmit: boolean;
    hasOnShape: boolean;
    hasEmitShape: boolean;
}

export function buildEmitterModel(args: BuildEmitterModelArgs): EmitterModel {
    const methods = resolveHarmonyMethods(args.scene, args.allowedMethodSignatures);
    const declaredProfiles = buildEmitterClassProfiles(args.scene);
    const observedProfiles = buildEmitterCallsiteProfiles(args.scene, methods);
    const classProfiles = mergeEmitterClassProfiles(declaredProfiles, observedProfiles);
    const callbackTargetsByEventKey = new Map<string, Set<number>>();
    const payloadSourcesByEventKey = new Map<string, Set<number>>();
    const forwardTargetNodeIdsBySourceNodeId = new Map<number, Set<number>>();
    let onRegistrationCount = 0;
    let emitCount = 0;
    let dynamicEventSkipCount = 0;

    for (const method of methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        const methodSignature = method.getSignature().toString();

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkStaticInvokeExpr)) continue;

            const invokeMethodSig = invokeExpr.getMethodSignature?.();
            if (!invokeMethodSig) continue;
            const invokeMethodName = invokeMethodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
            const classKey = resolveClassKeyFromMethodSig(invokeMethodSig);
            const profile = classProfiles.get(classKey);
            if (
                !profile
                || !profile.hasOn
                || !profile.hasEmit
                || !profile.hasOnShape
                || !profile.hasEmitShape
            ) {
                continue;
            }

            const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (invokeMethodName === ON_METHOD_NAME) {
                if (invokeArgs.length < 2) continue;
                const eventName = resolveEventName(methodSignature, invokeArgs[0]);
                if (!eventName) {
                    dynamicEventSkipCount++;
                    continue;
                }
                const callbackMethods = resolveCallbackMethodsFromArg(args.scene, invokeArgs[1]);
                if (callbackMethods.length === 0) continue;
                const callbackParamNodeIds = collectCallbackParamNodeIds(args.pag, callbackMethods, 0);
                if (callbackParamNodeIds.size === 0) continue;
                onRegistrationCount++;
                const eventKey = `${classKey}::${eventName}`;
                for (const nodeId of callbackParamNodeIds) {
                    addMapSetValue(callbackTargetsByEventKey, eventKey, nodeId);
                }
                continue;
            }

            if (invokeMethodName === EMIT_METHOD_NAME) {
                if (invokeArgs.length < 2) continue;
                const eventName = resolveEventName(methodSignature, invokeArgs[0]);
                if (!eventName) {
                    dynamicEventSkipCount++;
                    continue;
                }
                const payloadNodeIds = collectNodeIdsByValue(args.pag, invokeArgs[1]);
                if (payloadNodeIds.size === 0) continue;
                emitCount++;
                const eventKey = `${classKey}::${eventName}`;
                for (const nodeId of payloadNodeIds) {
                    addMapSetValue(payloadSourcesByEventKey, eventKey, nodeId);
                }
            }
        }
    }

    for (const [eventKey, sourceNodeIds] of payloadSourcesByEventKey.entries()) {
        const targetNodeIds = callbackTargetsByEventKey.get(eventKey);
        if (!targetNodeIds || targetNodeIds.size === 0) continue;
        for (const sourceNodeId of sourceNodeIds) {
            if (!forwardTargetNodeIdsBySourceNodeId.has(sourceNodeId)) {
                forwardTargetNodeIdsBySourceNodeId.set(sourceNodeId, new Set<number>());
            }
            const out = forwardTargetNodeIdsBySourceNodeId.get(sourceNodeId)!;
            for (const targetNodeId of targetNodeIds) {
                out.add(targetNodeId);
            }
        }
    }

    let bridgeCount = 0;
    for (const targetSet of forwardTargetNodeIdsBySourceNodeId.values()) {
        bridgeCount += targetSet.size;
    }

    return {
        forwardTargetNodeIdsBySourceNodeId,
        onRegistrationCount,
        emitCount,
        bridgeCount,
        dynamicEventSkipCount,
    };
}

function buildEmitterClassProfiles(scene: Scene): Map<string, EmitterClassProfile> {
    const profiles = new Map<string, EmitterClassProfile>();
    for (const method of scene.getMethods()) {
        if (method.getName() === "%dflt") continue;
        const methodSig = method.getSignature?.();
        if (!methodSig) continue;
        const classKey = resolveClassKeyFromMethodSig(methodSig);
        const methodName = methodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
        const profile = profiles.get(classKey) || { hasOn: false, hasEmit: false, hasOnShape: false, hasEmitShape: false };
        if (methodName === ON_METHOD_NAME) {
            profile.hasOn = true;
            if (isOnMethodShape(method)) {
                profile.hasOnShape = true;
            }
        }
        if (methodName === EMIT_METHOD_NAME) {
            profile.hasEmit = true;
            if (isEmitMethodShape(method)) {
                profile.hasEmitShape = true;
            }
        }
        profiles.set(classKey, profile);
    }
    return profiles;
}

function buildEmitterCallsiteProfiles(scene: Scene, methods: any[]): Map<string, EmitterClassProfile> {
    const profiles = new Map<string, EmitterClassProfile>();
    const ensure = (classKey: string): EmitterClassProfile => {
        const existing = profiles.get(classKey);
        if (existing) return existing;
        const created: EmitterClassProfile = { hasOn: false, hasEmit: false, hasOnShape: false, hasEmitShape: false };
        profiles.set(classKey, created);
        return created;
    };

    for (const method of methods) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        const methodSignature = method.getSignature?.().toString?.() || "";

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkStaticInvokeExpr)) continue;
            const invokeMethodSig = invokeExpr.getMethodSignature?.();
            if (!invokeMethodSig) continue;
            const invokeMethodName = invokeMethodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (invokeMethodName !== ON_METHOD_NAME && invokeMethodName !== EMIT_METHOD_NAME) continue;

            const classKey = resolveClassKeyFromMethodSig(invokeMethodSig);
            const profile = ensure(classKey);
            const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const eventLike = invokeArgs.length > 0 && isLikelyEventArg(methodSignature, invokeArgs[0]);

            if (invokeMethodName === ON_METHOD_NAME) {
                profile.hasOn = true;
                const callbackLike = invokeArgs.length > 1 && isLikelyCallableArg(scene, invokeArgs[1]);
                if (eventLike && callbackLike) {
                    profile.hasOnShape = true;
                }
            } else if (invokeMethodName === EMIT_METHOD_NAME) {
                profile.hasEmit = true;
                if (eventLike && invokeArgs.length > 1) {
                    profile.hasEmitShape = true;
                }
            }
        }
    }

    return profiles;
}

function mergeEmitterClassProfiles(
    declaredProfiles: Map<string, EmitterClassProfile>,
    observedProfiles: Map<string, EmitterClassProfile>
): Map<string, EmitterClassProfile> {
    const out = new Map<string, EmitterClassProfile>();
    const keys = new Set<string>([...declaredProfiles.keys(), ...observedProfiles.keys()]);
    for (const key of keys) {
        const d = declaredProfiles.get(key);
        const o = observedProfiles.get(key);
        out.set(key, {
            hasOn: Boolean(d?.hasOn || o?.hasOn),
            hasEmit: Boolean(d?.hasEmit || o?.hasEmit),
            hasOnShape: Boolean(d?.hasOnShape || o?.hasOnShape),
            hasEmitShape: Boolean(d?.hasEmitShape || o?.hasEmitShape),
        });
    }
    return out;
}

function isOnMethodShape(method: any): boolean {
    const params = method.getParameters?.() || [];
    if (params.length < 2) return false;
    const eventType = String(params[0]?.getType?.()?.toString?.() || "").toLowerCase();
    const callbackType = String(params[1]?.getType?.()?.toString?.() || "").toLowerCase();
    const hasEventString = eventType.includes("string");
    const hasCallable = callbackType.includes("=>")
        || callbackType.includes("function")
        || callbackType.includes("callable")
        || callbackType.includes("callback")
        || callbackType.includes("%am");
    if (hasEventString && hasCallable) {
        return true;
    }

    const sigText = String(method.getSignature?.()?.toString?.() || "").toLowerCase();
    return sigText.includes("on(")
        && sigText.includes("string")
        && (sigText.includes("=>") || sigText.includes("function") || sigText.includes("%am"));
}

function isEmitMethodShape(method: any): boolean {
    const params = method.getParameters?.() || [];
    if (params.length < 2) return false;
    const eventType = String(params[0]?.getType?.()?.toString?.() || "").toLowerCase();
    if (eventType.includes("string")) {
        return true;
    }
    const sigText = String(method.getSignature?.()?.toString?.() || "").toLowerCase();
    return sigText.includes("emit(") && sigText.includes("string");
}

function isLikelyEventArg(methodSignature: string, value: any): boolean {
    const literal = resolveEventName(methodSignature, value);
    if (literal && literal.length > 0) return true;
    if (value instanceof Local) {
        const t = String(value.getType?.()?.toString?.() || "").toLowerCase();
        return t.includes("string");
    }
    return false;
}

function isLikelyCallableArg(scene: Scene, value: any): boolean {
    if (!value) return false;
    const candidates = resolveMethodsFromCallable(scene, value, { maxCandidates: 4 });
    if (candidates.length > 0) return true;
    const t = String(value.getType?.()?.toString?.() || "").toLowerCase();
    if (t.includes("%am") || t.includes("function") || t.includes("=>") || t.includes("callable")) {
        return true;
    }
    const text = String(value.toString?.() || "").toLowerCase();
    return text.includes("%am");
}

function resolveEventName(methodSignature: string, eventArg: any): string | undefined {
    const literal = resolveStringLiteral(eventArg);
    if (literal) return literal;
    if (!(eventArg instanceof Local)) return undefined;
    return traceLocalStringLiteral(methodSignature, eventArg);
}

function resolveStringLiteral(value: any): string | undefined {
    if (!value) return undefined;
    if (value instanceof Constant) {
        return normalizeStringLiteral(value.getValue());
    }
    const text = String(value?.toString?.() || "").trim();
    const m = text.match(/^(['"`])((?:\\.|(?!\1).)*)\1$/);
    if (!m) return undefined;
    return normalizeStringLiteral(m[2]);
}

function normalizeStringLiteral(raw: string): string | undefined {
    const text = String(raw || "").trim();
    if (!text) return undefined;
    const unquoted = text.replace(/^['"`]|['"`]$/g, "").trim();
    return unquoted || undefined;
}

function traceLocalStringLiteral(methodSignature: string, local: Local): string | undefined {
    let current: any = local;
    let steps = 0;
    const visited = new Set<string>();
    while (steps < MAX_EVENT_BACKTRACE_STEPS && current instanceof Local) {
        const declStmt = current.getDeclaringStmt?.();
        const key = `${current.getName?.() || ""}#${declStmt?.toString?.() || ""}`;
        if (visited.has(key)) return undefined;
        visited.add(key);
        if (visited.size > MAX_EVENT_BACKTRACE_VISITED) return undefined;
        if (!(declStmt instanceof ArkAssignStmt)) return undefined;
        const declMethodSig = declStmt.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (!declMethodSig || declMethodSig !== methodSignature) return undefined;

        const right = declStmt.getRightOp();
        const literal = resolveStringLiteral(right);
        if (literal) return literal;
        if (!(right instanceof Local)) return undefined;

        current = right;
        steps++;
    }
    return undefined;
}

function resolveCallbackMethodsFromArg(scene: Scene, callbackArg: any): any[] {
    const initial = resolveMethodsFromCallable(scene, callbackArg, { maxCandidates: 8 });
    if (initial.length > 0) return initial;

    const out = new Set<any>();
    const raw = String(callbackArg?.toString?.() || "");
    const name = String(callbackArg?.getName?.() || "");
    for (const hint of [name, raw]) {
        const normalized = hint.trim();
        if (!normalized || normalized.includes("(")) continue;
        for (const method of scene.getMethods()) {
            if (!method.getCfg?.()) continue;
            if (method.getName?.() === normalized) {
                out.add(method);
            }
        }
    }
    return [...out];
}

function collectNodeIdsByValue(pag: Pag, value: any): Set<number> {
    const out = new Set<number>();
    const nodes = pag.getNodesByValue(value);
    if (!nodes || nodes.size === 0) return out;
    for (const nodeId of nodes.values()) out.add(nodeId);
    return out;
}

function collectCallbackParamNodeIds(pag: Pag, callbackMethods: any[], paramIndex: number): Set<number> {
    const out = new Set<number>();
    for (const callbackMethod of callbackMethods) {
        const paramStmts = collectParameterAssignStmts(callbackMethod)
            .filter(s => (s.getRightOp() as ArkParameterRef).getIndex() === paramIndex);
        if (paramStmts.length === 0) {
            const cfg = callbackMethod.getCfg?.();
            const stmts = cfg ? cfg.getStmts() : [];
            for (const stmt of stmts) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const right = stmt.getRightOp();
                if (!(right instanceof ArkParameterRef) || right.getIndex() !== paramIndex) continue;
                const nodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
                if (!nodes || nodes.size === 0) continue;
                for (const nodeId of nodes.values()) out.add(nodeId);
            }
            continue;
        }
        for (const paramStmt of paramStmts) {
            const nodes = getOrCreatePagNodes(pag, paramStmt.getLeftOp(), paramStmt);
            if (!nodes || nodes.size === 0) continue;
            for (const nodeId of nodes.values()) out.add(nodeId);
        }
    }
    return out;
}

function getOrCreatePagNodes(pag: Pag, value: any, anchorStmt: ArkAssignStmt): Map<number, number> | undefined {
    let nodes = pag.getNodesByValue(value);
    if (nodes && nodes.size > 0) return nodes;
    pag.addPagNode(0, value, anchorStmt);
    nodes = pag.getNodesByValue(value);
    return nodes;
}
