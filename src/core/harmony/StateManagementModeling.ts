import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { Decorator } from "../../../arkanalyzer/out/src/core/base/Decorator";
import { collectObjectNodeIdsFromValue, resolveHarmonyMethods } from "./HarmonyModelingUtils";

const DECORATOR_STATE = "State";
const DECORATOR_PROP = "Prop";
const DECORATOR_LINK = "Link";
const DECORATOR_OBJECT_LINK = "ObjectLink";
const DECORATOR_OBSERVED = "Observed";
const DECORATOR_PROVIDE = "Provide";
const DECORATOR_CONSUME = "Consume";

export interface StatePropBridgeEdge {
    sourceObjectNodeId: number;
    sourceFieldName: string;
    targetObjectNodeId: number;
    targetFieldName: string;
    methodSignature: string;
}

export interface StateManagementModel {
    edgesBySourceField: Map<string, StatePropBridgeEdge[]>;
    bridgeEdgeCount: number;
    constructorCallCount: number;
    stateCaptureAssignCount: number;
}

export interface BuildStateManagementModelArgs {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
}

interface DecoratedFieldSets {
    bridgeSourceFieldSignatures: Set<string>;
    propLikeFieldsByClassName: Map<string, Set<string>>;
    linkFieldsByClassName: Map<string, Set<string>>;
    observedClassNames: Set<string>;
    provideFieldsByKey: Map<string, DecoratedKeyFieldInfo[]>;
    consumeFieldsByKey: Map<string, DecoratedKeyFieldInfo[]>;
}

interface DecoratedKeyFieldInfo {
    fieldSignature: string;
    fieldName: string;
}

interface StateCaptureInfo {
    captureFieldName: string;
    stateFieldSignature: string;
    stateFieldName: string;
    sourceParamIndex?: number;
}

