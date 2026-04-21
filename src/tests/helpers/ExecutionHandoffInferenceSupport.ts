import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { resolveKnownFrameworkCallbackRegistration } from "../../core/substrate/semantics/ApprovedImperativeDeferredBindingSemantics";
import { isCallableValue, resolveMethodsFromCallable } from "../../core/substrate/queries/CalleeResolver";
import { registerMockSdkFiles } from "./TestSceneBuilder";
import {
    captureBindings,
    findInvokeStmt,
    methodSignature,
    paramBindings,
    payloadBindings,
    stmtTexts,
} from "./ExecutionHandoffContractSupport";

type SceneLike = Scene;
type MethodLike = any;

export type TriggerToken = "call(c)" | "event(c)" | "settle(fulfilled)" | "settle(rejected)" | "settle(any)";
export type ResumeKind = "none" | "promise_chain" | "await_site";

export interface InferenceFeatures {
    invokeText: string;
    invokeName: string | null;
    matchingArgIndexes: number[];
    callableArgIndexes: number[];
    localRegistration: boolean;
    registrationReachabilityDepth: number | null;
    usesPtrInvoke: boolean;
    hasAwaitResume: boolean;
    payloadPorts: number;
    capturePorts: number;
}

export const CALLBACK_RESOLVE_OPTIONS = {
    maxCandidates: 8,
    enableLocalBacktrace: true,
    maxBacktraceSteps: 5,
    maxVisitedDefs: 16,
};

export function buildInferenceScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

export function invokeMethodName(stmt: any): string | null {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) {
        return null;
    }
    return invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || null;
}

export function inferTau(features: InferenceFeatures): TriggerToken {
    if (features.registrationReachabilityDepth !== null) {
        return "event(c)";
    }
    if (features.invokeName === "then" && features.matchingArgIndexes.includes(0)) {
        return "settle(fulfilled)";
    }
    if (
        (features.invokeName === "then" && features.matchingArgIndexes.includes(1))
        || (features.invokeName === "catch" && features.matchingArgIndexes.includes(0))
    ) {
        return "settle(rejected)";
    }
    if (features.invokeName === "finally" && features.matchingArgIndexes.includes(0) && features.payloadPorts === 0) {
        return "settle(any)";
    }
    return "call(c)";
}

export function inferResume(features: InferenceFeatures): ResumeKind {
    if (features.hasAwaitResume) {
        return "await_site";
    }
    if (features.invokeName === "then" || features.invokeName === "catch" || features.invokeName === "finally") {
        return "promise_chain";
    }
    return "none";
}

export function inferDeferred(features: InferenceFeatures): boolean {
    return inferTau(features) !== "call(c)" || inferResume(features) === "await_site";
}

export function collectFeatures(scene: SceneLike, outer: MethodLike, unit: MethodLike, witnessNeedle: string): InferenceFeatures {
    const stmt = findInvokeStmt(outer, witnessNeedle);
    const invokeExpr = stmt?.getInvokeExpr?.();
    const explicitArgs = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const { callableArgIndexes, matchingArgIndexes } = collectArgMatchIndexes(scene, stmt, unit);
    const registrationMatch = invokeExpr
        ? resolveKnownFrameworkCallbackRegistration(
            { scene, invokeExpr, explicitArgs, sourceMethod: outer },
        )
        : undefined;
    const callbackArgIndexes = inferRegistrationArgIndexes(stmt, explicitArgs, callableArgIndexes, registrationMatch?.callbackArgIndexes || []);

    const localRegistration = callbackArgIndexes.some(index => matchingArgIndexes.includes(index));
    let registrationReachabilityDepth: number | null = localRegistration ? 0 : null;
    if (registrationReachabilityDepth === null && callbackArgIndexes.length > 0) {
        for (const callbackArgIndex of callbackArgIndexes) {
            const paramIndex = resolveParameterIndexForActualArg(outer, explicitArgs[callbackArgIndex]);
            if (paramIndex === null) {
                continue;
            }
            const relayDepth = resolveRelayRegistrationDepth(scene, outer, paramIndex, unit);
            if (relayDepth !== null && (registrationReachabilityDepth === null || relayDepth < registrationReachabilityDepth)) {
                registrationReachabilityDepth = relayDepth;
            }
        }
    }

    return {
        invokeText: stmt.toString(),
        invokeName: invokeMethodName(stmt),
        callableArgIndexes,
        matchingArgIndexes,
        localRegistration,
        registrationReachabilityDepth,
        usesPtrInvoke: stmt.toString().includes("ptrinvoke "),
        hasAwaitResume: stmtTexts(outer).some(text => text.includes("await ")),
        payloadPorts: payloadBindings(unit).length,
        capturePorts: captureBindings(unit).length,
    };
}

