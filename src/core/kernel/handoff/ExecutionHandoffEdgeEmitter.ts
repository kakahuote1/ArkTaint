import { CallEdgeType } from "../context/TaintContext";
import type { SyntheticInvokeEdgeInfo } from "../builders/SyntheticInvokeEdgeBuilder";
import {
    ExecutionHandoffContractRecord,
    ExecutionHandoffEdgeBuildResult,
} from "./ExecutionHandoffContract";

export function buildExecutionHandoffSyntheticInvokeEdges(
    contracts: ExecutionHandoffContractRecord[],
): ExecutionHandoffEdgeBuildResult {
    const edgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
    const deferredContracts = dedupeExecutionHandoffContracts(contracts);

    let callEdges = 0;
    let returnEdges = 0;
    for (const contract of deferredContracts) {
        const injected = emitExecutionHandoffEdges(edgeMap, contract);
        if (injected.callCount === 0 && injected.returnCount === 0) {
            throw new Error(
                `execution handoff contract emitted no edges: ${contract.id} activation=${contract.activation} ports=${JSON.stringify(contract.ports)}`,
            );
        }
        callEdges += injected.callCount;
        returnEdges += injected.returnCount;
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

function emitExecutionHandoffEdges(
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>,
    contract: ExecutionHandoffContractRecord,
): { callCount: number; returnCount: number } {
    const bindings = contract.edgeBindings;
    const callSiteId = resolveCallSiteId(contract);
    const callerSignature = resolveCallerSignature(contract);
    const callerMethodName = resolveCallerMethodName(contract);
    let callCount = 0;
    let returnCount = 0;
    for (const binding of bindings) {
        const calleeSignature = binding.calleeSignatureOverride
            || contract.unit.getSignature?.().toString?.()
            || contract.unitSignature;
        const calleeMethodName = binding.calleeMethodNameOverride
            || contract.unit.getName?.()
            || "";
        for (const srcNodeId of binding.sourceNodeIds) {
            for (const dstNodeId of binding.targetNodeIds) {
                pushEdge(edgeMap, srcNodeId, {
                    type: binding.edgeType,
                    srcNodeId,
                    dstNodeId,
                    callSiteId,
                    callerMethodName,
                    calleeMethodName,
                    callerSignature,
                    calleeSignature,
                });
                if (binding.edgeType === CallEdgeType.CALL) {
                    callCount += 1;
                } else {
                    returnCount += 1;
                }
            }
        }
    }
    return { callCount, returnCount };
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
