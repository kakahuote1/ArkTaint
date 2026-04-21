import { Type } from '../../base/Type';
import { ArkClass } from '../ArkClass';
import { ArkMethod } from '../ArkMethod';
import ts from 'ohos-typescript';
import { Stmt } from '../../base/Stmt';
import { Local } from '../../base/Local';
import { Value } from '../../base/Value';
export type MethodLikeNode = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration | ts.ArrowFunction | ts.AccessorDeclaration | ts.FunctionExpression | ts.MethodSignature | ts.ConstructSignatureDeclaration | ts.CallSignatureDeclaration | ts.FunctionTypeNode;
export declare function buildDefaultArkMethodFromArkClass(declaringClass: ArkClass, mtd: ArkMethod, sourceFile: ts.SourceFile, node?: ts.ModuleDeclaration): void;
export declare function buildArkMethodFromArkClass(methodNode: MethodLikeNode, declaringClass: ArkClass, mtd: ArkMethod, sourceFile: ts.SourceFile, declaringMethod?: ArkMethod): void;
export declare class ObjectBindingPatternParameter {
    private propertyName;
    private name;
    private optional;
    constructor();
    getName(): string;
    setName(name: string): void;
    getPropertyName(): string;
    setPropertyName(propertyName: string): void;
    isOptional(): boolean;
    setOptional(optional: boolean): void;
}
export declare class ArrayBindingPatternParameter {
    private propertyName;
    private name;
    private optional;
    constructor();
    getName(): string;
    setName(name: string): void;
    getPropertyName(): string;
    setPropertyName(propertyName: string): void;
    isOptional(): boolean;
    setOptional(optional: boolean): void;
}
export declare class MethodParameter implements Value {
    private name;
    private type;
    private optional;
    private restFlag;
    private objElements;
    private arrayElements;
    constructor();
    getName(): string;
    setName(name: string): void;
    getType(): Type;
    setType(type: Type): void;
    isOptional(): boolean;
    setOptional(optional: boolean): void;
    isRest(): boolean;
    setRestFlag(restFlag: boolean): void;
    addObjElement(element: ObjectBindingPatternParameter): void;
    getObjElements(): ObjectBindingPatternParameter[];
    setObjElements(objElements: ObjectBindingPatternParameter[]): void;
    addArrayElement(element: ArrayBindingPatternParameter): void;
    getArrayElements(): ArrayBindingPatternParameter[];
    setArrayElements(arrayElements: ArrayBindingPatternParameter[]): void;
    getUses(): Value[];
}
export declare function buildDefaultConstructor(arkClass: ArkClass): boolean;
export declare function buildInitMethod(initMethod: ArkMethod, fieldInitializerStmts: Stmt[], thisLocal: Local): void;
export declare function addInitInConstructor(constructor: ArkMethod): void;
export declare function isMethodImplementation(node: MethodLikeNode): boolean;
export declare function checkAndUpdateMethod(method: ArkMethod, cls: ArkClass): void;
export declare function replaceSuper2Constructor(constructor: ArkMethod): void;
//# sourceMappingURL=ArkMethodBuilder.d.ts.map