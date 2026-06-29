import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAssignStmt, ArkInvokeStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintFact } from "../model/TaintFact";
import { TaintTracker } from "../model/TaintTracker";
import { CallEdgeType, TaintContextManager } from "../context/TaintContext";
import type { SyntheticInvokeEdgeInfo } from "../builders/SyntheticInvokeEdgeBuilder";
import { fromContainerFieldKey, toContainerFieldKey } from "../model/ContainerSlotKeys";
import { collectCarrierNodeIdsForValueAtStmt } from "../ordinary/OrdinaryAliasPropagation";
import { isCarrierFieldPathLiveAtStmt } from "../ordinary/OrdinaryObjectInvalidation";
import {
    collectOrdinaryArrayFromMapperCallbackParamNodeIdsForObj,
    collectOrdinaryArraySlotLoadNodeIds,
    collectOrdinaryArrayStaticViewEffectsBySlot,
    collectOrdinaryArrayViewEffectsBySlot,
} from "../ordinary/OrdinaryArrayPropagation";
import {
    collectArrayElementStoreFactsFromValue,
    collectOrdinaryCaughtExceptionFieldLoadFactsFromTaintedObj,
    collectOrdinaryCopyLikeResultFactsFromTaintedObj,
    collectFieldStoreFactsFromValue,
    collectNestedArrayStoreFactsFromFieldValue,
    collectNestedCollectionStoreFactsFromFieldValue,
    collectNestedFieldStoreFactsFromFieldValue,
    collectObjectLiteralFieldCaptureFactsFromObjectField,
    collectObjectLiteralFieldCaptureFactsFromValue,
    collectPreciseArrayLoadNodeIdsFromTaintedObjSlot,
} from "../ordinary/OrdinaryLanguagePropagation";
import {
    propagateCarrierLoadPrefixesByObj,
    propagateDirectFieldArgUsesByObj,
    propagateDirectFieldLoadsByLocal,
    propagateDirectFieldLoadsByObj,
    propagateDynamicSelectorFieldMirrorStoresByObj,
    propagateObjectAssignFieldBridgesByObj,
    propagateObjectResultContainerStoresByObj,
    propagateObjectResultLoadsByObj,
    propagateReflectGetFieldLoadsByObj,
    propagateReceiverGetterResultLoadsByObj,
} from "../propagation/WorklistFieldPropagation";
import {
    extractFilePathFromMethodSignature,
    resolveMethodSignatureByNode,
    resolveObjectClassSignatureByNode,
    selectReachableThisFieldLoads,
    ThisFieldLoadNodeIds,
} from "../propagation/WorklistReachabilitySupport";
import { FieldAccessIndex } from "./FieldAccessIndex";

export interface FieldPropagationEmission {
    stage: string;
    fact: TaintFact;
    message: string;
    traceSection?: string;
}

export interface FieldPropagationEngineDeps {
    scene: Scene;
    pag: Pag;
    tracker: TaintTracker;
    classBySignature: Map<string, any>;
    fieldAccessIndex: FieldAccessIndex;
    unresolvedThisFieldLoadNodeIdsByFieldAndFile: ThisFieldLoadNodeIds;
    classRelationCache: Map<string, boolean>;
    preciseArrayLoadCache: Map<string, number[]>;
    ctxManager?: TaintContextManager;
    syntheticCallSourceNodeIdsByCallSiteAndDst?: Map<string, number[]>;
    syntheticInvokeEdgeMap?: Map<number, SyntheticInvokeEdgeInfo[]>;
}

export interface FieldPropagationRequest {
    fact: TaintFact;
    node: PagNode;
    currentCtx: number;
}

interface IndexedFieldLoadTarget {
    ownerId: number;
    destVarId: number;
}

export class FieldPropagationEngine {
    private readonly unresolvedThisFieldLoadEmissions = new Set<string>();

    constructor(private readonly deps: FieldPropagationEngineDeps) {}

    public propagate(request: FieldPropagationRequest): FieldPropagationEmission[] {
        const out: FieldPropagationEmission[] = [];
        const { fact } = request;
        if (!fact.field || fact.field.length === 0) {
            out.push(...this.propagateValueToFieldStores(request));
            out.push(...this.propagateObjectLiteralLocalCapture(request));
        } else {
            out.push(...this.propagateFieldLoadsAndCopies(request));
            out.push(...this.propagateFieldToFieldStores(request));
            out.push(...this.propagateIndexedAndReceiverLoads(request));
        }

        out.push(...this.propagateObjectAssign(request));
        return out;
    }

