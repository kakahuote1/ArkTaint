import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkNewExpr, ArkPtrInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { Decorator } from "../../../arkanalyzer/out/src/core/base/Decorator";
import {
    BuildStateManagementSemanticModelArgs,
    StateManagementSemanticModel,
    StatePropBridgeEdge,
} from "../../core/kernel/contracts/StateManagementModelingProvider";
import { collectObjectNodeIdsFromValue, resolveHarmonyMethods } from "../../core/kernel/contracts/HarmonyModelingUtils";
import {
    collectParameterAssignStmts,
    resolveMethodsFromCallable,
} from "../../core/kernel/contracts/SemanticPack";

const DECORATOR_STATE = "State";
const DECORATOR_PROP = "Prop";
const DECORATOR_LINK = "Link";
const DECORATOR_OBJECT_LINK = "ObjectLink";
const DECORATOR_TRACE = "Trace";
const DECORATOR_LOCAL = "Local";
const DECORATOR_PARAM = "Param";
const DECORATOR_ONCE = "Once";
const DECORATOR_EVENT = "Event";
const DECORATOR_PROVIDE = "Provide";
const DECORATOR_CONSUME = "Consume";
const DECORATOR_PROVIDER = "Provider";
const DECORATOR_CONSUMER = "Consumer";

export type StateManagementModel = StateManagementSemanticModel;
export type BuildStateManagementModelArgs = BuildStateManagementSemanticModelArgs;

interface DecoratedFieldSets {
    bridgeSourceFieldSignatures: Set<string>;
    stateFieldsByClassName: Map<string, Set<string>>;
    propLikeFieldsByClassName: Map<string, Set<string>>;
    linkFieldsByClassName: Map<string, Set<string>>;
    provideFieldsByKey: Map<string, DecoratedKeyFieldInfo[]>;
    consumeFieldsByKey: Map<string, DecoratedKeyFieldInfo[]>;
    eventFieldsByClassName: Map<string, Set<string>>;
}

