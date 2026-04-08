import { Scene } from "../../../../arkanalyzer/lib/Scene";
import { Pag, PagNode } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/lib/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/lib/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkNewExpr, ArkPtrInvokeExpr } from "../../../../arkanalyzer/lib/core/base/Expr";
import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import { Decorator } from "../../../../arkanalyzer/lib/core/base/Decorator";
import {
    defineModule,
    type TaintModule,
} from "../../../core/kernel/contracts/ModuleApi";
import type {
    BuildStateManagementSemanticModelArgs,
    StateManagementSemanticModel,
    StatePropBridgeEdge,
} from "../../../core/kernel/contracts/StateModuleProvider";
import {
    addMapSetValue,
    collectObjectNodeIdsFromValue,
    resolveHarmonyMethods,
} from "../../../core/kernel/contracts/HarmonyModuleUtils";
import { safeGetOrCreatePagNodes } from "../../../core/kernel/contracts/PagNodeResolution";

export const harmonyStateModule: TaintModule = defineModule({
    id: "harmony.state",
    description: "Built-in Harmony state/prop/link/provide-consume bridges.",
    setup(ctx) {
        const model = buildStateManagementModel({
            scene: ctx.raw.scene,
            pag: ctx.raw.pag,
            allowedMethodSignatures: ctx.raw.allowedMethodSignatures,
            callbacks: ctx.callbacks,
        });
        ctx.debug.summary("Harmony-State", {
            bridge_edges: model.bridgeEdgeCount,
            constructor_calls: model.constructorCallCount,
            state_capture_fields: model.stateCaptureAssignCount,
            event_invoke_bridges: model.eventInvokeBridgeCount,
        });
        return {
            onFact(event) {
                const emissions = event.emit.collector();

                const eventTargets = model.eventInvokeBridges.get(event.current.nodeId);
                if (eventTargets && eventTargets.size > 0) {
                    emissions.push(event.emit.preserveToNodes(
                        eventTargets,
                        "Harmony-StateEvent",
                        { allowUnreachableTarget: true },
                    ));
                }

                const sourceFieldName = event.current.fieldHead();
                if (sourceFieldName) {
                    const sourceKey = `${event.current.nodeId}#${sourceFieldName}`;
                    const bridgeEdges = model.edgesBySourceField.get(sourceKey) || [];
                    const targetLoadNodeIds = model.targetFieldLoadNodeIdsBySourceField.get(sourceKey);
                    for (const edge of bridgeEdges) {
                        const fieldTail = event.current.fieldTail();
                        const targetFieldPath = fieldTail && fieldTail.length > 0
                            ? [edge.targetFieldName, ...fieldTail]
                            : [edge.targetFieldName];
                        emissions.push(event.emit.toField(
                            edge.targetNodeId,
                            targetFieldPath,
                            "Harmony-StateProp",
                        ));
                    }
                    if (targetLoadNodeIds && targetLoadNodeIds.size > 0) {
                        emissions.push(event.emit.toCurrentFieldTailNodes(
                            targetLoadNodeIds,
                            "Harmony-StateLoad",
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
    const methods = resolveStateManagementModelMethods(
        args.scene,
        decorated,
        args.allowedMethodSignatures,
    );

    const stateCaptureByObjectNode = collectStateCaptureByObjectNode({
        pag: args.pag,
        methods,
        stateFieldSignatures: decorated.bridgeSourceFieldSignatures,
    });
    const stateOwnerObjectNodeIdsByFieldSignature = collectStateOwnerObjectNodeIdsByFieldSignature({
        pag: args.pag,
        methods,
        stateFieldSignatures: decorated.bridgeSourceFieldSignatures,
    });
    const fieldObjectNodeIdsByFieldSignature = collectFieldObjectNodeIdsByFieldSignature({
        pag: args.pag,
        methods,
    });
    const classObjectNodeIdsByClassName = collectClassObjectNodeIdsByClassName({
        pag: args.pag,
        methods,
    });
    const fieldLoadNodeIdsByClassFieldKey = collectFieldLoadNodeIdsByClassFieldKey({
        pag: args.pag,
        methods,
    });

    const edgesBySourceField = new Map<string, StatePropBridgeEdge[]>();
    const targetFieldLoadNodeIdsBySourceField = new Map<string, Set<number>>();
    const dedup = new Set<string>();
    let constructorCallCount = 0;
    let bridgeEdgeCount = 0;

    const addBridgeEdge = (edge: StatePropBridgeEdge): void => {
        const sourceKey = `${edge.sourceNodeId}#${edge.sourceFieldName}`;
        const dedupKey = `${sourceKey}->${edge.targetNodeId}#${edge.targetFieldName}`;
        if (dedup.has(dedupKey)) return;
        dedup.add(dedupKey);
        if (!edgesBySourceField.has(sourceKey)) edgesBySourceField.set(sourceKey, []);
        edgesBySourceField.get(sourceKey)!.push(edge);
        bridgeEdgeCount++;
    };
    const addLoadBridge = (
        sourceNodeId: number,
        sourceFieldName: string,
        targetClassName: string,
        targetFieldName: string,
    ): void => {
        if (!targetClassName || !targetFieldName) return;
        const targetNodeIds = fieldLoadNodeIdsByClassFieldKey.get(`${targetClassName}#${targetFieldName}`);
        if (!targetNodeIds || targetNodeIds.size === 0) return;
        const sourceKey = `${sourceNodeId}#${sourceFieldName}`;
        for (const targetNodeId of targetNodeIds) {
            addMapSetValue(targetFieldLoadNodeIdsBySourceField, sourceKey, targetNodeId);
        }
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

            const targetNodeIds = collectObjectNodeIdsFromValue(args.pag, invokeExpr.getBase());
            if (targetNodeIds.size === 0) continue;

            const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (invokeArgs.length === 0) continue;

            for (let argIndex = 0; argIndex < invokeArgs.length; argIndex++) {
                const arg = invokeArgs[argIndex];
                const sourceNodeIds = collectObjectNodeIdsFromValue(args.pag, arg);
                if (sourceNodeIds.size === 0) continue;
                for (const sourceNodeId of sourceNodeIds) {
                    const captures = stateCaptureByObjectNode.get(sourceNodeId);
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
                        const sourceBridgeNodeIds = new Set<number>();
                        const stateOwnerNodeIds = stateOwnerObjectNodeIdsByFieldSignature.get(capture.stateFieldSignature);
                        if (stateOwnerNodeIds && stateOwnerNodeIds.size > 0) {
                            for (const stateOwnerNodeId of stateOwnerNodeIds) {
                                sourceBridgeNodeIds.add(stateOwnerNodeId);
                            }
                        }
                        if (sourceBridgeNodeIds.size === 0) {
                            sourceBridgeNodeIds.add(sourceNodeId);
                        }
                        for (const targetNodeId of targetNodeIds) {
                            for (const sourceBridgeNodeId of sourceBridgeNodeIds) {
                                if (isPropLike) {
                                    addBridgeEdge({
                                        sourceNodeId: sourceBridgeNodeId,
                                        sourceFieldName: capture.stateFieldName,
                                        targetNodeId,
                                        targetFieldName: capture.captureFieldName,
                                        methodSignature: method.getSignature().toString(),
                                    });
                                }
                                if (isLink) {
                                    addBridgeEdge({
                                        sourceNodeId: targetNodeId,
                                        sourceFieldName: capture.captureFieldName,
                                        targetNodeId: sourceBridgeNodeId,
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
            const providerNodeIds = fieldObjectNodeIdsByFieldSignature.get(provideField.fieldSignature)
                || classObjectNodeIdsByClassName.get(provideField.className);
            if (!providerNodeIds || providerNodeIds.size === 0) continue;
            for (const consumeField of consumeFields) {
                for (const providerNodeId of providerNodeIds) {
                    addLoadBridge(
                        providerNodeId,
                        provideField.fieldName,
                        consumeField.className,
                        consumeField.fieldName,
                    );
                }
                const consumerNodeIds = fieldObjectNodeIdsByFieldSignature.get(consumeField.fieldSignature)
                    || classObjectNodeIdsByClassName.get(consumeField.className);
                if (!consumerNodeIds || consumerNodeIds.size === 0) continue;
                for (const providerNodeId of providerNodeIds) {
                    for (const consumerNodeId of consumerNodeIds) {
                        addBridgeEdge({
                            sourceNodeId: providerNodeId,
                            sourceFieldName: provideField.fieldName,
                            targetNodeId: consumerNodeId,
                            targetFieldName: consumeField.fieldName,
                            methodSignature: `provide-consume:${key}`,
                        });
                    }
                }
            }
        }
    }

    // Fallback bridge: decorator-only composition still needs to work in case-view projects
    // where there is no explicit constructor wiring between parent/child classes.
    for (const [sourceClassName, stateFieldNames] of decorated.stateFieldsByClassName.entries()) {
        const sourceNodeIds = classObjectNodeIdsByClassName.get(sourceClassName);
        if (!sourceNodeIds || sourceNodeIds.size === 0) continue;
        for (const [targetClassName, propLikeFieldNames] of decorated.propLikeFieldsByClassName.entries()) {
            if (targetClassName === sourceClassName) continue;
            const targetNodeIds = classObjectNodeIdsByClassName.get(targetClassName) || new Set<number>();
            const shouldUseClassFallback = targetNodeIds.size === 0;
            if (!shouldUseClassFallback) {
                continue;
            }
            const linkFieldNames = decorated.linkFieldsByClassName.get(targetClassName) || new Set<string>();
            for (const fieldName of stateFieldNames) {
                if (!propLikeFieldNames.has(fieldName)) continue;
                for (const sourceNodeId of sourceNodeIds) {
                    addLoadBridge(
                        sourceNodeId,
                        fieldName,
                        targetClassName,
                        fieldName,
                    );
                    for (const targetNodeId of targetNodeIds) {
                        addBridgeEdge({
                            sourceNodeId,
                            sourceFieldName: fieldName,
                            targetNodeId,
                            targetFieldName: fieldName,
                            methodSignature: `state-fallback:${sourceClassName}->${targetClassName}.${fieldName}`,
                        });
                        if (linkFieldNames.has(fieldName)) {
                            addBridgeEdge({
                                sourceNodeId: targetNodeId,
                                sourceFieldName: fieldName,
                                targetNodeId: sourceNodeId,
                                targetFieldName: fieldName,
                                methodSignature: `state-link-fallback:${targetClassName}->${sourceClassName}.${fieldName}`,
                            });
                            addLoadBridge(
                                targetNodeId,
                                fieldName,
                                sourceClassName,
                                fieldName,
                            );
                        }
                    }
                }
            }
        }
    }

    let stateCaptureAssignCount = 0;
    for (const captures of stateCaptureByObjectNode.values()) {
        stateCaptureAssignCount += captures.length;
    }

    const eventInvokeBridges = collectEventInvokeBridges({
        scene: args.scene,
        pag: args.pag,
        methods,
        eventFieldsByClassName: decorated.eventFieldsByClassName,
        callbacks: args.callbacks,
    });
    let eventInvokeBridgeCount = 0;
    for (const targets of eventInvokeBridges.values()) {
        eventInvokeBridgeCount += targets.size;
    }

    return {
        edgesBySourceField,
        targetFieldLoadNodeIdsBySourceField,
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

function resolveStateManagementModelMethods(
    scene: Scene,
    decorated: DecoratedFieldSets,
    allowedMethodSignatures?: Set<string>,
): any[] {
    const decoratedClassNames = new Set<string>([
        ...decorated.stateFieldsByClassName.keys(),
        ...decorated.propLikeFieldsByClassName.keys(),
        ...decorated.linkFieldsByClassName.keys(),
        ...decorated.eventFieldsByClassName.keys(),
    ]);
    for (const fields of decorated.provideFieldsByKey.values()) {
        for (const field of fields) decoratedClassNames.add(field.className);
    }
    for (const fields of decorated.consumeFieldsByKey.values()) {
        for (const field of fields) decoratedClassNames.add(field.className);
    }

    return resolveHarmonyMethods(scene).filter(method => {
        const signature = method.getSignature?.()?.toString?.() || "";
        if (allowedMethodSignatures?.has(signature)) {
            return true;
        }
        const className = method.getDeclaringArkClass?.()?.getName?.() || "";
        return className.length > 0 && decoratedClassNames.has(className);
    });
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

function collectStateCaptureByObjectNode(args: {
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

            const leftNodeIds = collectObjectNodeIdsFromValue(args.pag, leftBase);
            if (leftNodeIds.size === 0) continue;

            for (const nodeId of leftNodeIds) {
                addCapture(nodeId, {
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

function collectStateOwnerObjectNodeIdsByFieldSignature(args: {
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
        if (shouldIgnoreStateCarrierMethod(method)) continue;
        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            const leftFieldSig = left.getFieldSignature().toString();
            if (!args.stateFieldSignatures.has(leftFieldSig)) continue;
            const leftNodeIds = collectObjectNodeIdsFromValueInMethod(args.pag, method, left.getBase());
            for (const nodeId of leftNodeIds) {
                addOwner(leftFieldSig, nodeId);
            }
        }
    }

    return out;
}

function collectFieldObjectNodeIdsByFieldSignature(args: {
    pag: Pag;
    methods: any[];
}): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    const add = (fieldSig: string, objId: number): void => {
        if (!out.has(fieldSig)) out.set(fieldSig, new Set<number>());
        out.get(fieldSig)!.add(objId);
    };

    for (const method of args.methods) {
        if (shouldIgnoreStateCarrierMethod(method)) continue;
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
                const nodeIds = collectObjectNodeIdsFromValueInMethod(args.pag, method, ref.getBase());
                for (const nodeId of nodeIds) {
                    add(fieldSig, nodeId);
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
    callbacks: BuildStateManagementModelArgs["callbacks"];
}): Map<number, Set<number>> {
    const out = new Map<number, Set<number>>();
    if (args.eventFieldsByClassName.size === 0) return out;

    const addBridge = (sourceNodeId: number, targetNodeId: number): void => {
        if (!out.has(sourceNodeId)) out.set(sourceNodeId, new Set<number>());
        out.get(sourceNodeId)!.add(targetNodeId);
    };

    const callbackParamNodeIdsByClassAndField = collectEventFieldCallbackParamNodeIds(args);

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
            const callbackParamNodeIds = callbackParamNodeIdsByClassAndField.get(key);
            if (!callbackParamNodeIds || callbackParamNodeIds.size === 0) continue;

            for (let argIndex = 0; argIndex < invokeArgs.length; argIndex++) {
                let argNodeIds = collectNodeIdsFromValue(args.pag, invokeArgs[argIndex]);
                if (argNodeIds.size === 0 && invokeArgs[argIndex] instanceof Local) {
                    argNodeIds = findLocalPagNodeIds(args.pag, method, (invokeArgs[argIndex] as Local).getName());
                }
                if (argNodeIds.size === 0) continue;
                for (const sourceId of argNodeIds) {
                    for (const targetId of callbackParamNodeIds) {
                        addBridge(sourceId, targetId);
                    }
                }
            }
        }
    }

    return out;
}

function collectEventFieldCallbackParamNodeIds(args: {
    scene: Scene;
    pag: Pag;
    methods: any[];
    eventFieldsByClassName: Map<string, Set<string>>;
    callbacks: BuildStateManagementModelArgs["callbacks"];
}): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();

    const addCallbackParamNodes = (key: string, callbackValue: any): void => {
        for (const binding of args.callbacks.paramBindings(callbackValue, 0, { maxCandidates: 8 })) {
            for (const nodeId of binding.localNodeIds()) {
                addMapSetValue(out, key, nodeId);
            }
        }
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
                        args.scene, method, arg, targetClassName, eventFields, addCallbackParamNodes,
                        args.callbacks,
                    );
                    continue;
                }
                if (arg instanceof ArkNewExpr) {
                    const className = arg.getClassType?.()?.getClassSignature?.()?.getClassName?.() || "";
                    if (!className) continue;
                    resolveCallbacksFromAnonymousClassInit(
                        args.scene, className, targetClassName, eventFields, addCallbackParamNodes,
                        args.callbacks,
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
    addCallbackParamNodes: (key: string, callbackValue: any) => void,
    callbacks: BuildStateManagementModelArgs["callbacks"],
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
                scene, className, targetClassName, eventFields, addCallbackParamNodes, callbacks,
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
                addCallbackParamNodes,
                callbacks,
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
        const key = `${targetClassName}#${fieldName}`;
        addCallbackParamNodes(key, right);
    }
}

function resolveCallbacksFromAnonymousClassInit(
    scene: Scene,
    anonymousClassName: string,
    targetClassName: string,
    eventFields: Set<string>,
    addCallbackParamNodes: (key: string, callbackValue: any) => void,
    callbacks: BuildStateManagementModelArgs["callbacks"],
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
            const key = `${targetClassName}#${fieldName}`;
            addCallbackParamNodes(key, right);
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
        const nodes = safeGetOrCreatePagNodes(pag, left, stmt);
        if (nodes && nodes.size > 0) {
            for (const nodeId of nodes.values()) out.add(nodeId);
        }
    }
    return out;
}

function collectClassObjectNodeIdsByClassName(args: {
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
        if (shouldIgnoreStateCarrierMethod(method)) continue;
        const className = method.getDeclaringArkClass?.()?.getName?.() || "";
        if (!className) continue;
        const thisNodeIds = collectMethodThisObjectNodeIds(args.pag, method);
        for (const nodeId of thisNodeIds) {
            add(className, nodeId);
        }
    }
    return out;
}

function collectFieldLoadNodeIdsByClassFieldKey(args: {
    pag: Pag;
    methods: any[];
}): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();

    for (const method of args.methods) {
        if (shouldIgnoreStateCarrierMethod(method)) continue;
        const className = method.getDeclaringArkClass?.()?.getName?.() || "";
        if (!className) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(right instanceof ArkInstanceFieldRef)) continue;
            if (!(left instanceof Local)) continue;
            const base = right.getBase?.();
            if (!(base instanceof Local) || base.getName() !== "this") continue;
            const fieldName = right.getFieldSignature?.()?.getFieldName?.() || "";
            if (!fieldName) continue;
            const loadNodeIds = safeGetOrCreatePagNodes(args.pag, left, stmt);
            if (!loadNodeIds || loadNodeIds.size === 0) continue;
            for (const nodeId of loadNodeIds.values()) {
                addMapSetValue(out, `${className}#${fieldName}`, nodeId);
            }
        }
    }

    return out;
}

function shouldIgnoreStateCarrierMethod(method: any): boolean {
    const methodName = method?.getName?.() || "";
    if (methodName === "%statInit" || methodName === "%dflt") {
        return true;
    }
    const methodSig = method?.getSignature?.()?.toString?.() || "";
    return methodSig.includes(".%statInit(") || methodSig.includes(".%dflt(");
}

function collectObjectNodeIdsFromValueInMethod(pag: Pag, method: any, value: any): Set<number> {
    const nodeIds = collectObjectNodeIdsFromValue(pag, value);
    if (nodeIds.size > 0) {
        return nodeIds;
    }
    if (!(value instanceof Local) || value.getName() !== "this") {
        return nodeIds;
    }
    return collectMethodThisObjectNodeIds(pag, method);
}

function collectMethodThisObjectNodeIds(pag: Pag, method: any): Set<number> {
    const out = new Set<number>();
    const body = method?.getBody?.();
    const thisLocal = body?.getLocals?.()?.get?.("this");
    if (thisLocal instanceof Local) {
        const nodes = collectObjectNodeIdsFromValue(pag, thisLocal);
        for (const nodeId of nodes) {
            out.add(nodeId);
        }
        if (out.size > 0) {
            return out;
        }
        const carrierNodes = pag.getNodesByValue(thisLocal);
        if (carrierNodes) {
            for (const nodeId of carrierNodes.values()) {
                const carrier = pag.getNode(nodeId) as PagNode | undefined;
                const pointTo = carrier?.getPointTo?.() || [];
                for (const objectNodeId of pointTo) {
                    out.add(objectNodeId);
                }
            }
            if (out.size > 0) {
                return out;
            }
        }
    }

    const cfg = method?.getCfg?.();
    if (!cfg) return out;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local) || left.getName() !== "this") continue;
        const nodes = collectObjectNodeIdsFromValue(pag, left);
        for (const nodeId of nodes) {
            out.add(nodeId);
        }
        if (out.size > 0) continue;
        const carrierNodes = pag.getNodesByValue(left);
        if (!carrierNodes) continue;
        for (const nodeId of carrierNodes.values()) {
            const carrier = pag.getNode(nodeId) as PagNode | undefined;
            const pointTo = carrier?.getPointTo?.() || [];
            for (const objectNodeId of pointTo) {
                out.add(objectNodeId);
            }
        }
    }
    return out;
}

export default harmonyStateModule;

