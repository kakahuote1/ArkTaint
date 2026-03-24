"use strict";
/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnumValueType = exports.LexicalEnvType = exports.AnnotationTypeQueryType = exports.AnnotationNamespaceType = exports.AnnotationType = exports.GenericType = exports.AliasType = exports.TupleType = exports.ArrayType = exports.ClassType = exports.ClosureType = exports.FunctionType = exports.NeverType = exports.VoidType = exports.IntersectionType = exports.UnionType = exports.LiteralType = exports.UndefinedType = exports.NullType = exports.StringType = exports.BigIntType = exports.NumberType = exports.BooleanType = exports.PrimitiveType = exports.UnclearReferenceType = exports.UnknownType = exports.AnyType = exports.Type = void 0;
const ArkSignature_1 = require("../model/ArkSignature");
const ArkExport_1 = require("../model/ArkExport");
const ArkBaseModel_1 = require("../model/ArkBaseModel");
const TSConst_1 = require("../common/TSConst");
/**
 * @category core/base/type
 */
class Type {
    toString() {
        return this.getTypeString();
    }
}
exports.Type = Type;
/**
 * any type
 * @category core/base/type
 */
class AnyType extends Type {
    static getInstance() {
        return this.INSTANCE;
    }
    constructor() {
        super();
    }
    getTypeString() {
        return TSConst_1.ANY_KEYWORD;
    }
}
exports.AnyType = AnyType;
AnyType.INSTANCE = new AnyType();
/**
 * unknown type
 * @category core/base/type
 */
class UnknownType extends Type {
    static getInstance() {
        return this.INSTANCE;
    }
    constructor() {
        super();
    }
    getTypeString() {
        return TSConst_1.UNKNOWN_KEYWORD;
    }
}
exports.UnknownType = UnknownType;
UnknownType.INSTANCE = new UnknownType();
/**
 * unclear type
 * @category core/base/type
 */
class UnclearReferenceType extends Type {
    constructor(name, genericTypes = []) {
        super();
        this.name = name;
        this.genericTypes = genericTypes;
    }
    getName() {
        return this.name;
    }
    getGenericTypes() {
        return this.genericTypes;
    }
    getTypeString() {
        let str = this.name;
        if (this.genericTypes.length > 0) {
            str += '<' + this.genericTypes.join(',') + '>';
        }
        return str;
    }
}
exports.UnclearReferenceType = UnclearReferenceType;
/**
 * primitive type
 * @category core/base/type
 */
class PrimitiveType extends Type {
    constructor(name) {
        super();
        this.name = name;
    }
    getName() {
        return this.name;
    }
    getTypeString() {
        return this.name;
    }
}
exports.PrimitiveType = PrimitiveType;
class BooleanType extends PrimitiveType {
    constructor() {
        super(TSConst_1.BOOLEAN_KEYWORD);
    }
    static getInstance() {
        return this.INSTANCE;
    }
}
exports.BooleanType = BooleanType;
BooleanType.INSTANCE = new BooleanType();
class NumberType extends PrimitiveType {
    constructor() {
        super(TSConst_1.NUMBER_KEYWORD);
    }
    static getInstance() {
        return this.INSTANCE;
    }
}
exports.NumberType = NumberType;
NumberType.INSTANCE = new NumberType();
/**
 * bigint type
 * @category core/base/type
 */
class BigIntType extends PrimitiveType {
    constructor() {
        super(TSConst_1.BIGINT_KEYWORD);
    }
    static getInstance() {
        return this.INSTANCE;
    }
}
exports.BigIntType = BigIntType;
BigIntType.INSTANCE = new BigIntType();
class StringType extends PrimitiveType {
    constructor() {
        super(TSConst_1.STRING_KEYWORD);
    }
    static getInstance() {
        return this.INSTANCE;
    }
}
exports.StringType = StringType;
StringType.INSTANCE = new StringType();
/**
 * null type
 * @category core/base/type
 */
