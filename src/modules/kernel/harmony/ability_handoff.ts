import { Pag } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/lib/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/lib/core/base/Ref";
import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import {
    defineModule,
    type ModuleSetupContext,
    type TaintModule,
} from "../../../core/kernel/contracts/ModuleApi";
import {
    addMapSetValue,
    collectNodeIdsFromValue,
    collectObjectNodeIdsFromValue,
    resolveHarmonyMethods,
} from "../../../core/kernel/contracts/HarmonyModuleUtils";

interface AbilityHandoffBoundarySemantics {
    kind: "serialized_copy";
    summary: string;
    preservesFieldPath: boolean;
    preservesObjectIdentity: boolean;
}

interface AbilityHandoffModel {
    targetNodeIdsBySourceNodeId: Map<number, Set<number>>;
    targetFieldLoadNodeIdsBySourceFieldKey: Map<string, Set<number>>;
    continuedFieldLoadNodeIdsBySourceFieldKey: Map<string, Set<number>>;
    callCount: number;
    targetMethodCount: number;
    boundary: AbilityHandoffBoundarySemantics;
}

const START_ABILITY_METHOD_NAMES = new Set([
    "startAbility",
    "startAbilityForResult",
    "connectServiceExtensionAbility",
]);

export const harmonyAbilityHandoffModule: TaintModule = defineModule({
    id: "harmony.ability_handoff",
    description: "Built-in Harmony Ability handoff bridges.",
    setup(ctx) {
        const model = buildAbilityHandoffModel(ctx);
        ctx.debug.summary("Harmony-AbilityHandoff", {
            calls: model.callCount,
            targets: model.targetMethodCount,
            boundary: model.boundary.kind,
        });
        return {
            onFact(event) {
                const emissions = event.emit.collector();
                const targetNodeIds = model.targetNodeIdsBySourceNodeId.get(event.current.nodeId);
                if (targetNodeIds && targetNodeIds.size > 0) {
                    emissions.push(
                        model.boundary.preservesFieldPath
                            ? event.emit.preserveToNodes(
                                targetNodeIds,
                                "Harmony-AbilityHandoff",
                                { allowUnreachableTarget: true },
                            )
                            : event.emit.toNodes(
                                targetNodeIds,
                                "Harmony-AbilityHandoff",
                                { allowUnreachableTarget: true },
                            ),
                    );
                }

                const fieldHead = event.current.fieldHead();
                if (fieldHead) {
                    const targetFieldNodeIds = model.targetFieldLoadNodeIdsBySourceFieldKey.get(
                        `${event.current.nodeId}#${fieldHead}`,
                    );
                    if (targetFieldNodeIds && targetFieldNodeIds.size > 0) {
                        emissions.push(event.emit.toCurrentFieldTailNodes(
                            targetFieldNodeIds,
                            "Harmony-AbilityHandoffField",
                            {
                                allowUnreachableTarget: true,
                            },
                        ));
                    }
                    const continuedFieldNodeIds = model.continuedFieldLoadNodeIdsBySourceFieldKey.get(
                        `${event.current.nodeId}#${fieldHead}`,
                    );
                    if (continuedFieldNodeIds && continuedFieldNodeIds.size > 0) {
                        emissions.push(event.emit.toNodes(
                            continuedFieldNodeIds,
                            "Harmony-AbilityHandoffContinuation",
                            {
                                allowUnreachableTarget: true,
                            },
                        ));
                    }
                }

                return emissions.done();
            },
        };
    },
});

