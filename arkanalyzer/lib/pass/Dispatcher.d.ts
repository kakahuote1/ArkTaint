import type { Value } from '../core/base/Value';
import { ArkAliasTypeDefineStmt, ArkAssignStmt, ArkIfStmt, ArkInvokeStmt, ArkReturnStmt, ArkReturnVoidStmt, ArkThrowStmt, Stmt } from '../core/base/Stmt';
import { AbstractBinopExpr, AbstractExpr, AbstractInvokeExpr, AliasTypeExpr, ArkAwaitExpr, ArkCastExpr, ArkConditionExpr, ArkDeleteExpr, ArkInstanceInvokeExpr, ArkInstanceOfExpr, ArkNewArrayExpr, ArkNewExpr, ArkNormalBinopExpr, ArkPhiExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr, ArkTypeOfExpr, ArkUnopExpr, ArkYieldExpr } from '../core/base/Expr';
import { FallAction, MethodCtx } from './Pass';
import { BigIntConstant, BooleanConstant, Constant, NullConstant, NumberConstant, StringConstant, UndefinedConstant } from '../core/base/Constant';
import type { ArkMethod } from '../core/model/ArkMethod';
import { Local } from '../core/base/Local';
import { AbstractFieldRef, AbstractRef, ArkCaughtExceptionRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ArkThisRef, ClosureFieldRef, GlobalRef } from '../core/base/Ref';
/**
 * Represents a function type that processes a value and context, optionally returning a FallAction to control flow.
 * This function is invoked with a value of type T , a context object and a method object, and it can decide whether to skip subsequent passes.

 * @param value:T - The inst to be executed
 * @param ctx:MethodCtx - The method context of this inst
 * @param mtd:ArkMethod - The method of this inst
 * @returns  If a FallAction is returned, it indicates the action to take regarding skipping or halting further processing.
 *           Returning nothing or void implies no special action, allowing the next passes to execute normally.
 */
export interface InstPass<T> {
    (value: T, ctx: MethodCtx, mtd: ArkMethod): FallAction | void;
}
type IndexOf<T extends readonly any[]> = Extract<keyof T, `${number}`>;
/**
 * Represents all statement types used within the system.
 */
declare const STMTS: readonly [typeof ArkAssignStmt, typeof ArkInvokeStmt, typeof ArkIfStmt, typeof ArkReturnStmt, typeof ArkReturnVoidStmt, typeof ArkThrowStmt, typeof ArkAliasTypeDefineStmt, typeof Stmt];
/**
 * class of stmts
 */
export type StmtClass = typeof STMTS[number];
/**
 * stmts classes
 */
export type StmtTy = {
    [K in IndexOf<typeof STMTS>]: InstanceType<typeof STMTS[K]>;
}[IndexOf<typeof STMTS>];
type StmtPass = {
    [K in IndexOf<typeof STMTS>]: InstPass<InstanceType<typeof STMTS[K]>>;
}[IndexOf<typeof STMTS>];
type StmtList<S extends StmtClass> = [S, InstPass<InstanceType<S>>[] | InstPass<InstanceType<S>>];
/**
 * Represents an initialization statement type derived from the `STMTS` constant.
 * This type maps each index of the `STMTS` array to a corresponding `StmtList` type,
 * effectively creating a union of all possible statement list types defined by `STMTS`.
 * It is used to ensure type safety and consistency when working with statement lists
 * associated with the `STMTS` entries.
 */
export type StmtInit = {
    [K in IndexOf<typeof STMTS>]: StmtList<typeof STMTS[K]>;
}[IndexOf<typeof STMTS>];
/**
 * Represents all values types used within the system.
 */
declare const VALUES: readonly [typeof AliasTypeExpr, typeof ArkUnopExpr, typeof ArkPhiExpr, typeof ArkCastExpr, typeof ArkInstanceOfExpr, typeof ArkTypeOfExpr, typeof ArkNormalBinopExpr, typeof ArkConditionExpr, typeof AbstractBinopExpr, typeof ArkYieldExpr, typeof ArkAwaitExpr, typeof ArkDeleteExpr, typeof ArkNewArrayExpr, typeof ArkNewExpr, typeof ArkPtrInvokeExpr, typeof ArkStaticInvokeExpr, typeof ArkInstanceInvokeExpr, typeof AbstractInvokeExpr, typeof AbstractExpr, typeof ClosureFieldRef, typeof GlobalRef, typeof ArkCaughtExceptionRef, typeof ArkThisRef, typeof ArkParameterRef, typeof ArkStaticFieldRef, typeof ArkInstanceFieldRef, typeof AbstractFieldRef, typeof AbstractRef, typeof UndefinedConstant, typeof NullConstant, typeof StringConstant, typeof BigIntConstant, typeof NumberConstant, typeof BooleanConstant, typeof Constant, typeof Local];
/**
 * class of stmts
 */
type ValueClass = typeof VALUES[number];
/**
 * stmts classes
 */
export type ValueTy = {
    [K in IndexOf<typeof VALUES>]: InstanceType<typeof VALUES[K]>;
}[IndexOf<typeof VALUES>];
type ValuePass = {
    [K in IndexOf<typeof VALUES>]: InstPass<InstanceType<typeof VALUES[K]>>;
}[IndexOf<typeof VALUES>];
type ValuePair<S extends ValueClass> = [S, InstPass<InstanceType<S>>[] | InstPass<InstanceType<S>>];
/**
 * Represents an initialization value for a specific index in the VALUES array.
 * This type maps each index of the VALUES array to a corresponding ValuePair type,
 * ensuring that only valid initialization values for the given index are allowed.
 * The resulting type is a union of all possible ValuePair types derived from the VALUES array.
 */
export type ValueInit = {
    [K in IndexOf<typeof VALUES>]: ValuePair<typeof VALUES[K]>;
}[IndexOf<typeof VALUES>];
/**
 * the dispatch table, it can be cached
 */
export declare class Dispatch {
    name: string;
    readonly stmts: StmtClass[];
    readonly smap: Map<StmtClass, StmtPass[]>;
    readonly values: ValueClass[];
    readonly vmap: Map<ValueClass, ValuePass[]>;
    constructor(stmts?: StmtInit[], values?: ValueInit[]);
}
/**
 * the ArkIR dispatcher, to dispatch stmts and values actions
 */
export declare class Dispatcher {
    private readonly ctx;
    protected fallAction: FallAction;
    private readonly dispatch;
    private cache;
    constructor(ctx: MethodCtx, dispatch?: Dispatch);
    dispatchStmt(mtd: ArkMethod, stmt: Stmt): void;
    dispatchValue(mtd: ArkMethod, value: Value): void;
}
export {};
//# sourceMappingURL=Dispatcher.d.ts.map