    private propagateValueToFieldStores(request: FieldPropagationRequest): FieldPropagationEmission[] {
        const { pag, classBySignature } = this.deps;
        const { node, fact, currentCtx } = request;
        const out: FieldPropagationEmission[] = [];

        for (const newFact of collectFieldStoreFactsFromValue(node, fact.source, currentCtx, pag, classBySignature)) {
            out.push({
                stage: "Store-Field",
                fact: newFact,
                message: `    [Store-Field] Tainted Obj ${newFact.node.getID()}.${newFact.field?.[0] || "<field>"} (ctx=${newFact.contextID})`,
                traceSection: "field.store",
            });
        }

        for (const newFact of collectArrayElementStoreFactsFromValue(node, fact.source, currentCtx, pag, classBySignature)) {
            out.push({
                stage: "Store-Array",
                fact: newFact,
                message: `    [Store-Array] Tainted Obj ${newFact.node.getID()}.${newFact.field?.[0] || "<slot>"} (ctx=${newFact.contextID})`,
                traceSection: "field.store",
            });
        }
        return out;
    }

    private propagateObjectLiteralLocalCapture(request: FieldPropagationRequest): FieldPropagationEmission[] {
        const { pag, classBySignature } = this.deps;
        const { node, fact, currentCtx } = request;
        const out: FieldPropagationEmission[] = [];
        for (const newFact of collectObjectLiteralFieldCaptureFactsFromValue(node, fact.source, currentCtx, pag, classBySignature)) {
            out.push({
                stage: "Store-ObjectLiteralLocalCapture",
                fact: newFact,
                message: `    [Store-ObjectLiteralLocalCapture] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} via ordinary object literal local capture (ctx=${newFact.contextID})`,
                traceSection: "field.store",
            });
        }
        return out;
    }

    private propagateFieldLoadsAndCopies(request: FieldPropagationRequest): FieldPropagationEmission[] {
        const { scene, pag, tracker, classBySignature } = this.deps;
        const { node, fact, currentCtx } = request;
        const field = fact.field || [];
        const out: FieldPropagationEmission[] = [];

        for (const newFact of propagateDirectFieldLoadsByLocal(pag, node, field, fact.source, currentCtx, tracker, classBySignature)) {
            out.push({
                stage: "Load-LocalField",
                fact: newFact,
                message: `    [Load-LocalField] Tainted node ${newFact.node.getID()} from local field '${field[0]}' (ctx=${currentCtx})`,
                traceSection: "field.load",
            });
        }

        for (const newFact of propagateCarrierLoadPrefixesByObj(pag, node.getID(), field, fact.source, currentCtx, tracker, classBySignature)) {
            out.push({
                stage: "Carrier-LoadPrefix",
                fact: newFact,
                message: `    [Carrier-LoadPrefix] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} from loaded carrier alias (ctx=${currentCtx})`,
                traceSection: "field.load",
            });
        }

        for (const newFact of propagateReflectGetFieldLoadsByObj(pag, node.getID(), field, fact.source, currentCtx, tracker, classBySignature)) {
            out.push({
                stage: "Reflect-Load",
                fact: newFact,
                message: `    [Reflect-Load] Tainted var ${newFact.node.getID()} from Reflect.get field '${field[0]}' (ctx=${currentCtx})`,
                traceSection: "field.load",
            });
        }

        for (const newFact of propagateDirectFieldLoadsByObj(pag, node.getID(), field, fact.source, currentCtx, tracker, classBySignature)) {
            out.push({
                stage: "Load-DirectField",
                fact: newFact,
                message: `    [Load-DirectField] Tainted var ${newFact.node.getID()} from direct field '${field[0]}' (ctx=${currentCtx})`,
                traceSection: "field.load",
            });
        }

        for (const newFact of propagateDirectFieldArgUsesByObj(pag, node.getID(), field, fact.source, currentCtx, tracker, classBySignature)) {
            out.push({
                stage: "Load-DirectField-Arg",
                fact: newFact,
                message: `    [Load-DirectField-Arg] Tainted node ${newFact.node.getID()} from direct field arg '${field[0]}' (ctx=${currentCtx})`,
                traceSection: "field.load",
            });
        }

        for (const newFact of propagateReceiverGetterResultLoadsByObj(scene, pag, node.getID(), field, fact.source, currentCtx, tracker, classBySignature)) {
            out.push({
                stage: "Load-ReceiverGetter",
                fact: newFact,
                message: `    [Load-ReceiverGetter] Tainted node ${newFact.node.getID()} via receiver getter '${field.join(".")}' (ctx=${currentCtx})`,
                traceSection: "field.load",
            });
        }

        for (const newFact of collectOrdinaryCaughtExceptionFieldLoadFactsFromTaintedObj(node.getID(), field, fact.source, currentCtx, pag, classBySignature)) {
            out.push({
                stage: "Exception-Field-Load",
                fact: newFact,
                message: `    [Exception-Field-Load] Tainted node ${newFact.node.getID()} from thrown exception field '${field.join(".")}' (ctx=${currentCtx})`,
                traceSection: "field.load",
            });
        }

        for (const newFact of collectOrdinaryCopyLikeResultFactsFromTaintedObj(node.getID(), field, fact.source, currentCtx, pag, classBySignature)) {
            out.push({
                stage: "CopyLike-Result",
                fact: newFact,
                message: `    [CopyLike-Result] Tainted node ${newFact.node.getID()} via ordinary copy/serialization boundary (ctx=${currentCtx})`,
                traceSection: "field.copy",
            });
        }

        for (const newFact of propagateObjectResultLoadsByObj(pag, node.getID(), fact.source, currentCtx, classBySignature)) {
            out.push({
                stage: "Object-Result",
                fact: newFact,
                message: `    [Object-Result] Tainted result node ${newFact.node.getID()} from Object.values/entries on field '${field[0]}' (ctx=${currentCtx})`,
                traceSection: "field.copy",
            });
        }

        for (const newFact of propagateObjectResultContainerStoresByObj(pag, node.getID(), fact.source, currentCtx, classBySignature)) {
            out.push({
                stage: "Object-Result-Store",
                fact: newFact,
                message: `    [Object-Result-Store] Tainted slot '${fromContainerFieldKey(newFact.field?.[0] || "") || newFact.field?.[0]}' of Obj ${newFact.node.getID()} via Object.values/entries (ctx=${currentCtx})`,
                traceSection: "field.store",
            });
        }

        return out;
    }

