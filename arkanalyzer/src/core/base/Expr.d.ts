import { BasicBlock } from '../graph/BasicBlock';
import { MethodSignature } from '../model/ArkSignature';
import { Local } from './Local';
import { ArrayType, ClassType, Type } from './Type';
import { Value } from './Value';
import { AbstractFieldRef } from './Ref';
import { ArkMethod } from '../model/ArkMethod';
import { ImportInfo } from '../model/ArkImport';
import { ArkClass } from '../model/ArkClass';
import { ArkField } from '../model/ArkField';
/**
 * @category core/base/expr
 */
export declare abstract class AbstractExpr implements Value {
    abstract getUses(): Value[];
    abstract getType(): Type;
    abstract toString(): string;
    inferType(arkMethod: ArkMethod): AbstractExpr;
}
export declare abstract class AbstractInvokeExpr extends AbstractExpr {
    private methodSignature;
    private args;
    private realGenericTypes?;
    private spreadFlags?;
    constructor(methodSignature: MethodSignature, args: Value[], realGenericTypes?: Type[], spreadFlags?: boolean[]);
    /**
     * Get method Signature. The method signature is consist of ClassSignature and MethodSubSignature.
     * It is the unique flag of a method. It is usually used to compose a expression string in ArkIRTransformer.
     * @returns The class method signature, such as ArkStaticInvokeExpr.
     * @example
     * 1. 3AC information composed of getMethodSignature ().

     ```typescript
     let strs: string[] = [];
     strs.push('staticinvoke <');
     strs.push(this.getMethodSignature().toString());
     strs.push('>(');
     ```
     */
    getMethodSignature(): MethodSignature;
    setMethodSignature(newMethodSignature: MethodSignature): void;
    /**
     * Returns an argument used in the expression according to its index.
     * @param index - the index of the argument.
     * @returns An argument used in the expression.
     */
    getArg(index: number): Value;
    /**
     * Returns an **array** of arguments used in the expression.
     * @returns An **array** of arguments used in the expression.
     * @example
     * 1. get args number.

     ```typescript
     const argsNum = expr.getArgs().length;
     if (argsNum < 5) {
     ... ...
     }
     ```

     2. iterate arg based on expression

     ```typescript
     for (const arg of this.getArgs()) {
     strs.push(arg.toString());
     strs.push(', ');
     }
     ```
     */
    getArgs(): Value[];
    setArgs(newArgs: Value[]): void;
    getType(): Type;
    getRealGenericTypes(): Type[] | undefined;
    setRealGenericTypes(realTypes: Type[] | undefined): void;
    getSpreadFlags(): boolean[] | undefined;
    getUses(): Value[];
    protected argsToString(): string;
}
export declare class ArkInstanceInvokeExpr extends AbstractInvokeExpr {
    private base;
    constructor(base: Local, methodSignature: MethodSignature, args: Value[], realGenericTypes?: Type[], spreadFlags?: boolean[]);
    /**
     * Returns the local of the instance of invoke expression.
     * @returns The local of the invoke expression's instance..
     */
    getBase(): Local;
    setBase(newBase: Local): void;
    /**
     * Returns an **array** of values used in this invoke expression,
     * including all arguments and values each arguments used.
     * For {@link ArkInstanceInvokeExpr}, the return also contains the caller base and uses of base.
     * @returns An **array** of arguments used in the invoke expression.
     */
    getUses(): Value[];
    toString(): string;
    inferType(arkMethod: ArkMethod): AbstractInvokeExpr;
}
export declare class ArkStaticInvokeExpr extends AbstractInvokeExpr {
    constructor(methodSignature: MethodSignature, args: Value[], realGenericTypes?: Type[], spreadFlags?: boolean[]);
    toString(): string;
    inferType(arkMethod: ArkMethod): AbstractInvokeExpr;
}
/**
 *     1. Local PtrInvokeExpr
 *
 *      ```typescript
 *      func foo():void {
 *      }
 *      let ptr = foo;
 *      ptr();
 *      ```
 *     2. FieldRef PtrInvokeExpr
 *
 *      ```typescript
 *      class A {
 *          b:()=> void()
 *      }
 *      new A().b()
 *      ```
 */
