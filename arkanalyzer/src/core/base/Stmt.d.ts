import { Cfg } from '../graph/Cfg';
import { AbstractExpr, AbstractInvokeExpr, AliasTypeExpr, ArkConditionExpr } from './Expr';
import { AbstractFieldRef, ArkArrayRef } from './Ref';
import { Value } from './Value';
import { FullPosition, LineColPosition } from './Position';
import { ArkMetadata, ArkMetadataKind, ArkMetadataType } from '../model/ArkMetadata';
import { AliasType } from './Type';
import { AbstractTypeExpr } from './TypeExpr';
/**
 * @category core/base/stmt
 */
export declare abstract class Stmt {
    protected text?: string;
    protected originalText?: string;
    protected originalPosition: LineColPosition;
    protected cfg: Cfg;
    protected operandOriginalPositions?: FullPosition[];
    metadata?: ArkMetadata;
    getMetadata(kind: ArkMetadataKind): ArkMetadataType | undefined;
    setMetadata(kind: ArkMetadataKind, value: ArkMetadataType): void;
    /** Return a list of values which are uesd in this statement */
    getUses(): Value[];
    replaceUse(oldUse: Value, newUse: Value): void;
    /**
     * Return the definition which is uesd in this statement. Generally, the definition is the left value of `=` in
     * 3AC.  For example, the definition in 3AC of `value = parameter0: @project-1/sample-1.ets: AnonymousClass-0` is
     * `value`,  and the definition in `$temp0 = staticinvoke <@_ProjectName/_FileName: xxx.create()>()` is `\$temp0`.
     * @returns The definition in 3AC (may be a **null**).
     * @example
     * 1. get the def in stmt.
     ```typescript
     for (const block of this.blocks) {
     for (const stmt of block.getStmts()) {
     const defValue = stmt.getDef();
     ...
     }
     }
     ```
     */
    getDef(): Value | null;
    replaceDef(oldDef: Value, newDef: Value): void;
    getDefAndUses(): Value[];
    /**
     * Get the CFG (i.e., control flow graph) of an {@link ArkBody} in which the statement is.
     * A CFG contains a set of basic blocks and statements corresponding to each basic block.
     * Note that, "source code" and "three-address" are two types of {@link Stmt} in ArkAnalyzer.
     * Source code {@link Stmt} represents the statement of ets/ts source code, while three-address code {@link Stmt}
     * represents the statement after it has been converted into three-address code.  Since the source code {@link
     * Stmt} does not save its CFG reference, it returns **null**, while the `getCfg()` of the third address code
     * {@link Stmt} will return its CFG reference.
     * @returns The CFG (i.e., control flow graph) of an {@link ArkBody} in which the statement is.
     * @example
     * 1. get the ArkFile based on stmt.
     ```typescript
     const arkFile = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkFile();
     ```
     2. get the ArkMethod based on stmt.
     ```typescript
     let sourceMethod: ArkMethod = stmt.getCfg()?.getDeclaringMethod();
     ```
     */
    getCfg(): Cfg;
    setCfg(cfg: Cfg): void;
    /**
     * Return true if the following statement may not execute after this statement.
     * The ArkIfStmt and ArkGotoStmt will return true.
     */
    isBranch(): boolean;
    /** Return the number of statements which this statement may go to */
    getExpectedSuccessorCount(): number;
    containsInvokeExpr(): boolean;
    /**
     * Returns the method's invocation expression (including method signature and its arguments)
     * in the current statement. An **undefined** will be returned if there is no method used in this statement.
     * @returns  the method's invocation expression from the statement. An **undefined** will be returned if there is
     *     no method can be found in this statement.
     * @example
     * 1. get invoke expr based on stmt.
     ```typescript
     let invoke = stmt.getInvokeExpr();
     ```
     */
    getInvokeExpr(): AbstractInvokeExpr | undefined;
    /**
     * Returns an array of expressions in the statement.
     * @returns An array of expressions in the statement.
     * @example
     * 1. Traverse expression of statement.

     ```typescript
     for (const expr of stmt.getExprs()) {
     ...
     }
     ```
     */
    getExprs(): AbstractExpr[];
    getTypeExprs(): AbstractTypeExpr[];
    containsArrayRef(): boolean;
    getArrayRef(): ArkArrayRef | undefined;
    containsFieldRef(): boolean;
    getFieldRef(): AbstractFieldRef | undefined;
    setOriginPositionInfo(originPositionInfo: LineColPosition): void;
    /**
     * Returns the original position of the statement.
     * The position consists of two parts: line number and column number.
     * In the source file, the former (i.e., line number) indicates which line the statement is in,
     * and the latter (i.e., column number) indicates the position of the statement in the line.
     * The position is described as `LineColPosition(lineNo,colNum)` in ArkAnalyzer,
     * and its default value is LineColPosition(-1,-1).
     * @returns The original location of the statement.
     * @example
     * 1. Get the stmt position info to make some condition judgements.
     ```typescript
     for (const stmt of stmts) {
     if (stmt.getOriginPositionInfo().getLineNo() === -1) {
     stmt.setOriginPositionInfo(originalStmt.getOriginPositionInfo());
     this.stmtToOriginalStmt.set(stmt, originalStmt);
     }
     }
     ```
     */
    getOriginPositionInfo(): LineColPosition;
    abstract toString(): string;
    setText(text: string): void;
    setOriginalText(originalText: string): void;
    getOriginalText(): string | undefined;
    setOperandOriginalPositions(operandOriginalPositions: FullPosition[]): void;
    getOperandOriginalPositions(): FullPosition[] | undefined;
    getOperandOriginalPosition(indexOrOperand: number | Value): FullPosition | null;
}
export declare class ArkAssignStmt extends Stmt {
    private leftOp;
    private rightOp;
    constructor(leftOp: Value, rightOp: Value);
    /**
     * Returns the left operand of the assigning statement.
     * @returns The left operand of the assigning statement.
     * @example
     * 1. If the statement is `a=b;`, the right operand is `a`; if the statement is `dd = cc + 5;`, the right operand
     *     is `cc`.
     */
    getLeftOp(): Value;
    setLeftOp(newLeftOp: Value): void;
    /**
     * Returns the right operand of the assigning statement.
     * @returns The right operand of the assigning statement.
     * @example
     * 1. If the statement is `a=b;`, the right operand is `b`; if the statement is `dd = cc + 5;`, the right operand
     *     is `cc + 5`.
     * 2. Get the rightOp from stmt.
     ```typescript
     const rightOp = stmt.getRightOp();
     ```
     */
    getRightOp(): Value;
    setRightOp(rightOp: Value): void;
    toString(): string;
    getDef(): Value | null;
    getUses(): Value[];
}
export declare class ArkInvokeStmt extends Stmt {
    private invokeExpr;
    constructor(invokeExpr: AbstractInvokeExpr);
    replaceInvokeExpr(newExpr: AbstractInvokeExpr): void;
    getInvokeExpr(): AbstractInvokeExpr;
    toString(): string;
    getUses(): Value[];
}
export declare class ArkIfStmt extends Stmt {
    private conditionExpr;
    constructor(conditionExpr: ArkConditionExpr);
    /**
     * The condition expression consisit of two values as operands and one binary operator as operator.
     * The operator can indicate the relation between the two values, e.g., `<`, `<=`,`>`, `>=`, `==`, `!=`, `===`,
     * `!==`.
     * @returns a condition expression.
     * @example
     * 1. When a statement is `if (a > b)`, the operands are `a` and `b`, the operator is `<`. Therefore, the condition
     *     expression is `a > b`.
     * 2. get a conditon expr from a condition statement.
     ```typescript
     let expr = (this.original as ArkIfStmt).getConditionExpr();
     ```
     */
    getConditionExpr(): ArkConditionExpr;
    setConditionExpr(newConditionExpr: ArkConditionExpr): void;
    isBranch(): boolean;
    getExpectedSuccessorCount(): number;
    toString(): string;
    getUses(): Value[];
}
export declare class ArkReturnStmt extends Stmt {
    private op;
    constructor(op: Value);
    getExpectedSuccessorCount(): number;
    getOp(): Value;
    setReturnValue(returnValue: Value): void;
    toString(): string;
    getUses(): Value[];
}
export declare class ArkReturnVoidStmt extends Stmt {
    constructor();
    getExpectedSuccessorCount(): number;
    toString(): string;
}
export declare class ArkThrowStmt extends Stmt {
    private op;
    constructor(op: Value);
    getOp(): Value;
    setOp(newOp: Value): void;
    toString(): string;
    getUses(): Value[];
}
/**
 * Statement of type alias definition combines with the left hand as {@link AliasType} and right hand as {@link AliasTypeExpr}.
 * @category core/base/stmt
 * @extends Stmt
 * @example
 ```typescript
 type A = string;
 type B = import('./abc').TypeB;

 let c = 123;
 declare type C = typeof c;
 ```
 */
export declare class ArkAliasTypeDefineStmt extends Stmt {
    private aliasType;
    private aliasTypeExpr;
    constructor(aliasType: AliasType, typeAliasExpr: AliasTypeExpr);
    getAliasType(): AliasType;
    getAliasTypeExpr(): AliasTypeExpr;
    getAliasName(): string;
    toString(): string;
    getUses(): Value[];
    getTypeExprs(): AbstractTypeExpr[];
}
