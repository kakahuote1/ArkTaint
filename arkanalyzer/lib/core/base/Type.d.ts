import { AliasTypeSignature, ClassSignature, FieldSignature, MethodSignature, NamespaceSignature } from '../model/ArkSignature';
import { ArkExport, ExportType } from '../model/ArkExport';
import { ModifierType } from '../model/ArkBaseModel';
import { Local } from './Local';
import { Constant } from './Constant';
/**
 * @category core/base/type
 */
export declare abstract class Type {
    toString(): string;
    abstract getTypeString(): string;
}
/**
 * any type
 * @category core/base/type
 */
export declare class AnyType extends Type {
    private static readonly INSTANCE;
    static getInstance(): AnyType;
    private constructor();
    getTypeString(): string;
}
/**
 * unknown type
 * @category core/base/type
 */
export declare class UnknownType extends Type {
    private static readonly INSTANCE;
    static getInstance(): UnknownType;
    private constructor();
    getTypeString(): string;
}
/**
 * unclear type
 * @category core/base/type
 */
export declare class UnclearReferenceType extends Type {
    private name;
    private genericTypes;
    constructor(name: string, genericTypes?: Type[]);
    getName(): string;
    getGenericTypes(): Type[];
    getTypeString(): string;
}
/**
 * primitive type
 * @category core/base/type
 */
export declare abstract class PrimitiveType extends Type {
    private name;
    constructor(name: string);
    getName(): string;
    getTypeString(): string;
}
export declare class BooleanType extends PrimitiveType {
    private static readonly INSTANCE;
    private constructor();
    static getInstance(): BooleanType;
}
export declare class NumberType extends PrimitiveType {
    private static readonly INSTANCE;
    private constructor();
    static getInstance(): NumberType;
}
/**
 * bigint type
 * @category core/base/type
 */
export declare class BigIntType extends PrimitiveType {
    private static readonly INSTANCE;
    private constructor();
    static getInstance(): BigIntType;
}
export declare class StringType extends PrimitiveType {
    private static readonly INSTANCE;
    private constructor();
    static getInstance(): StringType;
}
/**
 * null type
 * @category core/base/type
 */
export declare class NullType extends PrimitiveType {
    private static readonly INSTANCE;
    static getInstance(): NullType;
    private constructor();
}
/**
 * undefined type
 * @category core/base/type
 */
export declare class UndefinedType extends PrimitiveType {
    private static readonly INSTANCE;
    static getInstance(): UndefinedType;
    private constructor();
}
/**
 * literal type
 * @category core/base/type
 */
export declare class LiteralType extends PrimitiveType {
    static readonly TRUE: LiteralType;
    static readonly FALSE: LiteralType;
    private literalName;
    constructor(literalName: string | number | boolean);
    getLiteralName(): string | number | boolean;
    getTypeString(): string;
}
/**
 * union type
 * @category core/base/type
 */
export declare class UnionType extends Type {
    private types;
    private currType;
    constructor(types: Type[], currType?: Type);
    getTypes(): Type[];
    getCurrType(): Type;
    setCurrType(newType: Type): void;
    getTypeString(): string;
    flatType(): Type[];
}
/**
 * intersection type
 * @category core/base/type
 */
export declare class IntersectionType extends Type {
    private types;
    constructor(types: Type[]);
    getTypes(): Type[];
    getTypeString(): string;
}
/**
 * types for function void return type
 * @category core/base/type
 */
export declare class VoidType extends Type {
    private static readonly INSTANCE;
    static getInstance(): VoidType;
    private constructor();
    getTypeString(): string;
}
export declare class NeverType extends Type {
    private static readonly INSTANCE;
    static getInstance(): NeverType;
    private constructor();
    getTypeString(): string;
}
/**
 * function type
 * @category core/base/type
 */
export declare class FunctionType extends Type {
    private methodSignature;
    private realGenericTypes?;
    constructor(methodSignature: MethodSignature, realGenericTypes?: Type[]);
    getMethodSignature(): MethodSignature;
    getRealGenericTypes(): Type[] | undefined;
    getTypeString(): string;
}
/**
 * types for closures which is a special FunctionType with a lexical env
 * @category core/base/type
 */
export declare class ClosureType extends FunctionType {
    private lexicalEnv;
    constructor(lexicalEnv: LexicalEnvType, methodSignature: MethodSignature, realGenericTypes?: Type[]);
    getLexicalEnv(): LexicalEnvType;
    getTypeString(): string;
}
/**
 * type of an object
 * @category core/base/type
 */