export declare class ArkPtrInvokeExpr extends AbstractInvokeExpr {
    private funPtr;
    constructor(methodSignature: MethodSignature, ptr: Local | AbstractFieldRef, args: Value[], realGenericTypes?: Type[], spreadFlags?: boolean[]);
    setFunPtrLocal(ptr: Local | AbstractFieldRef): void;
    getFuncPtrLocal(): Local | AbstractFieldRef;
    inferType(arkMethod: ArkMethod): AbstractInvokeExpr;
    toString(): string;
    getUses(): Value[];
}
export declare class ArkNewExpr extends AbstractExpr {
    private classType;
    constructor(classType: ClassType);
    getClassType(): ClassType;
    getUses(): Value[];
    getType(): Type;
    toString(): string;
    inferType(arkMethod: ArkMethod): ArkNewExpr;
    private constructorSignature;
}
export declare class ArkNewArrayExpr extends AbstractExpr {
    private baseType;
    private size;
    private fromLiteral;
    constructor(baseType: Type, size: Value, fromLiteral?: boolean);
    getSize(): Value;
    setSize(newSize: Value): void;
    getType(): ArrayType;
    getBaseType(): Type;
    setBaseType(newType: Type): void;
    isFromLiteral(): boolean;
    inferType(arkMethod: ArkMethod): ArkNewArrayExpr;
    getUses(): Value[];
    toString(): string;
}
export declare class ArkDeleteExpr extends AbstractExpr {
    private field;
    constructor(field: AbstractFieldRef);
    getField(): AbstractFieldRef;
    setField(newField: AbstractFieldRef): void;
    getType(): Type;
    getUses(): Value[];
    toString(): string;
}
export declare class ArkAwaitExpr extends AbstractExpr {
    private promise;
    constructor(promise: Value);
    getPromise(): Value;
    setPromise(newPromise: Value): void;
    getType(): Type;
    inferType(arkMethod: ArkMethod): ArkAwaitExpr;
    getUses(): Value[];
    toString(): string;
}
export declare class ArkYieldExpr extends AbstractExpr {
    private yieldValue;
    constructor(yieldValue: Value);
    getYieldValue(): Value;
    setYieldValue(newYieldValue: Value): void;
    getType(): Type;
    getUses(): Value[];
    toString(): string;
}
export declare enum NormalBinaryOperator {
    NullishCoalescing = "??",
    Exponentiation = "**",
    Division = "/",
    Addition = "+",
    Subtraction = "-",
    Multiplication = "*",
    Remainder = "%",
    LeftShift = "<<",
    RightShift = ">>",
    UnsignedRightShift = ">>>",
    BitwiseAnd = "&",
    BitwiseOr = "|",
    BitwiseXor = "^",
    LogicalAnd = "&&",
    LogicalOr = "||"
}
export declare enum RelationalBinaryOperator {
    LessThan = "<",
    LessThanOrEqual = "<=",
    GreaterThan = ">",
    GreaterThanOrEqual = ">=",
    Equality = "==",
    InEquality = "!=",
    StrictEquality = "===",
    StrictInequality = "!==",
    isPropertyOf = "in"
}
export type BinaryOperator = NormalBinaryOperator | RelationalBinaryOperator;
export declare abstract class AbstractBinopExpr extends AbstractExpr {
    protected op1: Value;
    protected op2: Value;
    protected operator: BinaryOperator;
    protected type: Type;
    constructor(op1: Value, op2: Value, operator: BinaryOperator);
    /**
     * Returns the first operand in the binary operation expression.
     * For example, the first operand in `a + b;` is `a`.
     * @returns The first operand in the binary operation expression.
     */
    getOp1(): Value;
    setOp1(newOp1: Value): void;
    /**
     * Returns the second operand in the binary operation expression.
     * For example, the second operand in `a + b;` is `b`.
     * @returns The second operand in the binary operation expression.
     */
    getOp2(): Value;
    setOp2(newOp2: Value): void;
    /**
     * Get the binary operator from the statement.
     * The binary operator can be divided into two categories,
     * one is the normal binary operator and the other is relational binary operator.
     * @returns The binary operator from the statement.
     * @example
     ```typescript
     if (expr instanceof AbstractBinopExpr) {
     let op1: Value = expr.getOp1();
     let op2: Value = expr.getOp2();
     let operator: string = expr.getOperator();
     ... ...
     }
     ```
     */
    getOperator(): BinaryOperator;
    getType(): Type;
    getUses(): Value[];
    toString(): string;
    protected inferOpType(op: Value, arkMethod: ArkMethod): void;
    private parseType;
    setType(): void;
    inferType(arkMethod: ArkMethod): AbstractBinopExpr;
}
export declare class ArkConditionExpr extends AbstractBinopExpr {
    constructor(op1: Value, op2: Value, operator: RelationalBinaryOperator);
    inferType(arkMethod: ArkMethod): ArkConditionExpr;
    fillType(): void;
}
export declare class ArkNormalBinopExpr extends AbstractBinopExpr {
    constructor(op1: Value, op2: Value, operator: NormalBinaryOperator);
}
export declare class ArkTypeOfExpr extends AbstractExpr {
    private op;
    constructor(op: Value);
    getOp(): Value;
    setOp(newOp: Value): void;
    getUses(): Value[];
    getType(): Type;
    toString(): string;
    inferType(arkMethod: ArkMethod): AbstractExpr;
}
export declare class ArkInstanceOfExpr extends AbstractExpr {
    private op;
    private checkType;
    constructor(op: Value, checkType: Type);
    getOp(): Value;
    setOp(newOp: Value): void;
    getCheckType(): Type;
    setCheckType(type: Type): void;
    getType(): Type;
    getUses(): Value[];
    toString(): string;
    inferType(arkMethod: ArkMethod): AbstractExpr;
}
export declare class ArkCastExpr extends AbstractExpr {
    private op;
    private type;
    constructor(op: Value, type: Type);
    getOp(): Value;
    setOp(newOp: Value): void;
    getUses(): Value[];
    getType(): Type;
    setType(type: Type): void;
    inferType(arkMethod: ArkMethod): AbstractExpr;
    toString(): string;
}
export declare class ArkPhiExpr extends AbstractExpr {
    private args;
    private argToBlock;
    constructor();
    getUses(): Value[];
    getArgs(): Local[];
    setArgs(args: Local[]): void;
    getArgToBlock(): Map<Local, BasicBlock>;
    setArgToBlock(argToBlock: Map<Local, BasicBlock>): void;
    getType(): Type;
    toString(): string;
}
export declare enum UnaryOperator {
    Neg = "-",
    BitwiseNot = "~",
    LogicalNot = "!"
}
export declare class ArkUnopExpr extends AbstractExpr {
    private op;
    private operator;
    constructor(op: Value, operator: UnaryOperator);
    getUses(): Value[];
    getOp(): Value;
    setOp(newOp: Value): void;
    getType(): Type;
    /**
     * Get the unary operator from the statement, such as `-`,`~`,`!`.
     * @returns the unary operator of a statement.
     */
    getOperator(): UnaryOperator;
    toString(): string;
}
export type AliasTypeOriginalModel = Type | ImportInfo | Local | ArkClass | ArkMethod | ArkField;
/**
 * Expression of the right hand of the type alias definition statement.
 * @category core/base/expr
 * @extends AbstractExpr
 * @example
 ```typescript
 let a: number = 123;
 type ABC = typeof a;
 ```
 * The AliasTypeExpr of the previous statement is with local 'a' as the 'originalObject' and 'transferWithTypeOf' is true.
 *
 * The Following case: import type with no clause name is not supported now,
 * whose 'originalObject' is {@link ImportInfo} with 'null' 'lazyExportInfo'.
 ```typescript
 let a = typeof import('./abc');
 ```
 */
export declare class AliasTypeExpr extends AbstractExpr {
    private originalType?;
    private originalObject;
    private readonly transferWithTypeOf;
    private realGenericTypes?;
    constructor(originalObject: AliasTypeOriginalModel, transferWithTypeOf?: boolean);
    getOriginalObject(): AliasTypeOriginalModel;
    setOriginalObject(object: AliasTypeOriginalModel): void;
    getTransferWithTypeOf(): boolean;
    setRealGenericTypes(realGenericTypes: Type[]): void;
    getRealGenericTypes(): Type[] | undefined;
    getOriginalType(): Type | undefined;
    setOriginalType(type: Type): Type;
    getType(): Type;
    inferType(arkMethod: ArkMethod): AbstractExpr;
    /**
     * Returns all used values which mainly used for def-use chain analysis.
     * @returns Always returns empty array because her is the alias type definition which has no relationship with value flow.
     */
    getUses(): Value[];
    toString(): string;
    static isAliasTypeOriginalModel(object: any): object is AliasTypeOriginalModel;
}
