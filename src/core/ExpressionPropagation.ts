import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import { ArkAssignStmt, ArkInvokeStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkNormalBinopExpr, ArkConditionExpr, ArkCastExpr, ArkStaticInvokeExpr, ArkInstanceInvokeExpr, ArkPtrInvokeExpr } from "../../arkanalyzer/out/src/core/base/Expr";
import { ArkInstanceFieldRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Value } from "../../arkanalyzer/out/src/core/base/Value";

// 容器方法白名单：参数 -> 接收者传播
const CONTAINER_TAINT_METHODS = new Set([
    "set",
    "add",
    "push",
    "unshift",
    "append",
    "put",
]);

export function propagateExpressionTaint(
    nodeId: number,
    value: Value,
    currentCtx: number,
    tracker: any,
    pag: any
): number[] {
    const targetNodeIds: number[] = [];

    if (!(value instanceof Local)) {
        return targetNodeIds;
    }

    const local = value as Local;
    const usedStmts = local.getUsedStmts();

    for (const stmt of usedStmts) {
        if (stmt instanceof ArkAssignStmt) {
            const rightOp = stmt.getRightOp();
            let shouldPropagate = false;

            if (rightOp instanceof ArkNormalBinopExpr) shouldPropagate = true;
            if (rightOp instanceof ArkConditionExpr) shouldPropagate = true;
            if (rightOp instanceof ArkCastExpr) shouldPropagate = true;

            if (rightOp instanceof ArkStaticInvokeExpr) {
                const sig = rightOp.getMethodSignature();
                const sigStr = sig ? sig.toString() : "";
                if (sigStr.includes("%unk")) {
                    shouldPropagate = true;
                }
            }

            if (rightOp instanceof ArkInstanceInvokeExpr) {
                const sig = rightOp.getMethodSignature();
                const sigStr = sig ? sig.toString() : "";
                const methodName = sig?.getMethodSubSignature()?.getMethodName() || "";
                if (sigStr.includes("%unk") && !isContainerReadMethod(methodName)) {
                    shouldPropagate = true;
                }
            }

            if (rightOp instanceof ArkPtrInvokeExpr) {
                const sig = rightOp.getMethodSignature();
                const sigStr = sig ? sig.toString() : "";
                const args = rightOp.getArgs ? rightOp.getArgs() : [];
                if (sigStr.includes("%unk") && args.includes(local)) {
                    shouldPropagate = true;
                }
            }

            if (rightOp instanceof ArkInstanceFieldRef) {
                const fieldSig = rightOp.getFieldSignature().toString();
                if (rightOp.getBase() === local && fieldSig.includes("@%unk/%unk")) {
                    shouldPropagate = true;
                }
            }

            if (!shouldPropagate) continue;

            const leftOp = stmt.getLeftOp();
            if (!(leftOp instanceof Local)) continue;

            const leftPagNodes = pag.getNodesByValue(leftOp);
            if (!leftPagNodes) continue;

            for (const leftNodeId of leftPagNodes.values()) {
                if (!tracker.isTainted(leftNodeId, currentCtx)) {
                    targetNodeIds.push(leftNodeId);
                }
            }
        }

        if (stmt instanceof ArkInvokeStmt) {
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const sig = invokeExpr.getMethodSignature();
            const methodName = sig?.getMethodSubSignature()?.getMethodName() || "";
            if (!CONTAINER_TAINT_METHODS.has(methodName)) continue;

            const base = invokeExpr.getBase();
            if (!(base instanceof Local)) continue;

            const basePagNodes = pag.getNodesByValue(base);
            if (!basePagNodes) continue;

            for (const baseNodeId of basePagNodes.values()) {
                if (!tracker.isTainted(baseNodeId, currentCtx)) {
                    targetNodeIds.push(baseNodeId);
                }
            }
        }
    }

    return targetNodeIds;
}

function isContainerReadMethod(methodName: string): boolean {
    return methodName === "get" || methodName === "getFirst";
}
