import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import {
    injectAsyncCallbackCaptureEdges,
    injectCallbackBindingEdges,
    injectPromiseContinuationContractEdges,
    injectResolvedCallbackParameterEdges,
    PromiseContinuationEdgeKind,
    SyntheticInvokeLookupContext,
    SyntheticInvokeLookupStats,
} from "../builders/SyntheticInvokeCallbacks";
import type { SyntheticInvokeEdgeInfo } from "../builders/SyntheticInvokeEdgeBuilder";
import {
    ExecutionHandoffContractRecord,
    ExecutionHandoffEdgeBuildResult,
} from "./ExecutionHandoffContract";

export function buildExecutionHandoffSyntheticInvokeEdges(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    contracts: ExecutionHandoffContractRecord[],
): ExecutionHandoffEdgeBuildResult {
    const edgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
    const lookupContext: SyntheticInvokeLookupContext = {
        methodLookupCacheByFileAndProperty: new Map<string, any[]>(),
        methodsByFileCache: new Map<string, any[]>(),
        stats: createLookupStats(),
    };
    const invokedParamCache = new Map<string, Set<number>>();
    const deferredSites = new Map<string, ExecutionHandoffContractRecord>();

    for (const contract of contracts) {
        if (contract.kernel.domain !== "deferred") continue;
        const siteKey = `${contract.callerSignature}#${contract.lineNo}#${contract.invokeText}`;
        if (!deferredSites.has(siteKey)) {
            deferredSites.set(siteKey, contract);
        }
    }

    let callEdges = 0;
    let returnEdges = 0;
    for (const contract of deferredSites.values()) {
        if (contract.kernel.activation === "event(c)") {
            const sourceMethods = contract.sourceMethods.length > 0
                ? contract.sourceMethods
                : [contract.caller];
            for (const sourceMethod of sourceMethods) {
                callEdges += injectCallbackBindingEdges(
                    pag,
                    contract.caller,
                    contract.stmt,
                    edgeMap,
                    contract.unit,
                    sourceMethod,
                );
            }
            continue;
        }
        if (isPromiseContinuationContract(contract)) {
            const sourceMethods = contract.sourceMethods.length > 0
                ? contract.sourceMethods
                : [contract.caller];
            for (const sourceMethod of sourceMethods) {
                const injected = injectPromiseContinuationContractEdges(
                    pag,
                    contract.caller,
                    contract.stmt,
                    contract.invokeExpr,
                    edgeMap,
                    contract.unit,
                    sourceMethod,
                    resolvePromiseContinuationEdgeKind(contract),
                );
                callEdges += injected.callCount;
                returnEdges += injected.returnCount;
            }
            continue;
        }
        callEdges += injectAsyncCallbackCaptureEdges(
            scene,
            cg,
            pag,
            contract.caller,
            contract.stmt,
            contract.invokeExpr,
            edgeMap,
            lookupContext,
        );
        callEdges += injectResolvedCallbackParameterEdges(
            scene,
            cg,
            pag,
            contract.caller,
            contract.stmt,
            contract.invokeExpr,
            edgeMap,
            invokedParamCache,
        );
    }

    dedupeSyntheticInvokeEdgeMap(edgeMap);

    return {
        edgeMap,
        stats: {
            siteCount: deferredSites.size,
            callEdges,
            returnEdges,
        },
    };
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

function createLookupStats(): SyntheticInvokeLookupStats {
    return {
        incomingLookupCalls: 0,
        incomingDirectScanMs: 0,
        incomingIndexBuildMs: 0,
        incomingIndexBuilt: false,
        methodLookupCalls: 0,
        methodLookupCacheHits: 0,
    };
}

function isPromiseContinuationContract(contract: ExecutionHandoffContractRecord): boolean {
    return contract.kernel.activation === "settle(fulfilled)"
        || contract.kernel.activation === "settle(rejected)"
        || contract.kernel.activation === "settle(any)";
}

function resolvePromiseContinuationEdgeKind(contract: ExecutionHandoffContractRecord): PromiseContinuationEdgeKind {
    if (contract.semantics.continuationRole === "observe") return "finally";
    if (contract.semantics.continuationRole === "error" && contract.ports.preserve === "settle(fulfilled)") return "catch";
    return "then";
}