interface DecoratedKeyFieldInfo {
    className: string;
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
    const classObjectIdsByClassName = collectClassObjectIdsByClassName({
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
            const providerObjIds = fieldObjectIdsByFieldSignature.get(provideField.fieldSignature)
                || classObjectIdsByClassName.get(provideField.className);
            if (!providerObjIds || providerObjIds.size === 0) continue;
            for (const consumeField of consumeFields) {
                const consumerObjIds = fieldObjectIdsByFieldSignature.get(consumeField.fieldSignature)
                    || classObjectIdsByClassName.get(consumeField.className);
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

    // Fallback bridge: only when no capture evidence is recovered from constructor wiring.
    if (stateCaptureByObject.size === 0) {
        for (const [sourceClassName, stateFieldNames] of decorated.stateFieldsByClassName.entries()) {
            const sourceObjIds = classObjectIdsByClassName.get(sourceClassName);
            if (!sourceObjIds || sourceObjIds.size === 0) continue;
            for (const [targetClassName, propLikeFieldNames] of decorated.propLikeFieldsByClassName.entries()) {
                if (targetClassName === sourceClassName) continue;
                const targetObjIds = classObjectIdsByClassName.get(targetClassName);
                if (!targetObjIds || targetObjIds.size === 0) continue;
                const linkFieldNames = decorated.linkFieldsByClassName.get(targetClassName) || new Set<string>();
                for (const fieldName of stateFieldNames) {
                    if (!propLikeFieldNames.has(fieldName)) continue;
                    for (const sourceObjId of sourceObjIds) {
                        for (const targetObjId of targetObjIds) {
                            addBridgeEdge({
                                sourceObjectNodeId: sourceObjId,
                                sourceFieldName: fieldName,
                                targetObjectNodeId: targetObjId,
                                targetFieldName: fieldName,
                                methodSignature: `state-fallback:${sourceClassName}->${targetClassName}.${fieldName}`,
                            });
                            if (linkFieldNames.has(fieldName)) {
                                addBridgeEdge({
                                    sourceObjectNodeId: targetObjId,
                                    sourceFieldName: fieldName,
                                    targetObjectNodeId: sourceObjId,
                                    targetFieldName: fieldName,
                                    methodSignature: `state-link-fallback:${targetClassName}->${sourceClassName}.${fieldName}`,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let stateCaptureAssignCount = 0;
    for (const captures of stateCaptureByObject.values()) {
        stateCaptureAssignCount += captures.length;
    }

    const eventInvokeBridges = collectEventInvokeBridges({
        scene: args.scene,
        pag: args.pag,
        methods,
        eventFieldsByClassName: decorated.eventFieldsByClassName,
    });
    let eventInvokeBridgeCount = 0;
    for (const targets of eventInvokeBridges.values()) {
        eventInvokeBridgeCount += targets.size;
    }

    return {
        edgesBySourceField,
        bridgeEdgeCount,
        constructorCallCount,
        stateCaptureAssignCount,
        eventInvokeBridges,
        eventInvokeBridgeCount,
    };
}


function collectDecoratedFieldSets(scene: Scene): DecoratedFieldSets {
    const bridgeSourceFieldSignatures = new Set<string>();
    const stateFieldsByClassName = new Map<string, Set<string>>();
    const propLikeFieldsByClassName = new Map<string, Set<string>>();
    const linkFieldsByClassName = new Map<string, Set<string>>();
    const provideFieldsByKey = new Map<string, DecoratedKeyFieldInfo[]>();
    const consumeFieldsByKey = new Map<string, DecoratedKeyFieldInfo[]>();
    const eventFieldsByClassName = new Map<string, Set<string>>();

    for (const cls of scene.getClasses()) {
        const className = cls.getName();
        for (const field of cls.getFields()) {
            const decorators = field.getDecorators() || [];
            if (decorators.length === 0) continue;
            for (const decorator of decorators) {
                const kind = normalizeDecoratorKind(decorator);
                if (!kind) continue;
                if (kind === DECORATOR_STATE) {
                    const sig = field.getSignature()?.toString?.() || "";
                    if (sig) bridgeSourceFieldSignatures.add(sig);
                    if (!stateFieldsByClassName.has(className)) {
                        stateFieldsByClassName.set(className, new Set<string>());
                    }
                    stateFieldsByClassName.get(className)!.add(field.getName());
                } else if (
                    kind === DECORATOR_PROP
                    || kind === DECORATOR_LINK
                    || kind === DECORATOR_OBJECT_LINK
                    || kind === DECORATOR_LOCAL
                    || kind === DECORATOR_PARAM
                    || kind === DECORATOR_ONCE
                    || kind === DECORATOR_EVENT
                    || kind === DECORATOR_TRACE
                ) {
                    const sig = field.getSignature()?.toString?.() || "";
                    if (sig) bridgeSourceFieldSignatures.add(sig);
                    if (!propLikeFieldsByClassName.has(className)) {
                        propLikeFieldsByClassName.set(className, new Set<string>());
                    }
                    propLikeFieldsByClassName.get(className)!.add(field.getName());
                    if (kind === DECORATOR_EVENT) {
                        if (!eventFieldsByClassName.has(className)) {
                            eventFieldsByClassName.set(className, new Set<string>());
                        }
                        eventFieldsByClassName.get(className)!.add(field.getName());
                    }
                    if (
                        kind === DECORATOR_LINK
                        || kind === DECORATOR_OBJECT_LINK
                        || kind === DECORATOR_LOCAL
                        || kind === DECORATOR_TRACE
                    ) {
                        if (!linkFieldsByClassName.has(className)) {
                            linkFieldsByClassName.set(className, new Set<string>());
                        }
                        linkFieldsByClassName.get(className)!.add(field.getName());
                    }
                } else if (
                    kind === DECORATOR_PROVIDE
                    || kind === DECORATOR_CONSUME
                    || kind === DECORATOR_PROVIDER
                    || kind === DECORATOR_CONSUMER
                ) {
                    const sig = field.getSignature()?.toString?.() || "";
                    if (!sig) continue;
                    const key = extractDecoratorKey(decorator) || field.getName();
                    const targetMap = (kind === DECORATOR_PROVIDE || kind === DECORATOR_PROVIDER)
                        ? provideFieldsByKey
                        : consumeFieldsByKey;
                    if (!targetMap.has(key)) targetMap.set(key, []);
                    targetMap.get(key)!.push({
                        className,
                        fieldSignature: sig,
                        fieldName: field.getName(),
                    });
                }
            }
        }
    }

    return {
        bridgeSourceFieldSignatures,
        stateFieldsByClassName,
        propLikeFieldsByClassName,
        linkFieldsByClassName,
        provideFieldsByKey,
        consumeFieldsByKey,
        eventFieldsByClassName,
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

function collectEventInvokeBridges(args: {
    scene: Scene;
    pag: Pag;
    methods: any[];
    eventFieldsByClassName: Map<string, Set<string>>;
}): Map<number, Set<number>> {
    const out = new Map<number, Set<number>>();
    if (args.eventFieldsByClassName.size === 0) return out;

    const addBridge = (sourceNodeId: number, targetNodeId: number): void => {
        if (!out.has(sourceNodeId)) out.set(sourceNodeId, new Set<number>());
        out.get(sourceNodeId)!.add(targetNodeId);
    };

    const callbackMethodsByClassAndField = collectEventFieldCallbackMethods(args);

    for (const method of args.methods) {
        const className = method.getDeclaringArkClass?.()?.getName?.() || "";
        if (!className) continue;
        const eventFields = args.eventFieldsByClassName.get(className);
        if (!eventFields || eventFields.size === 0) continue;

        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();

            let fieldName: string | undefined;
            let invokeArgs: any[] = [];

            if (invokeExpr instanceof ArkPtrInvokeExpr) {
                const funcPtr = invokeExpr.getFuncPtrLocal();
                if (!(funcPtr instanceof ArkInstanceFieldRef)) continue;
                const base = funcPtr.getBase();
                if (!(base instanceof Local) || base.getName() !== "this") continue;
                const fname = funcPtr.getFieldSignature?.()?.getFieldName?.() || "";
                if (!eventFields.has(fname)) continue;
                fieldName = fname;
                invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            } else if (invokeExpr instanceof ArkInstanceInvokeExpr) {
                const methodName = invokeExpr.getMethodSignature?.()
                    ?.getMethodSubSignature?.()?.getMethodName?.() || "";
                if (!eventFields.has(methodName)) continue;
                const base = invokeExpr.getBase();
                if (!(base instanceof Local) || base.getName() !== "this") continue;
                fieldName = methodName;
                invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            }

            if (!fieldName || invokeArgs.length === 0) continue;

            const key = `${className}#${fieldName}`;
            const callbackMethods = callbackMethodsByClassAndField.get(key);
            if (!callbackMethods || callbackMethods.length === 0) continue;

            for (let argIndex = 0; argIndex < invokeArgs.length; argIndex++) {
                let argNodeIds = collectNodeIdsFromValue(args.pag, invokeArgs[argIndex]);
                if (argNodeIds.size === 0 && invokeArgs[argIndex] instanceof Local) {
                    argNodeIds = findLocalPagNodeIds(args.pag, method, (invokeArgs[argIndex] as Local).getName());
                }
                if (argNodeIds.size === 0) continue;
                const paramNodeIds = collectCallbackParamNodeIds(
                    args.pag, callbackMethods, argIndex,
                );
                if (paramNodeIds.size === 0) continue;
                for (const sourceId of argNodeIds) {
                    for (const targetId of paramNodeIds) {
                        addBridge(sourceId, targetId);
                    }
                }
            }
        }
    }

    return out;
}

function collectEventFieldCallbackMethods(args: {
    scene: Scene;
    pag: Pag;
    methods: any[];
    eventFieldsByClassName: Map<string, Set<string>>;
}): Map<string, any[]> {
    const out = new Map<string, any[]>();
    const dedup = new Map<string, Set<string>>();

    const addCallback = (key: string, method: any): void => {
        const sig = method.getSignature?.()?.toString?.() || "";
        if (!sig) return;
        if (!dedup.has(key)) dedup.set(key, new Set<string>());
        if (dedup.get(key)!.has(sig)) return;
        dedup.get(key)!.add(sig);
        if (!out.has(key)) out.set(key, []);
        out.get(key)!.push(method);
    };

    for (const method of args.methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

            const calleeSig = invokeExpr.getMethodSignature?.();
            const calleeSigText = calleeSig?.toString?.() || "";
            if (!calleeSigText.includes(".constructor(")) continue;

            const targetClassName = calleeSig?.getDeclaringClassSignature?.()
                ?.getClassName?.() || "";
            if (!targetClassName) continue;
            const eventFields = args.eventFieldsByClassName.get(targetClassName);
            if (!eventFields || eventFields.size === 0) continue;

            const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (invokeArgs.length === 0) continue;

            for (const arg of invokeArgs) {
                if (arg instanceof Local) {
                    resolveEventCallbacksFromArgLocal(
                        args.scene, method, arg, targetClassName, eventFields, addCallback,
                    );
                    continue;
                }
                if (arg instanceof ArkNewExpr) {
                    const className = arg.getClassType?.()?.getClassSignature?.()?.getClassName?.() || "";
                    if (!className) continue;
                    resolveCallbacksFromAnonymousClassInit(
                        args.scene, className, targetClassName, eventFields, addCallback,
                    );
                }
            }
        }
    }

    return out;
}

function resolveEventCallbacksFromArgLocal(
    scene: Scene,
    enclosingMethod: any,
    argLocal: Local,
    targetClassName: string,
    eventFields: Set<string>,
    addCallback: (key: string, method: any) => void,
    visitedLocals: Set<string> = new Set(),
): void {
    const cfg = enclosingMethod.getCfg?.();
    if (!cfg) return;
    const localName = argLocal.getName?.() || argLocal.toString?.() || "<local>";
    const visitKey = `${targetClassName}#${localName}`;
    if (visitedLocals.has(visitKey)) return;
    visitedLocals.add(visitKey);

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        if (left !== argLocal && left.getName() !== argLocal.getName()) continue;

        const right = stmt.getRightOp();

        if (right instanceof ArkInstanceFieldRef) {
            if (right.getBase() === argLocal || (right.getBase() instanceof Local && (right.getBase() as Local).getName() === argLocal.getName())) {
                continue;
            }
        }

        if (right instanceof ArkNewExpr) {
            const classType = right.getClassType();
            const className = classType?.getClassSignature?.()?.getClassName?.() || "";
            if (!className) continue;
            resolveCallbacksFromAnonymousClassInit(
                scene, className, targetClassName, eventFields, addCallback,
            );
            return;
        }
        if (right instanceof Local) {
            resolveEventCallbacksFromArgLocal(
                scene,
                enclosingMethod,
                right,
                targetClassName,
                eventFields,
                addCallback,
                visitedLocals,
            );
            return;
        }
    }

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        const leftBase = left.getBase();
        const sameBase = leftBase === argLocal
            || (leftBase instanceof Local && leftBase.getName?.() === argLocal.getName?.());
        if (!sameBase) continue;
        const fieldName = left.getFieldSignature?.()?.getFieldName?.() || "";
        if (!eventFields.has(fieldName)) continue;

        const right = stmt.getRightOp();
        const callbackMethods = resolveMethodsFromCallable(scene, right, {
            maxCandidates: 8,
        });
        const key = `${targetClassName}#${fieldName}`;
        for (const callbackMethod of callbackMethods) {
            addCallback(key, callbackMethod);
        }
    }
}

function resolveCallbacksFromAnonymousClassInit(
    scene: Scene,
    anonymousClassName: string,
    targetClassName: string,
    eventFields: Set<string>,
    addCallback: (key: string, method: any) => void,
): void {
    for (const method of scene.getMethods()) {
        const cls = method.getDeclaringArkClass?.();
        if (!cls) continue;
        const clsName = cls.getName() || "";
        if (clsName !== anonymousClassName) continue;
        const mname = method.getName() || "";
        if (mname !== "%instInit") continue;

        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            const base = left.getBase();
            if (!(base instanceof Local) || base.getName() !== "this") continue;
            const fieldName = left.getFieldSignature?.()?.getFieldName?.() || "";
            if (!eventFields.has(fieldName)) continue;

            const right = stmt.getRightOp();
            const callbackMethods = resolveMethodsFromCallable(scene, right, {
                maxCandidates: 8,
            });
            const key = `${targetClassName}#${fieldName}`;
            for (const callbackMethod of callbackMethods) {
                addCallback(key, callbackMethod);
            }
        }
        break;
    }
}

function collectNodeIdsFromValue(pag: Pag, value: any): Set<number> {
    const out = new Set<number>();
    const nodes = pag.getNodesByValue(value);
    if (nodes && nodes.size > 0) {
        for (const nodeId of nodes.values()) out.add(nodeId);
    }
    return out;
}

function findLocalPagNodeIds(pag: Pag, method: any, localName: string): Set<number> {
    const out = new Set<number>();
    const cfg = method.getCfg?.();
    if (!cfg) return out;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        if (left.getName() !== localName) continue;
        let nodes = pag.getNodesByValue(left);
        if (!nodes || nodes.size === 0) {
            try { pag.addPagNode(0, left, stmt); } catch { /* */ }
            nodes = pag.getNodesByValue(left);
        }
        if (nodes && nodes.size > 0) {
            for (const nodeId of nodes.values()) out.add(nodeId);
        }
    }
    return out;
}

function collectCallbackParamNodeIds(
    pag: Pag,
    callbackMethods: any[],
    paramIndex: number,
): Set<number> {
    const out = new Set<number>();
    for (const callbackMethod of callbackMethods) {
        const paramStmts = collectParameterAssignStmts(callbackMethod)
            .filter(s => (s.getRightOp() as ArkParameterRef).getIndex() === paramIndex);
        if (paramStmts.length === 0) {
            const cfg = callbackMethod.getCfg?.();
            if (!cfg) continue;
            for (const stmt of cfg.getStmts()) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const right = stmt.getRightOp();
                if (!(right instanceof ArkParameterRef) || right.getIndex() !== paramIndex) continue;
                const left = stmt.getLeftOp();
                let nodes = pag.getNodesByValue(left);
                if ((!nodes || nodes.size === 0) && left instanceof Local) {
                    try { pag.addPagNode(0, left, stmt); } catch { /* */ }
                    nodes = pag.getNodesByValue(left);
                }
                if (!nodes || nodes.size === 0) continue;
                for (const nodeId of nodes.values()) out.add(nodeId);
            }
            continue;
        }
        for (const paramStmt of paramStmts) {
            const left = paramStmt.getLeftOp();
            let nodes = pag.getNodesByValue(left);
            if ((!nodes || nodes.size === 0) && left instanceof Local) {
                try { pag.addPagNode(0, left, paramStmt); } catch { /* */ }
                nodes = pag.getNodesByValue(left);
            }
            if (!nodes || nodes.size === 0) continue;
            for (const nodeId of nodes.values()) out.add(nodeId);
        }
    }
    return out;
}

function collectClassObjectIdsByClassName(args: {
    pag: Pag;
    methods: any[];
}): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    const add = (className: string, objId: number): void => {
        if (!className) return;
        if (!out.has(className)) out.set(className, new Set<number>());
        out.get(className)!.add(objId);
    };

    for (const method of args.methods) {
        const className = method.getDeclaringArkClass?.()?.getName?.() || "";
        if (!className) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof Local) || left.getName() !== "this") continue;
            const objectIds = collectObjectNodeIdsFromValue(args.pag, left);
            if (objectIds.size > 0) {
                for (const objId of objectIds) {
                    add(className, objId);
                }
                continue;
            }
            const carrierNodes = args.pag.getNodesByValue(left);
            if (!carrierNodes) continue;
            for (const nodeId of carrierNodes.values()) {
                add(className, nodeId);
            }
        }
    }
    return out;
}
