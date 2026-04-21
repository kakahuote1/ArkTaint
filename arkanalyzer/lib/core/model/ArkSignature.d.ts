import { ClassType, Type } from '../base/Type';
import { MethodParameter } from './builder/ArkMethodBuilder';
export type Signature = FileSignature | NamespaceSignature | ClassSignature | MethodSignature | FieldSignature | LocalSignature | AliasTypeSignature;
export interface ArkSignature {
    getSignature(): Signature;
}
/**
 * @category core/model
 */
export declare class FileSignature {
    private projectName;
    private fileName;
    private hashcode;
    static readonly DEFAULT: FileSignature;
    constructor(projectName: string, fileName: string);
    getProjectName(): string;
    getFileName(): string;
    toString(): string;
    toMapKey(): string;
}
export declare class NamespaceSignature {
    private namespaceName;
    private declaringFileSignature;
    private declaringNamespaceSignature;
    static readonly DEFAULT: NamespaceSignature;
    constructor(namespaceName: string, declaringFileSignature: FileSignature, declaringNamespaceSignature?: NamespaceSignature | null);
    getNamespaceName(): string;
    getDeclaringFileSignature(): FileSignature;
    getDeclaringNamespaceSignature(): NamespaceSignature | null;
    toString(): string;
    toMapKey(): string;
}
export declare class ClassSignature {
    private declaringFileSignature;
    private declaringNamespaceSignature;
    private className;
    static readonly DEFAULT: ClassSignature;
    constructor(className: string, declaringFileSignature: FileSignature, declaringNamespaceSignature?: NamespaceSignature | null);
    /**
     * Returns the declaring file signature.
     * @returns The declaring file signature.
     */
    getDeclaringFileSignature(): FileSignature;
    /**
     * Get the declaring namespace's signature.
     * @returns the declaring namespace's signature.
     */
    getDeclaringNamespaceSignature(): NamespaceSignature | null;
    /**
     * Get the **string** name of class from the the class signature. The default value is `""`.
     * @returns The name of this class.
     */
    getClassName(): string;
    /**
     *
     * @returns The name of the declare class.
     */
    getDeclaringClassName(): string;
    setClassName(className: string): void;
    getType(): ClassType;
    toString(): string;
    toMapKey(): string;
}
/**
 * `AliasClassSignature` is used to extend `ClassSignature`, preserving the actual name used during invocation.
 */
export declare class AliasClassSignature extends ClassSignature {
    private readonly aliasName;
    constructor(aliasName: string, signature: ClassSignature);
    /**
     * Returns the name used in the code.
     */
    getClassName(): string;
    /**
     * Return the original name of declared class
     */
    getOriginName(): string;
}
export type BaseSignature = ClassSignature | NamespaceSignature;
export declare class FieldSignature {
    private declaringSignature;
    private fieldName;
    private type;
    private staticFlag;
    constructor(fieldName: string, declaringSignature: BaseSignature, type: Type, staticFlag?: boolean);
    getDeclaringSignature(): BaseSignature;
    getBaseName(): string;
    getFieldName(): string;
    getType(): Type;
    isStatic(): boolean;
    setType(type: Type): void;
    setStaticFlag(flag: boolean): void;
    toString(): string;
}
export declare class MethodSubSignature {
    private methodName;
    private parameters;
    private returnType;
    private staticFlag;
    constructor(methodName: string, parameters: MethodParameter[], returnType: Type, staticFlag?: boolean);
    getMethodName(): string;
    getParameters(): MethodParameter[];
    getParameterTypes(): Type[];
    getReturnType(): Type;
    setReturnType(returnType: Type): void;
    isStatic(): boolean;
    toString(ptrName?: string): string;
}
/**
 * @category core/model
 */
export declare class MethodSignature {
    private declaringClassSignature;
    private methodSubSignature;
    constructor(declaringClassSignature: ClassSignature, methodSubSignature: MethodSubSignature);
    /**
     * Return the declaring class signature.
     * A {@link ClassSignature} includes:
     * - File Signature: including the **string** names of the project and file, respectively.
     * The default value of project's name is "%unk" and the default value of file's name is "%unk".
     * - Namespace Signature | **null**:  it may be a namespace signature or **null**.
     * A namespace signature can indicate its **string** name of namespace and its file signature.
     * - Class Name: the **string** name of this class.
     * @returns The declaring class signature.
     * @example
     * 1. get class signature from ArkMethod.

     ```typescript
     let methodSignature = expr.getMethodSignature();
     let name = methodSignature.getDeclaringClassSignature().getClassName();
     ```
     *
     */
    getDeclaringClassSignature(): ClassSignature;
    /**
     * Returns the sub-signature of this method signature.
     * The sub-signature is part of the method signature, which is used to
     * identify the name of the method, its parameters and the return value type.
     * @returns The sub-signature of this method signature.
     */
    getMethodSubSignature(): MethodSubSignature;
    getType(): Type;
    toString(ptrName?: string): string;
    toMapKey(): string;
    isMatch(signature: MethodSignature): boolean;
    getParamLength(): number;
}
export declare class LocalSignature {
    private name;
    private declaringMethodSignature;
    constructor(name: string, declaringMethodSignature: MethodSignature);
    getName(): string;
    getDeclaringMethodSignature(): MethodSignature;
    toString(): string;
}
export declare class AliasTypeSignature {
    private name;
    private declaringMethodSignature;
    constructor(name: string, declaringMethodSignature: MethodSignature);
    getName(): string;
    getDeclaringMethodSignature(): MethodSignature;
    toString(): string;
}
export declare function fieldSignatureCompare(leftSig: FieldSignature, rightSig: FieldSignature): boolean;
export declare function methodSignatureCompare(leftSig: MethodSignature, rightSig: MethodSignature): boolean;
export declare function methodSubSignatureCompare(leftSig: MethodSubSignature, rightSig: MethodSubSignature): boolean;
export declare function classSignatureCompare(leftSig: ClassSignature, rightSig: ClassSignature): boolean;
export declare function fileSignatureCompare(leftSig: FileSignature, rightSig: FileSignature): boolean;
export declare function genSignature4ImportClause(arkFileName: string, importClauseName: string): string;
//# sourceMappingURL=ArkSignature.d.ts.map