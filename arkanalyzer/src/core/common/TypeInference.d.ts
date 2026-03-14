import { Local } from '../base/Local';
import { Stmt } from '../base/Stmt';
import { EnumValueType, FunctionType, GenericType, Type, UnclearReferenceType } from '../base/Type';
import { ArkMethod } from '../model/ArkMethod';
import { ArkExport } from '../model/ArkExport';
import { ArkClass } from '../model/ArkClass';
import { ArkField } from '../model/ArkField';
import { Value } from '../base/Value';
import { MethodSignature, MethodSubSignature } from '../model/ArkSignature';
import { MethodParameter } from '../model/builder/ArkMethodBuilder';
export declare class TypeInference {
    static inferTypeInArkField(arkField: ArkField): void;
    /**
     * Infer type for a given unclear type.
     * It returns an array with 2 items, original object and original type.
     * The original object is null if there is no object, or it failed to find the object.
     * The original type is null if failed to infer the type.
     * @param leftOpType
     * @param declaringArkClass
     * @param visited
     * @returns
     */
    static inferUnclearedType(leftOpType: Type, declaringArkClass: ArkClass, visited?: Set<Type>): Type | null | undefined;
    private static inferUnclearComplexType;
    static inferTypeInMethod(arkMethod: ArkMethod): void;
    private static resolveStmt;
    /**
     * @Deprecated
     * @param arkMethod
     */
    static inferSimpleTypeInMethod(arkMethod: ArkMethod): void;
    /**
     * infer type for Exprs in stmt which invoke method.
     * such as ArkInstanceInvokeExpr ArkStaticInvokeExpr ArkNewExpr
     */
    private static resolveExprsInStmt;
    /**
     * infer value type for TypeExprs in stmt which specify the type such as TypeQueryExpr
     */
    private static resolveTypeExprsInStmt;
    /**
     * infer type for fieldRefs in stmt.
     */
    private static resolveFieldRefsInStmt;
    private static processRef;
    static getLocalFromMethodBody(name: string, arkMethod: ArkMethod): Local | null;
    static parseArkExport2Type(arkExport: ArkExport | undefined | null): Type | null;
    /**
     * infer and pass type for ArkAssignStmt right and left
     * @param stmt
     * @param arkMethod
     */
    static resolveArkAssignStmt(stmt: Stmt, arkMethod: ArkMethod): void;
    private static resolveLeftOp;
    private static inferLeftOpType;
    static setValueType(value: Value, type: Type): void;
    static isUnclearType(type: Type | null | undefined): boolean;
    static checkType(type: Type, check: (t: Type) => boolean, visited?: Set<Type>): boolean;
    static inferSimpleTypeInStmt(stmt: Stmt): void;
    static buildTypeFromStr(typeStr: string): Type;
    static inferValueType(value: Value, arkMethod: ArkMethod): Type | null;
    static inferParameterType(param: MethodParameter, arkMethod: ArkMethod): void;
    static inferSignatureReturnType(oldSignature: MethodSignature, arkMethod: ArkMethod): void;
    static inferReturnType(arkMethod: ArkMethod): Type | null;
    static inferGenericType(types: GenericType[] | undefined, arkClass: ArkClass): void;
    /**
     * Infer type for a given {@link UnclearReferenceType} type.
     * It returns original type.
     * The original type is null if it failed to infer the type.
     * @param urType
     * @param arkClass
     * @returns
     */
    static inferUnclearRefType(urType: UnclearReferenceType, arkClass: ArkClass): Type | null;
    /**
     * Find out the original object and type for a given unclear reference type name.
     * It returns original type.
     * The original type is null if it failed to infer the type.
     * @param refName
     * @param arkClass
     * @returns
     */
    static inferUnclearRefName(refName: string, arkClass: ArkClass): Type | null;
    /**
     * Find out the original object and type for a given base type and the field name.
     * It returns an array with 2 items, original object and original type.
     * The original object is null if there is no object, or it failed to find the object.
     * The original type is null if it failed to infer the type.
     * @param baseType
     * @param fieldName
     * @param declareClass
     * @returns
     */
    static inferFieldType(baseType: Type, fieldName: string, declareClass: ArkClass): [any, Type] | null;
    private static inferClassFieldType;
    private static repairFieldType;
    static getEnumValueType(property: ArkField): EnumValueType | null;
    private static inferArrayFieldType;
    /**
     * Find out the original object and type for a given base name.
     * It returns original type.
     * The original type is null if failed to infer the type.
     * @param baseName
     * @param arkClass
     * @returns
     */
    static inferBaseType(baseName: string, arkClass: ArkClass): Type | null;
    static inferTypeByName(typeName: string, arkClass: ArkClass): Type | null;
    static getTypeByGlobalName(globalName: string, arkMethod: ArkMethod): Type | null;
    static inferRealGenericTypes(realTypes: Type[] | undefined, arkClass: ArkClass): void;
    static inferDynamicImportType(from: string, arkClass: ArkClass): Type | null;
    static replaceTypeWithReal(type: Type, realTypes?: Type[], visited?: Set<Type>): Type;
    static replaceRecursiveType(type: Type, visited: Set<Type>, realTypes?: Type[]): Type;
    static replaceAliasType(type: Type): Type;
    static inferFunctionType(argType: FunctionType, paramSubSignature: MethodSubSignature | undefined, realTypes: Type[] | undefined): void;
    private static resolveArkReturnStmt;
    static isAnonType(argType: Type, projectName: string): boolean;
    static isDummyClassType(rightType: Type): boolean;
    static isTypeCanBeOverride(type: Type): boolean;
    static union(type1: Type, type2: Type): Type;
    static isSameType(type1: Type, type2: Type): boolean;
}
