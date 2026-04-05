import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { defineModule, TaintModule } from "../../../core/kernel/contracts/ModuleApi";

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

export const harmonyEmitterModule: TaintModule = defineModule({
    id: "harmony.emitter",
    description: "Built-in Harmony event emitter bridges.",
    setup(ctx) {
        const relay = ctx.bridge.nodeRelay();
        const callbackTargetsByEventKey = new Map<string, Set<number>>();
        const payloadSourcesByEventKey = new Map<string, Set<number>>();
        let onRegistrationCount = 0;
        let emitCount = 0;
        let dynamicEventSkipCount = 0;

        const declaredProfiles = buildEmitterClassProfiles(ctx.methods.all());
        const observedProfiles = buildEmitterCallsiteProfiles(ctx.methods.all(), ctx);
        const classProfiles = mergeEmitterClassProfiles(declaredProfiles, observedProfiles);

        for (const call of ctx.scan.invokes({ minArgs: 2 })) {
            if (!call.call.matchesMethod(ON_METHOD_NAME) && !call.call.matchesMethod(EMIT_METHOD_NAME)) {
                continue;
            }
            const classKey = call.call.declaringClassName || call.call.signature;
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
            const eventName = resolveEventName(call.ownerMethodSignature, call.arg(0));
            if (!eventName) {
                dynamicEventSkipCount++;
                continue;
            }
            const eventKey = `${classKey}::${eventName}`;
            if (call.call.matchesMethod(ON_METHOD_NAME)) {
                const callbackParamNodeIds = new Set<number>(call.callbackParamNodeIds(1, 0, { maxCandidates: 8 }));
                if (callbackParamNodeIds.size === 0) continue;
                onRegistrationCount++;
                for (const nodeId of callbackParamNodeIds) {
                    addMapSetValue(callbackTargetsByEventKey, eventKey, nodeId);
                }
                continue;
            }

            const payloadNodeIds = new Set<number>(call.argNodeIds(1));
            if (payloadNodeIds.size === 0) continue;
            emitCount++;
            for (const nodeId of payloadNodeIds) {
                addMapSetValue(payloadSourcesByEventKey, eventKey, nodeId);
            }
        }

        let bridgeCount = 0;
        for (const [eventKey, sourceNodeIds] of payloadSourcesByEventKey.entries()) {
            const targetNodeIds = callbackTargetsByEventKey.get(eventKey);
            if (!targetNodeIds || targetNodeIds.size === 0) continue;
            bridgeCount += sourceNodeIds.size * targetNodeIds.size;
            relay.connectMany(sourceNodeIds, targetNodeIds);
        }

        ctx.debug.summary("Harmony-Emitter", {
            on_registrations: onRegistrationCount,
            emits: emitCount,
            bridge_edges: bridgeCount,
            dynamic_event_skips: dynamicEventSkipCount,
        });

        return {
            onFact(event) {
                return relay.emitPreserve(event, "Harmony-Emitter");
            },
        };
    },
});

function addMapSetValue<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
    let set = map.get(key);
    if (!set) {
        set = new Set<V>();
        map.set(key, set);
    }
    set.add(value);
}

function resolveClassKeyFromMethodSig(methodSig: any): string {
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const classSigText = methodSig?.getDeclaringClassSignature?.()?.toString?.() || "";
    const signatureText = methodSig?.toString?.() || "";
    return className || classSigText || signatureText;
}

function buildEmitterClassProfiles(methods: any[]): Map<string, EmitterClassProfile> {
    const profiles = new Map<string, EmitterClassProfile>();
    for (const method of methods) {
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

function buildEmitterCallsiteProfiles(methods: any[], ctx: Parameters<NonNullable<TaintModule["setup"]>>[0]): Map<string, EmitterClassProfile> {
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
                const callbackLike = invokeArgs.length > 1 && ctx.callbacks.paramNodeIds(invokeArgs[1], 0, { maxCandidates: 4 }).length > 0;
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
    observedProfiles: Map<string, EmitterClassProfile>,
): Map<string, EmitterClassProfile> {
    const out = new Map<string, EmitterClassProfile>();
    const keys = new Set<string>([...declaredProfiles.keys(), ...observedProfiles.keys()]);
    for (const key of keys) {
        const declared = declaredProfiles.get(key);
        const observed = observedProfiles.get(key);
        out.set(key, {
            hasOn: Boolean(declared?.hasOn || observed?.hasOn),
            hasEmit: Boolean(declared?.hasEmit || observed?.hasEmit),
            hasOnShape: Boolean(declared?.hasOnShape || observed?.hasOnShape),
            hasEmitShape: Boolean(declared?.hasEmitShape || observed?.hasEmitShape),
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
        const typeText = String(value.getType?.()?.toString?.() || "").toLowerCase();
        return typeText.includes("string");
    }
    return false;
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
    const match = text.match(/^(['"`])((?:\\.|(?!\1).)*)\1$/);
    if (!match) return undefined;
    return normalizeStringLiteral(match[2]);
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
        const declStmt: any = current.getDeclaringStmt?.();
        const key = `${methodSignature}#${current.getName?.() || ""}#${declStmt?.toString?.() || ""}`;
        if (visited.has(key)) return undefined;
        visited.add(key);
        if (visited.size > MAX_EVENT_BACKTRACE_VISITED) return undefined;
        if (!declStmt || declStmt.constructor?.name !== "ArkAssignStmt") return undefined;
        const right = declStmt.getRightOp?.();
        const literal = resolveStringLiteral(right);
        if (literal) return literal;
        current = right;
        steps += 1;
    }
    return undefined;
}

export default harmonyEmitterModule;
