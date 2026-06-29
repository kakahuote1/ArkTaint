import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { resolveKnownKeyedCallbackRegistrationsFromStmt } from "../../shared/FrameworkCallbackClassifier";

export function collectChannelFacts(scene: Scene, context: ArkMainFactCollectionContext): void {
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr) continue;
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


