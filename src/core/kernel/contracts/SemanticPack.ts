import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { fromContainerFieldKey, toContainerFieldKey } from "../ContainerSlotKeys";
import { TaintFact } from "../TaintFact";
import type { CallableResolveOptions } from "../../substrate/queries/CalleeResolver";

export interface SemanticPackRuleChain {
    sourceRuleId?: string;
    transferRuleIds: string[];
}

export interface SemanticPackQueryApi {
    resolveMethodsFromCallable(scene: Scene, value: any, options?: CallableResolveOptions): any[];
    collectParameterAssignStmts(calleeMethod: any): any[];
    collectFiniteStringCandidatesFromValue(scene: Scene, value: any, maxDepth?: number): string[];
}

export interface SemanticPackSetupContext {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
    fieldToVarIndex: Map<string, Set<number>>;
    queries: SemanticPackQueryApi;
    log: (msg: string) => void;
}

export interface SemanticPackFactEvent extends SemanticPackSetupContext {
    fact: TaintFact;
    node: PagNode;
}

export interface SemanticPackInvokeEvent extends SemanticPackFactEvent {
    stmt: any;
    invokeExpr: any;
    callSignature: string;
    methodName: string;
    declaringClassName: string;
    args: any[];
    baseValue?: any;
    resultValue?: any;
}

export interface SemanticPackCopyEdgeEvent {
    scene: Scene;
    pag: Pag;
    node: PagNode;
    contextId: number;
}

export interface SemanticPackEmission {
    reason: string;
    fact: TaintFact;
    chain?: SemanticPackRuleChain;
    allowUnreachableTarget?: boolean;
}

export interface SemanticPackSession {
    onFact?(event: SemanticPackFactEvent): SemanticPackEmission[] | void;
    onInvoke?(event: SemanticPackInvokeEvent): SemanticPackEmission[] | void;
    shouldSkipCopyEdge?(event: SemanticPackCopyEdgeEvent): boolean;
}

export interface SemanticPack {
    readonly id: string;
    readonly description: string;
    readonly enabled?: boolean;
    setup?(ctx: SemanticPackSetupContext): SemanticPackSession | void;
}

export interface SemanticPackRuntime {
    listPackIds(): string[];
    emitForFact(event: SemanticPackFactEvent): SemanticPackEmission[];
    emitForInvoke(event: SemanticPackInvokeEvent): SemanticPackEmission[];
    shouldSkipCopyEdge(event: SemanticPackCopyEdgeEvent): boolean;
}

export function defineSemanticPack<T extends SemanticPack>(pack: T): T {
    return pack;
}

export function resolveMethodsFromCallable(scene: Scene, value: any, options?: CallableResolveOptions): any[] {
    const mod = require("../../substrate/queries/CalleeResolver") as typeof import("../../substrate/queries/CalleeResolver");
    return mod.resolveMethodsFromCallable(scene, value, options);
}

export function collectParameterAssignStmts(calleeMethod: any): any[] {
    const mod = require("../../substrate/queries/CalleeResolver") as typeof import("../../substrate/queries/CalleeResolver");
    return mod.collectParameterAssignStmts(calleeMethod);
}

export function collectFiniteStringCandidatesFromValue(scene: Scene, value: any, maxDepth?: number): string[] {
    const mod = require("../../substrate/queries/FiniteStringCandidateResolver") as typeof import("../../substrate/queries/FiniteStringCandidateResolver");
    return mod.collectFiniteStringCandidatesFromValue(scene, value, maxDepth);
}

export {
    fromContainerFieldKey,
    TaintFact,
    toContainerFieldKey,
};
