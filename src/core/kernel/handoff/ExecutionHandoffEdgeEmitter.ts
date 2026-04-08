import { Pag } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/lib/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import { ArkParameterRef } from "../../../../arkanalyzer/lib/core/base/Ref";
import { CallGraph } from "../../../../arkanalyzer/lib/callgraph/model/CallGraph";
import { Scene } from "../../../../arkanalyzer/lib/Scene";
import { CallEdgeType } from "../context/TaintContext";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import { collectParameterAssignStmts } from "../../substrate/queries/CalleeResolver";
import type { SyntheticInvokeEdgeInfo } from "../builders/SyntheticInvokeEdgeBuilder";
import {
    ExecutionHandoffContractRecord,
    ExecutionHandoffEdgeBuildResult,
} from "./ExecutionHandoffContract";

export function buildExecutionHandoffSyntheticInvokeEdges(
    _scene: Scene,
    _cg: CallGraph,
    pag: Pag,
    contracts: ExecutionHandoffContractRecord[],
): ExecutionHandoffEdgeBuildResult {
    const edgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
    const deferredContracts = dedupeExecutionHandoffContracts(contracts);

    let callEdges = 0;
    let returnEdges = 0;
    for (const contract of deferredContracts) {
        if (contract.activation === "event(c)") {
            callEdges += emitEventHandoffEdges(pag, edgeMap, contract);
            continue;
        }
        if (isPromiseContinuationContract(contract)) {
            const injected = emitPromiseContinuationEdges(pag, edgeMap, contract);
            callEdges += injected.callCount;
            returnEdges += injected.returnCount;
        }
    }

    dedupeSyntheticInvokeEdgeMap(edgeMap);

    return {
        edgeMap,
        stats: {
            siteCount: deferredContracts.length,
            callEdges,
            returnEdges,
        },
    };
}

function emitEventHandoffEdges(
    pag: Pag,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    contract: ExecutionHandoffContractRecord,
): number {
    if (contract.ports.payload !== "payload+") return 0;
    const baseValue = contract.invokeExpr?.getBase?.();
    if (!(baseValue instanceof Local)) return 0;
    const explicitSourceNodes = safeGetOrCreatePagNodes(pag, baseValue, contract.stmt);
    if (!explicitSourceNodes || explicitSourceNodes.size === 0) return 0;

    return emitCallbackParameterCallEdges(
        pag,
        edgeMap,
        contract,
        explicitSourceNodes,
    );
}

function emitPromiseContinuationEdges(
    pag: Pag,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    contract: ExecutionHandoffContractRecord,
): { callCount: number; returnCount: number } {
    const baseValue = contract.invokeExpr?.getBase?.();
    const explicitSourceNodes = contract.semantics.continuationRole === "observe" || !(baseValue instanceof Local)
        ? undefined
        : safeGetOrCreatePagNodes(pag, baseValue, contract.stmt);
    const callCount = emitCallbackParameterCallEdges(
        pag,
        edgeMap,
        contract,
        explicitSourceNodes,
    );

    if (!(contract.stmt instanceof ArkAssignStmt)) {
        return { callCount, returnCount: 0 };
    }

    const callSiteId = resolveCallSiteId(contract);
    const resultNodes = safeGetOrCreatePagNodes(pag, contract.stmt.getLeftOp(), contract.stmt);
    if (!resultNodes || resultNodes.size === 0) {
        return { callCount, returnCount: 0 };
    }

    let returnCount = 0;
    if (contract.semantics.continuationRole !== "observe") {
        for (const retStmt of contract.unit.getReturnStmt?.() || []) {
            if (!(retStmt instanceof ArkReturnStmt)) continue;
            const retValue = retStmt.getOp?.();
            if (!(retValue instanceof Local)) continue;
            const srcNodes = safeGetOrCreatePagNodes(pag, retValue, retStmt);
            if (!srcNodes || srcNodes.size === 0) continue;
            returnCount += emitReturnEdges(
                edgeMap,
                contract,
                callSiteId,
                srcNodes,
                resultNodes,
            );
        }
    }

    if (contract.ports.preserve !== "preserve0" && baseValue instanceof Local) {
        const srcNodes = safeGetOrCreatePagNodes(pag, baseValue, contract.stmt);
        if (srcNodes && srcNodes.size > 0) {
            returnCount += emitReturnEdges(
                edgeMap,
                contract,
                callSiteId,
                srcNodes,
                resultNodes,
                `__handoff_preserve__:${contract.activation}`,
                contract.unit.getName?.() || contract.activation,
            );
        }
    }

    return { callCount, returnCount };
}