export function buildStateManagementModel(args: BuildStateManagementModelArgs): StateManagementModel {
    const decorated = collectDecoratedFieldSets(args.scene);
    const methods = resolveHarmonyMethods(args.scene, args.allowedMethodSignatures);

    const stateCaptureByObject = collectStateCaptureByObject({
        pag: args.pag,
        methods,
        stateFieldSignatures: decorated.bridgeSourceFieldSignatures,
    });
    const stateOwnerObjectIdsByFieldSignature = collectStateOwnerObjectIdsByFieldSignature({
        pag: args.pag,
        methods,
        stateFieldSignatures: decorated.bridgeSourceFieldSignatures,
    });
    const fieldObjectIdsByFieldSignature = collectFieldObjectIdsByFieldSignature({
        pag: args.pag,
        methods,
    });

    const edgesBySourceField = new Map<string, StatePropBridgeEdge[]>();
    const dedup = new Set<string>();
    let constructorCallCount = 0;
    let bridgeEdgeCount = 0;

    const addBridgeEdge = (edge: StatePropBridgeEdge): void => {
        const sourceKey = `${edge.sourceObjectNodeId}#${edge.sourceFieldName}`;
        const dedupKey = `${sourceKey}->${edge.targetObjectNodeId}#${edge.targetFieldName}`;
        if (dedup.has(dedupKey)) return;
        dedup.add(dedupKey);
        if (!edgesBySourceField.has(sourceKey)) edgesBySourceField.set(sourceKey, []);
        edgesBySourceField.get(sourceKey)!.push(edge);
        bridgeEdgeCount++;
    };

    for (const method of methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const calleeSig = invokeExpr.getMethodSignature?.();
            const calleeSigText = calleeSig?.toString?.() || "";
            if (!calleeSigText.includes(".constructor(")) continue;
            constructorCallCount++;

            const targetClassName = calleeSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
            if (!targetClassName) continue;
            const propLikeFields = decorated.propLikeFieldsByClassName.get(targetClassName);
            const linkFields = decorated.linkFieldsByClassName.get(targetClassName);
            if ((!propLikeFields || propLikeFields.size === 0) && (!linkFields || linkFields.size === 0)) continue;

            const targetObjectNodeIds = collectObjectNodeIdsFromValue(args.pag, invokeExpr.getBase());
            if (targetObjectNodeIds.size === 0) continue;

            const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (invokeArgs.length === 0) continue;

            for (let argIndex = 0; argIndex < invokeArgs.length; argIndex++) {
                const arg = invokeArgs[argIndex];
                const sourceObjectNodeIds = collectObjectNodeIdsFromValue(args.pag, arg);
                if (sourceObjectNodeIds.size === 0) continue;
                for (const sourceObjectNodeId of sourceObjectNodeIds) {
                    const captures = stateCaptureByObject.get(sourceObjectNodeId);
                    if (!captures || captures.length === 0) continue;
                    for (const capture of captures) {
                        // Prefer param-position precision when we can recover parameter origin.
                        // If parameter origin is unknown, keep conservative fallback to avoid false negatives.
                        if (
                            capture.sourceParamIndex !== undefined
                            && capture.sourceParamIndex !== argIndex
                        ) {
                            continue;
                        }
                        const isPropLike = propLikeFields?.has(capture.captureFieldName) || false;
                        const isLink = linkFields?.has(capture.captureFieldName) || false;
                        if (!isPropLike && !isLink) continue;
                        const stateOwnerObjectIds = stateOwnerObjectIdsByFieldSignature.get(capture.stateFieldSignature);
                        // When we know the source parameter index, bind bridge source to the
                        // current argument object to avoid cross-argument over-approximation.
                        const sourceOwnerIds = (
                            capture.sourceParamIndex !== undefined
                            || !stateOwnerObjectIds
                            || stateOwnerObjectIds.size === 0
                        )
                            ? new Set<number>([sourceObjectNodeId])
                            : stateOwnerObjectIds;
                        for (const targetObjectNodeId of targetObjectNodeIds) {
                            for (const sourceOwnerId of sourceOwnerIds) {
                                if (isPropLike) {
                                    addBridgeEdge({
                                        sourceObjectNodeId: sourceOwnerId,
                                        sourceFieldName: capture.stateFieldName,
                                        targetObjectNodeId,
                                        targetFieldName: capture.captureFieldName,
                                        methodSignature: method.getSignature().toString(),
                                    });
                                }
                                if (isLink) {
                                    addBridgeEdge({
                                        sourceObjectNodeId: targetObjectNodeId,
                                        sourceFieldName: capture.captureFieldName,
                                        targetObjectNodeId: sourceOwnerId,
                                        targetFieldName: capture.stateFieldName,
                                        methodSignature: method.getSignature().toString(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    for (const [key, provideFields] of decorated.provideFieldsByKey.entries()) {
        const consumeFields = decorated.consumeFieldsByKey.get(key);
        if (!consumeFields || consumeFields.length === 0) continue;
        for (const provideField of provideFields) {
            const providerObjIds = fieldObjectIdsByFieldSignature.get(provideField.fieldSignature);
            if (!providerObjIds || providerObjIds.size === 0) continue;
            for (const consumeField of consumeFields) {
                const consumerObjIds = fieldObjectIdsByFieldSignature.get(consumeField.fieldSignature);
                if (!consumerObjIds || consumerObjIds.size === 0) continue;
                for (const providerObjId of providerObjIds) {
                    for (const consumerObjId of consumerObjIds) {
                        addBridgeEdge({
                            sourceObjectNodeId: providerObjId,
                            sourceFieldName: provideField.fieldName,
                            targetObjectNodeId: consumerObjId,
                            targetFieldName: consumeField.fieldName,
                            methodSignature: `provide-consume:${key}`,
                        });
                    }
                }
            }
        }
    }

    let stateCaptureAssignCount = 0;
    for (const captures of stateCaptureByObject.values()) {
        stateCaptureAssignCount += captures.length;
    }

    return {
        edgesBySourceField,
        bridgeEdgeCount,
        constructorCallCount,
        stateCaptureAssignCount,
    };
}

function collectDecoratedFieldSets(scene: Scene): DecoratedFieldSets {
    const bridgeSourceFieldSignatures = new Set<string>();
    const propLikeFieldsByClassName = new Map<string, Set<string>>();
    const linkFieldsByClassName = new Map<string, Set<string>>();
    const observedClassNames = new Set<string>();
    const provideFieldsByKey = new Map<string, DecoratedKeyFieldInfo[]>();
    const consumeFieldsByKey = new Map<string, DecoratedKeyFieldInfo[]>();

    for (const cls of scene.getClasses()) {
        const className = cls.getName();
        const classDecorators = cls.getDecorators?.() || [];
        for (const decorator of classDecorators) {
            const kind = normalizeDecoratorKind(decorator);
            if (kind === DECORATOR_OBSERVED) {
                observedClassNames.add(className);
            }
        }
        for (const field of cls.getFields()) {
            const decorators = field.getDecorators() || [];
            if (decorators.length === 0) continue;
            for (const decorator of decorators) {
                const kind = normalizeDecoratorKind(decorator);
                if (!kind) continue;
                if (kind === DECORATOR_STATE) {
                    const sig = field.getSignature()?.toString?.() || "";
                    if (sig) bridgeSourceFieldSignatures.add(sig);
                } else if (
                    kind === DECORATOR_PROP
                    || kind === DECORATOR_LINK
                    || kind === DECORATOR_OBJECT_LINK
                ) {
                    const sig = field.getSignature()?.toString?.() || "";
                    if (sig) bridgeSourceFieldSignatures.add(sig);
                    if (!propLikeFieldsByClassName.has(className)) {
                        propLikeFieldsByClassName.set(className, new Set<string>());
                    }
                    propLikeFieldsByClassName.get(className)!.add(field.getName());
                    if (kind === DECORATOR_LINK || kind === DECORATOR_OBJECT_LINK) {
                        if (!linkFieldsByClassName.has(className)) {
                            linkFieldsByClassName.set(className, new Set<string>());
                        }
                        linkFieldsByClassName.get(className)!.add(field.getName());
                    }
                } else if (kind === DECORATOR_PROVIDE || kind === DECORATOR_CONSUME) {
                    const sig = field.getSignature()?.toString?.() || "";
                    if (!sig) continue;
                    const key = extractDecoratorKey(decorator);
                    if (!key) continue;
                    const targetMap = kind === DECORATOR_PROVIDE
                        ? provideFieldsByKey
                        : consumeFieldsByKey;
                    if (!targetMap.has(key)) targetMap.set(key, []);
                    targetMap.get(key)!.push({
                        fieldSignature: sig,
                        fieldName: field.getName(),
                    });
                }
            }
        }
    }

    return {
        bridgeSourceFieldSignatures,
        propLikeFieldsByClassName,
        linkFieldsByClassName,
        observedClassNames,
        provideFieldsByKey,
        consumeFieldsByKey,
    };
}

function extractDecoratorKey(decorator: Decorator): string | undefined {
    const fromParam = normalizeDecoratorKey(decorator.getParam?.() || "");
    if (fromParam) return fromParam;
    const content = decorator.getContent?.() || "";
    const m = content.match(/\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (!m) return undefined;
    return normalizeDecoratorKey(m[1]);
}

function normalizeDecoratorKey(raw: string): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const text = String(raw).trim();
    if (text.length === 0) return undefined;
    const quoted = text.match(/^["'`](.+)["'`]$/);
    if (quoted) return quoted[1];
    return text;
}

function normalizeDecoratorKind(decorator: Decorator): string | undefined {
    const raw = decorator.getKind?.() || "";
    if (!raw) return undefined;
    const normalized = raw.replace(/^@/, "").trim();
    if (!normalized) return undefined;
    const noCall = normalized.endsWith("()")
        ? normalized.slice(0, normalized.length - 2)
        : normalized;
    return noCall;
}

function collectStateCaptureByObject(args: {
    pag: Pag;
    methods: any[];
    stateFieldSignatures: Set<string>;
}): Map<number, StateCaptureInfo[]> {
    const out = new Map<number, StateCaptureInfo[]>();
    const dedup = new Map<number, Set<string>>();
    const addCapture = (objId: number, info: StateCaptureInfo): void => {
        if (!out.has(objId)) out.set(objId, []);
        if (!dedup.has(objId)) dedup.set(objId, new Set<string>());
        const key = `${info.captureFieldName}|${info.stateFieldSignature}|${info.stateFieldName}|${info.sourceParamIndex ?? -1}`;
        if (dedup.get(objId)!.has(key)) return;
        dedup.get(objId)!.add(key);
        out.get(objId)!.push(info);
    };

    for (const method of args.methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        const localParamIndexByName = new Map<string, number>();
        const localStateFieldByName = new Map<string, { name: string; signature: string; sourceParamIndex?: number }>();

        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();

            if (left instanceof Local) {
                if (right instanceof ArkParameterRef) {
                    localParamIndexByName.set(left.getName(), right.getIndex());
                    continue;
                }
                if (right instanceof ArkInstanceFieldRef) {
                    const rightFieldSig = right.getFieldSignature().toString();
                    if (args.stateFieldSignatures.has(rightFieldSig)) {
                        const rightBase = right.getBase();
                        let sourceParamIndex: number | undefined;
                        if (rightBase instanceof Local) {
                            sourceParamIndex = localParamIndexByName.get(rightBase.getName());
                        }
                        localStateFieldByName.set(left.getName(), {
                            name: right.getFieldSignature().getFieldName(),
                            signature: rightFieldSig,
                            sourceParamIndex,
                        });
                        continue;
                    }
                }
                if (right instanceof Local) {
                    const inheritedParam = localParamIndexByName.get(right.getName());
                    if (inheritedParam !== undefined) {
                        localParamIndexByName.set(left.getName(), inheritedParam);
                    }
                    const inherited = localStateFieldByName.get(right.getName());
                    if (inherited) {
                        localStateFieldByName.set(left.getName(), inherited);
                        continue;
                    }
                }
            }

            if (!(left instanceof ArkInstanceFieldRef)) continue;
            const leftBase = left.getBase();
            const leftFieldName = left.getFieldSignature().getFieldName();

            let stateFieldName: string | undefined;
            let stateFieldSignature: string | undefined;
            let sourceParamIndex: number | undefined;
            if (right instanceof ArkInstanceFieldRef) {
                const rightFieldSig = right.getFieldSignature().toString();
                if (args.stateFieldSignatures.has(rightFieldSig)) {
                    stateFieldName = right.getFieldSignature().getFieldName();
                    stateFieldSignature = rightFieldSig;
                    const rightBase = right.getBase();
                    if (rightBase instanceof Local) {
                        sourceParamIndex = localParamIndexByName.get(rightBase.getName());
                    }
                }
            } else if (right instanceof Local) {
                const inherited = localStateFieldByName.get(right.getName());
                if (inherited) {
                    stateFieldName = inherited.name;
                    stateFieldSignature = inherited.signature;
                    sourceParamIndex = inherited.sourceParamIndex;
                }
            }
            if (!stateFieldName || !stateFieldSignature) continue;

            const leftObjectIds = collectObjectNodeIdsFromValue(args.pag, leftBase);
            if (leftObjectIds.size === 0) continue;

            for (const objId of leftObjectIds) {
                addCapture(objId, {
                    captureFieldName: leftFieldName,
                    stateFieldSignature,
                    stateFieldName,
                    sourceParamIndex,
                });
            }
        }
    }
    return out;
}

function collectStateOwnerObjectIdsByFieldSignature(args: {
    pag: Pag;
    methods: any[];
    stateFieldSignatures: Set<string>;
}): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    const addOwner = (stateFieldSignature: string, objId: number): void => {
        if (!out.has(stateFieldSignature)) out.set(stateFieldSignature, new Set<number>());
        out.get(stateFieldSignature)!.add(objId);
    };

    for (const method of args.methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            const leftFieldSig = left.getFieldSignature().toString();
            if (!args.stateFieldSignatures.has(leftFieldSig)) continue;
            const leftObjectIds = collectObjectNodeIdsFromValue(args.pag, left.getBase());
            for (const objId of leftObjectIds) {
                addOwner(leftFieldSig, objId);
            }
        }
    }

    return out;
}

function collectFieldObjectIdsByFieldSignature(args: {
    pag: Pag;
    methods: any[];
}): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    const add = (fieldSig: string, objId: number): void => {
        if (!out.has(fieldSig)) out.set(fieldSig, new Set<number>());
        out.get(fieldSig)!.add(objId);
    };

    for (const method of args.methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            const refs: ArkInstanceFieldRef[] = [];
            if (left instanceof ArkInstanceFieldRef) refs.push(left);
            if (right instanceof ArkInstanceFieldRef) refs.push(right);
            for (const ref of refs) {
                const fieldSig = ref.getFieldSignature().toString();
                const objectIds = collectObjectNodeIdsFromValue(args.pag, ref.getBase());
                for (const objId of objectIds) {
                    add(fieldSig, objId);
                }
            }
        }
    }
    return out;
}