function buildAbilityHandoffModel(ctx: ModuleSetupContext): AbilityHandoffModel {
    const { scene, pag, allowedMethodSignatures } = ctx.raw;
    const targetNodeIdsBySourceNodeId = new Map<number, Set<number>>();
    const targetFieldLoadNodeIdsBySourceFieldKey = new Map<string, Set<number>>();
    const continuedFieldLoadNodeIdsBySourceFieldKey = new Map<string, Set<number>>();
    const targetMethods = collectTargetLifecycleMethods(scene, allowedMethodSignatures);
    const continuedFieldLoadNodeIdsByClassAndWantField = collectContinuedFieldLoadNodeIdsByClassAndWantField(
        scene,
        pag,
        targetMethods,
    );
    let callCount = 0;

    const methods = resolveHarmonyMethods(scene, allowedMethodSignatures);
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
            if (!isAbilityContextLikeInvoke(invokeExpr, methodSig)) continue;

            const callArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (callArgs.length === 0) continue;
            const wantArg = callArgs[0];

            const sourceNodeIds = new Set<number>([
                ...collectNodeIdsFromValue(pag, wantArg),
                ...collectObjectNodeIdsFromValue(pag, wantArg),
            ]);
            if (sourceNodeIds.size === 0) continue;
            callCount++;

            for (const targetMethod of targetMethods) {
                const targetClassName = targetMethod.getDeclaringArkClass?.()?.getName?.() || "";
                if (targetClassName && targetClassName === sourceClassName) {
                    continue;
                }
                const targetParamNodeIds = collectWantParamNodeIds(pag, targetMethod);
                const targetFieldLoadNodeIdsByFieldName = collectWantFieldLoadNodeIds(pag, targetMethod);
                if (targetParamNodeIds.size === 0) continue;
                for (const sourceNodeId of sourceNodeIds) {
                    for (const targetNodeId of targetParamNodeIds) {
                        addMapSetValue(targetNodeIdsBySourceNodeId, sourceNodeId, targetNodeId);
                    }
                    for (const [fieldName, targetFieldNodeIds] of targetFieldLoadNodeIdsByFieldName.entries()) {
                        const sourceFieldKey = `${sourceNodeId}#${fieldName}`;
                        for (const targetNodeId of targetFieldNodeIds) {
                            addMapSetValue(targetFieldLoadNodeIdsBySourceFieldKey, sourceFieldKey, targetNodeId);
                        }
                    }
                    const continuedFieldLoads = continuedFieldLoadNodeIdsByClassAndWantField.get(targetClassName);
                    if (continuedFieldLoads) {
                        for (const [fieldName, targetFieldNodeIds] of continuedFieldLoads.entries()) {
                            const sourceFieldKey = `${sourceNodeId}#${fieldName}`;
                            for (const targetNodeId of targetFieldNodeIds) {
                                addMapSetValue(continuedFieldLoadNodeIdsBySourceFieldKey, sourceFieldKey, targetNodeId);
                            }
                        }
                    }
                }
            }
        }
    }

    return {
        targetNodeIdsBySourceNodeId,
        targetFieldLoadNodeIdsBySourceFieldKey,
        continuedFieldLoadNodeIdsBySourceFieldKey,
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
    scene: any,
    _allowedMethodSignatures?: Set<string>,
): any[] {
    return scene.getMethods().filter((method: any) => {
        const methodName = method.getName?.() || "";
        if (methodName !== "onCreate" && methodName !== "onNewWant" && methodName !== "onConnect") {
            return false;
        }
        const parameters = method.getParameters?.() || [];
        const hasWantParam = parameters.some((parameter: any) => {
            const typeText = String(parameter.getType?.()?.toString?.() || "").toLowerCase();
            const nameText = String(parameter.getName?.() || "").toLowerCase();
            return typeText.includes("want") || nameText.includes("want");
        });
        if (!hasWantParam) {
            return false;
        }
        const declaringClass = method.getDeclaringArkClass?.();
        const className = declaringClass?.getName?.() || "";
        if (/ability|extension/i.test(className)) {
            return true;
        }
        let cursor = declaringClass?.getSuperClass?.() || null;
        let depth = 0;
        while (cursor && depth < 8) {
            const superName = cursor.getName?.() || "";
            if (/ability|extension/i.test(superName)) {
                return true;
            }
            cursor = cursor.getSuperClass?.() || null;
            depth += 1;
        }
        return false;
    });
}