function emitCallbackParameterCallEdges(
    pag: Pag,
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    contract: ExecutionHandoffContractRecord,
    explicitSourceNodes?: Map<number, number>,
): number {
    const paramStmts = collectParameterAssignStmts(contract.unit);
    if (paramStmts.length === 0) return 0;

    const callSiteId = resolveCallSiteId(contract);
    const callerSignature = resolveCallerSignature(contract);
    const callerMethodName = resolveCallerMethodName(contract);
    const calleeSignature = contract.unit.getSignature?.().toString?.() || contract.unitSignature;
    const calleeMethodName = contract.unit.getName?.() || "";

    let count = 0;
    for (const paramStmt of paramStmts) {
        const paramLocal = paramStmt.getLeftOp?.();
        if (!(paramLocal instanceof Local)) continue;
        const rightOp = paramStmt.getRightOp?.();
        if (!(rightOp instanceof ArkParameterRef)) continue;

        const srcNodes = explicitSourceNodes;
        const dstNodes = safeGetOrCreatePagNodes(pag, paramLocal, paramStmt);
        if (!srcNodes || srcNodes.size === 0 || !dstNodes || dstNodes.size === 0) continue;

        for (const srcNodeId of srcNodes.values()) {
            for (const dstNodeId of dstNodes.values()) {
                pushEdge(edgeMap, srcNodeId, {
                    type: CallEdgeType.CALL,
                    srcNodeId,
                    dstNodeId,
                    callSiteId,
                    callerMethodName,
                    calleeMethodName,
                    callerSignature,
                    calleeSignature,
                });
                count += 1;
            }
        }
    }

    return count;
}

function emitReturnEdges(
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    contract: ExecutionHandoffContractRecord,
    callSiteId: number,
    srcNodes: Map<number, number>,
    dstNodes: Map<number, number>,
    calleeSignatureOverride?: string,
    calleeMethodNameOverride?: string,
): number {
    let count = 0;
    const callerSignature = resolveCallerSignature(contract);
    const callerMethodName = resolveCallerMethodName(contract);
    const calleeSignature = calleeSignatureOverride || contract.unit.getSignature?.().toString?.() || contract.unitSignature;
    const calleeMethodName = calleeMethodNameOverride || contract.unit.getName?.() || "";

    for (const srcNodeId of srcNodes.values()) {
        for (const dstNodeId of dstNodes.values()) {
            pushEdge(edgeMap, srcNodeId, {
                type: CallEdgeType.RETURN,
                srcNodeId,
                dstNodeId,
                callSiteId,
                callerMethodName,
                calleeMethodName,
                callerSignature,
                calleeSignature,
            });
            count += 1;
        }
    }
    return count;
}

function resolveCallSiteId(contract: ExecutionHandoffContractRecord): number {
    const calleeSignature = contract.unit.getSignature?.().toString?.() || contract.unitSignature;
    return (contract.stmt.getOriginPositionInfo?.().getLineNo?.() || contract.lineNo || 0) * 10000
        + simpleHash(calleeSignature);
}

function resolveCallerSignature(contract: ExecutionHandoffContractRecord): string {
    const sourceMethod = contract.sourceMethods.length > 0 ? contract.sourceMethods[0] : contract.caller;
    return sourceMethod?.getSignature?.().toString?.() || contract.callerSignature;
}

function resolveCallerMethodName(contract: ExecutionHandoffContractRecord): string {
    const sourceMethod = contract.sourceMethods.length > 0 ? contract.sourceMethods[0] : contract.caller;
    return sourceMethod?.getName?.() || contract.caller.getName?.() || "";
}

function dedupeExecutionHandoffContracts(
    contracts: ExecutionHandoffContractRecord[],
): ExecutionHandoffContractRecord[] {
    const deduped: ExecutionHandoffContractRecord[] = [];
    const seen = new Set<string>();
    for (const contract of contracts) {
        const key = [
            contract.id,
            contract.activation,
            contract.unitSignature,
            contract.callerSignature,
            contract.lineNo,
            contract.invokeText,
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(contract);
    }
    return deduped;
}

function dedupeSyntheticInvokeEdgeMap(edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>): void {
    for (const [nodeId, edges] of edgeMap.entries()) {
        const deduped: SyntheticInvokeEdgeInfo[] = [];
        const seen = new Set<string>();
        for (const edge of edges) {
            const key = [
                edge.type,
                edge.srcNodeId,
                edge.dstNodeId,
                edge.callSiteId,
                edge.callerSignature || "",
                edge.calleeSignature || "",
            ].join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(edge);
        }
        edgeMap.set(nodeId, deduped);
    }
}

function pushEdge(map: Map<number, SyntheticInvokeEdgeInfo[]>, key: number, edge: SyntheticInvokeEdgeInfo): void {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(edge);
}

function simpleHash(text: string): number {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) {
        h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

function isPromiseContinuationContract(contract: ExecutionHandoffContractRecord): boolean {
    return contract.activation === "settle(fulfilled)"
        || contract.activation === "settle(rejected)"
        || contract.activation === "settle(any)";
}
