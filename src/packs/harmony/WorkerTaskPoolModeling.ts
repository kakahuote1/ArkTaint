import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import {
    BuildWorkerTaskPoolSemanticModelArgs,
    WorkerTaskPoolSemanticModel,
} from "../../core/kernel/contracts/WorkerTaskPoolModelingProvider";
import { resolveMethodsFromCallable } from "../../core/kernel/contracts/SemanticPack";
import { collectNodeIdsFromValue, collectObjectNodeIdsFromValue, resolveHarmonyMethods } from "../../core/kernel/contracts/HarmonyModelingUtils";
import { safeGetOrCreatePagNodes } from "../../core/kernel/contracts/PagNodeResolution";

export type WorkerTaskPoolModel = WorkerTaskPoolSemanticModel;
export type BuildWorkerTaskPoolModelArgs = BuildWorkerTaskPoolSemanticModelArgs;

interface WorkerRegistration {
    workerObjectNodeIds: Set<number>;
    callbackParamNodeIds: Set<number>;
}

interface WorkerSend {
    workerObjectNodeIds: Set<number>;
    payloadNodeIds: Set<number>;
}

export function buildWorkerTaskPoolModel(args: BuildWorkerTaskPoolModelArgs): WorkerTaskPoolModel {
    const methods = resolveHarmonyMethods(args.scene, args.allowedMethodSignatures);
    const workerRegistrations: WorkerRegistration[] = [];
    const workerSends: WorkerSend[] = [];
    const allWorkerCallbackParamNodeIds = new Set<number>();
    const forwardTargetNodeIdsBySourceNodeId = new Map<number, Set<number>>();
    let workerRegistrationCount = 0;
    let workerSendCount = 0;
    let taskpoolExecuteCount = 0;

    const addBridge = (sourceNodeId: number, targetNodeId: number): void => {
        if (!forwardTargetNodeIdsBySourceNodeId.has(sourceNodeId)) {
            forwardTargetNodeIdsBySourceNodeId.set(sourceNodeId, new Set<number>());
        }
        forwardTargetNodeIdsBySourceNodeId.get(sourceNodeId)!.add(targetNodeId);
    };

    for (const method of methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkStaticInvokeExpr)) continue;

            const methodSig = invokeExpr.getMethodSignature?.();
            const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
            const declaringClassSig = methodSig?.getDeclaringClassSignature?.()?.toString?.() || "";
            const argsList = invokeExpr.getArgs ? invokeExpr.getArgs() : [];

            if (invokeExpr instanceof ArkInstanceInvokeExpr && methodName === "onMessage") {
                if (argsList.length < 1) continue;
                const callbackArg = argsList[0];
                const callbackMethods = resolveMethodsFromCallable(args.scene, callbackArg, { maxCandidates: 8 });
                if (callbackMethods.length === 0) continue;
                const callbackParamNodeIds = collectCallbackParamNodeIds(args.pag, callbackMethods, 0);
                if (callbackParamNodeIds.size === 0) continue;
                const workerObjectNodeIds = collectObjectNodeIdsFromValue(args.pag, invokeExpr.getBase());
                if (workerObjectNodeIds.size === 0) continue;
                workerRegistrationCount++;
                workerRegistrations.push({
                    workerObjectNodeIds,
                    callbackParamNodeIds,
                });
                for (const nodeId of callbackParamNodeIds) {
                    allWorkerCallbackParamNodeIds.add(nodeId);
                }
                continue;
            }

            if (invokeExpr instanceof ArkInstanceInvokeExpr && methodName === "postMessage") {
                if (argsList.length < 1) continue;
                const payloadNodeIds = collectNodeIdsFromValue(args.pag, argsList[0]);
                if (payloadNodeIds.size === 0) continue;
                const workerObjectNodeIds = collectObjectNodeIdsFromValue(args.pag, invokeExpr.getBase());
                if (workerObjectNodeIds.size === 0) continue;
                workerSendCount++;
                workerSends.push({
                    workerObjectNodeIds,
                    payloadNodeIds,
                });
                continue;
            }

            if (methodName === "execute" && argsList.length >= 2 && declaringClassSig.toLowerCase().includes("taskpool")) {
                const callableArg = argsList[0];
                const payloadArg = argsList[1];
                const callbackMethods = resolveMethodsFromCallable(args.scene, callableArg, { maxCandidates: 8 });
                if (callbackMethods.length === 0) continue;
                const callbackParamNodeIds = collectCallbackParamNodeIds(args.pag, callbackMethods, 0);
                if (callbackParamNodeIds.size === 0) continue;
                const payloadNodeIds = collectNodeIdsFromValue(args.pag, payloadArg);
                if (payloadNodeIds.size === 0) continue;
                taskpoolExecuteCount++;
                for (const payloadNodeId of payloadNodeIds) {
                    for (const callbackParamNodeId of callbackParamNodeIds) {
                        addBridge(payloadNodeId, callbackParamNodeId);
                    }
                }
            }
        }
    }

    for (const send of workerSends) {
        const matchedTargets = new Set<number>();
        for (const registration of workerRegistrations) {
            if (hasIntersection(send.workerObjectNodeIds, registration.workerObjectNodeIds)) {
                for (const targetNodeId of registration.callbackParamNodeIds) {
                    matchedTargets.add(targetNodeId);
                }
            }
        }
        const finalTargets = matchedTargets.size > 0
            ? matchedTargets
            : allWorkerCallbackParamNodeIds;
        for (const payloadNodeId of send.payloadNodeIds) {
            for (const targetNodeId of finalTargets) {
                addBridge(payloadNodeId, targetNodeId);
            }
        }
    }

    let bridgeCount = 0;
    for (const targetSet of forwardTargetNodeIdsBySourceNodeId.values()) {
        bridgeCount += targetSet.size;
    }

    return {
        forwardTargetNodeIdsBySourceNodeId,
        workerRegistrationCount,
        workerSendCount,
        taskpoolExecuteCount,
        bridgeCount,
    };
}


function collectCallbackParamNodeIds(
    pag: Pag,
    callbackMethods: any[],
    paramIndex: number
): Set<number> {
    const out = new Set<number>();
    for (const callbackMethod of callbackMethods) {
        const cfg = callbackMethod.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const right = stmt.getRightOp();
            if (!(right instanceof ArkParameterRef) || right.getIndex() !== paramIndex) continue;
            const nodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
            if (!nodes || nodes.size === 0) continue;
            for (const nodeId of nodes.values()) out.add(nodeId);
        }
    }
    return out;
}

function hasIntersection(a: Set<number>, b: Set<number>): boolean {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const v of small) {
        if (large.has(v)) return true;
    }
    return false;
}

function getOrCreatePagNodes(pag: Pag, value: any, anchorStmt: ArkAssignStmt): Map<number, number> | undefined {
    return safeGetOrCreatePagNodes(pag, value, anchorStmt);
}