    private propagateFieldToFieldStores(request: FieldPropagationRequest): FieldPropagationEmission[] {
        const { pag, classBySignature } = this.deps;
        const { node, fact, currentCtx } = request;
        const field = fact.field || [];
        const out: FieldPropagationEmission[] = [];

        for (const newFact of collectObjectLiteralFieldCaptureFactsFromObjectField(node.getID(), field, fact.source, currentCtx, pag, classBySignature)) {
            out.push({
                stage: "Store-ObjectLiteralFieldCapture",
                fact: newFact,
                message: `    [Store-ObjectLiteralFieldCapture] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} via ordinary object literal shorthand (ctx=${newFact.contextID})`,
                traceSection: "field.store",
            });
        }

        for (const newFact of collectNestedFieldStoreFactsFromFieldValue(node, field, fact.source, currentCtx, pag, classBySignature)) {
            out.push({
                stage: "Store-NestedField",
                fact: newFact,
                message: `    [Store-NestedField] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${newFact.contextID})`,
                traceSection: "field.store",
            });
        }

        for (const newFact of collectNestedArrayStoreFactsFromFieldValue(node, field, fact.source, currentCtx, pag, classBySignature)) {
            out.push({
                stage: "Store-NestedArray",
                fact: newFact,
                message: `    [Store-NestedArray] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${newFact.contextID})`,
                traceSection: "field.store",
            });
        }

        for (const newFact of collectNestedCollectionStoreFactsFromFieldValue(node, field, fact.source, currentCtx, pag, classBySignature)) {
            out.push({
                stage: "Store-NestedCollection",
                fact: newFact,
                message: `    [Store-NestedCollection] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} (ctx=${newFact.contextID})`,
                traceSection: "field.store",
            });
        }

        for (const newFact of propagateDynamicSelectorFieldMirrorStoresByObj(pag, node.getID(), field, fact.source, currentCtx, this.deps.tracker, classBySignature)) {
            out.push({
                stage: "Store-DynamicSelectorField",
                fact: newFact,
                message: `    [Store-DynamicSelectorField] Tainted Obj ${newFact.node.getID()}.${newFact.field?.join(".")} via dynamic selector mirror store (ctx=${newFact.contextID})`,
                traceSection: "field.store",
            });
        }

        return out;
    }

    private propagateObjectAssign(request: FieldPropagationRequest): FieldPropagationEmission[] {
        const { pag, classBySignature } = this.deps;
        const { node, fact, currentCtx } = request;
        const value = node.getValue?.();
        if ((!fact.field || fact.field.length === 0) && !(value instanceof Local)) return [];
        return propagateObjectAssignFieldBridgesByObj(pag, node.getID(), fact.field || [], fact.source, currentCtx, classBySignature)
            .map(newFact => ({
                stage: "Object-Assign",
                fact: newFact,
                message: `    [Object-Assign] Tainted field '${newFact.field?.[0]}' of Obj ${newFact.node.getID()} via Object.assign (ctx=${currentCtx})`,
                traceSection: "field.copy",
            }));
    }

