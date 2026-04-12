import { Constant } from "../../../../../arkanalyzer/out/src/core/base/Constant";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceFieldRef, ArkStaticFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { defineModule, TaintModule } from "../../../kernel/contracts/ModuleApi";

const MAX_EVENT_BACKTRACE_STEPS = 6;
const MAX_EVENT_BACKTRACE_VISITED = 24;

interface EmitterClassProfile {
    hasOn: boolean;
    hasEmit: boolean;
    hasOnShape: boolean;
    hasEmitShape: boolean;
}

export interface HarmonyEventEmitterSemanticsOptions {
    id?: string;
    description?: string;
    onMethods?: string[];
    emitMethods?: string[];
    channelArgIndexes?: number[];
    payloadArgIndex?: number;
    callbackArgIndex?: number;
    callbackParamIndex?: number;
    maxCandidates?: number;
}

const DEFAULT_EMITTER_OPTIONS: Required<HarmonyEventEmitterSemanticsOptions> = {
    id: "harmony.emitter",
    description: "Built-in Harmony event emitter bridges.",
    onMethods: ["on"],
    emitMethods: ["emit"],
    channelArgIndexes: [],
    payloadArgIndex: 1,
    callbackArgIndex: 1,
    callbackParamIndex: 0,
    maxCandidates: 8,
};

