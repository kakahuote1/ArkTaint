import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import {
    AbilityHandoffBoundaryKind,
    AbilityHandoffBoundarySemantics,
    AbilityHandoffSemanticModel,
    BuildAbilityHandoffSemanticModelArgs,
} from "../../core/kernel/contracts/AbilityHandoffModelingProvider";
import { addMapSetValue, collectNodeIdsFromValue, collectObjectNodeIdsFromValue, resolveHarmonyMethods } from "../../core/kernel/contracts/HarmonyModelingUtils";

export type AbilityHandoffModel = AbilityHandoffSemanticModel;
export type BuildAbilityHandoffModelArgs = BuildAbilityHandoffSemanticModelArgs;

const START_ABILITY_METHOD_NAMES = new Set([
    "startAbility",
    "startAbilityForResult",
    "connectServiceExtensionAbility",
]);

export function buildAbilityHandoffModel(args: BuildAbilityHandoffModelArgs): AbilityHandoffModel {
    const targetNodeIdsBySourceNodeId = new Map<number, Set<number>>();
    const targetMethods = collectTargetLifecycleMethods(args.scene, args.allowedMethodSignatures);
    let callCount = 0;

    const methods = resolveHarmonyMethods(args.scene, args.allowedMethodSignatures);
    for (const method of methods) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        const sourceClassName = method.getDeclaringArkClass?.()?.getName?.() || "";

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;
            const methodSig = invokeExpr.getMethodSignature?.();
            const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (!START_ABILITY_METHOD_NAMES.has(methodName)) continue;

            if (!isAbilityContextLikeInvoke(invokeExpr, methodSig)) {
                continue;
            }

            const callArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (callArgs.length === 0) continue;
            const wantArg = callArgs[0];

            const sourceNodeIds = new Set<number>([
                ...collectNodeIdsFromValue(args.pag, wantArg),
                ...collectObjectNodeIdsFromValue(args.pag, wantArg),
            ]);
            if (sourceNodeIds.size === 0) continue;
            callCount++;

            for (const targetMethod of targetMethods) {
                const targetClassName = targetMethod.getDeclaringArkClass?.()?.getName?.() || "";
                if (targetClassName && targetClassName === sourceClassName) {
                    continue;
                }
                const targetParamNodeIds = collectWantParamNodeIds(args.pag, targetMethod);
                if (targetParamNodeIds.size === 0) continue;
                for (const sourceNodeId of sourceNodeIds) {
                    for (const targetNodeId of targetParamNodeIds) {
                        addMapSetValue(targetNodeIdsBySourceNodeId, sourceNodeId, targetNodeId);
                    }
                }
            }
        }
    }

    return {
        targetNodeIdsBySourceNodeId,
        callCount,
        targetMethodCount: targetMethods.length,
        boundary: {
            kind: "serialized_copy",
            summary: "Ability handoff serializes Want payloads before entering target lifecycle parameters.",
            preservesFieldPath: true,
            preservesObjectIdentity: false,
        },
    };
}


function isAbilityContextLikeInvoke(invokeExpr: any, methodSig: any): boolean {
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const classSigText = methodSig?.getDeclaringClassSignature?.()?.toString?.()?.toLowerCase?.() || "";
    if (className === "AbilityContext" || classSigText.includes("abilitycontext")) {
        return true;
    }

    const base = invokeExpr?.getBase?.();
    const baseTypeText = base?.getType?.()?.toString?.()?.toLowerCase?.() || "";
    if (baseTypeText.includes("abilitycontext")) {
        return true;
    }

    const baseClassSig = base?.getType?.()?.getClassSignature?.()?.toString?.()?.toLowerCase?.() || "";
    if (baseClassSig.includes("abilitycontext")) {
        return true;
    }

    const baseText = base?.toString?.()?.toLowerCase?.() || "";
    if (baseText.includes(".context") || baseText === "context") {
        return true;
    }
    return valueBacktraceHintsContext(base, 0);
}

function valueBacktraceHintsContext(value: any, depth: number): boolean {
    if (!value || depth >= 4) return false;
    const declaringStmt = value?.getDeclaringStmt?.();
    if (!(declaringStmt instanceof ArkAssignStmt)) return false;
    const right = declaringStmt.getRightOp?.();
    if (right instanceof ArkInstanceFieldRef) {
        const fieldName = right.getFieldSignature?.().getFieldName?.()?.toLowerCase?.() || "";
        if (fieldName === "context") {
            return true;
        }
        return valueBacktraceHintsContext(right.getBase?.(), depth + 1);
    }
    if (right instanceof Local) {
        return valueBacktraceHintsContext(right, depth + 1);
    }
    return false;
}

function collectTargetLifecycleMethods(
    scene: Scene,
    allowedMethodSignatures?: Set<string>,
): any[] {
    const methods = resolveHarmonyMethods(scene, allowedMethodSignatures);
    return methods.filter(method => {
        const methodName = method.getName?.() || "";
        if (methodName !== "onCreate" && methodName !== "onNewWant" && methodName !== "onConnect") {
            return false;
        }
        const parameters = method.getParameters?.() || [];
        return parameters.some((parameter: any) => {
            const typeText = String(parameter.getType?.()?.toString?.() || "").toLowerCase();
            const nameText = String(parameter.getName?.() || "").toLowerCase();
            return typeText.includes("want") || nameText.includes("want");
        });
    });
}

function collectWantParamNodeIds(pag: Pag, method: any): Set<number> {
    const out = new Set<number>();
    const cfg = method.getCfg?.();
    if (!cfg) return out;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkParameterRef)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        const param = (method.getParameters?.() || [])[right.getIndex()];
        const typeText = String(param?.getType?.()?.toString?.() || "").toLowerCase();
        const nameText = String(param?.getName?.() || "").toLowerCase();
        if (!typeText.includes("want") && !nameText.includes("want")) continue;

        for (const nodeId of collectNodeIdsFromValue(pag, left)) {
            out.add(nodeId);
        }
        for (const objectNodeId of collectObjectNodeIdsFromValue(pag, left)) {
            out.add(objectNodeId);
        }
    }

    return out;
}
