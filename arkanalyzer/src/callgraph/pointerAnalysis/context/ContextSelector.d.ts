import { CallGraph, FuncID, ICallSite } from '../../model/CallGraph';
import { Context, ContextCache, ContextID } from './Context';
import { ContextItemManager } from './ContextItem';
/**
 * Top layer of context
 */
export declare const emptyID: number;
export interface ContextSelector {
    ctxCache: ContextCache;
    ctxManager: ContextItemManager;
    selectContext(callerContextID: ContextID, callSite: ICallSite, obj: number, calleeFunc: number): ContextID;
    emptyContext(id: number): ContextID;
    getContextID(context: Context): ContextID;
    dump(path: string, cg: CallGraph): void;
}
export declare class KCallSiteContextSelector implements ContextSelector {
    private k;
    ctxCache: ContextCache;
    ctxManager: ContextItemManager;
    constructor(k: number);
    selectContext(callerContextID: ContextID, callSite: ICallSite, obj: number, callee: number): ContextID;
    emptyContext(id: number): ContextID;
    getContextID(context: Context): ContextID;
    dump(dir: string, cg: CallGraph): void;
}
export declare class KObjContextSelector implements ContextSelector {
    private k;
    ctxCache: ContextCache;
    ctxManager: ContextItemManager;
    constructor(k: number);
    selectContext(callerContextID: ContextID, callSite: ICallSite, obj: number, callee: number): ContextID;
    emptyContext(id: number): ContextID;
    getContextID(context: Context): ContextID;
    dump(dir: string, cg: CallGraph): void;
}
export declare class KFuncContextSelector implements ContextSelector {
    private k;
    ctxCache: ContextCache;
    ctxManager: ContextItemManager;
    constructor(k: number);
    selectContext(callerContextID: ContextID, callSite: ICallSite, obj: number, funcID: number): ContextID;
    emptyContext(funcID: FuncID): ContextID;
    getContextID(context: Context): ContextID;
    dump(dir: string, cg: CallGraph): void;
}