export function createHarmonyEventEmitterSemanticModule(
    options: HarmonyEventEmitterSemanticsOptions = {},
): TaintModule {
    const resolved = {
        id: options.id || DEFAULT_EMITTER_OPTIONS.id,
        description: options.description || DEFAULT_EMITTER_OPTIONS.description,
        channelArgIndexes: Array.isArray(options.channelArgIndexes)
            ? [...new Set(options.channelArgIndexes)].sort((a, b) => a - b)
            : [...DEFAULT_EMITTER_OPTIONS.channelArgIndexes],
        payloadArgIndex: Number.isInteger(options.payloadArgIndex)
            ? options.payloadArgIndex
            : DEFAULT_EMITTER_OPTIONS.payloadArgIndex,
        callbackArgIndex: Number.isInteger(options.callbackArgIndex)
            ? options.callbackArgIndex
            : DEFAULT_EMITTER_OPTIONS.callbackArgIndex,
        callbackParamIndex: Number.isInteger(options.callbackParamIndex)
            ? options.callbackParamIndex
            : DEFAULT_EMITTER_OPTIONS.callbackParamIndex,
        maxCandidates: Number.isInteger(options.maxCandidates)
            ? options.maxCandidates
            : DEFAULT_EMITTER_OPTIONS.maxCandidates,
        onMethods: options.onMethods && options.onMethods.length > 0
            ? [...options.onMethods]
            : [...DEFAULT_EMITTER_OPTIONS.onMethods],
        emitMethods: options.emitMethods && options.emitMethods.length > 0
            ? [...options.emitMethods]
            : [...DEFAULT_EMITTER_OPTIONS.emitMethods],
    };
    const onMethodNames = new Set(resolved.onMethods);
    const emitMethodNames = new Set(resolved.emitMethods);
    const maxChannelArgIndex = resolved.channelArgIndexes.length > 0
        ? Math.max(...resolved.channelArgIndexes)
        : 0;
    const minArgs = Math.max(
        maxChannelArgIndex,
        resolved.payloadArgIndex,
        resolved.callbackArgIndex,
    ) + 1;

    return defineModule({
        id: resolved.id,
        description: resolved.description,
        setup(ctx) {
            let onRegistrationCount = 0;
            let emitCount = 0;
            let dynamicEventSkipCount = 0;
            let deferredBindingCount = 0;

            const declaredProfiles = buildEmitterClassProfiles(ctx.methods.all(), onMethodNames, emitMethodNames);
            const observedProfiles = buildEmitterCallsiteProfiles(
                ctx.methods.all(),
                ctx,
                onMethodNames,
                emitMethodNames,
                resolved.channelArgIndexes,
                resolved.payloadArgIndex,
                resolved.callbackArgIndex,
                resolved.maxCandidates,
            );
            const classProfiles = mergeEmitterClassProfiles(declaredProfiles, observedProfiles);
            const callbackMethodsByEventKey = new Map<string, Map<string, any>>();

            for (const call of ctx.scan.invokes({ minArgs })) {
                const isOnCall = resolved.onMethods.some(methodName => call.call.matchesMethod(methodName));
                if (!isOnCall) {
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
                const callArgs = call.args();
                const channelKey = resolveEmitterChannelKey(
                    call.ownerMethodSignature,
                    callArgs,
                    resolveEmitterChannelArgIndexes(
                        callArgs,
                        resolved.channelArgIndexes,
                        resolved.payloadArgIndex,
                        resolved.callbackArgIndex,
                    ),
                );
                if (!channelKey) {
                    dynamicEventSkipCount++;
                    continue;
                }
                const callbackMethods = ctx.callbacks.methods(
                    call.arg(resolved.callbackArgIndex),
                    { maxCandidates: resolved.maxCandidates },
                );
                if (callbackMethods.length === 0) continue;
                onRegistrationCount++;
                for (const eventKey of buildEmitterEventKeys(call, classKey, channelKey)) {
                    let bucket = callbackMethodsByEventKey.get(eventKey);
                    if (!bucket) {
                        bucket = new Map<string, any>();
                        callbackMethodsByEventKey.set(eventKey, bucket);
                    }
                    for (const callbackMethod of callbackMethods) {
                        bucket.set(callbackMethod.methodSignature, callbackMethod.method);
                    }
                }
            }

            for (const call of ctx.scan.invokes({ minArgs })) {
                const isEmitCall = resolved.emitMethods.some(methodName => call.call.matchesMethod(methodName));
                if (!isEmitCall) {
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
                const callArgs = call.args();
                const channelKey = resolveEmitterChannelKey(
                    call.ownerMethodSignature,
                    callArgs,
                    resolveEmitterChannelArgIndexes(
                        callArgs,
                        resolved.channelArgIndexes,
                        resolved.payloadArgIndex,
                        resolved.callbackArgIndex,
                    ),
                );
                if (!channelKey) {
                    dynamicEventSkipCount++;
                    continue;
                }
                emitCount++;
                const sourceMethod = call.stmt?.getCfg?.()?.getDeclaringMethod?.();
                if (!sourceMethod?.getCfg?.()) continue;
                for (const eventKey of buildEmitterEventKeys(call, classKey, channelKey)) {
                    const callbackMethods = callbackMethodsByEventKey.get(eventKey);
                    if (!callbackMethods || callbackMethods.size === 0) continue;
                    for (const handlerMethod of callbackMethods.values()) {
                        ctx.deferred.declarative({
                            sourceMethod,
                            handlerMethod,
                            anchorStmt: call.stmt,
                            triggerLabel: eventKey,
                            activationSource: { kind: "arg", index: resolved.payloadArgIndex },
                            payloadSource: { kind: "arg", index: resolved.payloadArgIndex },
                            reason: `Harmony event dispatch ${eventKey}`,
                        });
                        deferredBindingCount++;
                    }
                }
            }

            ctx.debug.summary("Harmony-Emitter", {
                on_registrations: onRegistrationCount,
                emits: emitCount,
                deferred_bindings: deferredBindingCount,
                dynamic_event_skips: dynamicEventSkipCount,
            });
        },
    });
}

export const harmonyEmitterSemanticModule = createHarmonyEventEmitterSemanticModule();
export const harmonyEmitterModule: TaintModule = harmonyEmitterSemanticModule;

function resolveClassKeyFromMethodSig(methodSig: any): string {
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const classSigText = methodSig?.getDeclaringClassSignature?.()?.toString?.() || "";
    const signatureText = methodSig?.toString?.() || "";
    return className || classSigText || signatureText;
}

function buildEmitterEventKeys(call: any, classKey: string, channelKey: string): string[] {
    const keys = new Set<string>();
    const baseNodeIds = typeof call.baseNodeIds === "function"
        ? call.baseNodeIds()
        : [];
    if (Array.isArray(baseNodeIds) && baseNodeIds.length > 0) {
        for (const nodeId of baseNodeIds) {
            keys.add(`${classKey}::node:${nodeId}::${channelKey}`);
        }
    }
    const fieldBackedReceiverKey = resolveFieldBackedEmitterReceiverKey(call);
    if (fieldBackedReceiverKey) {
        keys.add(`${classKey}::field:${fieldBackedReceiverKey}::${channelKey}`);
    }
    const baseObjectNodeIds = typeof call.baseObjectNodeIds === "function"
        ? call.baseObjectNodeIds()
        : [];
    if (Array.isArray(baseObjectNodeIds) && baseObjectNodeIds.length === 1) {
        for (const nodeId of baseObjectNodeIds) {
            keys.add(`${classKey}::obj:${nodeId}::${channelKey}`);
        }
    }
    if (keys.size === 0) {
        const baseCarrierNodeIds = typeof call.baseCarrierNodeIds === "function"
            ? call.baseCarrierNodeIds()
            : [];
        if (Array.isArray(baseCarrierNodeIds) && baseCarrierNodeIds.length === 1) {
            for (const nodeId of baseCarrierNodeIds) {
                keys.add(`${classKey}::carrier:${nodeId}::${channelKey}`);
            }
        }
    }
    if (keys.size === 0) {
        if (Array.isArray(baseObjectNodeIds) && baseObjectNodeIds.length > 0) {
            for (const nodeId of baseObjectNodeIds) {
                keys.add(`${classKey}::obj:${nodeId}::${channelKey}`);
            }
        }
    }
    if (keys.size === 0) {
        keys.add(`${classKey}::${channelKey}`);
    }
    return [...keys];
}

function resolveFieldBackedEmitterReceiverKey(call: any): string | undefined {
    const baseValue = typeof call.base === "function" ? call.base() : undefined;
    if (!(baseValue instanceof Local)) {
        return undefined;
    }
    const declStmt = baseValue.getDeclaringStmt?.();
    if (!(declStmt instanceof ArkAssignStmt)) {
        return undefined;
    }
    const right = declStmt.getRightOp?.();
    if (!(right instanceof ArkInstanceFieldRef || right instanceof ArkStaticFieldRef)) {
        return undefined;
    }
    const text = String(right.toString?.() || "").trim();
    return text || undefined;
}

function buildEmitterClassProfiles(
    methods: any[],
    onMethodNames: Set<string>,
    emitMethodNames: Set<string>,
): Map<string, EmitterClassProfile> {
    const profiles = new Map<string, EmitterClassProfile>();
    for (const method of methods) {
        const methodSig = method.getSignature?.();
        if (!methodSig) continue;
        const classKey = resolveClassKeyFromMethodSig(methodSig);
        const methodName = methodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
        const profile = profiles.get(classKey) || { hasOn: false, hasEmit: false, hasOnShape: false, hasEmitShape: false };
        if (onMethodNames.has(methodName)) {
            profile.hasOn = true;
            if (isOnMethodShape(method)) {
                profile.hasOnShape = true;
            }
        }
        if (emitMethodNames.has(methodName)) {
            profile.hasEmit = true;
            if (isEmitMethodShape(method)) {
                profile.hasEmitShape = true;
            }
        }
        profiles.set(classKey, profile);
    }
    return profiles;
}

function buildEmitterCallsiteProfiles(
    methods: any[],
    ctx: Parameters<NonNullable<TaintModule["setup"]>>[0],
    onMethodNames: Set<string>,
    emitMethodNames: Set<string>,
    channelArgIndexes: number[],
    payloadArgIndex: number,
    callbackArgIndex: number,
    maxCandidates: number,
): Map<string, EmitterClassProfile> {
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
            const isOn = onMethodNames.has(invokeMethodName);
            const isEmit = emitMethodNames.has(invokeMethodName);
            if (!isOn && !isEmit) continue;

            const classKey = resolveClassKeyFromMethodSig(invokeMethodSig);
            const profile = ensure(classKey);
            const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const resolvedChannelArgIndexes = resolveEmitterChannelArgIndexes(
                invokeArgs,
                channelArgIndexes,
                payloadArgIndex,
                callbackArgIndex,
            );
            const channelLike = hasLikelyChannelShape(methodSignature, invokeArgs, resolvedChannelArgIndexes);

            if (isOn) {
                profile.hasOn = true;
                const callbackLike = invokeArgs.length > callbackArgIndex
                    && ctx.callbacks.paramNodeIds(
                        invokeArgs[callbackArgIndex],
                        0,
                        { maxCandidates },
                    ).length > 0;
                if (channelLike && callbackLike) {
                    profile.hasOnShape = true;
                }
            } else if (isEmit) {
                profile.hasEmit = true;
                if (channelLike && invokeArgs.length > payloadArgIndex) {
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

function hasLikelyChannelShape(methodSignature: string, invokeArgs: any[], channelArgIndexes: number[]): boolean {
    if (channelArgIndexes.length === 0) {
        return false;
    }
    let hasResolved = false;
    for (const index of channelArgIndexes) {
        if (index < 0 || index >= invokeArgs.length) {
            return false;
        }
        if (isLikelyChannelArg(methodSignature, invokeArgs[index])) {
            hasResolved = true;
        }
    }
    return hasResolved;
}

function isLikelyChannelArg(methodSignature: string, value: any): boolean {
    const literal = resolveEmitterAddressToken(methodSignature, value);
    if (literal && literal.length > 0) return true;
    if (value instanceof Local) {
        const typeText = String(value.getType?.()?.toString?.() || "").toLowerCase();
        return typeText.includes("string") || typeText.includes("number") || typeText.includes("boolean");
    }
    return false;
}

function resolveEmitterChannelArgIndexes(
    invokeArgs: any[],
    configuredChannelArgIndexes: number[],
    payloadArgIndex: number,
    callbackArgIndex: number,
): number[] {
    if (configuredChannelArgIndexes.length > 0) {
        return [...new Set(configuredChannelArgIndexes)].sort((a, b) => a - b);
    }
    const indexes: number[] = [];
    for (let index = 0; index < invokeArgs.length; index++) {
        if (index === payloadArgIndex || index === callbackArgIndex) {
            continue;
        }
        indexes.push(index);
    }
    return indexes;
}

function resolveEmitterChannelKey(methodSignature: string, invokeArgs: any[], channelArgIndexes: number[]): string | undefined {
    if (channelArgIndexes.length === 0) {
        return undefined;
    }
    const parts: string[] = [];
    for (const index of channelArgIndexes) {
        if (index < 0 || index >= invokeArgs.length) {
            return undefined;
        }
        const token = resolveEmitterAddressToken(methodSignature, invokeArgs[index]);
        if (!token) {
            return undefined;
        }
        parts.push(token);
    }
    return parts.join("|");
}

function resolveEmitterAddressToken(methodSignature: string, eventArg: any): string | undefined {
    const literal = resolveScalarLiteral(eventArg);
    if (literal) return literal;
    if (!(eventArg instanceof Local)) return undefined;
    return traceLocalScalarLiteral(methodSignature, eventArg);
}

function resolveScalarLiteral(value: any): string | undefined {
    if (!value) return undefined;
    if (value instanceof Constant) {
        return normalizeScalarLiteral(value.getValue());
    }
    const text = String(value?.toString?.() || "").trim();
    const quoted = text.match(/^(['"`])((?:\\.|(?!\1).)*)\1$/);
    if (quoted) {
        return normalizeScalarLiteral(quoted[2]);
    }
    if (/^-?\d+(?:\.\d+)?$/.test(text)) {
        return normalizeScalarLiteral(Number(text));
    }
    if (text === "true" || text === "false") {
        return normalizeScalarLiteral(text === "true");
    }
    return undefined;
}

function normalizeScalarLiteral(raw: unknown): string | undefined {
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === "string") {
        const text = raw.trim().replace(/^['"`]|['"`]$/g, "").trim();
        return text ? `s:${text}` : undefined;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
        return `${typeof raw}:${String(raw)}`;
    }
    return undefined;
}

function traceLocalScalarLiteral(methodSignature: string, local: Local): string | undefined {
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
        const literal = resolveScalarLiteral(right);
        if (literal) return literal;
        current = right;
        steps += 1;
    }
    return undefined;
}

export default harmonyEmitterModule;
