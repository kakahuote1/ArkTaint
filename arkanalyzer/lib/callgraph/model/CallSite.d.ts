import { Stmt } from '../../core/base/Stmt';
import { Value } from '../../core/base/Value';
import { FuncID } from './CallGraph';
export type CallSiteID = number;
export interface ICallSite {
    id: CallSiteID;
    callStmt: Stmt;
    args: Value[] | undefined;
    callerFuncID: FuncID;
    getCalleeFuncID(): FuncID | undefined;
}
export declare class CallSite implements ICallSite {
    id: CallSiteID;
    callStmt: Stmt;
    args: Value[] | undefined;
    calleeFuncID: FuncID;
    callerFuncID: FuncID;
    constructor(id: CallSiteID, s: Stmt, a: Value[] | undefined, ce: FuncID, cr: FuncID);
    getCalleeFuncID(): FuncID | undefined;
}
export declare class DynCallSite implements ICallSite {
    id: CallSiteID;
    callStmt: Stmt;
    args: Value[] | undefined;
    protentialCalleeFuncID: FuncID | undefined;
    callerFuncID: FuncID;
    constructor(id: CallSiteID, s: Stmt, a: Value[] | undefined, ptcCallee: FuncID | undefined, caller: FuncID);
    getCalleeFuncID(): FuncID | undefined;
}
export declare class CallSiteManager {
    private idToCallSiteMap;
    private callSiteToIdMap;
    private dynToStaticMap;
    newCallSite(s: Stmt, a: Value[] | undefined, ce: FuncID, cr: FuncID): CallSite;
    newDynCallSite(s: Stmt, a: Value[] | undefined, ptcCallee: FuncID | undefined, caller: FuncID): DynCallSite;
    cloneCallSiteFromDyn(dynCallSite: DynCallSite, calleeFuncID: FuncID): CallSite;
    getCallSiteById(id: CallSiteID): ICallSite | undefined;
}
//# sourceMappingURL=CallSite.d.ts.map