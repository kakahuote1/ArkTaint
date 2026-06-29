import { Constant } from "../../../../../arkanalyzer/out/src/core/base/Constant";
import { Local } from "../../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceFieldRef, ArkStaticFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { parseCanonicalApiId } from "../../../api/identity";
import {
    defineModule,
    type ModuleAnalysisApi,
    type ModuleScannedInvoke,
    TaintModule,
} from "../../../kernel/contracts/ModuleApi";
import { createHandoffPropagationSession } from "../../../kernel/semantic_handoff/SemanticHandoffPropagation";
import { createExactHandoffHandle, HandoffEffect } from "../../../kernel/semantic_handoff/SemanticHandoffTypes";
import { isConsumableSemanticEndpointProjection } from "../../../kernel/contracts/PagNodeResolution";

const MAX_EVENT_BACKTRACE_STEPS = 6;
const MAX_EVENT_BACKTRACE_VISITED = 24;
const EMITTER_HANDOFF_FAMILY = "harmony.emitter.payload";
const EMITTER_CELL_KIND = "message-channel-slot";

interface EmitterClassProfile {
    hasOn: boolean;
    hasEmit: boolean;
    hasOnShape: boolean;
    hasEmitShape: boolean;
}

interface EmitterCallbackRegistration {
    method: any;
    envSourceMethods: any[];
}

export interface HarmonyEventEmitterSemanticsOptions {
    id?: string;
    description?: string;
    onCanonicalApiIds?: string[];
    emitCanonicalApiIds?: string[];
    channelArgIndexes?: number[];
    payloadArgIndex?: number;
    callbackArgIndex?: number;
    callbackParamIndex?: number;
    maxCandidates?: number;
}

