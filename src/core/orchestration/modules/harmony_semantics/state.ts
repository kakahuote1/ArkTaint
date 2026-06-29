import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkNewExpr, ArkPtrInvokeExpr } from "../../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../../arkanalyzer/out/src/core/base/Local";
import {
    defineModule,
    type TaintModule,
} from "../../../kernel/contracts/ModuleApi";
import type {
    BuildStateManagementSemanticModelArgs,
    StateManagementSemanticModel,
    StatePropBridgeEdge,
} from "../../../kernel/contracts/StateModuleProvider";
import {
    addMapSetValue,
    collectObjectNodeIdsFromValue,
    collectObjectNodeIdsFromValueInMethod,
    collectMethodThisObjectNodeIds,
    resolveHarmonyMethods,
} from "../../../kernel/contracts/HarmonyModuleUtils";
import { resolveExistingPagNodes } from "../../../kernel/contracts/PagNodeResolution";
import { createHandoffPropagationSession } from "../../../kernel/semantic_handoff/SemanticHandoffPropagation";
import { createExactHandoffHandle, HandoffEffect } from "../../../kernel/semantic_handoff/SemanticHandoffTypes";

export interface HarmonyStateBindingSemanticsOptions {
    id?: string;
    description?: string;
    stateDecoratorCanonicalApiIds?: string[];
    propDecoratorCanonicalApiIds?: string[];
    linkDecoratorCanonicalApiIds?: string[];
    provideDecoratorCanonicalApiIds?: string[];
    consumeDecoratorCanonicalApiIds?: string[];
    eventDecoratorCanonicalApiIds?: string[];
}

const DEFAULT_STATE_OPTIONS: Required<HarmonyStateBindingSemanticsOptions> = {
    id: "harmony.state",
    description: "Built-in Harmony state/prop/link/provide-consume bridges.",
    stateDecoratorCanonicalApiIds: [],
    propDecoratorCanonicalApiIds: [],
    linkDecoratorCanonicalApiIds: [],
    provideDecoratorCanonicalApiIds: [],
    consumeDecoratorCanonicalApiIds: [],
    eventDecoratorCanonicalApiIds: [],
};

interface BuildStateManagementInternalOptions {
    stateDecoratorCanonicalApiIds: Set<string>;
    propDecoratorCanonicalApiIds: Set<string>;
    linkDecoratorCanonicalApiIds: Set<string>;
    provideDecoratorCanonicalApiIds: Set<string>;
    consumeDecoratorCanonicalApiIds: Set<string>;
    eventDecoratorCanonicalApiIds: Set<string>;
}

