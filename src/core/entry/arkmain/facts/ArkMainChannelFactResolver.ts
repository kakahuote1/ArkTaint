import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { resolveKnownKeyedCallbackRegistrationsFromStmt } from "../../shared/FrameworkCallbackClassifier";
import { resolveArkMainChannelInvocation } from "./ArkMainChannelInvocationResolver";

export function collectChannelFacts(scene: Scene, context: ArkMainFactCollectionContext): void {
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const channelMatch = resolveArkMainChannelInvocation(scene, method, invokeExpr);
            if (channelMatch) {
                context.addFact({
                    phase: "reactive_handoff",
                    kind: channelMatch.factKind,
                    method,
                    reason: channelMatch.reason,
                    schedule: false,
                    sourceMethod: method,
                    entryFamily: channelMatch.entryFamily,
                    entryShape: channelMatch.entryShape,
                    recognitionLayer: channelMatch.recognitionLayer,
                });
            }
            for (const registration of resolveKnownKeyedCallbackRegistrationsFromStmt(stmt, scene, method)) {
                context.addFact({
                    phase: "reactive_handoff",
                    kind: "router_trigger",
                    method: registration.callbackMethod,
                    reason: registration.reason,
                    schedule: false,
                    sourceMethod: method,
                    entryFamily: "navigation_trigger",
                    entryShape: registration.registrationShape,
                    recognitionLayer: registration.recognitionLayer,
                });
            }
        }
    }
}


