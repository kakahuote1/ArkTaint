import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { expandEntryMethodsByDirectCalls } from "../../shared/ExplicitEntryScopeResolver";
import { resolveCallbackRegistrationsFromStmt } from "../../../substrate/queries/CallbackBindingQuery";
import {
    resolveKnownSchedulerCallbackRegistration,
    isKnownSchedulerMethodName,
} from "../../shared/FrameworkCallbackClassifier";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { dedupeMethods } from "./ArkMainFactResolverUtils";

export function collectSchedulerFacts(scene: Scene, context: ArkMainFactCollectionContext): void {
    const candidateMethods = dedupeMethods([
        ...context.explicitSeedMethods,
        ...context.phaseCandidateMethods.get("bootstrap")!,
        ...context.phaseCandidateMethods.get("composition")!,
        ...context.phaseCandidateMethods.get("reactive_handoff")!,
        ...context.phaseCandidateMethods.get("teardown")!,
    ]);

    const schedulerReachable = buildTransitiveSchedulerReachableNames(scene);

    for (const method of candidateMethods) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const invokedName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            const transitiveDepth = schedulerReachable.get(invokedName);
            if (transitiveDepth === undefined && !isKnownSchedulerMethodName(invokedName)) continue;
            // Leave enough slack for: caller -> helper -> scheduler registration,
            // and an additional returned-callback helper on the callback value.
            const maxDepth = (transitiveDepth !== undefined ? transitiveDepth : 0) + 3;
            const callbackBindings = resolveCallbackRegistrationsFromStmt(
                stmt,
                scene,
                method,
                resolveKnownSchedulerCallbackRegistration,
                { maxDepth },
            );
            for (const binding of callbackBindings) {
                const sourceSignature = binding.sourceMethod?.getSignature?.()?.toString?.();
                const sourcePhase = sourceSignature ? context.phaseByMethodSignature.get(sourceSignature) : undefined;
                if (!sourcePhase || sourcePhase === "teardown") {
                    continue;
                }
                context.addFact({
                    phase: "interaction",
                    kind: "scheduler_callback",
                    method: binding.callbackMethod,
                    reason: binding.reason,
                    sourceMethod: binding.sourceMethod,
                    callbackShape: binding.registrationShape,
                    callbackSlotFamily: binding.slotFamily,
                    callbackRecognitionLayer: binding.recognitionLayer,
                    entryFamily: "scheduler_callback",
                    entryShape: binding.registrationShape,
                    recognitionLayer: binding.recognitionLayer,
                });
            }
        }
    }
}

/**
 * Build a map: methodName �?minimum depth needed to reach a scheduler call.
 *
 * Level 0: method names whose body directly contains setTimeout/setInterval
 * Level 1: method names that call a Level 0 method
 * Level N: method names that call a Level N-1 method
 *
 * BFS propagates backwards from scheduler calls through the
 * callerName �?calleeName edges built in a single pass over the scene.
 */
function buildTransitiveSchedulerReachableNames(scene: Scene): Map<string, number> {
    const callerToCallees = new Map<string, Set<string>>();
    const directSchedulerNames = new Set<string>();

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        const methodName = method.getName?.();
        if (!methodName) continue;
        let callees: Set<string> | undefined;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const name = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (!name) continue;
            if (isKnownSchedulerMethodName(name)) {
                directSchedulerNames.add(methodName);
            }
            if (!callees) callees = new Set();
            callees.add(name);
        }
        if (callees) {
            const existing = callerToCallees.get(methodName);
            if (existing) {
                for (const c of callees) existing.add(c);
            } else {
                callerToCallees.set(methodName, callees);
            }
        }
    }

    const reachable = new Map<string, number>();
    for (const name of directSchedulerNames) {
        reachable.set(name, 0);
    }

    let frontier = new Set(directSchedulerNames);
    let level = 1;
    const MAX_TRANSITIVE_DEPTH = 6;
    while (frontier.size > 0 && level <= MAX_TRANSITIVE_DEPTH) {
        const nextFrontier = new Set<string>();
        for (const [callerName, callees] of callerToCallees) {
            if (reachable.has(callerName)) continue;
            for (const callee of callees) {
                if (frontier.has(callee)) {
                    reachable.set(callerName, level);
                    nextFrontier.add(callerName);
                    break;
                }
            }
        }
        frontier = nextFrontier;
        level++;
    }

    return reachable;
}


