import { Pag, PagNode } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/lib/core/base/Stmt";
import { ArkInstanceFieldRef, ClosureFieldRef } from "../../../../arkanalyzer/lib/core/base/Ref";
import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import { ArkMethod } from "../../../../arkanalyzer/lib/core/model/ArkMethod";
import { TaintFact } from "../model/TaintFact";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import { ExecutionHandoffContractRecord } from "./ExecutionHandoffContract";
import { buildExecutionHandoffSiteKeyFromStmt } from "./ExecutionHandoffSiteKey";

export type ExecutionHandoffEventContractIndex = Map<string, ExecutionHandoffContractRecord[]>;

export function collectExecutionHandoffEventCaptureFactsFromTaintedLocal(
    pag: Pag,
    taintedLocal: Local,
    source: string,
    currentCtx: number,
    eventContractsBySiteKey?: ExecutionHandoffEventContractIndex,
    fieldPath?: string[],
): TaintFact[] {
    if (!eventContractsBySiteKey || eventContractsBySiteKey.size === 0) return [];
    const declaringStmt = taintedLocal.getDeclaringStmt?.();
    const callerMethod = declaringStmt?.getCfg?.()?.getDeclaringMethod?.();
    const cfg = callerMethod?.getCfg?.();
    if (!cfg) return [];

    const results: TaintFact[] = [];
    const capturedFieldName = taintedLocal.getName?.() || "";
    if (!capturedFieldName) return results;

    for (const stmt of cfg.getStmts()) {
        if (!stmt?.containsInvokeExpr?.() || !stmt.containsInvokeExpr()) continue;
        const contracts = collectEventContractsForStmt(eventContractsBySiteKey, stmt);
        if (contracts.length === 0) continue;

        for (const contract of contracts) {
            for (const fact of collectSpecificEventCallbackCaptureFieldFacts(
                pag,
                contract.unit,
                capturedFieldName,
                source,
                currentCtx,
                fieldPath,
            )) {
                results.push(fact);
            }
        }
    }

    return results;
}

function collectEventContractsForStmt(
    eventContractsBySiteKey: ExecutionHandoffEventContractIndex,
    stmt: any,
): ExecutionHandoffContractRecord[] {
    const siteKey = buildExecutionHandoffSiteKeyFromStmt(undefined, stmt);
    return eventContractsBySiteKey.get(siteKey) || [];
}

function collectSpecificEventCallbackCaptureFieldFacts(
    pag: Pag,
    callbackMethod: ArkMethod,
    expectedFieldName: string | undefined,
    source: string,
    currentCtx: number,
    fieldPath?: string[],
): TaintFact[] {
    const results: TaintFact[] = [];
    for (const mapping of collectEventClosureFieldReads(callbackMethod)) {
        if (expectedFieldName && mapping.fieldName !== expectedFieldName) continue;
        const carrierNodes = safeGetOrCreatePagNodes(pag, mapping.carrierLocal, mapping.anchorStmt);
        if (carrierNodes) {
            const carriedFieldPath = fieldPath && fieldPath.length > 0
                ? [mapping.fieldName, ...fieldPath]
                : [mapping.fieldName];
            for (const nodeId of carrierNodes.values()) {
                const node = pag.getNode(nodeId) as PagNode;
                if (!node) continue;
                results.push(new TaintFact(node, source, currentCtx, carriedFieldPath));
            }
        }

        const localNodes = safeGetOrCreatePagNodes(pag, mapping.callbackLocal, mapping.anchorStmt);
        if (!localNodes) continue;
        for (const nodeId of localNodes.values()) {
            const node = pag.getNode(nodeId) as PagNode;
            if (!node) continue;
            results.push(new TaintFact(
                node,
                source,
                currentCtx,
                fieldPath ? [...fieldPath] : undefined,
            ));
        }
    }
    return results;
}

function collectEventClosureFieldReads(
    callbackMethod: ArkMethod,
): Array<{ carrierLocal: Local; callbackLocal: Local; fieldName: string; anchorStmt: ArkAssignStmt }> {
    const results: Array<{ carrierLocal: Local; callbackLocal: Local; fieldName: string; anchorStmt: ArkAssignStmt }> = [];
    const cfg = callbackMethod.getCfg?.();
    if (!cfg) return results;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local)) continue;
        if (!(right instanceof ArkInstanceFieldRef) && !(right instanceof ClosureFieldRef)) continue;

        const base = right.getBase?.();
        const isClosureCarrier = right instanceof ClosureFieldRef || base instanceof Local && base.getName().startsWith("%closures");
        if (!isClosureCarrier) continue;

        const fieldName = right instanceof ClosureFieldRef
            ? right.getFieldName?.()
            : right.getFieldSignature?.().getFieldName?.();
        if (!fieldName) continue;
        results.push({
            carrierLocal: base,
            callbackLocal: left,
            fieldName,
            anchorStmt: stmt,
        });
    }

    return results;
}
