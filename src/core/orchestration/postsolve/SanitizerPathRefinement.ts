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
    resolveInvokeExprFromStmt,
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
    const sinkValue = resolveFlowSinkValue(flow, context);
    if (!sinkValue) return [];
    const sinkStmt = flow.sink;
    const sinkIndex = stmtIndexInMethod(sinkStmt);
    if (sinkIndex < 0) return [];
    const stmts = methodStmtsFromStmt(sinkStmt);

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
            const evidence = buildSanitizerEvidence(rule, stmt, invokeExpr, sinkValue, sinkStmt, sinkIndex, flow, path, item.factId);
            if (evidence) return [evidence];
        }
    }

    // Some sink flows carry a correct rule-chain but only materialize the source
    // fact in the witness path. Fall back to the sink statement's local value and
    // scan dominating same-method assignments so sanitizer evidence is not lost.
    for (let i = 0; i < sinkIndex; i++) {
        const stmt = stmts[i];
        const invokeExpr = resolveAssignInvokeExprFromStmt(stmt);
        if (!invokeExpr) continue;
        for (const rule of sanitizerRules) {
            const evidence = buildSanitizerEvidence(rule, stmt, invokeExpr, sinkValue, sinkStmt, sinkIndex, flow, path);
            if (evidence) return [evidence];
        }
    }
    return [];
}

function resolveFlowSinkValue(flow: TaintFlow, context: PostsolveContext): any | undefined {
    const sinkInvoke = resolveInvokeExprFromStmt(flow.sink);
    const sinkEndpoint = parseBaseEndpoint(flow.sinkEndpoint || "arg0");
    if (sinkInvoke) {
        const endpointValue = resolveInvokeEndpointValue(flow.sink, sinkInvoke, sinkEndpoint as any);
        if (endpointValue) return endpointValue;
    }
    const sinkNode: any = flow.sinkNodeId === undefined ? undefined : context.pag?.getNode?.(flow.sinkNodeId);
    return sinkNode?.getValue?.();
}

function parseBaseEndpoint(endpoint: string): string {
    const normalized = String(endpoint || "arg0").trim();
    const dot = normalized.indexOf(".");
    return dot >= 0 ? normalized.slice(0, dot) : normalized;
}

function buildSanitizerEvidence(
    rule: any,
    stmt: any,
    invokeExpr: any,
    sinkValue: any,
    sinkStmt: any,
    sinkIndex: number,
    flow: TaintFlow,
    path: ProvenancePath,
    factId?: string,
): PostsolveEvidence | undefined {
    if (!matchesSanitizerRuleInvoke(rule, stmt, invokeExpr)) return undefined;
    const targetEndpoint = typeof rule.target === "string"
        ? rule.target
        : (rule.target?.endpoint || "result");
    const targetValue = resolveInvokeEndpointValue(stmt, invokeExpr, targetEndpoint);
    if (!targetValue) return undefined;
    if (!sameValueLike(targetValue, sinkValue)) return undefined;
    const stmtIndex = stmtIndexInMethod(stmt);
    if (
        targetValue instanceof Local
        && hasLocalReassignmentBetween(methodStmtsFromStmt(stmt), targetValue, stmtIndex, sinkIndex)
    ) {
        return undefined;
    }
    return {
        kind: "sanitizer_rule",
        polarity: "negative",
        strength: "strong",
        stability: "overridable",
        scope: "path-segment",
        subject: {
            pathId: path.id,
            factId,
            sinkFactId: flow.sinkFactId,
            sinkNodeId: flow.sinkNodeId,
            sinkArgEndpoint: flow.sinkEndpoint,
        },
        requiredForRefutation: true,
        preconditions: {
            pathComplete: path.status === "complete" || path.status === "bounded-complete",
            sinkValueAligned: true,
            sameValueVersion: true,
            noDirtyRemixAfter: true,
            endpointResolved: true,
        },
        sourceEvidenceIds: [path.id, factId].filter((id): id is string => !!id),
        position: {
            factId,
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
    };
}

function resolveAnchorStmtFromFact(fact: any): any | undefined {
    const nodeStmt = fact?.node?.getStmt?.();
    if (nodeStmt) return nodeStmt;
    const value = fact?.node?.getValue?.();
    if (value?.getDeclaringStmt) return value.getDeclaringStmt?.();
    return undefined;
}
