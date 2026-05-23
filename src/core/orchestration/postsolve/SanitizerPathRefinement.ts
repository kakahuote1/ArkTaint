import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { TaintFlow } from "../../kernel/model/TaintFlow";
import { ProvenancePath } from "../../provenance/ProvenancePathTypes";
import { PostsolveContext, PostsolveEvidence } from "./PostsolveTypes";
import {
    hasLocalReassignmentBetween,
    matchesSanitizerRuleInvoke,
    methodSignatureTextFromStmt,
    methodStmtsFromStmt,
    resolveAssignInvokeExprFromStmt,
    resolveInvokeEndpointValue,
    sameValueLike,
    stmtIndexInMethod,
} from "./PostsolveRuleUtils";

export function evaluateSanitizerPath(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): PostsolveEvidence[] {
    const sanitizerRules = context.sanitizerRules || [];
    if (sanitizerRules.length === 0 || !context.pag || flow.sinkNodeId === undefined) return [];
    const sinkNode: any = context.pag.getNode?.(flow.sinkNodeId);
    const sinkValue = sinkNode?.getValue?.();
    if (!sinkValue) return [];
    const sinkStmt = flow.sink;
    const sinkIndex = stmtIndexInMethod(sinkStmt);
    if (sinkIndex < 0) return [];

    const facts = path.factIds
        .map(factId => ({
            factId,
            fact: context.observedFactsById.get(factId),
        }))
        .filter((item): item is { factId: string; fact: NonNullable<typeof item.fact> } => !!item.fact);

    for (const item of facts) {
        const stmt = resolveAnchorStmtFromFact(item.fact);
        if (!stmt || stmt === sinkStmt) continue;
        const stmtIndex = stmtIndexInMethod(stmt);
        if (stmtIndex < 0 || stmtIndex >= sinkIndex) continue;
        const invokeExpr = resolveAssignInvokeExprFromStmt(stmt);
        if (!invokeExpr) continue;

        for (const rule of sanitizerRules) {
            if (!matchesSanitizerRuleInvoke(rule, stmt, invokeExpr)) continue;
            const targetEndpoint = typeof rule.target === "string"
                ? rule.target
                : (rule.target?.endpoint || "result");
            const targetValue = resolveInvokeEndpointValue(stmt, invokeExpr, targetEndpoint);
            if (!targetValue) continue;
            if (!sameValueLike(targetValue, sinkValue)) continue;
            if (
                targetValue instanceof Local
                && hasLocalReassignmentBetween(methodStmtsFromStmt(stmt), targetValue, stmtIndex, sinkIndex)
            ) {
                continue;
            }
            return [{
                kind: "sanitizer_rule",
                polarity: "negative",
                strength: "strong",
                stability: "overridable",
                position: {
                    factId: item.factId,
                    stmtText: stmt?.toString?.() || "",
                    methodSignature: methodSignatureTextFromStmt(stmt),
                },
                target: {
                    sinkFactId: flow.sinkFactId || "",
                    sinkNodeId: flow.sinkNodeId,
                },
                meta: {
                    reason: "sanitizer_rule",
                    ruleId: rule.id,
                    targetEndpoint,
                    sanitizerStmtText: stmt?.toString?.() || "",
                    sinkStmtText: sinkStmt?.toString?.() || "",
                },
            }];
        }
    }
    return [];
}

function resolveAnchorStmtFromFact(fact: any): any | undefined {
    const nodeStmt = fact?.node?.getStmt?.();
    if (nodeStmt) return nodeStmt;
    const value = fact?.node?.getValue?.();
    if (value?.getDeclaringStmt) return value.getDeclaringStmt?.();
    return undefined;
}
