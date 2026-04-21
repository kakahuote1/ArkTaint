import { Stmt } from '../base/Stmt';
import { Value } from '../base/Value';
import { Inference, InferenceFlow } from './Inference';
import { ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ClosureFieldRef } from '../base/Ref';
import { Type } from '../base/Type';
import { ArkMethod } from '../model/ArkMethod';
import { AbstractInvokeExpr, ArkCastExpr, ArkConditionExpr, ArkInstanceInvokeExpr, ArkInstanceOfExpr, ArkNewArrayExpr, ArkNewExpr, ArkNormalBinopExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from '../base/Expr';
import { Local } from '../base/Local';
export declare enum InferLanguage {
    UNKNOWN = -1,
    COMMON = 0,
    ARK_TS1_1 = 1,
    ARK_TS1_2 = 2,
    JAVA_SCRIPT = 3,
    CXX = 21,
    ABC = 51
}
export declare const valueCtors: Map<Function, InferLanguage>;
export declare function Bind(lang?: InferLanguage): Function;
/**
 * Abstract base class for value-specific inference operations
 * @template T - Type parameter that must extend the Value base class
 */
export declare abstract class ValueInference<T extends Value> implements Inference, InferenceFlow {
    /**
     * Returns the name of the value being inferred
     * @returns Name identifier for the value
     */
    abstract getValueName(): string;
    /**
     * Prepares for inference operation
     * @param value - The value to prepare for inference
     * @param stmt - The statement where the value is located
     * @returns True if inference should proceed, false otherwise
     */
    abstract preInfer(value: T, stmt?: Stmt): boolean;
    /**
     * Performs the actual inference operation
     * @param value - The value to perform inference on
     * @param stmt - The statement where the value is located
     * @returns New inferred value or undefined if no changes
     */
    abstract infer(value: T, stmt?: Stmt): Value | undefined;
    /**
     * Main inference workflow implementation
     * Orchestrates the preInfer → infer → postInfer sequence
     * @param value - The value to perform inference on
     * @param stmt - The statement where the value is located
     */
    doInfer(value: T, stmt?: Stmt): void;
    /**
     * Handles updates after inference completes
     * Replaces values in statements if new values are inferred
     * @param value - The original value that was inferred
     * @param newValue - The new inferred value
     * @param stmt - The statement where the value is located
     */
    postInfer(value: T, newValue?: Value, stmt?: Stmt): void;
}
/**
 * Parameter reference inference implementation for ArkParameterRef values
 * Handles type inference and resolution for parameter references in the IR
 */
export declare class ParameterRefInference extends ValueInference<ArkParameterRef> {
    getValueName(): string;
    /**
     * Determines if pre-inference should be performed on the given parameter reference
     * Checks if the parameter type requires inference (lexical environment types or unclear types)
     * @param {ArkParameterRef} value - The parameter reference to evaluate
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value: ArkParameterRef): boolean;
    /**
     * Performs inference on a parameter reference within the context of a statement
     * Resolves the parameter reference using the method's declaration context
     * @param {ArkParameterRef} value - The parameter reference to infer
     * @param {Stmt} stmt - The statement containing the parameter reference
     * @returns {Value | undefined} Always returns undefined as parameter references are resolved in-place
     */
    infer(value: ArkParameterRef, stmt: Stmt): Value | undefined;
}
/**
 * Closure field reference inference implementation for ClosureFieldRef values
 * Handles type inference and resolution for closure field references in the IR
 */
export declare class ClosureFieldRefInference extends ValueInference<ClosureFieldRef> {
    getValueName(): string;
    /**
     * Determines if pre-inference should be performed on the given closure field reference
     * Checks if the closure field type requires inference (unclear types)
     * @param {ClosureFieldRef} value - The closure field reference to evaluate
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value: ClosureFieldRef): boolean;
    /**
     * Performs inference on a closure field reference
     * Resolves the closure field type by looking up the field in the lexical environment's closures
     * @param {ClosureFieldRef} value - The closure field reference to infer
     * @returns {Value | undefined} Always returns undefined as closure field references are resolved in-place
     */
    infer(value: ClosureFieldRef): Value | undefined;
}
export declare class FieldRefInference extends ValueInference<ArkInstanceFieldRef> {
    getValueName(): string;
    /**
     * Determines if pre-inference should be performed on the given field reference
     * Checks if the field requires inference based on declaring signature, type clarity, or static status
     * @param {ArkInstanceFieldRef} value - The field reference to evaluate
     * @param {Stmt} [stmt] - Optional statement context for the evaluation
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value: ArkInstanceFieldRef, stmt?: Stmt): boolean;
    /**
     * Performs inference on a field reference within the context of a statement
     * Handles special cases for array types and dynamic field access, and generates updated field signatures
     * @param {ArkInstanceFieldRef} value - The field reference to infer
     * @param {Stmt} stmt - The statement containing the field reference
     * @returns {Value | undefined} Returns a new ArkArrayRef for array types, ArkStaticFieldRef for static fields,
     *          or undefined for regular instance fields
     */
    infer(value: ArkInstanceFieldRef, stmt: Stmt): Value | undefined;
}
export declare class StaticFieldRefInference extends ValueInference<ArkStaticFieldRef> {
    getValueName(): string;
    /**
     * Determines if pre-inference should be performed on the given static field reference
     * Checks if the field requires inference based on declaring signature or type clarity
     * @param {ArkStaticFieldRef} value - The static field reference to evaluate
     * @param {Stmt} [stmt] - Optional statement context for the evaluation
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value: ArkStaticFieldRef, stmt?: Stmt): boolean;
    /**
     * Performs inference on a static field reference within the context of a statement
     * Resolves the base type and generates updated field signatures, maintaining static field semantics
     * @param {ArkStaticFieldRef} value - The static field reference to infer
     * @param {Stmt} stmt - The statement containing the static field reference
     * @returns {Value | undefined} Returns a new ArkStaticFieldRef with updated signature, or undefined if no changes
     */
    infer(value: ArkStaticFieldRef, stmt: Stmt): Value | undefined;
}
export declare class InstanceInvokeExprInference extends ValueInference<ArkInstanceInvokeExpr> {
    getValueName(): string;
    /**
     * Determines if pre-inference should be performed on the given invocation expression
     * Checks if the method requires inference based on declaring signature or type clarity
     * @param {ArkInstanceInvokeExpr} value - The invocation expression to evaluate
     * @param {Stmt} [stmt] - Optional statement context for the evaluation
     * @returns {boolean} True if pre-inference should be performed, false otherwise
     */
    preInfer(value: ArkInstanceInvokeExpr, stmt: Stmt | undefined): boolean;
    /**
     * Performs inference on an instance invocation expression within the context of a statement
     * Resolves the base type and method signature, handling various base type scenarios
     * @param {ArkInstanceInvokeExpr} value - The invocation expression to infer
     * @param {Stmt} stmt - The statement containing the invocation
     * @returns {Value | undefined} Returns a new invocation expression if transformed, undefined otherwise
     */
    infer(value: ArkInstanceInvokeExpr, stmt: Stmt): Value | undefined;
    /**
     * Performs post-inference processing on invocation expressions
     * Handles special case for super() calls by replacing the base with 'this' local
     * @param {ArkInstanceInvokeExpr} value - The original invocation expression
     * @param {Value} newValue - The new value after inference
     * @param {Stmt} stmt - The statement containing the invocation
     */
    postInfer(value: ArkInstanceInvokeExpr, newValue: Value, stmt: Stmt): void;
    getMethodName(expr: AbstractInvokeExpr, arkMethod: ArkMethod): string;
    static inferInvokeExpr(baseType: Type, expr: AbstractInvokeExpr, arkMethod: ArkMethod): AbstractInvokeExpr | null;
}
export declare class StaticInvokeExprInference extends InstanceInvokeExprInference {
    getValueName(): string;
    preInfer(value: ArkStaticInvokeExpr, stmt: Stmt | undefined): boolean;
    infer(expr: ArkStaticInvokeExpr, stmt: Stmt): Value | undefined;
    private getBaseType;
}
export declare class ArkPtrInvokeExprInference extends StaticInvokeExprInference {
    getValueName(): string;
    infer(expr: ArkPtrInvokeExpr, stmt: Stmt): Value | undefined;
}
export declare class ArkNewExprInference extends ValueInference<ArkNewExpr> {
    getValueName(): string;
    preInfer(value: ArkNewExpr): boolean;
    infer(value: ArkNewExpr, stmt: Stmt): Value | undefined;
}
export declare class ArkNewArrayExprInference extends ValueInference<ArkNewArrayExpr> {
    getValueName(): string;
    preInfer(value: ArkNewArrayExpr): boolean;
    infer(value: ArkNewArrayExpr, stmt: Stmt): Value | undefined;
}
export declare class ArkNormalBinOpExprInference extends ValueInference<ArkNormalBinopExpr> {
    getValueName(): string;
    preInfer(value: ArkNormalBinopExpr): boolean;
    infer(value: ArkNormalBinopExpr): Value | undefined;
}
export declare class ArkConditionExprInference extends ArkNormalBinOpExprInference {
    getValueName(): string;
    preInfer(value: ArkConditionExpr): boolean;
    infer(value: ArkConditionExpr): Value | undefined;
}
export declare class ArkInstanceOfExprInference extends ValueInference<ArkInstanceOfExpr> {
    getValueName(): string;
    preInfer(value: ArkInstanceOfExpr): boolean;
    infer(value: ArkInstanceOfExpr, stmt: Stmt): Value | undefined;
}
export declare class ArkCastExprInference extends ValueInference<ArkCastExpr> {
    getValueName(): string;
    preInfer(value: ArkCastExpr): boolean;
    infer(value: ArkCastExpr, stmt: Stmt): Value | undefined;
}
export declare class LocalInference extends ValueInference<Local> {
    getValueName(): string;
    preInfer(value: Local): boolean;
    infer(value: Local, stmt: Stmt): Value | undefined;
}