    private propagateIndexedAndReceiverLoads(request: FieldPropagationRequest): FieldPropagationEmission[] {
        const { scene, pag, tracker, classBySignature, fieldAccessIndex } = this.deps;
        const { node, fact, currentCtx } = request;
        const field = fact.field || [];
        if (field.length === 0) return [];

        const out: FieldPropagationEmission[] = [];
        const objId = node.getID();
        const fieldName = field[0];
        const containerSlot = fromContainerFieldKey(fieldName);
        const remainingFieldPath = field.length > 1 ? field.slice(1) : undefined;

        if (containerSlot !== null && containerSlot.startsWith("arr:")) {
            out.push(...this.propagateArrayContainerLoads(objId, containerSlot, remainingFieldPath, fact, currentCtx));
        }

        let indexedLoadTargets = collectIndexedFieldLoadTargets(fieldAccessIndex, node, fieldName);
        if (containerSlot !== null) {
            const preciseTargets: IndexedFieldLoadTarget[] = [];
            for (const ownerId of collectFieldIndexOwnerIds(node)) {
                const preciseCacheKey = `${ownerId}|${containerSlot}`;
                let preciseDestVarIds = this.deps.preciseArrayLoadCache.get(preciseCacheKey);
                if (!preciseDestVarIds) {
                    preciseDestVarIds = collectPreciseArrayLoadNodeIdsFromTaintedObjSlot(ownerId, containerSlot, pag);
                    this.deps.preciseArrayLoadCache.set(preciseCacheKey, preciseDestVarIds);
                }
                for (const destVarId of preciseDestVarIds) {
                    preciseTargets.push({ ownerId, destVarId });
                }
            }
            if (preciseTargets.length > 0) {
                indexedLoadTargets = preciseTargets;
            }
        }
        if (indexedLoadTargets.length > 0) {
            const seenLoads = new Set<string>();
            for (const { ownerId, destVarId } of indexedLoadTargets) {
                const loadKey = `${ownerId}|${destVarId}`;
                if (seenLoads.has(loadKey)) continue;
                seenLoads.add(loadKey);
                const dstNode = pag.getNode(destVarId) as PagNode;
                if (!dstNode) continue;
                const loadValue: any = dstNode.getValue?.();
                const loadAnchorStmt = dstNode.getStmt?.() || loadValue?.getDeclaringStmt?.();
                const indexedLoadBaseCarrierIds = resolveIndexedLoadBaseCarrierNodeIds(pag, dstNode, loadAnchorStmt, classBySignature);
                if (indexedLoadBaseCarrierIds && indexedLoadBaseCarrierIds.length > 0 && !indexedLoadBaseCarrierIds.includes(ownerId)) {
                    continue;
                }
                if (loadAnchorStmt && !isCarrierFieldPathLiveAtStmt(pag, tracker, ownerId, field, loadAnchorStmt, classBySignature)) {
                    continue;
                }
                if (field.length > 1) {
                    let hasPointTo = false;
                    for (const nestedObjId of dstNode.getPointTo()) {
                        hasPointTo = true;
                        const nestedObjNode = pag.getNode(nestedObjId) as PagNode;
                        if (!nestedObjNode) continue;
                        const newFact = new TaintFact(nestedObjNode, fact.source, currentCtx, field.slice(1));
                        out.push({
                            stage: "Load",
                            fact: newFact,
                            message: `    [Load] Tainted Obj ${nestedObjId}.${newFact.field?.join(".")} from Obj ${objId}.${fieldName} (ctx=${currentCtx})`,
                            traceSection: "field.load",
                        });
                    }
                    if (!hasPointTo) {
                        const newFact = new TaintFact(dstNode, fact.source, currentCtx, field.slice(1));
                        out.push({
                            stage: "Load",
                            fact: newFact,
                            message: `    [Load] Tainted local ${destVarId}.${newFact.field?.join(".")} from Obj ${objId}.${fieldName} (ctx=${currentCtx})`,
                            traceSection: "field.load",
                        });
                    }
                } else {
                    if (tracker.hasDescendantFieldSourceAnyContext(ownerId, fact.source, field)) {
                        continue;
                    }
                    const newFact = new TaintFact(dstNode, fact.source, currentCtx);
                    out.push({
                        stage: "Load",
                        fact: newFact,
                        message: `    [Load] Tainted var ${destVarId} from Obj ${objId}.${fieldName} (ctx=${currentCtx})`,
                        traceSection: "field.load",
                    });
                }
            }
        }

        const sourceMethodSig = resolveMethodSignatureByNode(node);
        const sourceFilePath = extractFilePathFromMethodSignature(sourceMethodSig);
        const unresolvedByFile = this.deps.unresolvedThisFieldLoadNodeIdsByFieldAndFile.get(fieldName);
        const unresolvedByClass = sourceFilePath.length > 0 ? unresolvedByFile?.get(sourceFilePath) : undefined;
        const sourceClassSig = resolveObjectClassSignatureByNode(node);
        const unresolvedLoadNodeIds = selectReachableThisFieldLoads(
            unresolvedByClass,
            sourceClassSig,
            classBySignature,
            this.deps.classRelationCache,
        );
        if (unresolvedLoadNodeIds) {
            const emissionScopeKeyPrefix = [
                sourceFilePath || "%unknown-file",
                sourceClassSig || "%unknown-class",
                fieldName,
                fact.source,
            ].join("\u0001");
            for (const destVarId of unresolvedLoadNodeIds.values()) {
                const dstNode = pag.getNode(destVarId) as PagNode;
                if (!dstNode) continue;
                this.emitUnresolvedThisFieldLoads(out, dstNode, destVarId, field, fact, currentCtx, emissionScopeKeyPrefix);
            }
        }

        return out;
    }