function collectWantParamNodeIds(pag: Pag, method: any): Set<number> {
    const out = new Set<number>();
    const cfg = method.getCfg?.();
    if (!cfg) return out;
    const parameters = method.getParameters?.() || [];

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkParameterRef)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        const param = parameters[right.getIndex()];
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

    for (const parameter of parameters) {
        const typeText = String(parameter?.getType?.()?.toString?.() || "").toLowerCase();
        const nameText = String(parameter?.getName?.() || "").toLowerCase();
        if (!typeText.includes("want") && !nameText.includes("want")) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const right = stmt.getRightOp();
            if (!(right instanceof ArkInstanceFieldRef)) continue;
            const base = right.getBase?.();
            const baseName = String(base?.getName?.() || "").toLowerCase();
            const baseType = String(base?.getType?.()?.toString?.() || "").toLowerCase();
            if (baseName !== nameText && !baseType.includes("want")) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof Local)) continue;
            for (const nodeId of collectNodeIdsFromValue(pag, left)) {
                out.add(nodeId);
            }
            for (const objectNodeId of collectObjectNodeIdsFromValue(pag, left)) {
                out.add(objectNodeId);
            }
        }
    }

    for (const parameter of parameters) {
        const typeText = String(parameter?.getType?.()?.toString?.() || "").toLowerCase();
        const nameText = String(parameter?.getName?.() || "").toLowerCase();
        if (!typeText.includes("want") && !nameText.includes("want")) continue;
        const bodyLocals = method.getBody?.()?.getLocals?.();
        if (!bodyLocals) continue;
        for (const local of bodyLocals.values()) {
            const localName = String(local?.getName?.() || "").toLowerCase();
            const localType = String(local?.getType?.()?.toString?.() || "").toLowerCase();
            if (localName !== nameText && !localType.includes("want")) continue;
            for (const nodeId of collectNodeIdsFromValue(pag, local)) {
                out.add(nodeId);
            }
            for (const objectNodeId of collectObjectNodeIdsFromValue(pag, local)) {
                out.add(objectNodeId);
            }
        }
    }

    return out;
}

function collectWantFieldLoadNodeIds(pag: Pag, method: any): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    const cfg = method.getCfg?.();
    if (!cfg) return out;

    const parameters = method.getParameters?.() || [];
    const wantParamIndexes = new Set<number>();
    for (let index = 0; index < parameters.length; index++) {
        const parameter = parameters[index];
        const typeText = String(parameter?.getType?.()?.toString?.() || "").toLowerCase();
        const nameText = String(parameter?.getName?.() || "").toLowerCase();
        if (typeText.includes("want") || nameText.includes("want")) {
            wantParamIndexes.add(index);
        }
    }
    if (wantParamIndexes.size === 0) return out;

    const wantLocalNames = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local)) continue;
        if (!(right instanceof ArkParameterRef)) continue;
        if (!wantParamIndexes.has(right.getIndex())) continue;
        wantLocalNames.add(left.getName());
    }

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceFieldRef)) continue;
        const base = right.getBase?.();
        const baseName = String(base?.getName?.() || "").trim();
        if (!baseName || !wantLocalNames.has(baseName)) continue;

        const fieldName = right.getFieldSignature?.()?.getFieldName?.() || "";
        if (!fieldName) continue;
        const nodes = left instanceof Local
            ? collectNodeIdsFromValue(pag, left)
            : new Set<number>();
        if (nodes.size === 0) continue;
        for (const nodeId of nodes) {
            addMapSetValue(out, fieldName, nodeId);
        }
    }

    return out;
}

