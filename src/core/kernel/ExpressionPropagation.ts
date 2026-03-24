import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkNormalBinopExpr, ArkConditionExpr, ArkCastExpr, ArkStaticInvokeExpr, ArkInstanceInvokeExpr, ArkPtrInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Value } from "../../../arkanalyzer/out/src/core/base/Value";

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

            if (rightOp instanceof Local && rightOp === local) {
                shouldPropagate = true;
            }

            if (rightOp instanceof ArkNormalBinopExpr) shouldPropagate = true;
            if (rightOp instanceof ArkConditionExpr) shouldPropagate = true;
            if (rightOp instanceof ArkCastExpr) shouldPropagate = true;

            if (rightOp instanceof ArkStaticInvokeExpr) {
                const sig = rightOp.getMethodSignature();
                const sigStr = sig ? sig.toString() : "";
                const methodName = resolveStaticMethodName(rightOp);
                if (sigStr.includes("%unk") && !isNonPropagatingStaticMethod(methodName)) {
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

            let leftPagNodes = pag.getNodesByValue(leftOp);
            if ((!leftPagNodes || leftPagNodes.size === 0) && leftOp instanceof Local) {
                try {
                    pag.getOrNewNode(currentCtx, leftOp, leftOp.getDeclaringStmt?.() || stmt);
                    leftPagNodes = pag.getNodesByValue(leftOp);
                } catch {
                    leftPagNodes = undefined;
                }
            }
            if (!leftPagNodes) continue;

            for (const leftNodeId of leftPagNodes.values()) {
                if (!tracker.isTainted(leftNodeId, currentCtx)) {
                    targetNodeIds.push(leftNodeId);
                }
            }
        }

    }

    return targetNodeIds;
}

function resolveStaticMethodName(expr: ArkStaticInvokeExpr): string {
    const sig = expr.getMethodSignature();
    const bySubSig = sig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (bySubSig) return bySubSig;
    const sigStr = sig?.toString?.() || "";
    const fromSig = sigStr.match(/\.([A-Za-z0-9_]+)\(\)/);
    if (fromSig) return fromSig[1];
    const text = expr.toString?.() || "";
    const fromText = text.match(/\.([A-Za-z0-9_]+)\(/);
    return fromText ? fromText[1] : "";
}

function isNonPropagatingStaticMethod(methodName: string): boolean {
    return methodName === "keys";
}

function isContainerReadMethod(methodName: string): boolean {
    return methodName === "get"
        || methodName === "getFirst"
        || methodName === "at"
        || methodName === "values"
        || methodName === "keys"
        || methodName === "entries";
}