class NullType extends PrimitiveType {
    static getInstance() {
        return this.INSTANCE;
    }
    constructor() {
        super(TSConst_1.NULL_KEYWORD);
    }
}
exports.NullType = NullType;
NullType.INSTANCE = new NullType();
/**
 * undefined type
 * @category core/base/type
 */
class UndefinedType extends PrimitiveType {
    static getInstance() {
        return this.INSTANCE;
    }
    constructor() {
        super(TSConst_1.UNDEFINED_KEYWORD);
    }
}
exports.UndefinedType = UndefinedType;
UndefinedType.INSTANCE = new UndefinedType();
/**
 * literal type
 * @category core/base/type
 */
class LiteralType extends PrimitiveType {
    constructor(literalName) {
        super('literal');
        this.literalName = literalName;
    }
    getLiteralName() {
        return this.literalName;
    }
    getTypeString() {
        return this.literalName.toString();
    }
}
exports.LiteralType = LiteralType;
LiteralType.TRUE = new LiteralType(true);
LiteralType.FALSE = new LiteralType(false);
/**
 * union type
 * @category core/base/type
 */
class UnionType extends Type {
    constructor(types, currType = UnknownType.getInstance()) {
        super();
        this.types = [...types];
        this.currType = currType;
    }
    getTypes() {
        return this.types;
    }
    getCurrType() {
        return this.currType;
    }
    setCurrType(newType) {
        this.currType = newType;
    }
    getTypeString() {
        let typesString = [];
        this.getTypes().forEach(t => {
            if (t instanceof UnionType || t instanceof IntersectionType) {
                typesString.push(`(${t.toString()})`);
            }
            else {
                typesString.push(t.toString());
            }
        });
        return typesString.join('|');
    }
    // TODO: Need to remove this function because of IntersectionType has been added.
    flatType() {
        const result = [];
        this.types.forEach(t => {
            if (t instanceof UnionType) {
                t.flatType().forEach(e => result.push(e));
            }
            else {
                result.push(t);
            }
        });
        return result;
    }
}
exports.UnionType = UnionType;
/**
 * intersection type
 * @category core/base/type
 */
class IntersectionType extends Type {
    constructor(types) {
        super();
        this.types = [...types];
    }
    getTypes() {
        return this.types;
    }
    getTypeString() {
        let typesString = [];
        this.getTypes().forEach(t => {
            if (t instanceof UnionType || t instanceof IntersectionType) {
                typesString.push(`(${t.toString()})`);
            }
            else {
                typesString.push(t.toString());
            }
        });
        return typesString.join('&');
    }
}
exports.IntersectionType = IntersectionType;
/**
 * types for function void return type
 * @category core/base/type
 */
class VoidType extends Type {
    static getInstance() {
        return this.INSTANCE;
    }
    constructor() {
        super();
    }
    getTypeString() {
        return TSConst_1.VOID_KEYWORD;
    }
}
exports.VoidType = VoidType;
VoidType.INSTANCE = new VoidType();
class NeverType extends Type {
    static getInstance() {
        return this.INSTANCE;
    }
    constructor() {
        super();
    }
    getTypeString() {
        return TSConst_1.NEVER_KEYWORD;
    }
}
exports.NeverType = NeverType;
NeverType.INSTANCE = new NeverType();
/**
 * function type
 * @category core/base/type
 */
class FunctionType extends Type {
    constructor(methodSignature, realGenericTypes) {
        super();
        this.methodSignature = methodSignature;
        this.realGenericTypes = realGenericTypes;
    }
    getMethodSignature() {
        return this.methodSignature;
    }
    getRealGenericTypes() {
        return this.realGenericTypes;
    }
    getTypeString() {
        return this.methodSignature.toString();
    }
}
exports.FunctionType = FunctionType;
/**
 * types for closures which is a special FunctionType with a lexical env
 * @category core/base/type
 */