export function createHarmonyStateBindingSemanticModule(
    options: HarmonyStateBindingSemanticsOptions = {},
): TaintModule {
    const resolved = {
        ...DEFAULT_STATE_OPTIONS,
        ...options,
        stateDecoratorCanonicalApiIds: options.stateDecoratorCanonicalApiIds && options.stateDecoratorCanonicalApiIds.length > 0
            ? [...options.stateDecoratorCanonicalApiIds]
            : [...DEFAULT_STATE_OPTIONS.stateDecoratorCanonicalApiIds],
        propDecoratorCanonicalApiIds: options.propDecoratorCanonicalApiIds && options.propDecoratorCanonicalApiIds.length > 0
            ? [...options.propDecoratorCanonicalApiIds]
            : [...DEFAULT_STATE_OPTIONS.propDecoratorCanonicalApiIds],
        linkDecoratorCanonicalApiIds: options.linkDecoratorCanonicalApiIds && options.linkDecoratorCanonicalApiIds.length > 0
            ? [...options.linkDecoratorCanonicalApiIds]
            : [...DEFAULT_STATE_OPTIONS.linkDecoratorCanonicalApiIds],
        provideDecoratorCanonicalApiIds: options.provideDecoratorCanonicalApiIds && options.provideDecoratorCanonicalApiIds.length > 0
            ? [...options.provideDecoratorCanonicalApiIds]
            : [...DEFAULT_STATE_OPTIONS.provideDecoratorCanonicalApiIds],
        consumeDecoratorCanonicalApiIds: options.consumeDecoratorCanonicalApiIds && options.consumeDecoratorCanonicalApiIds.length > 0
            ? [...options.consumeDecoratorCanonicalApiIds]
            : [...DEFAULT_STATE_OPTIONS.consumeDecoratorCanonicalApiIds],
        eventDecoratorCanonicalApiIds: options.eventDecoratorCanonicalApiIds && options.eventDecoratorCanonicalApiIds.length > 0
            ? [...options.eventDecoratorCanonicalApiIds]
            : [...DEFAULT_STATE_OPTIONS.eventDecoratorCanonicalApiIds],
    };
    const internalOptions: BuildStateManagementInternalOptions = {
        stateDecoratorCanonicalApiIds: new Set(resolved.stateDecoratorCanonicalApiIds),
        propDecoratorCanonicalApiIds: new Set(resolved.propDecoratorCanonicalApiIds),
        linkDecoratorCanonicalApiIds: new Set(resolved.linkDecoratorCanonicalApiIds),
        provideDecoratorCanonicalApiIds: new Set(resolved.provideDecoratorCanonicalApiIds),
        consumeDecoratorCanonicalApiIds: new Set(resolved.consumeDecoratorCanonicalApiIds),
        eventDecoratorCanonicalApiIds: new Set(resolved.eventDecoratorCanonicalApiIds),
    };

    return defineModule({
        id: resolved.id,
        description: resolved.description,
        setup(ctx) {
            const model = buildStateManagementModel({
                scene: ctx.raw.scene,
                pag: ctx.raw.pag,
                allowedMethodSignatures: ctx.raw.allowedMethodSignatures,
                callbacks: ctx.callbacks,
                scan: ctx.scan,
            }, internalOptions);
            const handoff = createHandoffPropagationSession(buildStateHandoffEffects(model), {
                currentnessAnalysis: ctx.raw.currentnessAnalysis,
            });
            for (const binding of model.eventDeferredBindings) {
                ctx.deferred.declarative({
                    sourceMethod: binding.sourceMethod,
                    handlerMethod: binding.handlerMethod,
                    anchorStmt: binding.anchorStmt,
                    triggerLabel: binding.triggerLabel,
                    activationSource: { kind: "arg", index: 0 },
                    payloadSource: { kind: "arg", index: 0 },
                    reason: `Harmony state event dispatch ${binding.triggerLabel}`,
                });
            }
            ctx.debug.summary("Harmony-State", {
                decorator_occurrences: ctx.raw.canonicalDecoratorOccurrences?.length || 0,
                bridge_edges: model.bridgeEdgeCount,
                constructor_calls: model.constructorCallCount,
                state_capture_fields: model.stateCaptureAssignCount,
                event_invoke_bridges: model.eventInvokeBridgeCount,
                event_deferred_bindings: model.eventDeferredBindings.length,
            });
            return {
                onFact(event) {
                    return handoff.emitForFact(event);
                },
            };
        },
    });
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.map(item => String(item || "").trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}

export const harmonyStateSemanticModule = createHarmonyStateBindingSemanticModule();
export const harmonyStateModule: TaintModule = harmonyStateSemanticModule;

export type StateManagementModel = StateManagementSemanticModel;
export type BuildStateManagementModelArgs = BuildStateManagementSemanticModelArgs;

const STATE_SLOT_HANDOFF_FAMILY = "harmony.state.slot";
const STATE_EVENT_HANDOFF_FAMILY = "harmony.state.event";
const STATE_SLOT_CELL_KIND = "reactive-state-slot";
const STATE_EVENT_CELL_KIND = "message-channel-slot";

function buildStateHandoffEffects(model: StateManagementModel): HandoffEffect[] {
    const effects: HandoffEffect[] = [];

    for (const [sourceNodeId, targetNodeIds] of model.eventInvokeBridges.entries()) {
        const handle = createExactHandoffHandle(STATE_EVENT_CELL_KIND, STATE_EVENT_HANDOFF_FAMILY, `event-source:${sourceNodeId}`);
        effects.push({
            kind: "put",
            handle,
            source: { nodeId: sourceNodeId },
            reason: "Harmony-StateEvent",
            originModel: "harmony.state",
        });
        for (const targetNodeId of targetNodeIds) {
            effects.push({
                kind: "get",
                handle,
                target: {
                    nodeId: targetNodeId,
                    allowUnreachableTarget: true,
                },
                reason: "Harmony-StateEvent",
                originModel: "harmony.state",
            });
        }
    }

    const linkedPairs = new Set<string>();
    for (const [sourceKey, bridgeEdges] of model.edgesBySourceField.entries()) {
        const [sourceNodeIdText, sourceFieldName] = sourceKey.split("#");
        const sourceNodeId = Number(sourceNodeIdText);
        if (!Number.isFinite(sourceNodeId) || !sourceFieldName) continue;
        const sourceHandle = createExactHandoffHandle(
            STATE_SLOT_CELL_KIND,
            STATE_SLOT_HANDOFF_FAMILY,
            `node:${sourceNodeId}#field:${sourceFieldName}`,
        );
        effects.push({
            kind: "put",
            handle: sourceHandle,
            source: { nodeId: sourceNodeId, fieldHead: sourceFieldName },
            reason: "Harmony-StateProp",
            originModel: "harmony.state",
        });

        for (const edge of bridgeEdges) {
            const targetHandle = createExactHandoffHandle(
                STATE_SLOT_CELL_KIND,
                STATE_SLOT_HANDOFF_FAMILY,
                `node:${edge.targetNodeId}#field:${edge.targetFieldName}`,
            );
            addScopedLinkEffect(effects, linkedPairs, sourceHandle, targetHandle, "Harmony-StateProp", edge.methodSignature);
            effects.push({
                kind: "get",
                handle: targetHandle,
                target: {
                    nodeId: edge.targetNodeId,
                    currentField: {
                        mode: "prefix",
                        prefix: [edge.targetFieldName],
                        stripPrefixes: [[edge.sourceFieldName]],
                        requireField: true,
                        scalarAlias: edge.scalarAlias,
                    },
                },
                reason: "Harmony-StateProp",
                originModel: "harmony.state",
            });
        }

        const targetLoadNodeIds = model.targetFieldLoadNodeIdsBySourceField.get(sourceKey);
        if (targetLoadNodeIds && targetLoadNodeIds.size > 0) {
            const scalarSource = model.scalarBridgeSourceFields.has(sourceKey);
            const loadHandle = createExactHandoffHandle(
                STATE_SLOT_CELL_KIND,
                STATE_SLOT_HANDOFF_FAMILY,
                `load:${sourceKey}`,
            );
            addScopedLinkEffect(effects, linkedPairs, sourceHandle, loadHandle, "Harmony-StateLoad", sourceKey);
            for (const targetNodeId of targetLoadNodeIds) {
                effects.push({
                    kind: "put",
                    handle: loadHandle,
                    source: { nodeId: targetNodeId },
                    reason: "Harmony-StateLoad",
                    originModel: "harmony.state",
                });
                effects.push({
                    kind: "get",
                    handle: loadHandle,
                    target: {
                        nodeId: targetNodeId,
                        currentField: {
                            mode: "preserve",
                            stripPrefixes: scalarSource ? [[sourceFieldName]] : undefined,
                            requireField: true,
                            scalarAlias: scalarSource,
                        },
                        allowUnreachableTarget: true,
                    },
                    reason: "Harmony-StateLoad",
                    originModel: "harmony.state",
                });
            }
        }
    }

    return effects;
}

function addScopedLinkEffect(
    effects: HandoffEffect[],
    seen: Set<string>,
    left: ReturnType<typeof createExactHandoffHandle>,
    right: ReturnType<typeof createExactHandoffHandle>,
    reason: string,
    scopeId: string,
): void {
    const key = `${left.family}|${left.scope}|${left.key}->${right.family}|${right.scope}|${right.key}`;
    if (seen.has(key)) return;
    seen.add(key);
    effects.push({
        kind: "scoped-link",
        left,
        right,
        reason,
        scopeId,
        originModel: "harmony.state",
    });
}

interface DecoratedFieldSets {
    bridgeSourceFieldSignatures: Set<string>;
    bridgeFieldSignatureByClassAndName: Map<string, Map<string, string>>;
    scalarFieldSignatures: Set<string>;
    scalarFieldsByClassAndName: Map<string, Set<string>>;
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

export function buildStateManagementModel(
    args: BuildStateManagementModelArgs,
    options: BuildStateManagementInternalOptions = {
        stateDecoratorCanonicalApiIds: new Set(),
        propDecoratorCanonicalApiIds: new Set(),
        linkDecoratorCanonicalApiIds: new Set(),
        provideDecoratorCanonicalApiIds: new Set(),
        consumeDecoratorCanonicalApiIds: new Set(),
        eventDecoratorCanonicalApiIds: new Set(),
    },
): StateManagementModel {
    const decorated = collectDecoratedFieldSets(args, options);
    const methods = resolveStateManagementModelMethods(
        args.scene,
        decorated,
        args.allowedMethodSignatures,
    );

    const stateCaptureByObjectNode = collectStateCaptureByObjectNode({
        scene: args.scene,
        pag: args.pag,
        methods,
        stateFieldSignatures: decorated.bridgeSourceFieldSignatures,
        bridgeFieldSignatureByClassAndName: decorated.bridgeFieldSignatureByClassAndName,
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
    const scalarBridgeSourceFields = new Set<string>();
    const dedup = new Set<string>();
    let constructorCallCount = 0;
    let bridgeEdgeCount = 0;

    const addBridgeEdge = (edge: StatePropBridgeEdge): void => {
        const sourceKey = `${edge.sourceNodeId}#${edge.sourceFieldName}`;
        const dedupKey = `${sourceKey}->${edge.targetNodeId}#${edge.targetFieldName}`;
        if (edge.scalarAlias) {
            scalarBridgeSourceFields.add(sourceKey);
        }
        if (dedup.has(dedupKey)) {
            if (edge.scalarAlias) {
                const existing = edgesBySourceField.get(sourceKey)
                    ?.find(item => item.targetNodeId === edge.targetNodeId && item.targetFieldName === edge.targetFieldName);
                if (existing) existing.scalarAlias = true;
            }
            return;
        }
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

    const processConstructorInvoke = (stmt: any, methodSignature: string): void => {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) return;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return;

            const calleeSig = invokeExpr.getMethodSignature?.();
            const calleeSigText = calleeSig?.toString?.() || "";
            if (!calleeSigText.includes(".constructor(")) return;
            constructorCallCount++;

            const targetClassName = calleeSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
            if (!targetClassName) return;
            const propLikeFields = decorated.propLikeFieldsByClassName.get(targetClassName);
            const linkFields = decorated.linkFieldsByClassName.get(targetClassName);
            if ((!propLikeFields || propLikeFields.size === 0) && (!linkFields || linkFields.size === 0)) return;

            const targetNodeIds = collectObjectNodeIdsFromValue(args.pag, invokeExpr.getBase());
            if (targetNodeIds.size === 0) return;

            const invokeArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (invokeArgs.length === 0) return;

            for (let argIndex = 0; argIndex < invokeArgs.length; argIndex++) {
                const arg = invokeArgs[argIndex];
                const sourceNodeIds = collectObjectNodeIdsFromValue(args.pag, arg);
                if (sourceNodeIds.size === 0) continue;
                for (const sourceNodeId of sourceNodeIds) {
                    const captures = stateCaptureByObjectNode.get(sourceNodeId);
                    if (!captures || captures.length === 0) continue;
                    for (const capture of captures) {
                        if (
                            capture.sourceParamIndex !== undefined
                                ? capture.sourceParamIndex !== argIndex
                                : invokeArgs.length !== 1
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
                        const sourceIsScalar = decorated.scalarFieldSignatures.has(capture.stateFieldSignature);
                        const targetIsScalar = hasFieldName(
                            decorated.scalarFieldsByClassAndName,
                            targetClassName,
                            capture.captureFieldName,
                        );
                        const scalarAlias = sourceIsScalar || targetIsScalar;
                        for (const targetNodeId of targetNodeIds) {
                            for (const sourceBridgeNodeId of sourceBridgeNodeIds) {
                                if (isPropLike) {
                                    addBridgeEdge({
                                        sourceNodeId: sourceBridgeNodeId,
                                        sourceFieldName: capture.stateFieldName,
                                        targetNodeId,
                                        targetFieldName: capture.captureFieldName,
                                        methodSignature,
                                        scalarAlias,
                                    });
                                    addLoadBridge(
                                        sourceBridgeNodeId,
                                        capture.stateFieldName,
                                        targetClassName,
                                        capture.captureFieldName,
                                    );
                                }
                                if (isLink) {
                                    addBridgeEdge({
                                        sourceNodeId: targetNodeId,
                                        sourceFieldName: capture.captureFieldName,
                                        targetNodeId: sourceBridgeNodeId,
                                        targetFieldName: capture.stateFieldName,
                                        methodSignature,
                                        scalarAlias,
                                    });
                                    const sourceClassName = extractClassNameFromFieldSignature(capture.stateFieldSignature);
                                    if (sourceClassName) {
                                        addLoadBridge(
                                            targetNodeId,
                                            capture.captureFieldName,
                                            sourceClassName,
                                            capture.stateFieldName,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
    };

    for (const method of methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            processConstructorInvoke(stmt, method.getSignature().toString());
        }
    }

    for (const fieldInit of collectFieldInitializerStatements(args.scene)) {
        processConstructorInvoke(fieldInit.stmt, fieldInit.signature);
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
                            scalarAlias: decorated.scalarFieldSignatures.has(provideField.fieldSignature)
                                || decorated.scalarFieldSignatures.has(consumeField.fieldSignature),
                        });
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
    const eventDeferredBindings = collectEventDeferredBindings({
        scene: args.scene,
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
        scalarBridgeSourceFields,
        bridgeEdgeCount,
        constructorCallCount,
        stateCaptureAssignCount,
        eventInvokeBridges,
        eventInvokeBridgeCount,
        eventDeferredBindings,
    };
}

function collectDecoratedFieldSets(
    args: BuildStateManagementModelArgs,
    options: BuildStateManagementInternalOptions,
): DecoratedFieldSets {
    const bridgeSourceFieldSignatures = new Set<string>();
    const bridgeFieldSignatureByClassAndName = new Map<string, Map<string, string>>();
    const scalarFieldSignatures = new Set<string>();
    const scalarFieldsByClassAndName = new Map<string, Set<string>>();
    const stateFieldsByClassName = new Map<string, Set<string>>();
    const propLikeFieldsByClassName = new Map<string, Set<string>>();
    const linkFieldsByClassName = new Map<string, Set<string>>();
    const provideFieldsByKey = new Map<string, DecoratedKeyFieldInfo[]>();
    const consumeFieldsByKey = new Map<string, DecoratedKeyFieldInfo[]>();
    const eventFieldsByClassName = new Map<string, Set<string>>();

    const addClassField = (map: Map<string, Set<string>>, field: DecoratedFieldInfo): void => {
        addMapSetValue(map, field.className, field.fieldName);
    };
    const addBridgeField = (field: DecoratedFieldInfo): void => {
        if (field.fieldSignature) bridgeSourceFieldSignatures.add(field.fieldSignature);
        let classFields = bridgeFieldSignatureByClassAndName.get(field.className);
        if (!classFields) {
            classFields = new Map<string, string>();
            bridgeFieldSignatureByClassAndName.set(field.className, classFields);
        }
        if (field.fieldSignature) classFields.set(field.fieldName, field.fieldSignature);
    };
    const addKeyedField = (
        map: Map<string, DecoratedKeyFieldInfo[]>,
        field: DecoratedFieldInfo,
        canonicalApiIds: Set<string>,
    ): void => {
        for (const key of decoratedFieldKeys(field, canonicalApiIds)) {
            const fields = map.get(key) || [];
            if (!fields.some(item => item.fieldSignature === field.fieldSignature && item.fieldName === field.fieldName)) {
                fields.push({
                    className: field.className,
                    fieldSignature: field.fieldSignature,
                    fieldName: field.fieldName,
                });
            }
            map.set(key, fields);
        }
    };

    for (const field of scanDecoratedFields(args, options.stateDecoratorCanonicalApiIds)) {
        addClassField(stateFieldsByClassName, field);
        addBridgeField(field);
    }
    for (const field of scanDecoratedFields(args, options.propDecoratorCanonicalApiIds)) {
        addClassField(propLikeFieldsByClassName, field);
    }
    for (const field of scanDecoratedFields(args, options.linkDecoratorCanonicalApiIds)) {
        addClassField(linkFieldsByClassName, field);
        addBridgeField(field);
    }
    for (const field of scanDecoratedFields(args, options.provideDecoratorCanonicalApiIds)) {
        addKeyedField(provideFieldsByKey, field, options.provideDecoratorCanonicalApiIds);
    }
    for (const field of scanDecoratedFields(args, options.consumeDecoratorCanonicalApiIds)) {
        addKeyedField(consumeFieldsByKey, field, options.consumeDecoratorCanonicalApiIds);
    }
    for (const field of scanDecoratedFields(args, options.eventDecoratorCanonicalApiIds)) {
        addClassField(eventFieldsByClassName, field);
    }

    return {
        bridgeSourceFieldSignatures,
        bridgeFieldSignatureByClassAndName,
        scalarFieldSignatures,
        scalarFieldsByClassAndName,
        stateFieldsByClassName,
        propLikeFieldsByClassName,
        linkFieldsByClassName,
        provideFieldsByKey,
        consumeFieldsByKey,
        eventFieldsByClassName,
    };
}

interface DecoratedFieldInfo {
    className: string;
    fieldName: string;
    fieldSignature: string;
    decorators: ReturnType<BuildStateManagementModelArgs["scan"]["decoratedFields"]>[number]["decorators"];
}

function scanDecoratedFields(
    args: BuildStateManagementModelArgs,
    canonicalApiIds: Set<string>,
): DecoratedFieldInfo[] {
    if (canonicalApiIds.size === 0) return [];
    return args.scan.decoratedFields({
        decoratorCanonicalApiIds: [...canonicalApiIds],
    }).map(field => ({
        className: field.className,
        fieldName: field.fieldName,
        fieldSignature: field.fieldSignature,
        decorators: field.decorators.bind(field),
    }));
}

function decoratedFieldKeys(field: DecoratedFieldInfo, canonicalApiIds: Set<string>): string[] {
    const keys = new Set<string>();
    for (const decorator of field.decorators()) {
        if (!decorator.canonicalApiId || !canonicalApiIds.has(decorator.canonicalApiId)) continue;
        for (const key of decoratorKeyCandidates(decorator)) {
            keys.add(key);
        }
    }
    return [...keys.values()];
}

function decoratorKeyCandidates(decorator: { param?: string; content?: string }): string[] {
    const keys = new Set<string>();
    for (const raw of [decorator.param, decorator.content]) {
        const normalized = normalizeDecoratorKey(raw || "");
        if (normalized) keys.add(normalized);
        for (const quoted of extractQuotedDecoratorLiterals(raw || "")) {
            keys.add(quoted);
        }
    }
    return [...keys.values()];
}

function normalizeDecoratorKey(raw: string): string | undefined {
    const text = String(raw || "").trim();
    if (text.length === 0) return undefined;
    const quoted = parseClosedQuotedDecoratorText(text);
    if (quoted !== undefined) return quoted;
    if (/^[A-Za-z0-9_.:-]+$/.test(text)) return text;
    return undefined;
}

function extractQuotedDecoratorLiterals(raw: string): string[] {
    const out = new Set<string>();
    const text = String(raw || "");
    const pattern = /(['"`])((?:\\.|(?!\1).)+)\1/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const normalized = normalizeDecoratorKey(match[0]);
        if (normalized) out.add(normalized);
    }
    return [...out.values()];
}

function parseClosedQuotedDecoratorText(text: string): string | undefined {
    if (text.length < 2) return undefined;
    const quote = text[0];
    if ((quote !== "'" && quote !== "\"" && quote !== "`") || text[text.length - 1] !== quote) {
        return undefined;
    }
    return text.slice(1, -1).replace(/\\(["'`\\])/g, "$1");
}

function hasFieldName(
    map: Map<string, Set<string>>,
    className: string,
    fieldName: string,
): boolean {
    return map.get(className)?.has(fieldName) || false;
}

function extractClassNameFromFieldSignature(signature: string): string | undefined {
    const match = String(signature || "").match(/:\s*([^.\s]+)\.([^.\s>]+)>?$/);
    return match?.[1];
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
        if (className.length > 0 && decoratedClassNames.has(className)) {
            return true;
        }
        return methodConstructsDecoratedClass(method, decoratedClassNames);
    });
}

function methodConstructsDecoratedClass(method: any, decoratedClassNames: Set<string>): boolean {
    const cfg = method.getCfg?.();
    if (!cfg || decoratedClassNames.size === 0) return false;
    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const calleeSig = invokeExpr.getMethodSignature?.();
        const calleeSigText = calleeSig?.toString?.() || "";
        if (!calleeSigText.includes(".constructor(")) continue;
        const targetClassName = calleeSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
        if (targetClassName && decoratedClassNames.has(targetClassName)) {
            return true;
        }
    }
    return false;
}

function collectStateCaptureByObjectNode(args: {
    scene: Scene;
    pag: Pag;
    methods: any[];
    stateFieldSignatures: Set<string>;
    bridgeFieldSignatureByClassAndName: Map<string, Map<string, string>>;
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

    for (const ctx of collectFieldInitializerStatements(args.scene)) {
        const left = ctx.stmt.getLeftOp?.();
        const right = ctx.stmt.getRightOp?.();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        if (!(right instanceof Local)) continue;
        const leftBase = left.getBase();
        if (!(leftBase instanceof Local) || leftBase.getName?.() !== "this") continue;
        const captureFieldName = left.getFieldSignature().getFieldName();
        const sourceFieldName = normalizeDollarStateLocalName(right.getName?.() || "");
        if (!captureFieldName || !sourceFieldName) continue;
        const ownerClassName = inferOwnerClassNameFromAnonymousClassName(ctx.className);
        if (!ownerClassName) continue;
        const stateFieldSignature = args.bridgeFieldSignatureByClassAndName
            .get(ownerClassName)
            ?.get(sourceFieldName);
        if (!stateFieldSignature || !args.stateFieldSignatures.has(stateFieldSignature)) continue;
        const leftNodeIds = collectObjectNodeIdsFromValue(args.pag, leftBase);
        for (const nodeId of leftNodeIds) {
            addCapture(nodeId, {
                captureFieldName,
                stateFieldSignature,
                stateFieldName: sourceFieldName,
            });
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

function normalizeDollarStateLocalName(name: string): string | undefined {
    const trimmed = String(name || "").trim();
    if (!trimmed.startsWith("$") || trimmed.length <= 1) return undefined;
    const candidate = trimmed.slice(1);
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate) ? candidate : undefined;
}

function inferOwnerClassNameFromAnonymousClassName(className: string): string | undefined {
    const parts = String(className || "").split("$");
    for (let index = parts.length - 1; index >= 0; index--) {
        const head = parts[index].split("-")[0];
        if (!head || head.startsWith("%AC")) continue;
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(head)) return head;
    }
    return undefined;
}

function collectFieldInitializerStatements(scene: Scene): Array<{ stmt: ArkAssignStmt; signature: string; className: string }> {
    const out: Array<{ stmt: ArkAssignStmt; signature: string; className: string }> = [];
    for (const cls of scene.getClasses()) {
        const className = cls.getName?.() || "";
        for (const field of cls.getFields?.() || []) {
            const initializer = field.getInitializer?.();
            const stmts = Array.isArray(initializer) ? initializer : initializer ? [initializer] : [];
            const signature = field.getSignature?.()?.toString?.() || `${className}.${field.getName?.() || ""}`;
            for (const stmt of stmts) {
                if (stmt instanceof ArkAssignStmt) {
                    out.push({ stmt, signature, className });
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

function collectEventDeferredBindings(args: {
    scene: Scene;
    methods: any[];
    eventFieldsByClassName: Map<string, Set<string>>;
    callbacks: BuildStateManagementModelArgs["callbacks"];
}): Array<{
    sourceMethod: any;
    handlerMethod: any;
    anchorStmt: any;
    triggerLabel: string;
}> {
    const out: Array<{
        sourceMethod: any;
        handlerMethod: any;
        anchorStmt: any;
        triggerLabel: string;
    }> = [];
    if (args.eventFieldsByClassName.size === 0) return out;

    const callbackMethodsByClassAndField = collectEventFieldCallbackMethods(args);
    const seen = new Set<string>();

    for (const method of args.methods) {
        const className = method.getDeclaringArkClass?.()?.getName?.() || "";
        if (!className) continue;
        const eventFields = args.eventFieldsByClassName.get(className);
        if (!eventFields || eventFields.size === 0) continue;

        const cfg = method.getCfg?.();
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

            const triggerLabel = `${className}#${fieldName}`;
            const callbackMethods = callbackMethodsByClassAndField.get(triggerLabel);
            if (!callbackMethods || callbackMethods.size === 0) continue;
            for (const [handlerSignature, handlerMethod] of callbackMethods.entries()) {
                const key = `${method.getSignature?.().toString?.() || ""}#${String(stmt)}#${handlerSignature}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    sourceMethod: method,
                    handlerMethod,
                    anchorStmt: stmt,
                    triggerLabel,
                });
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

    const consumeCallbackValue = (key: string, callbackValue: any): void => {
        for (const binding of args.callbacks.paramBindings(callbackValue, 0, { maxCandidates: 8 })) {
            for (const nodeId of binding.localNodeIds()) {
                addMapSetValue(out, key, nodeId);
            }
            for (const nodeId of binding.localUseNodeIds()) {
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
                        args.scene, method, arg, targetClassName, eventFields, consumeCallbackValue,
                        args.callbacks,
                    );
                    continue;
                }
                if (arg instanceof ArkNewExpr) {
                    const className = arg.getClassType?.()?.getClassSignature?.()?.getClassName?.() || "";
                    if (!className) continue;
                    resolveCallbacksFromAnonymousClassInit(
                        args.scene, className, targetClassName, eventFields, consumeCallbackValue,
                        args.callbacks,
                    );
                }
            }
        }
    }

    return out;
}

function collectEventFieldCallbackMethods(args: {
    scene: Scene;
    methods: any[];
    eventFieldsByClassName: Map<string, Set<string>>;
    callbacks: BuildStateManagementModelArgs["callbacks"];
}): Map<string, Map<string, any>> {
    const out = new Map<string, Map<string, any>>();

    const consumeCallbackValue = (key: string, callbackValue: any): void => {
        const bindings = args.callbacks.paramBindings(callbackValue, 0, { maxCandidates: 8 });
        if (bindings.length === 0) return;
        let bucket = out.get(key);
        if (!bucket) {
            bucket = new Map<string, any>();
            out.set(key, bucket);
        }
        for (const binding of bindings) {
            bucket.set(binding.methodSignature, binding.method);
        }
    };

    for (const method of args.methods) {
        const cfg = method.getCfg?.();
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
                        args.scene, method, arg, targetClassName, eventFields, consumeCallbackValue,
                        args.callbacks,
                    );
                    continue;
                }
                if (arg instanceof ArkNewExpr) {
                    const className = arg.getClassType?.()?.getClassSignature?.()?.getClassName?.() || "";
                    if (!className) continue;
                    resolveCallbacksFromAnonymousClassInit(
                        args.scene, className, targetClassName, eventFields, consumeCallbackValue,
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
    consumeCallbackValue: (key: string, callbackValue: any) => void,
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
                scene, className, targetClassName, eventFields, consumeCallbackValue, callbacks,
            );
            return;
        }
        if (right instanceof ArkInstanceInvokeExpr) {
            const ctorSig = right.getMethodSignature?.();
            const ctorSigText = ctorSig?.toString?.() || "";
            if (ctorSigText.includes(".constructor(")) {
                const className = ctorSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
                if (className) {
                    resolveCallbacksFromAnonymousClassInit(
                        scene, className, targetClassName, eventFields, consumeCallbackValue, callbacks,
                    );
                    return;
                }
            }
        }
        if (right instanceof Local) {
            resolveEventCallbacksFromArgLocal(
                scene,
                enclosingMethod,
                right,
                targetClassName,
                eventFields,
                consumeCallbackValue,
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
        consumeCallbackValue(key, right);
    }
}

function resolveCallbacksFromAnonymousClassInit(
    scene: Scene,
    anonymousClassName: string,
    targetClassName: string,
    eventFields: Set<string>,
    consumeCallbackValue: (key: string, callbackValue: any) => void,
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
            consumeCallbackValue(key, right);
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
        const nodes = resolveExistingPagNodes(pag, left, stmt);
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
            const loadNodeIds = resolveExistingPagNodes(args.pag, left, stmt);
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

export default harmonyStateModule;

