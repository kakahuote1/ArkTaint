import { Constant } from '../../core/base/Constant';
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from '../../core/base/Expr';
import { Local } from '../../core/base/Local';
import { ArkClass } from '../../core/model/ArkClass';
import { ArkMethod } from '../../core/model/ArkMethod';
import { ClassSignature, MethodSignature } from '../../core/model/ArkSignature';
import { ArkCodeBuffer } from '../ArkStream';
import { ClassType, Type } from '../../core/base/Type';
import { Value } from '../../core/base/Value';
import { AbstractRef } from '../../core/base/Ref';
import { ArkFile } from '../../core/model/ArkFile';
import { ArkNamespace } from '../../core/model/ArkNamespace';
export interface TransformerContext {
    getArkFile(): ArkFile;
    getDeclaringArkNamespace(): ArkNamespace | undefined;
    getMethod(signature: MethodSignature): ArkMethod | null;
    getClass(signature: ClassSignature): ArkClass | null;
    getPrinter(): ArkCodeBuffer;
    transTemp2Code(temp: Local, isLeftOp: boolean): string;
    isInBuilderMethod(): boolean;
}
export declare class SourceTransformer {
    protected context: TransformerContext;
    constructor(context: TransformerContext);
    private anonymousMethodToString;
    private anonymousClassToString;
    instanceInvokeExprToString(invokeExpr: ArkInstanceInvokeExpr, isAttr: boolean): string;
    private transBuilderMethod;
    staticInvokeExprToString(invokeExpr: ArkStaticInvokeExpr): string;
    private genericTypesToString;
    typeArrayToString(types: Type[], split?: string): string;
    static constToString(value: Constant): string;
    private exprToString;
    refToString(value: AbstractRef): string;
    valueToString(value: Value, isLeftOp?: boolean, operator?: string): string;
    private localToString;
    literalObjectToString(type: ClassType): string;
    typeToString(type: Type): string;
    private literalType2string;
    private multipleType2string;
    private arrayType2string;
    private tupleType2string;
    private aliasType2string;
    private keyofTypeExpr2string;
    private typeQueryExpr2string;
    private unclearReferenceType2string;
    private classType2string;
}
//# sourceMappingURL=SourceTransformer.d.ts.map