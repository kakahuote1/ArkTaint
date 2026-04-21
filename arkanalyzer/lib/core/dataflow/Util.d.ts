import { ArkInvokeStmt } from '../base/Stmt';
import { ArkMethod } from '../model/ArkMethod';
import { Local } from '../base/Local';
import { AbstractRef } from '../base/Ref';
export declare const INTERNAL_PARAMETER_SOURCE: string[];
export declare const INTERNAL_SINK_METHOD: string[];
export declare function getRecallMethodInParam(stmt: ArkInvokeStmt): ArkMethod | null;
export declare function LocalEqual(local1: Local, local2: Local): boolean;
export declare function RefEqual(ref1: AbstractRef, ref2: AbstractRef): boolean;
//# sourceMappingURL=Util.d.ts.map