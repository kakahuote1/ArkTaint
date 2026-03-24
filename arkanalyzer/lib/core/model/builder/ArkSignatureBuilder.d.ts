import { ClassSignature, FieldSignature, MethodSignature, MethodSubSignature } from '../ArkSignature';
export declare class ArkSignatureBuilder {
    static buildMethodSignatureFromClassNameAndMethodName(className: string, methodName: string, staticFlag?: boolean): MethodSignature;
    static buildMethodSignatureFromMethodName(methodName: string, staticFlag?: boolean): MethodSignature;
    static buildMethodSubSignatureFromMethodName(methodName: string, staticFlag?: boolean): MethodSubSignature;
    static buildClassSignatureFromClassName(className: string): ClassSignature;
    static buildFieldSignatureFromFieldName(fieldName: string, staticFlag?: boolean): FieldSignature;
}
//# sourceMappingURL=ArkSignatureBuilder.d.ts.map