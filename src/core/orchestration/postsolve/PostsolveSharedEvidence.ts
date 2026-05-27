import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintFlow } from "../../kernel/model/TaintFlow";
import {
    collectKnownKeyedDispatchKeysFromMethod,
    resolveKnownKeyedCallbackRegistrationsFromStmt,
} from "../../entry/shared/FrameworkCallbackClassifier";
import { collectFiniteStringCandidatesFromValue } from "../../substrate/queries/FiniteStringCandidateResolver";

export function extractFilePathFromSignature(signature: string): string {
    const at = signature.indexOf("@");
    if (at < 0) return "";
    const methodSep = signature.indexOf(": ", at);
    if (methodSep < 0) return "";
    return signature.slice(at + 1, methodSep).replace(/\\/g, "/");
}

export function resolveFlowFilePath(flow: TaintFlow): string {
    const sinkMethodSig = flow.sink?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
    return extractFilePathFromSignature(sinkMethodSig);
}

function intersectStringSets(left: Set<string>, right: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const value of left) {
        if (right.has(value)) out.add(value);
    }
    return out;
}

export interface NavDestinationRouteFacts {
    dispatchKeys: Set<string>;
    registrationKeys: Set<string>;
    effectiveDispatchKeys: Set<string>;
    pushRouteKeys: Set<string>;
}

export function collectKnownNavDestinationRouteFactsInFile(
    scene: Scene,
    filePath: string,
    routePushKeyCache?: Map<string, Set<string>>,
): NavDestinationRouteFacts {
    const dispatchKeys = new Set<string>();
    const registrationKeys = new Set<string>();
    const pushRouteKeys = new Set<string>();

    for (const sourceMethod of scene.getMethods()) {
        const sourceMethodSig = sourceMethod.getSignature?.()?.toString?.() || "";
        if (extractFilePathFromSignature(sourceMethodSig) !== filePath) continue;

        const methodDispatchKeys = collectKnownKeyedDispatchKeysFromMethod(scene, sourceMethod).get("nav_destination");
        if (methodDispatchKeys) {
            for (const key of methodDispatchKeys) dispatchKeys.add(key);
        }
        const syntheticDispatchKeys = collectSyntheticNavDestinationDispatchKeysFromMethod(scene, sourceMethod);
        for (const key of syntheticDispatchKeys) dispatchKeys.add(key);

        const methodPushRouteKeys = collectKnownRoutePushKeysFromMethod(scene, sourceMethod, routePushKeyCache);
        for (const key of methodPushRouteKeys) pushRouteKeys.add(key);

        const cfg = sourceMethod.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const registrations = resolveKnownKeyedCallbackRegistrationsFromStmt(stmt, scene, sourceMethod);
            for (const reg of registrations) {
                if (reg.familyId !== "nav_destination") continue;
                for (const key of reg.dispatchKeys || []) registrationKeys.add(key);
            }
            for (const key of collectSyntheticNavDestinationRegistrationKeysFromStmt(scene, stmt)) {
                registrationKeys.add(key);
            }
        }
    }

    return {
        dispatchKeys,
        registrationKeys,
        effectiveDispatchKeys: intersectStringSets(dispatchKeys, registrationKeys),
        pushRouteKeys,
    };
}

export function collectKnownRoutePushKeysFromMethod(
    scene: Scene,
    method: ArkMethod,
    routePushKeyCache?: Map<string, Set<string>>,
): Set<string> {
    const methodSig = method.getSignature?.()?.toString?.() || "";
    if (!methodSig) return new Set<string>();
    const cached = routePushKeyCache?.get(methodSig);
    if (cached) return new Set(cached);

    const out = new Set<string>();
    const cfg = method.getCfg?.();
    const stmts = cfg?.getStmts?.() || [];
    const knownPushMethods = new Map<string, string>([
        ["pushNamedRoute", "name"],
        ["pushPath", "name"],
        ["pushPathByName", "name"],
        ["replacePath", "name"],
        ["pushUrl", "url"],
        ["replaceUrl", "url"],
    ]);

    const addKeysFromValue = (value: any, routeFieldName: string): void => {
        for (const literal of collectFiniteStringCandidatesFromValue(scene, value)) {
            if (literal) out.add(literal);
        }
        if (!(value instanceof Local)) return;
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp?.();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (left.getBase?.() !== value) continue;
            const fieldName = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.() || "";
            if (fieldName !== routeFieldName) continue;
            for (const literal of collectFiniteStringCandidatesFromValue(scene, stmt.getRightOp?.())) {
                if (literal) out.add(literal);
            }
        }
    };

    for (const stmt of stmts) {
        if (!stmt?.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!(invokeExpr instanceof ArkStaticInvokeExpr || invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
        if (methodName === "PushRoute") {
            const invokeArgs = invokeExpr.getArgs?.() || [];
            if (invokeArgs.length > 0) {
                for (const literal of collectFiniteStringCandidatesFromValue(scene, invokeArgs[0])) {
                    if (literal) out.add(literal);
                }
            }
            continue;
        }
        const routeFieldName = knownPushMethods.get(methodName);
        if (!routeFieldName) continue;
        const invokeArgs = invokeExpr.getArgs?.() || [];
        for (const arg of invokeArgs) {
            addKeysFromValue(arg, routeFieldName);
        }
    }

    routePushKeyCache?.set(methodSig, new Set(out));
    return out;
}

function collectSyntheticNavDestinationDispatchKeysFromMethod(
    scene: Scene,
    method: ArkMethod,
): Set<string> {
    const out = new Set<string>();
    const cfg = method.getCfg?.();
    if (!cfg) return out;
    for (const stmt of cfg.getStmts()) {
        if (!stmt?.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!(invokeExpr instanceof ArkStaticInvokeExpr || invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
        if (methodName !== "TriggerRoute") continue;
        const invokeArgs = invokeExpr.getArgs?.() || [];
        if (invokeArgs.length === 0) continue;
        for (const literal of collectFiniteStringCandidatesFromValue(scene, invokeArgs[0])) {
            if (literal) out.add(literal);
        }
    }
    return out;
}

function collectSyntheticNavDestinationRegistrationKeysFromStmt(
    scene: Scene,
    stmt: any,
): Set<string> {
    const out = new Set<string>();
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!(invokeExpr instanceof ArkStaticInvokeExpr || invokeExpr instanceof ArkInstanceInvokeExpr)) return out;
    const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName !== "RegisterRoute") return out;
    const invokeArgs = invokeExpr.getArgs?.() || [];
    if (invokeArgs.length === 0) return out;
    for (const literal of collectFiniteStringCandidatesFromValue(scene, invokeArgs[0])) {
        if (literal) out.add(literal);
    }
    return out;
}