function collectContinuedFieldLoadNodeIdsByClassAndWantField(
    scene: any,
    pag: Pag,
    targetMethods: any[],
): Map<string, Map<string, Set<number>>> {
    const out = new Map<string, Map<string, Set<number>>>();
    const targetClassNames = new Set<string>();
    for (const method of targetMethods) {
        const className = method.getDeclaringArkClass?.()?.getName?.() || "";
        if (!className) continue;
        targetClassNames.add(className);
    }

    for (const className of targetClassNames) {
        const classMethods = scene.getMethods().filter((method: any) => {
            const owner = method.getDeclaringArkClass?.()?.getName?.() || "";
            return owner === className;
        });
        const lifecycleMethods = targetMethods.filter((method: any) => {
            const owner = method.getDeclaringArkClass?.()?.getName?.() || "";
            return owner === className;
        });
        const fieldLoadsByFieldName = collectClassFieldLoadNodeIds(pag, classMethods);
        if (fieldLoadsByFieldName.size === 0) continue;
        for (const method of lifecycleMethods) {
            const cfg = method.getCfg?.();
            if (!cfg) continue;
            const wantLocalNames = collectWantLocalNames(method);
            if (wantLocalNames.size === 0) continue;
            const localWantFieldByName = new Map<string, string>();
            for (const stmt of cfg.getStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const left = stmt.getLeftOp();
                const right = stmt.getRightOp();
                if (left instanceof Local) {
                    if (right instanceof ArkInstanceFieldRef) {
                        const rightBase = right.getBase?.();
                        if (rightBase instanceof Local && wantLocalNames.has(rightBase.getName())) {
                            const wantFieldName = right.getFieldSignature?.()?.getFieldName?.() || "";
                            if (wantFieldName) {
                                localWantFieldByName.set(left.getName(), wantFieldName);
                            }
                        }
                    } else if (right instanceof Local) {
                        const wantFieldName = localWantFieldByName.get(right.getName());
                        if (wantFieldName) {
                            localWantFieldByName.set(left.getName(), wantFieldName);
                        }
                    }
                }
                if (!(left instanceof ArkInstanceFieldRef)) continue;
                const leftBase = left.getBase?.();
                if (!(leftBase instanceof Local) || leftBase.getName() !== "this") continue;
                let wantFieldName = "";
                if (right instanceof ArkInstanceFieldRef) {
                    const rightBase = right.getBase?.();
                    if (!(rightBase instanceof Local) || !wantLocalNames.has(rightBase.getName())) continue;
                    wantFieldName = right.getFieldSignature?.()?.getFieldName?.() || "";
                } else if (right instanceof Local) {
                    wantFieldName = localWantFieldByName.get(right.getName()) || "";
                } else {
                    continue;
                }
                const storedFieldName = left.getFieldSignature?.()?.getFieldName?.() || "";
                if (!wantFieldName || !storedFieldName) continue;
                const loadNodeIds = fieldLoadsByFieldName.get(storedFieldName);
                if (!loadNodeIds || loadNodeIds.size === 0) continue;
                for (const targetNodeId of loadNodeIds) {
                    if (!out.has(className)) out.set(className, new Map<string, Set<number>>());
                    addMapSetValue(out.get(className)!, wantFieldName, targetNodeId);
                }
            }
        }
    }

    return out;
}

function collectWantLocalNames(method: any): Set<string> {
    const out = new Set<string>();
    const cfg = method.getCfg?.();
    if (!cfg) return out;
    const parameters = method.getParameters?.() || [];
    const wantParamIndexes = new Set<number>();
    for (let index = 0; index < parameters.length; index++) {
        const parameter = parameters[index];
        const typeText = String(parameter?.getType?.()?.toString?.() || "").toLowerCase();
        const nameText = String(parameter?.getName?.() || "").toLowerCase();
        if (typeText.includes("want") || nameText.includes("want")) {
            wantParamIndexes.add(index);
            if (nameText) {
                out.add(nameText);
            }
        }
    }
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof Local)) continue;
        if (!(right instanceof ArkParameterRef)) continue;
        if (!wantParamIndexes.has(right.getIndex())) continue;
        out.add(left.getName());
    }
    return out;
}

function collectClassFieldLoadNodeIds(pag: Pag, methods: any[]): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    for (const method of methods) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local)) continue;
            if (!(right instanceof ArkInstanceFieldRef)) continue;
            const base = right.getBase?.();
            if (!(base instanceof Local) || base.getName() !== "this") continue;
            const fieldName = right.getFieldSignature?.()?.getFieldName?.() || "";
            if (!fieldName) continue;
            const nodeIds = collectNodeIdsFromValue(pag, left);
            if (nodeIds.size === 0) continue;
            for (const nodeId of nodeIds) {
                addMapSetValue(out, fieldName, nodeId);
            }
        }
    }
    return out;
}

export default harmonyAbilityHandoffModule;