    private propagateArrayContainerLoads(
        objId: number,
        containerSlot: string,
        remainingFieldPath: string[] | undefined,
        fact: TaintFact,
        currentCtx: number,
    ): FieldPropagationEmission[] {
        const { scene, pag } = this.deps;
        const out: FieldPropagationEmission[] = [];
        const scopeMethodSignature = resolveMethodSignatureByNode(fact.node);
        for (const targetNodeId of collectOrdinaryArraySlotLoadNodeIds(
            objId,
            containerSlot,
            pag,
            scene,
            scopeMethodSignature,
            (indexValue, anchorStmt) => this.resolveContextualArrayIndexSlot(indexValue, anchorStmt, currentCtx),
        )) {
            const targetNode = pag.getNode(targetNodeId) as PagNode;
            if (!targetNode) continue;
            const newFact = new TaintFact(targetNode, fact.source, currentCtx, remainingFieldPath ? [...remainingFieldPath] : undefined);
            out.push({
                stage: "Array-LoadLike",
                fact: newFact,
                message: `    [Array-LoadLike] Tainted node ${targetNodeId} from ordinary array slot '${containerSlot}' (ctx=${currentCtx})`,
                traceSection: "field.load",
            });
        }

        const viewEffects = collectOrdinaryArrayViewEffectsBySlot(objId, containerSlot, pag, scopeMethodSignature);
        for (const targetNodeId of viewEffects.resultNodeIds) {
            const targetNode = pag.getNode(targetNodeId) as PagNode;
            if (!targetNode) continue;
            const newFact = new TaintFact(targetNode, fact.source, currentCtx, remainingFieldPath ? [...remainingFieldPath] : undefined);
            out.push({
                stage: "Array-View",
                fact: newFact,
                message: `    [Array-View] Tainted result node ${targetNodeId} from ordinary array view on slot '${containerSlot}' (ctx=${currentCtx})`,
                traceSection: "field.copy",
            });
        }
        for (const store of viewEffects.resultSlotStores) {
            const targetNode = pag.getNode(store.objId) as PagNode;
            if (!targetNode) continue;
            const newFact = new TaintFact(targetNode, fact.source, currentCtx, [toContainerFieldKey(store.slot), ...(remainingFieldPath || [])]);
            out.push({
                stage: "Array-View-Store",
                fact: newFact,
                message: `    [Array-View-Store] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary array view on slot '${containerSlot}' (ctx=${currentCtx})`,
                traceSection: "field.store",
            });
        }

        const staticViewEffects = collectOrdinaryArrayStaticViewEffectsBySlot(objId, containerSlot, pag, scopeMethodSignature);
        for (const targetNodeId of staticViewEffects.resultNodeIds) {
            const targetNode = pag.getNode(targetNodeId) as PagNode;
            if (!targetNode) continue;
            const newFact = new TaintFact(targetNode, fact.source, currentCtx, remainingFieldPath ? [...remainingFieldPath] : undefined);
            out.push({
                stage: "Array-StaticView",
                fact: newFact,
                message: `    [Array-StaticView] Tainted result node ${targetNodeId} from ordinary array static view on slot '${containerSlot}' (ctx=${currentCtx})`,
                traceSection: "field.copy",
            });
        }
        for (const store of staticViewEffects.resultSlotStores) {
            const targetNode = pag.getNode(store.objId) as PagNode;
            if (!targetNode) continue;
            const newFact = new TaintFact(targetNode, fact.source, currentCtx, [toContainerFieldKey(store.slot), ...(remainingFieldPath || [])]);
            out.push({
                stage: "Array-StaticView-Store",
                fact: newFact,
                message: `    [Array-StaticView-Store] Tainted Obj ${targetNode.getID()}.${store.slot} from ordinary array static view on slot '${containerSlot}' (ctx=${currentCtx})`,
                traceSection: "field.store",
            });
        }

        for (const targetNodeId of collectOrdinaryArrayFromMapperCallbackParamNodeIdsForObj(objId, pag, scene)) {
            const targetNode = pag.getNode(targetNodeId) as PagNode;
            if (!targetNode) continue;
            const newFact = new TaintFact(targetNode, fact.source, currentCtx, remainingFieldPath ? [...remainingFieldPath] : undefined);
            out.push({
                stage: "Array-From-Mapper-CB",
                fact: newFact,
                message: `    [Array-From-Mapper-CB] Tainted callback param node ${targetNodeId} from ordinary Array.from mapper on slot '${containerSlot}' (ctx=${currentCtx})`,
                traceSection: "field.load",
            });
        }

        return out;
    }