const DEFAULT_EMITTER_OPTIONS: Required<HarmonyEventEmitterSemanticsOptions> = {
    id: "harmony.emitter",
    description: "Built-in Harmony event emitter bridges.",
    onCanonicalApiIds: [],
    emitCanonicalApiIds: [],
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
        onCanonicalApiIds: options.onCanonicalApiIds && options.onCanonicalApiIds.length > 0
            ? [...new Set(options.onCanonicalApiIds)].sort((left, right) => left.localeCompare(right))
            : [...DEFAULT_EMITTER_OPTIONS.onCanonicalApiIds],
        emitCanonicalApiIds: options.emitCanonicalApiIds && options.emitCanonicalApiIds.length > 0
            ? [...new Set(options.emitCanonicalApiIds)].sort((left, right) => left.localeCompare(right))
            : [...DEFAULT_EMITTER_OPTIONS.emitCanonicalApiIds],
    };
    const hasPayloadArg = resolved.payloadArgIndex >= 0;
    const maxChannelArgIndex = resolved.channelArgIndexes.length > 0
        ? Math.max(...resolved.channelArgIndexes)
        : 0;
    const onMinArgs = Math.max(
        maxChannelArgIndex,
        resolved.callbackArgIndex,
    ) + 1;
    const emitMinArgs = Math.max(
        maxChannelArgIndex,
        hasPayloadArg ? resolved.payloadArgIndex : -1,
    ) + 1;

    return defineModule({
        id: resolved.id,
        description: resolved.description,
        setup(ctx) {
            let onRegistrationCount = 0;
            let emitCount = 0;
            let dynamicEventSkipCount = 0;
            let deferredBindingCount = 0;
            const handoffEffects: HandoffEffect[] = [];
            const methodsBySignature = new Map<string, any>();
            for (const method of ctx.methods.all()) {
                const signature = method?.getSignature?.()?.toString?.();
                if (signature) {
                    methodsBySignature.set(signature, method);
                }
            }

            const onCalls = scanCanonicalEmitterCalls(ctx, resolved.onCanonicalApiIds);
            const emitCalls = scanCanonicalEmitterCalls(ctx, resolved.emitCanonicalApiIds);
            const classProfiles = buildEmitterCallsiteProfiles(
                ctx,
                onCalls,
                emitCalls,
                resolved.channelArgIndexes,
                resolved.payloadArgIndex,
                resolved.callbackArgIndex,
                resolved.maxCandidates,
            );
            const callbackMethodsByEventKey = new Map<string, Map<string, EmitterCallbackRegistration>>();

            for (const call of onCalls) {
                if (call.args().length < onMinArgs) continue;
                const ownerKey = emitterOwnerIdentityKey(call);
                if (!ownerKey) continue;
                const profile = classProfiles.get(ownerKey);
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
                const callbackMethods = filterEmitterCallbackMethods(
                    call,
                    ctx.callbacks.methods(
                        call.arg(resolved.callbackArgIndex),
                        { maxCandidates: resolved.maxCandidates },
                    ),
                );
                if (callbackMethods.length === 0) continue;
                const callbackParamNodeIds = callbackParamNodeIdsForEmitterCall(
                    call,
                    ctx.callbacks.paramBindings(
                        call.arg(resolved.callbackArgIndex),
                        resolved.callbackParamIndex,
                        { maxCandidates: resolved.maxCandidates },
                    ),
                );
                onRegistrationCount++;
                for (const eventKey of buildEmitterEventKeys(call, ownerKey, channelKey)) {
                    let bucket = callbackMethodsByEventKey.get(eventKey);
                    if (!bucket) {
                        bucket = new Map<string, EmitterCallbackRegistration>();
                        callbackMethodsByEventKey.set(eventKey, bucket);
                    }
                    for (const callbackMethod of callbackMethods) {
                        bucket.set(callbackMethod.methodSignature, {
                            method: callbackMethod.method,
                            envSourceMethods: [methodsBySignature.get(call.ownerMethodSignature)].filter(method => !!method?.getCfg?.()),
                        });
                    }
                    for (const targetNodeId of callbackParamNodeIds) {
                        handoffEffects.push({
                            kind: "get",
                            handle: createExactHandoffHandle(EMITTER_CELL_KIND, EMITTER_HANDOFF_FAMILY, eventKey),
                            target: {
                                nodeId: targetNodeId,
                                allowUnreachableTarget: true,
                            },
                            reason: `Harmony event payload ${eventKey}`,
                            originModel: "harmony.emitter",
                            programPoint: emitterProgramPoint(call),
                            confidence: "certain",
                        });
                    }
                }
            }

            for (const call of emitCalls) {
                if (call.args().length < emitMinArgs) continue;
                const ownerKey = emitterOwnerIdentityKey(call);
                if (!ownerKey) continue;
                const profile = classProfiles.get(ownerKey);
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
                const payloadNodeIds = hasPayloadArg
                    ? call.argNodeIds(resolved.payloadArgIndex)
                    : [];
                const activationArgIndex = hasPayloadArg
                    ? resolved.payloadArgIndex
                    : (resolveEmitterChannelArgIndexes(
                        callArgs,
                        resolved.channelArgIndexes,
                        resolved.payloadArgIndex,
                        resolved.callbackArgIndex,
                    )[0] ?? 0);
                for (const eventKey of buildEmitterEventKeys(call, ownerKey, channelKey)) {
                    for (const nodeId of payloadNodeIds) {
                        handoffEffects.push({
                            kind: "put",
                            handle: createExactHandoffHandle(EMITTER_CELL_KIND, EMITTER_HANDOFF_FAMILY, eventKey),
                            source: { nodeId },
                            reason: `Harmony event payload ${eventKey}`,
                            originModel: "harmony.emitter",
                            programPoint: emitterProgramPoint(call),
                            confidence: "certain",
                        });
                    }
                    const callbackMethods = callbackMethodsByEventKey.get(eventKey);
                    if (!callbackMethods || callbackMethods.size === 0) continue;
                    for (const registration of callbackMethods.values()) {
                        ctx.deferred.declarative({
                            sourceMethod,
                            handlerMethod: registration.method,
                            envSourceMethods: registration.envSourceMethods,
                            anchorStmt: call.stmt,
                            triggerLabel: eventKey,
                            activationSource: { kind: "arg", index: activationArgIndex },
                            ...(hasPayloadArg ? { payloadSource: { kind: "arg" as const, index: resolved.payloadArgIndex } } : {}),
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
            const handoff = createHandoffPropagationSession(handoffEffects, {
                currentnessAnalysis: ctx.raw.currentnessAnalysis,
            });
            return {
                onFact(event) {
                    return handoff.emitForFact(event);
                },
            };
        },
    });
}

function scanCanonicalEmitterCalls(
    ctx: Parameters<NonNullable<TaintModule["setup"]>>[0],
    canonicalApiIds: string[],
): ModuleScannedInvoke[] {
    const out = [];
    const seen = new Set<string>();
    for (const canonicalApiId of canonicalApiIds) {
        for (const call of ctx.scan.invokes({ canonicalApiId })) {
            if (!hasResolvedModuleSemanticEndpoint(call, ctx.analysis)) continue;
            const key = [
                call.ownerMethodSignature,
                call.call.canonicalApiId || canonicalApiId,
                call.call.signature,
                call.stmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0,
                call.stmt?.getOriginPositionInfo?.()?.getColNo?.() || 0,
            ].join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(call);
        }
    }
    return out;
}

function hasResolvedModuleSemanticEndpoint(
    call: ModuleScannedInvoke,
    analysis: ModuleAnalysisApi,
): boolean {
    for (const semanticSite of call.call.semanticEffectSites || []) {
        if (semanticSite.capability !== "module") continue;
        if (semanticSite.canonicalApiId !== call.call.canonicalApiId) continue;
        if (semanticSite.occurrenceId !== call.call.occurrenceId) continue;
        if (semanticSite.rawOccurrenceId !== call.call.rawOccurrenceId) continue;
        const projection = analysis.projectEndpoint({
            semanticSite,
            endpointSpec: semanticSite.endpointSpec,
            stmt: call.stmt,
            invokeExpr: call.invokeExpr,
            allowNodeCreation: false,
            consumer: "module",
        });
        if (isConsumableSemanticEndpointProjection(projection)) {
            return true;
        }
    }
    return false;
}

export const harmonyEmitterSemanticModule = createHarmonyEventEmitterSemanticModule();
export const harmonyEmitterModule: TaintModule = harmonyEmitterSemanticModule;

function emitterOwnerIdentityKey(call: { call?: { canonicalApiId?: string } }): string | undefined {
    const parts = parseCanonicalApiId(call.call?.canonicalApiId || "");
    if (!parts) return undefined;
    return [
        parts.authority,
        parts.domain,
        parts.module,
        parts.file,
        parts.export,
        parts.decl,
    ].join("|");
}

function filterEmitterCallbackMethods(call: any, callbacks: any[]): any[] {
    const ownerFile = methodSignatureFile(call.ownerMethodSignature);
    if (!ownerFile) return [];
    return callbacks.filter(callback => methodSignatureFile(callback.methodSignature) === ownerFile);
}

function callbackParamNodeIdsForEmitterCall(call: any, bindings: any[]): number[] {
    const ownerFile = methodSignatureFile(call.ownerMethodSignature);
    if (!ownerFile) return [];
    const out = new Set<number>();
    for (const binding of bindings) {
        if (methodSignatureFile(binding.methodSignature) !== ownerFile) continue;
        for (const nodeId of binding.localNodeIds()) {
            out.add(nodeId);
        }
        for (const nodeId of binding.localUseNodeIds()) {
            out.add(nodeId);
        }
    }
    return [...out.values()];
}

function methodSignatureFile(signature: string | undefined): string | undefined {
    const text = String(signature || "");
    const match = /^@([^:]+):/.exec(text);
    return match?.[1]?.replace(/\\/g, "/");
}

function buildEmitterEventKeys(call: any, ownerKey: string, channelKey: string): string[] {
    const keys = new Set<string>();
    const baseNodeIds = typeof call.baseNodeIds === "function"
        ? call.baseNodeIds()
        : [];
    if (Array.isArray(baseNodeIds) && baseNodeIds.length > 0) {
        for (const nodeId of baseNodeIds) {
            keys.add(`${ownerKey}::node:${nodeId}::${channelKey}`);
        }
    }
    const fieldBackedReceiverKey = resolveFieldBackedEmitterReceiverKey(call);
    if (fieldBackedReceiverKey) {
        keys.add(`${ownerKey}::field:${fieldBackedReceiverKey}::${channelKey}`);
    }
    const baseObjectNodeIds = typeof call.baseObjectNodeIds === "function"
        ? call.baseObjectNodeIds()
        : [];
    if (Array.isArray(baseObjectNodeIds) && baseObjectNodeIds.length === 1) {
        for (const nodeId of baseObjectNodeIds) {
            keys.add(`${ownerKey}::obj:${nodeId}::${channelKey}`);
        }
    }
    if (keys.size === 0) {
        const baseCarrierNodeIds = typeof call.baseCarrierNodeIds === "function"
            ? call.baseCarrierNodeIds()
            : [];
        if (Array.isArray(baseCarrierNodeIds) && baseCarrierNodeIds.length === 1) {
            for (const nodeId of baseCarrierNodeIds) {
                keys.add(`${ownerKey}::carrier:${nodeId}::${channelKey}`);
            }
        }
    }
    if (keys.size === 0) {
        if (Array.isArray(baseObjectNodeIds) && baseObjectNodeIds.length > 0) {
            for (const nodeId of baseObjectNodeIds) {
                keys.add(`${ownerKey}::obj:${nodeId}::${channelKey}`);
            }
        }
    }
    if (keys.size === 0) {
        keys.add(`${ownerKey}::${channelKey}`);
    }
    return [...keys];
}

function emitterProgramPoint(call: { ownerMethodSignature?: string; stmt?: any; call?: { signature?: string } }): string {
    const owner = call.ownerMethodSignature || "";
    const stmt = String(call.stmt?.toString?.() || call.call?.signature || "").trim();
    return `${owner}#${stmt}`;
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

function buildEmitterCallsiteProfiles(
    ctx: Parameters<NonNullable<TaintModule["setup"]>>[0],
    onCalls: any[],
    emitCalls: any[],
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

    for (const call of onCalls) {
        const ownerKey = emitterOwnerIdentityKey(call);
        if (!ownerKey) continue;
        const profile = ensure(ownerKey);
        const invokeArgs = call.args();
        const resolvedChannelArgIndexes = resolveEmitterChannelArgIndexes(
            invokeArgs,
            channelArgIndexes,
            payloadArgIndex,
            callbackArgIndex,
        );
        const channelLike = hasLikelyChannelShape(call.ownerMethodSignature || "", invokeArgs, resolvedChannelArgIndexes);
        const callbackLike = invokeArgs.length > callbackArgIndex
            && filterEmitterCallbackMethods(
                call,
                ctx.callbacks.methods(
                    call.arg(callbackArgIndex),
                    { maxCandidates },
                ),
            ).length > 0;
        profile.hasOn = true;
        if (channelLike && callbackLike) {
            profile.hasOnShape = true;
        }
    }

    for (const call of emitCalls) {
        const ownerKey = emitterOwnerIdentityKey(call);
        if (!ownerKey) continue;
        const profile = ensure(ownerKey);
        const invokeArgs = call.args();
        const resolvedChannelArgIndexes = resolveEmitterChannelArgIndexes(
            invokeArgs,
            channelArgIndexes,
            payloadArgIndex,
            callbackArgIndex,
        );
        const channelLike = hasLikelyChannelShape(call.ownerMethodSignature || "", invokeArgs, resolvedChannelArgIndexes);
        profile.hasEmit = true;
        if (channelLike && (payloadArgIndex < 0 || invokeArgs.length > payloadArgIndex)) {
            profile.hasEmitShape = true;
        }
    }

    return profiles;
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
    const typeToken = resolveStaticMemberTokenFromTypeText(eventArg.getType?.()?.toString?.());
    if (typeToken) return typeToken;
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
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(text)) {
        return `sym:${text}`;
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

function resolveStaticMemberTokenFromTypeText(raw: unknown): string | undefined {
    const text = String(raw || "").trim();
    if (!text.includes("[static]")) return undefined;
    const normalized = text
        .replace(/\s+/g, "")
        .replace(/\.?\[static\]/g, ".");
    const memberMatch = /(?:^|:)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)$/u.exec(normalized);
    if (!memberMatch) return undefined;
    return `sym:${memberMatch[1]}`;
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