function collectArgMatchIndexes(scene: SceneLike, stmt: any, unit: MethodLike): { callableArgIndexes: number[]; matchingArgIndexes: number[] } {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) {
        return { callableArgIndexes: [], matchingArgIndexes: [] };
    }
    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const unitSignature = methodSignature(unit);
    const callableArgIndexes: number[] = [];
    const matched: number[] = [];
    explicitArgs.forEach((arg: any, index: number) => {
        const methods = resolveMethodsFromCallable(scene, arg, CALLBACK_RESOLVE_OPTIONS);
        if (methods.length > 0 || isCallableValue(arg)) {
            callableArgIndexes.push(index);
        }
        if (methods.some((method: MethodLike) => methodSignature(method) === unitSignature)) {
            matched.push(index);
        }
    });
    return { callableArgIndexes, matchingArgIndexes: matched };
}

function inferRegistrationArgIndexes(
    stmt: any,
    explicitArgs: any[],
    callableArgIndexes: number[],
    classifiedIndexes: number[],
): number[] {
    if (classifiedIndexes.length > 0) {
        return classifiedIndexes;
    }
    const invokeName = invokeMethodName(stmt);
    if (!looksLikeRegistrationInvoke(invokeName)) {
        return [];
    }
    return callableArgIndexes.filter(index => index >= 0 && index < explicitArgs.length);
}

function looksLikeRegistrationInvoke(invokeName: string | null): boolean {
    if (!invokeName) {
        return false;
    }
    const normalized = invokeName.trim();
    if (normalized === "on" || normalized === "bind" || normalized === "subscribe") {
        return true;
    }
    return /^on[A-Z_]/.test(normalized);
}

function resolveParameterIndexForActualArg(method: MethodLike, value: any): number | null {
    if (!(value instanceof Local)) {
        return null;
    }
    const binding = paramBindings(method).find(item => item.local === value.getName());
    return binding ? binding.index : null;
}

function resolveRelayRegistrationDepth(
    scene: SceneLike,
    calleeMethod: MethodLike,
    paramIndex: number,
    unit: MethodLike,
    visited: Set<string> = new Set<string>(),
): number | null {
    const calleeSignature = methodSignature(calleeMethod);
    const visitKey = `${calleeSignature}#${paramIndex}`;
    if (visited.has(visitKey)) {
        return null;
    }
    visited.add(visitKey);

    const unitSignature = methodSignature(unit);
    let bestDepth: number | null = null;

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) {
            continue;
        }
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) {
                continue;
            }
            const invokeSignature = invokeExpr.getMethodSignature?.()?.toString?.() || "";
            if (invokeSignature !== calleeSignature) {
                continue;
            }
            const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (paramIndex >= explicitArgs.length) {
                continue;
            }

            const actualArg = explicitArgs[paramIndex];
            const directMethods = resolveMethodsFromCallable(scene, actualArg, CALLBACK_RESOLVE_OPTIONS);
            if (directMethods.some(candidate => methodSignature(candidate) === unitSignature)) {
                bestDepth = bestDepth === null ? 1 : Math.min(bestDepth, 1);
                continue;
            }

            const callerParamIndex = resolveParameterIndexForActualArg(method, actualArg);
            if (callerParamIndex === null) {
                continue;
            }
            const nestedDepth = resolveRelayRegistrationDepth(scene, method, callerParamIndex, unit, new Set<string>(visited));
            if (nestedDepth !== null) {
                const depth = nestedDepth + 1;
                bestDepth = bestDepth === null ? depth : Math.min(bestDepth, depth);
            }
        }
    }

    return bestDepth;
}