    private resolveContextualArrayIndexSlot(indexValue: any, anchorStmt: ArkAssignStmt, currentCtx: number): string | undefined {
        const key = this.resolveContextualValueKey(indexValue, anchorStmt, currentCtx, new Set<string>());
        if (!key || !/^-?\d+$/.test(key)) return undefined;
        return `arr:${key}`;
    }

    private resolveContextualValueKey(
        value: any,
        anchorStmt: ArkAssignStmt | undefined,
        currentCtx: number,
        visiting: Set<string>,
    ): string | undefined {
        if (value instanceof Constant) {
            return normalizeContextLiteralText(value.toString());
        }
        if (!(value instanceof Local)) return undefined;

        const localKey = `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}#${currentCtx}`;
        if (visiting.has(localKey)) return undefined;
        visiting.add(localKey);

        const decl = value.getDeclaringStmt?.();
        if (decl instanceof ArkAssignStmt && decl.getLeftOp?.() === value) {
            const right = decl.getRightOp?.();
            if (right instanceof Constant) {
                return normalizeContextLiteralText(right.toString());
            }
            if (right instanceof Local) {
                return this.resolveContextualValueKey(right, decl, currentCtx, visiting);
            }
            if (right instanceof ArkInstanceFieldRef) {
                return this.resolveLatestFieldStoreValueKey(right, decl, currentCtx, visiting);
            }
            if (right instanceof ArkParameterRef) {
                return this.resolveContextualParameterArgKey(value, currentCtx, visiting);
            }
        }
        return undefined;
    }

    private resolveLatestFieldStoreValueKey(
        fieldRef: ArkInstanceFieldRef,
        anchorStmt: ArkAssignStmt,
        currentCtx: number,
        visiting: Set<string>,
    ): string | undefined {
        const fieldName = fieldNameOf(fieldRef);
        if (!fieldName) return undefined;
        const base = fieldRef.getBase?.();
        if (!(base instanceof Local)) return undefined;

        const cfg = anchorStmt.getCfg?.() || base.getDeclaringStmt?.()?.getCfg?.();
        const stmts = cfg?.getStmts?.() || [];
        let latestValue: any;
        for (const stmt of stmts) {
            if (stmt === anchorStmt) break;
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp?.();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (!sameLocalValue(left.getBase?.(), base)) continue;
            if (fieldNameOf(left) !== fieldName) continue;
            latestValue = stmt.getRightOp?.();
        }
        if (!latestValue) return undefined;
        return this.resolveContextualValueKey(latestValue, anchorStmt, currentCtx, visiting);
    }