class ClosureType extends FunctionType {
    constructor(lexicalEnv, methodSignature, realGenericTypes) {
        super(methodSignature, realGenericTypes);
        this.lexicalEnv = lexicalEnv;
    }
    getLexicalEnv() {
        return this.lexicalEnv;
    }
    getTypeString() {
        return 'closures: ' + super.getTypeString();
    }
}
exports.ClosureType = ClosureType;
/**
 * type of an object
 * @category core/base/type
 */
class ClassType extends Type {
    constructor(classSignature, realGenericTypes) {
        super();
        this.classSignature = classSignature;
        this.realGenericTypes = realGenericTypes;
    }
    getClassSignature() {
        return this.classSignature;
    }
    setClassSignature(newClassSignature) {
        this.classSignature = newClassSignature;
    }
    getRealGenericTypes() {
        return this.realGenericTypes;
    }
    setRealGenericTypes(types) {
        this.realGenericTypes = types;
    }
    getTypeString() {
        var _a;
        let temp = this.classSignature.toString();
        let generic = (_a = this.realGenericTypes) === null || _a === void 0 ? void 0 : _a.join(',');
        if (generic) {
            temp += `<${generic}>`;
        }
        return temp;
    }
}
exports.ClassType = ClassType;
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
class ArrayType extends Type {
    constructor(baseType, dimension) {
        super();
        this.baseType = baseType;
        this.dimension = dimension;
    }
    /**
     * Returns the base type of this array, such as `Any`, `Unknown`, `TypeParameter`, etc.
     * @returns The base type of array.
     */
    getBaseType() {
        return this.baseType;
    }
    setBaseType(newType) {
        this.baseType = newType;
    }
    getDimension() {
        return this.dimension;
    }
    setReadonlyFlag(readonlyFlag) {
        this.readonlyFlag = readonlyFlag;
    }
    getReadonlyFlag() {
        return this.readonlyFlag;
    }
    getTypeString() {
        const strs = [];
        if (this.getReadonlyFlag()) {
            strs.push('readonly ');
        }
        if (this.baseType instanceof UnionType || this.baseType instanceof IntersectionType) {
            strs.push('(' + this.baseType.toString() + ')');
        }
        else if (this.baseType) {
            strs.push(this.baseType.toString());
        }
        for (let i = 0; i < this.dimension; i++) {
            strs.push('[]');
        }
        return strs.join('');
    }
}
exports.ArrayType = ArrayType;
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
class TupleType extends Type {
    constructor(types) {
        super();
        this.types = types;
    }
    getTypes() {
        return this.types;
    }
    setReadonlyFlag(readonlyFlag) {
        this.readonlyFlag = readonlyFlag;
    }
    getReadonlyFlag() {
        return this.readonlyFlag;
    }
    getTypeString() {
        if (this.getReadonlyFlag()) {
            return 'readonly [' + this.types.join(', ') + ']';
        }
        return '[' + this.types.join(', ') + ']';
    }
}
exports.TupleType = TupleType;
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
class AliasType extends Type {
    constructor(name, originalType, signature, genericTypes) {
        super();
        this.name = name;
        this.originalType = originalType;
        this.signature = signature;
        this.genericTypes = genericTypes;
    }
    getName() {
        return this.name;
    }
    setOriginalType(type) {
        this.originalType = type;
    }
    getOriginalType() {
        return this.originalType;
    }
    getTypeString() {
        var _a, _b, _c;
        let res = this.getSignature().toString();
        let generic = (_b = (_a = this.getRealGenericTypes()) === null || _a === void 0 ? void 0 : _a.join(',')) !== null && _b !== void 0 ? _b : (_c = this.getGenericTypes()) === null || _c === void 0 ? void 0 : _c.join(',');
        if (generic) {
            res += `<${generic}>`;
        }
        return res;
    }
    getExportType() {
        return ArkExport_1.ExportType.TYPE;
    }
    getModifiers() {
        if (!this.modifiers) {
            return 0;
        }
        return this.modifiers;
    }
    containsModifier(modifierType) {
        if (!this.modifiers) {
            return false;
        }
        return (this.modifiers & modifierType) === modifierType;
    }
    setModifiers(modifiers) {
        if (modifiers !== 0) {
            this.modifiers = modifiers;
        }
    }
    addModifier(modifier) {
        this.modifiers = this.getModifiers() | modifier;
    }
    removeModifier(modifier) {
        if (!this.modifiers) {
            return;
        }
        this.modifiers &= ArkBaseModel_1.MODIFIER_TYPE_MASK ^ modifier;
    }
    getSignature() {
        return this.signature;
    }
    setGenericTypes(genericTypes) {
        this.genericTypes = genericTypes;
    }
    getGenericTypes() {
        return this.genericTypes;
    }
    setRealGenericTypes(realGenericTypes) {
        this.realGenericTypes = realGenericTypes;
    }
    getRealGenericTypes() {
        return this.realGenericTypes;
    }
}
exports.AliasType = AliasType;
class GenericType extends Type {
    constructor(name, defaultType, constraint) {
        super();
        this.index = 0;
        this.name = name;
        this.defaultType = defaultType;
        this.constraint = constraint;
    }
    getName() {
        return this.name;
    }
    getDefaultType() {
        return this.defaultType;
    }
    setDefaultType(type) {
        this.defaultType = type;
    }
    getConstraint() {
        return this.constraint;
    }
    setConstraint(type) {
        this.constraint = type;
    }
    setIndex(index) {
        this.index = index;
    }
    getIndex() {
        var _a;
        return (_a = this.index) !== null && _a !== void 0 ? _a : 0;
    }
    getTypeString() {
        let str = this.name;
        if (this.constraint) {
            str += ' extends ' + this.constraint.toString();
        }
        if (this.defaultType) {
            str += ' = ' + this.defaultType.toString();
        }
        return str;
    }
}
exports.GenericType = GenericType;
class AnnotationType extends Type {
    constructor(originType) {
        super();
        this.originType = originType;
    }
    getOriginType() {
        return this.originType;
    }
    getTypeString() {
        return this.originType;
    }
}
exports.AnnotationType = AnnotationType;
class AnnotationNamespaceType extends AnnotationType {
    static getInstance(signature) {
        const type = new AnnotationNamespaceType(signature.getNamespaceName());
        type.setNamespaceSignature(signature);
        return type;
    }
    getNamespaceSignature() {
        return this.namespaceSignature;
    }
    setNamespaceSignature(signature) {
        this.namespaceSignature = signature;
    }
    constructor(originType) {
        super(originType);
        this.namespaceSignature = ArkSignature_1.NamespaceSignature.DEFAULT;
    }
    getOriginType() {
        return super.getOriginType();
    }
}
exports.AnnotationNamespaceType = AnnotationNamespaceType;
class AnnotationTypeQueryType extends AnnotationType {
    constructor(originType) {
        super(originType);
    }
}
exports.AnnotationTypeQueryType = AnnotationTypeQueryType;
class LexicalEnvType extends Type {
    constructor(nestedMethod, closures) {
        super();
        this.closures = [];
        this.nestedMethodSignature = nestedMethod;
        this.closures = closures !== null && closures !== void 0 ? closures : this.closures;
    }
    getNestedMethod() {
        return this.nestedMethodSignature;
    }
    getClosures() {
        return this.closures;
    }
    addClosure(closure) {
        this.closures.push(closure);
    }
    getTypeString() {
        return `[${this.getClosures().join(', ')}]`;
    }
}
exports.LexicalEnvType = LexicalEnvType;
class EnumValueType extends Type {
    constructor(signature, constant) {
        super();
        this.signature = signature;
        this.constant = constant;
    }
    getFieldSignature() {
        return this.signature;
    }
    getConstant() {
        return this.constant;
    }
    getTypeString() {
        return this.signature.toString();
    }
}
exports.EnumValueType = EnumValueType;
