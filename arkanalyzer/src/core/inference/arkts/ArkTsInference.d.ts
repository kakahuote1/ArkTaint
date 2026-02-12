import { ClassInference, ImportInfoInference, MethodInference, StmtInference } from '../ModelInference';
import { ArkMethod } from '../../model/ArkMethod';
import { InferenceBuilder } from '../InferenceBuilder';
import { FieldRefInference, InstanceInvokeExprInference, LocalInference, ValueInference } from '../ValueInference';
import { Stmt } from '../../base/Stmt';
import { Value } from '../../base/Value';
import { Type } from '../../base/Type';
import { ArkInstanceFieldRef } from '../../base/Ref';
import { Local } from '../../base/Local';
import { AliasTypeExpr, ArkInstanceInvokeExpr } from '../../base/Expr';
export declare class ArkTsStmtInference extends StmtInference {
    constructor(valueInferences: ValueInference<Value>[]);
    typeSpread(stmt: Stmt, method: ArkMethod): Set<Stmt>;
    transferRight2Left(leftOp: Value, rightType: Type, method: ArkMethod): Stmt[] | undefined;
    static updateUnionType(target: Value, srcType: Type, method: ArkMethod): Stmt[] | undefined;
    static updateGlobalRef(ref: Value | null, srcType: Type): Stmt[] | undefined;
}
export declare class ArkTsInferenceBuilder extends InferenceBuilder {
    buildImportInfoInference(): ImportInfoInference;
    buildClassInference(): ClassInference;
    buildMethodInference(): MethodInference;
    buildStmtInference(): StmtInference;
}
export declare class ArkTs2InferenceBuilder extends ArkTsInferenceBuilder {
}
export declare class JsInferenceBuilder extends InferenceBuilder {
    buildImportInfoInference(): ImportInfoInference;
    buildMethodInference(): MethodInference;
    buildStmtInference(): StmtInference;
}
export declare class ArkTSFieldRefInference extends FieldRefInference {
    preInfer(value: ArkInstanceFieldRef, stmt: Stmt): boolean;
    /**
     * Checks if a value represents an anonymous class 'this' field reference
     * Identifies field references that access fields directly on 'this' in anonymous class constructors
     * @param {Value} stmtDef - The value to check (typically a field reference)
     * @param {ArkMethod} arkMethod - The method containing the value
     * @returns {boolean} True if the value is an anonymous class 'this' field reference
     */
    private isAnonClassThisRef;
}
export declare class ArkTsInstanceInvokeExprInference extends InstanceInvokeExprInference {
    /**
     * Performs inference on an instance invocation expression within the context of a statement
     * Enhances the base implementation with real generic type inference and extension function support
     * @param {ArkInstanceInvokeExpr} value - The invocation expression to infer
     * @param {Stmt} stmt - The statement containing the invocation
     * @returns {Value | undefined} Returns a new expression if transformed, undefined otherwise
     */
    infer(value: ArkInstanceInvokeExpr, stmt: Stmt): Value | undefined;
    /**
     * process arkUI function with Annotation @Extend @Styles @AnimatableExtend
     * @param expr
     * @param arkMethod
     * @param methodName
     */
    private processExtendFunc;
}
export declare class AliasTypeExprInference extends ValueInference<AliasTypeExpr> {
    getValueName(): string;
    preInfer(value: AliasTypeExpr): boolean;
    infer(value: AliasTypeExpr, stmt: Stmt): Value | undefined;
}
export declare class ArkTSLocalInference extends LocalInference {
    getValueName(): string;
    preInfer(value: Local): boolean;
    infer(value: Local, stmt: Stmt): Value | undefined;
    private getEnumValue;
}