    private resolveContextualParameterArgKey(
        paramLocal: Local,
        currentCtx: number,
        visiting: Set<string>,
    ): string | undefined {
        const ctxManager = this.deps.ctxManager;
        const argIndex = this.deps.syntheticCallSourceNodeIdsByCallSiteAndDst;
        if (!ctxManager || !argIndex) return undefined;
        const callSiteId = ctxManager.getTopElement(currentCtx);
        if (callSiteId < 0) return undefined;

        const paramNodes = this.deps.pag.getNodesByValue(paramLocal);
        if (!paramNodes || paramNodes.size === 0) return undefined;
        const paramIndex = resolveParameterIndex(paramLocal);

        const resolved = new Set<string>();
        for (const dstNodeId of paramNodes.values()) {
            const srcNodeIds = argIndex.get(syntheticCallArgIndexKey(callSiteId, dstNodeId)) || [];
            if (srcNodeIds.length === 0 && this.deps.syntheticInvokeEdgeMap) {
                for (const edges of this.deps.syntheticInvokeEdgeMap.values()) {
                    for (const edge of edges) {
                        if (edge.type !== CallEdgeType.CALL) continue;
                        if (edge.callSiteId !== callSiteId || edge.dstNodeId !== dstNodeId) continue;
                        srcNodeIds.push(edge.srcNodeId);
                    }
                }
            }
            for (const srcNodeId of srcNodeIds) {
                const srcNode = this.deps.pag.getNode(srcNodeId) as PagNode;
                const srcValue = srcNode?.getValue?.();
                const sourceAnchor = srcNode?.getStmt?.();
                const fallbackAnchor = paramLocal.getDeclaringStmt?.();
                const anchorStmt = sourceAnchor instanceof ArkAssignStmt
                    ? sourceAnchor
                    : fallbackAnchor instanceof ArkAssignStmt
                    ? fallbackAnchor
                    : undefined;
                const key = this.resolveContextualValueKey(srcValue, anchorStmt, currentCtx, visiting);
                if (key !== undefined) resolved.add(key);
            }
        }
        if (resolved.size === 0 && paramIndex !== undefined) {
            const key = this.resolveContextualParameterArgKeyFromCallStmt(paramLocal, paramIndex, callSiteId, currentCtx, visiting);
            if (key !== undefined) resolved.add(key);
        }

        return resolved.size === 1 ? [...resolved][0] : undefined;
    }

    private resolveContextualParameterArgKeyFromCallStmt(
        paramLocal: Local,
        paramIndex: number,
        callSiteId: number,
        currentCtx: number,
        visiting: Set<string>,
    ): string | undefined {
        const edgeMap = this.deps.syntheticInvokeEdgeMap;
        if (!edgeMap) return undefined;
        const declaringMethodName = paramLocal
            .getDeclaringStmt?.()
            ?.getCfg?.()
            ?.getDeclaringMethod?.()
            ?.getName?.() || "";

        const resolved = new Set<string>();
        for (const edges of edgeMap.values()) {
            for (const edge of edges) {
                if (edge.type !== CallEdgeType.CALL) continue;
                if (edge.callSiteId !== callSiteId) continue;
                if (declaringMethodName && edge.calleeMethodName !== declaringMethodName) continue;
                const srcNode = this.deps.pag.getNode(edge.srcNodeId) as PagNode;
                const stmt = srcNode?.getStmt?.();
                const invokeExpr = resolveInvokeExprFromStmt(stmt);
                const arg = invokeExpr?.getArgs?.()?.[paramIndex];
                if (!arg) continue;
                const key = this.resolveContextualValueKey(arg, stmt instanceof ArkAssignStmt ? stmt : undefined, currentCtx, visiting);
                if (key !== undefined) resolved.add(key);
            }
        }
        return resolved.size === 1 ? [...resolved][0] : undefined;
    }

    private emitUnresolvedThisFieldLoads(
        out: FieldPropagationEmission[],
        dstNode: PagNode,
        destVarId: number,
        field: string[],
        fact: TaintFact,
        currentCtx: number,
        emissionScopeKeyPrefix: string,
    ): void {
        const shouldEmit = (newFact: TaintFact): boolean => {
            const emissionKey = `${emissionScopeKeyPrefix}\u0001${newFact.id}`;
            if (this.unresolvedThisFieldLoadEmissions.has(emissionKey)) return false;
            this.unresolvedThisFieldLoadEmissions.add(emissionKey);
            return true;
        };

        if (field.length > 1) {
            let hasPointTo = false;
            for (const nestedObjId of dstNode.getPointTo()) {
                hasPointTo = true;
                const nestedObjNode = this.deps.pag.getNode(nestedObjId) as PagNode;
                if (!nestedObjNode) continue;
                const newFact = new TaintFact(nestedObjNode, fact.source, currentCtx, field.slice(1));
                if (!shouldEmit(newFact)) continue;
                out.push({
                    stage: "Load-UnresolvedThisField",
                    fact: newFact,
                    message: `    [Load-UnresolvedThisField] Tainted Obj ${nestedObjId}.${newFact.field?.join(".")} from unresolved this.${field[0]} (ctx=${currentCtx})`,
                    traceSection: "field.load",
                });
            }
            if (!hasPointTo) {
                const newFact = new TaintFact(dstNode, fact.source, currentCtx, field.slice(1));
                if (!shouldEmit(newFact)) return;
                out.push({
                    stage: "Load-UnresolvedThisField",
                    fact: newFact,
                    message: `    [Load-UnresolvedThisField] Tainted local ${destVarId}.${newFact.field?.join(".")} from unresolved this.${field[0]} (ctx=${currentCtx})`,
                    traceSection: "field.load",
                });
            }
            return;
        }

        if (this.deps.tracker.hasDescendantFieldSourceAnyContext(fact.node.getID(), fact.source, field)) return;
        const newFact = new TaintFact(dstNode, fact.source, currentCtx);
        if (!shouldEmit(newFact)) return;
        out.push({
            stage: "Load-UnresolvedThisField",
            fact: newFact,
            message: `    [Load-UnresolvedThisField] Tainted var ${destVarId} from unresolved this.${field[0]} (ctx=${currentCtx})`,
            traceSection: "field.load",
        });
    }
}

