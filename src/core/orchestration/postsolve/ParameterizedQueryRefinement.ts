import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { TaintFlow } from "../../kernel/model/TaintFlow";
import { ProvenancePath } from "../../provenance/ProvenancePathTypes";
import { PostsolveContext, PostsolveEvidence } from "./PostsolveTypes";
import {
    invokeMethodName,
    methodSignatureTextFromStmt,
    resolveInvokeExprFromStmt,
    resolveInvokeEndpointValue,
    sameValueLike,
    stringLiteralValue,
} from "./PostsolveRuleUtils";

const SQL_TEMPLATE_ARG_METHODS = new Set([
    "executeSql",
    "querySql",
    "execDML",
    "execDQL",
]);

export function evaluateParameterizedQueryPath(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): PostsolveEvidence[] {
    if (!context.pag || flow.sinkNodeId === undefined) return [];
    const sinkInvoke = resolveInvokeExprFromStmt(flow.sink);
    if (!sinkInvoke) return [];
    const methodName = invokeMethodName(sinkInvoke);
    if (!SQL_TEMPLATE_ARG_METHODS.has(methodName)) return [];

    const args = sinkInvoke.getArgs?.() || [];
    if (args.length < 2) return [];

    const sinkNode: any = context.pag.getNode?.(flow.sinkNodeId);
    const sinkValue = sinkNode?.getValue?.();
    if (!sinkValue) return [];

    const endpoint = flow.sinkEndpoint || inferSinkEndpointFromArgs(flow, sinkValue, args);
    if (!endpoint || endpoint === "arg0") return [];
    const argIndex = parseArgEndpoint(endpoint);
    if (argIndex === undefined || argIndex <= 0) return [];
    const endpointValue = resolveInvokeEndpointValue(flow.sink, sinkInvoke, endpoint as any);
    if (endpointValue && !sameValueLike(endpointValue, sinkValue)) return [];

    const sqlText = resolveStaticString(args[0]);
    if (sqlText === undefined) return [];
    return [{
        kind: "parameterized_query",
        polarity: "negative",
        strength: "strong",
        stability: "stable",
        scope: "sink-argument",
        subject: {
            pathId: path.id,
            factId: path.factIds[path.factIds.length - 1],
            sinkFactId: flow.sinkFactId,
            sinkNodeId: flow.sinkNodeId,
            sinkArgEndpoint: endpoint,
        },
        requiredForRefutation: true,
        preconditions: {
            pathComplete: path.status === "complete" || path.status === "bounded-complete",
            endpointResolved: true,
        },
        sourceEvidenceIds: [path.id, path.factIds[path.factIds.length - 1]].filter((id): id is string => !!id),
        position: {
            factId: path.factIds[path.factIds.length - 1],
            stmtText: flow.sink?.toString?.() || "",
            methodSignature: methodSignatureTextFromStmt(flow.sink),
        },
        target: {
            sinkFactId: flow.sinkFactId || "",
            sinkNodeId: flow.sinkNodeId,
        },
        meta: {
            reason: "parameterized_query",
            methodName,
            parameterEndpoint: endpoint,
            sqlTemplate: sqlText,
        },
    }];
}

function inferSinkEndpointFromArgs(flow: TaintFlow, sinkValue: any, args: any[]): string | undefined {
    for (let i = 0; i < args.length; i++) {
        if (sameValueLike(args[i], sinkValue)) return `arg${i}`;
    }
    const sinkText = flow.sink?.toString?.() || "";
    const match = sinkText.match(/\barg(\d+)\b/);
    return match ? `arg${match[1]}` : undefined;
}

function parseArgEndpoint(endpoint: string): number | undefined {
    const match = endpoint.match(/^arg(\d+)/);
    return match ? Number(match[1]) : undefined;
}

function resolveStaticString(value: any, seen: Set<string> = new Set()): string | undefined {
    const direct = stringLiteralValue(value);
    if (direct !== undefined) return direct;
    if (!(value instanceof Local)) return undefined;
    const key = `${value.getName?.() || ""}:${value.getDeclaringStmt?.()?.toString?.() || ""}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const decl = value.getDeclaringStmt?.();
    if (!(decl instanceof ArkAssignStmt) || decl.getLeftOp?.() !== value) return undefined;
    return resolveStaticString(decl.getRightOp?.(), seen);
}
