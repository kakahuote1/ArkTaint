import { TaintFlow } from "../../kernel/model/TaintFlow";
import { ProvenancePath } from "../../provenance/ProvenancePathTypes";
import { PostsolveContext, PostsolveEvidence } from "./PostsolveTypes";
import {
    collectKnownNavDestinationRouteFactsInFile,
    extractFilePathFromSignature,
    resolveFlowFilePath,
} from "./PostsolveSharedEvidence";

export function evaluateKeyedRouteCallbackMismatchPath(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): PostsolveEvidence[] {
    const filePath = resolveFlowFilePath(flow);
    if (!filePath) return [];

    const scene = flow.sink?.getCfg?.()?.getDeclaringMethod?.()?.getDeclaringArkFile?.()?.getScene?.()
        || flow.sink?.getCfg?.()?.getDeclaringMethod?.()?.getDeclaringArkClass?.()?.getDeclaringArkFile?.()?.getScene?.();
    if (!scene) return [];

    const facts = collectKnownNavDestinationRouteFactsInFile(scene, filePath);
    if (facts.effectiveDispatchKeys.size === 0) return [];
    if (facts.pushRouteKeys.size === 0) return [];
    if (hasStringSetIntersection(facts.effectiveDispatchKeys, facts.pushRouteKeys)) return [];

    const pathMethodSignature = findPathMethodSignatureForFile(path, context, filePath);
    if (!pathMethodSignature) return [];

    return [{
        kind: "keyed_route_callback_mismatch",
        polarity: "negative",
        strength: "strong",
        stability: "stable",
        position: {
            factId: path.factIds[0],
            methodSignature: pathMethodSignature,
        },
        target: {
            sinkFactId: flow.sinkFactId || "",
            sinkNodeId: flow.sinkNodeId,
        },
        meta: {
            reason: "keyed_route_callback_mismatch",
            sourceRuleId: flow.sourceRuleId || "",
            filePath,
            callbackKeys: [...facts.effectiveDispatchKeys].sort(),
            routeKeys: [...facts.pushRouteKeys].sort(),
        },
    }];
}

function findPathMethodSignatureForFile(
    path: ProvenancePath,
    context: PostsolveContext,
    filePath: string,
): string | undefined {
    for (const factId of path.factIds) {
        const fact = context.observedFactsById.get(factId);
        const stmt = resolveAnchorStmtFromFact(fact);
        const methodSignature = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (!methodSignature) continue;
        if (extractFilePathFromSignature(methodSignature) !== filePath) continue;
        return methodSignature;
    }
    return undefined;
}

function resolveAnchorStmtFromFact(fact: any): any | undefined {
    const nodeStmt = fact?.node?.getStmt?.();
    if (nodeStmt) return nodeStmt;
    const value = fact?.node?.getValue?.();
    if (value?.getDeclaringStmt) return value.getDeclaringStmt?.();
    return undefined;
}

function hasStringSetIntersection(left: Set<string>, right: Set<string>): boolean {
    for (const value of left) {
        if (right.has(value)) return true;
    }
    return false;
}