function resolveIndexedLoadBaseCarrierNodeIds(
    pag: Pag,
    dstNode: PagNode,
    loadAnchorStmt: any,
    classBySignature?: Map<string, any>,
): number[] | undefined {
    if (!(loadAnchorStmt instanceof ArkAssignStmt)) return undefined;
    const right = loadAnchorStmt.getRightOp?.();
    if (right instanceof ArkInstanceFieldRef || right instanceof ArkArrayRef) {
        return collectCarrierNodeIdsForValueAtStmt(
            pag,
            right.getBase?.(),
            loadAnchorStmt,
            classBySignature,
        );
    }
    return undefined;
}

function collectIndexedFieldLoadTargets(
    fieldAccessIndex: FieldAccessIndex,
    node: PagNode,
    fieldName: string,
): IndexedFieldLoadTarget[] {
    const out: IndexedFieldLoadTarget[] = [];
    const seen = new Set<string>();
    for (const ownerId of collectFieldIndexOwnerIds(node)) {
        const destVarIds = fieldAccessIndex.getDirectFieldLoadTargetNodeIds(ownerId, fieldName);
        if (!destVarIds) continue;
        for (const destVarId of destVarIds) {
            const key = `${ownerId}|${destVarId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ ownerId, destVarId });
        }
    }
    return out;
}

function collectFieldIndexOwnerIds(node: PagNode): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    const add = (id: number): void => {
        if (!Number.isFinite(id) || seen.has(id)) return;
        seen.add(id);
        out.push(id);
    };
    add(node.getID());
    for (const objId of node.getPointTo?.() || []) {
        add(objId);
    }
    return out;
}

function fieldNameOf(ref: ArkInstanceFieldRef): string {
    return ref.getFieldSignature?.().getFieldName?.() || ref.getFieldName?.() || "";
}

function sameLocalValue(a: any, b: Local): boolean {
    return a instanceof Local && (a === b || (a.getName?.() || "") === (b.getName?.() || ""));
}

function syntheticCallArgIndexKey(callSiteId: number, dstNodeId: number): string {
    return `${callSiteId}|${dstNodeId}`;
}

function normalizeContextLiteralText(text: string): string {
    return String(text || "").replace(/^['"`]/, "").replace(/['"`]$/, "");
}

function resolveParameterIndex(local: Local): number | undefined {
    const decl = local.getDeclaringStmt?.();
    if (!(decl instanceof ArkAssignStmt)) return undefined;
    const right = decl.getRightOp?.();
    if (!(right instanceof ArkParameterRef)) return undefined;
    const index = right.getIndex?.();
    if (Number.isInteger(index)) return index;
    const matched = String(right.toString?.() || "").match(/parameter(\d+)\s*:/);
    return matched ? Number(matched[1]) : undefined;
}

function resolveInvokeExprFromStmt(stmt: any): ArkInstanceInvokeExpr | ArkStaticInvokeExpr | undefined {
    if (stmt instanceof ArkAssignStmt) {
        const rightOp = stmt.getRightOp?.();
        if (rightOp instanceof ArkInstanceInvokeExpr || rightOp instanceof ArkStaticInvokeExpr) return rightOp;
    }
    if (stmt instanceof ArkInvokeStmt) {
        const invokeExpr = stmt.getInvokeExpr?.();
        if (invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkStaticInvokeExpr) return invokeExpr;
    }
    const invokeExpr = stmt?.containsInvokeExpr?.() ? stmt.getInvokeExpr?.() : undefined;
    if (invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkStaticInvokeExpr) return invokeExpr;
    return undefined;
}