export declare class ClassType extends Type {
    private classSignature;
    private realGenericTypes?;
    constructor(classSignature: ClassSignature, realGenericTypes?: Type[]);
    getClassSignature(): ClassSignature;
    setClassSignature(newClassSignature: ClassSignature): void;
    getRealGenericTypes(): Type[] | undefined;
    setRealGenericTypes(types: Type[] | undefined): void;
    getTypeString(): string;
}
/**
 * Array type
 * @category core/base/type
 * @extends Type
 * @example
 ```typescript
 // baseType is number, dimension is 1, readonlyFlag is true
 let a: readonly number[] = [1, 2, 3];

 // baseType is number, dimension is 1, readonlyFlag is undefined
 let a: number[] = [1, 2, 3];
 ```
 */
export declare class ArrayType extends Type {
    private baseType;
    private dimension;
    private readonlyFlag?;
    constructor(baseType: Type, dimension: number);
    /**
     * Returns the base type of this array, such as `Any`, `Unknown`, `TypeParameter`, etc.
     * @returns The base type of array.
     */
    getBaseType(): Type;
    setBaseType(newType: Type): void;
    getDimension(): number;
    setReadonlyFlag(readonlyFlag: boolean): void;
    getReadonlyFlag(): boolean | undefined;
    getTypeString(): string;
}
/**
 * Tuple type
 * @category core/base/type
 * @extends Type
 * @example
 ```typescript
 // types are number and string, dimension is 1, readonlyFlag is true
 let a: readonly number[] = [1, 2, 3];

 // baseType is number, dimension is 1, readonlyFlag is undefined
 let a: number[] = [1, 2, 3];
 ```
 */
export declare class TupleType extends Type {
    private types;
    private readonlyFlag?;
    constructor(types: Type[]);
    getTypes(): Type[];
    setReadonlyFlag(readonlyFlag: boolean): void;
    getReadonlyFlag(): boolean | undefined;
    getTypeString(): string;
}
/**
 * alias type
 * @category core/base/type
 * @extends Type
 * @example
 ```typescript
 // alias type A is defined without any genericTypes (undefined) or realGenericTypes (undefined)
 type A = number;

 // alias type B is defined with genericTypes but not instance with realGenericTypes (undefined)
 type B<T> = T[];

 // alias type could also be defined with another instance generic type such as aliaType, FunctionType and ClassType
 // genericTypes and realGenericTypes of C are both undefined
 // originalType of C is an instance of B with genericTypes [T] and realGenericTypes [numberType]
 type C = B<number>;
 ```
 */
export declare class AliasType extends Type implements ArkExport {
    private originalType;
    private name;
    private signature;
    protected modifiers?: number;
    private genericTypes?;
    private realGenericTypes?;
    constructor(name: string, originalType: Type, signature: AliasTypeSignature, genericTypes?: GenericType[]);
    getName(): string;
    setOriginalType(type: Type): void;
    getOriginalType(): Type;
    getTypeString(): string;
    getExportType(): ExportType;
    getModifiers(): number;
    containsModifier(modifierType: ModifierType): boolean;
    setModifiers(modifiers: number): void;
    addModifier(modifier: ModifierType | number): void;
    removeModifier(modifier: ModifierType): void;
    getSignature(): AliasTypeSignature;
    setGenericTypes(genericTypes: GenericType[]): void;
    getGenericTypes(): GenericType[] | undefined;
    setRealGenericTypes(realGenericTypes: Type[]): void;
    getRealGenericTypes(): Type[] | undefined;
}
export declare class GenericType extends Type {
    private name;
    private defaultType?;
    private constraint?;
    private index;
    constructor(name: string, defaultType?: Type, constraint?: Type);
    getName(): string;
    getDefaultType(): Type | undefined;
    setDefaultType(type: Type): void;
    getConstraint(): Type | undefined;
    setConstraint(type: Type): void;
    setIndex(index: number): void;
    getIndex(): number;
    getTypeString(): string;
}
export declare abstract class AnnotationType extends Type {
    private originType;
    protected constructor(originType: string);
    getOriginType(): string;
    getTypeString(): string;
}
export declare class AnnotationNamespaceType extends AnnotationType {
    private namespaceSignature;
    static getInstance(signature: NamespaceSignature): AnnotationNamespaceType;
    getNamespaceSignature(): NamespaceSignature;
    setNamespaceSignature(signature: NamespaceSignature): void;
    constructor(originType: string);
    getOriginType(): string;
}
export declare class AnnotationTypeQueryType extends AnnotationType {
    constructor(originType: string);
}
export declare class LexicalEnvType extends Type {
    private nestedMethodSignature;
    private closures;
    constructor(nestedMethod: MethodSignature, closures?: Local[]);
    getNestedMethod(): MethodSignature;
    getClosures(): Local[];
    addClosure(closure: Local): void;
    getTypeString(): string;
}
export declare class EnumValueType extends Type {
    private signature;
    private constant?;
    constructor(signature: FieldSignature, constant?: Constant);
    getFieldSignature(): FieldSignature;
    getConstant(): Constant | undefined;
    getTypeString(): string;
}
//# sourceMappingURL=Type.d.ts.map