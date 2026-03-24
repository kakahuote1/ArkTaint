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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTypeFromPreStr = exports.tsNode2Type = exports.buildReturnType = exports.buildGenericType = exports.buildParameters = exports.buildTypeParameters = exports.buildHeritageClauses = exports.buildModifiers = exports.buildDecorators = exports.handlePropertyAccessExpression = exports.handleQualifiedName = void 0;
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const Type_1 = require("../../base/Type");
const TypeInference_1 = require("../../common/TypeInference");
const ArkField_1 = require("../ArkField");
const logger_1 = __importStar(require("../../../utils/logger"));
const ArkClass_1 = require("../ArkClass");
const ArkMethod_1 = require("../ArkMethod");
const Decorator_1 = require("../../base/Decorator");
const ArkMethodBuilder_1 = require("./ArkMethodBuilder");
const ArkClassBuilder_1 = require("./ArkClassBuilder");
const Builtin_1 = require("../../common/Builtin");
const ArkBaseModel_1 = require("../ArkBaseModel");
const ArkValueTransformer_1 = require("../../common/ArkValueTransformer");
const TypeExpr_1 = require("../../base/TypeExpr");
const TSConst_1 = require("../../common/TSConst");
const ArkSignatureBuilder_1 = require("./ArkSignatureBuilder");
const Ref_1 = require("../../base/Ref");
const Local_1 = require("../../base/Local");
const Position_1 = require("../../base/Position");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'builderUtils');
function handleQualifiedName(node) {
    let right = node.right.text;
    let left = '';
    if (node.left.kind === ohos_typescript_1.default.SyntaxKind.Identifier) {
        left = node.left.text;
    }
    else if (node.left.kind === ohos_typescript_1.default.SyntaxKind.QualifiedName) {
        left = handleQualifiedName(node.left);
    }
    let qualifiedName = left + '.' + right;
    return qualifiedName;
}
exports.handleQualifiedName = handleQualifiedName;
function handlePropertyAccessExpression(node) {
    let right = node.name.text;
    let left = '';
    if (ohos_typescript_1.default.SyntaxKind[node.expression.kind] === 'Identifier') {
        left = node.expression.text;
    }
    else if (ohos_typescript_1.default.isStringLiteral(node.expression)) {
        left = node.expression.text;
    }
    else if (ohos_typescript_1.default.isPropertyAccessExpression(node.expression)) {
        left = handlePropertyAccessExpression(node.expression);
    }
    let propertyAccessExpressionName = left + '.' + right;
    return propertyAccessExpressionName;
}
exports.handlePropertyAccessExpression = handlePropertyAccessExpression;
function buildDecorators(node, sourceFile) {
    let decorators = new Set();
    ohos_typescript_1.default.getAllDecorators(node).forEach(decoratorNode => {
        let decorator = parseDecorator(decoratorNode);
        if (decorator) {
            decorator.setContent(decoratorNode.expression.getText(sourceFile));
            decorators.add(decorator);
        }
    });
    return decorators;
}
exports.buildDecorators = buildDecorators;
function parseDecorator(node) {
    if (!node.expression) {
        return undefined;
    }
    let expression = node.expression;
    if (ohos_typescript_1.default.isIdentifier(expression)) {
        return new Decorator_1.Decorator(expression.text);
    }
    if (!ohos_typescript_1.default.isCallExpression(expression) || !ohos_typescript_1.default.isIdentifier(expression.expression)) {
        return undefined;
    }
    let decorator = new Decorator_1.Decorator(expression.expression.text);
    if (expression.arguments.length > 0) {
        const arg = expression.arguments[0];
        if (ohos_typescript_1.default.isArrowFunction(arg) && ohos_typescript_1.default.isIdentifier(arg.body)) {
            decorator.setParam(arg.body.text);
        }
    }
    return decorator;
}
function buildModifiers(node) {
    var _a;
    let modifiers = 0;
    if (ohos_typescript_1.default.canHaveModifiers(node)) {
        (_a = ohos_typescript_1.default.getModifiers(node)) === null || _a === void 0 ? void 0 : _a.forEach(modifier => {
            modifiers |= (0, ArkBaseModel_1.modifierKind2Enum)(modifier.kind);
        });
    }
    return modifiers;
}
exports.buildModifiers = buildModifiers;
function buildHeritageClauses(heritageClauses) {
    let heritageClausesMap = new Map();
    heritageClauses === null || heritageClauses === void 0 ? void 0 : heritageClauses.forEach(heritageClause => {
        heritageClause.types.forEach(type => {
            let heritageClauseName = '';
            if (type.typeArguments) {
                heritageClauseName = type.getText();
            }
            else if (ohos_typescript_1.default.isIdentifier(type.expression)) {
                heritageClauseName = type.expression.text;
            }
            else if (ohos_typescript_1.default.isPropertyAccessExpression(type.expression)) {
                heritageClauseName = handlePropertyAccessExpression(type.expression);
            }
            else {
                heritageClauseName = type.getText();
            }
            heritageClausesMap.set(heritageClauseName, ohos_typescript_1.default.SyntaxKind[heritageClause.token]);
        });
    });
    return heritageClausesMap;
}
exports.buildHeritageClauses = buildHeritageClauses;
function buildTypeParameters(typeParameters, sourceFile, arkInstance) {
    var _a;
    const genericTypes = [];
    let index = 0;
    if (arkInstance instanceof ArkMethod_1.ArkMethod) {
        const len = (_a = arkInstance.getDeclaringArkClass().getGenericsTypes()) === null || _a === void 0 ? void 0 : _a.length;
        if (len) {
            index = len;
        }
    }
    typeParameters.forEach(typeParameter => {
        const genericType = tsNode2Type(typeParameter, sourceFile, arkInstance);
        if (genericType instanceof Type_1.GenericType) {
            genericType.setIndex(index++);
            genericTypes.push(genericType);
        }
        if (typeParameter.modifiers) {
            logger.warn('This typeparameter has modifiers.');
        }
        if (typeParameter.expression) {
            logger.warn('This typeparameter has expression.');
        }
    });
    return genericTypes;
}
exports.buildTypeParameters = buildTypeParameters;
function buildObjectBindingPatternParam(methodParameter, paramNameNode) {
    methodParameter.setName('ObjectBindingPattern');
    let elements = [];
    paramNameNode.elements.forEach(element => {
        let paraElement = new ArkMethodBuilder_1.ObjectBindingPatternParameter();
        if (element.propertyName) {
            if (ohos_typescript_1.default.isIdentifier(element.propertyName)) {
                paraElement.setPropertyName(element.propertyName.text);
            }
            else {
                logger.warn('New propertyName of ObjectBindingPattern found, please contact developers to support this!');
            }
        }
        if (element.name) {
            if (ohos_typescript_1.default.isIdentifier(element.name)) {
                paraElement.setName(element.name.text);
            }
            else {
                logger.warn('New name of ObjectBindingPattern found, please contact developers to support this!');
            }
        }
        if (element.initializer) {
            logger.warn('TODO: support ObjectBindingPattern initializer.');
        }
        if (element.dotDotDotToken) {
            paraElement.setOptional(true);
        }
        elements.push(paraElement);
    });
    methodParameter.setObjElements(elements);
}
function buildBindingElementOfBindingPatternParam(element, paraElement) {
    if (element.propertyName) {
        if (ohos_typescript_1.default.isIdentifier(element.propertyName)) {
            paraElement.setPropertyName(element.propertyName.text);
        }
        else {
            logger.warn('New propertyName of ArrayBindingPattern found, please contact developers to support this!');
        }
    }
    if (element.name) {
        if (ohos_typescript_1.default.isIdentifier(element.name)) {
            paraElement.setName(element.name.text);
        }
        else {
            logger.warn('New name of ArrayBindingPattern found, please contact developers to support this!');
        }
    }
    if (element.initializer) {
        logger.warn('TODO: support ArrayBindingPattern initializer.');
    }
    if (element.dotDotDotToken) {
        paraElement.setOptional(true);
    }
}
function buildArrayBindingPatternParam(methodParameter, paramNameNode) {
    methodParameter.setName('ArrayBindingPattern');
    let elements = [];
    paramNameNode.elements.forEach(element => {
        let paraElement = new ArkMethodBuilder_1.ArrayBindingPatternParameter();
        if (ohos_typescript_1.default.isBindingElement(element)) {
            buildBindingElementOfBindingPatternParam(element, paraElement);
        }
        else if (ohos_typescript_1.default.isOmittedExpression(element)) {
            logger.warn('TODO: support OmittedExpression for ArrayBindingPattern parameter name.');
        }
        elements.push(paraElement);
    });
    methodParameter.setArrayElements(elements);
}
function buildParameters(params, arkInstance, sourceFile, paramsPosition) {
    let parameters = [];
    params.forEach(parameter => {
        let methodParameter = new ArkMethodBuilder_1.MethodParameter();
        // name
        if (ohos_typescript_1.default.isIdentifier(parameter.name)) {
            methodParameter.setName(parameter.name.text);
            paramsPosition.set(parameter.name.text, Position_1.FullPosition.buildFromNode(parameter.name, sourceFile));
        }
        else if (ohos_typescript_1.default.isObjectBindingPattern(parameter.name)) {
            buildObjectBindingPatternParam(methodParameter, parameter.name);
            paramsPosition.set('ObjectBindingPattern', Position_1.FullPosition.buildFromNode(parameter.name, sourceFile));
        }
        else if (ohos_typescript_1.default.isArrayBindingPattern(parameter.name)) {
            buildArrayBindingPatternParam(methodParameter, parameter.name);
            paramsPosition.set('ArrayBindingPattern', Position_1.FullPosition.buildFromNode(parameter.name, sourceFile));
        }
        else {
            logger.warn('Parameter name is not identifier, ObjectBindingPattern nor ArrayBindingPattern, please contact developers to support this!');
        }
        // questionToken
        if (parameter.questionToken) {
            methodParameter.setOptional(true);
        }
        // type
        if (parameter.type) {
            methodParameter.setType(buildGenericType(tsNode2Type(parameter.type, sourceFile, arkInstance), arkInstance));
        }
        else {
            methodParameter.setType(Type_1.UnknownType.getInstance());
        }
        // initializer
        if (parameter.initializer) {
            // For param with initializer, it is actually optional param. The cfgBuilder will do the last initializer things.
            methodParameter.setOptional(true);
        }
        // dotDotDotToken
        if (parameter.dotDotDotToken) {
            methodParameter.setRestFlag(true);
        }
        // modifiers
        if (parameter.modifiers) {
            //
        }
        parameters.push(methodParameter);
    });
    return parameters;
}
exports.buildParameters = buildParameters;
function buildGenericType(type, arkInstance) {
    function replace(urType) {
        var _a, _b, _c;
        const typeName = urType.getName();
        let gType;
        if (arkInstance instanceof Type_1.AliasType) {
            gType = (_a = arkInstance.getGenericTypes()) === null || _a === void 0 ? void 0 : _a.find(f => f.getName() === typeName);
        }
        else {
            if (arkInstance instanceof ArkMethod_1.ArkMethod) {
                gType = (_b = arkInstance.getGenericTypes()) === null || _b === void 0 ? void 0 : _b.find(f => f.getName() === typeName);
            }
            if (!gType) {
                gType = (_c = arkInstance
                    .getDeclaringArkClass()
                    .getGenericsTypes()) === null || _c === void 0 ? void 0 : _c.find(f => f.getName() === typeName);
            }
        }
        if (gType) {
            return gType;
        }
        const types = urType.getGenericTypes();
        for (let i = 0; i < types.length; i++) {
            const mayType = types[i];
            if (mayType instanceof Type_1.UnclearReferenceType) {
                types[i] = replace(mayType);
            }
        }
        return urType;
    }
    if (type instanceof Type_1.UnclearReferenceType) {
        return replace(type);
    }
    else if (type instanceof Type_1.ClassType && arkInstance instanceof Type_1.AliasType) {
        type.setRealGenericTypes(arkInstance.getGenericTypes());
    }
    else if (type instanceof Type_1.UnionType || type instanceof Type_1.TupleType) {
        const types = type.getTypes();
        for (let i = 0; i < types.length; i++) {
            const mayType = types[i];
            if (mayType instanceof Type_1.UnclearReferenceType) {
                types[i] = replace(mayType);
            }
        }
    }
    else if (type instanceof Type_1.ArrayType) {
        const baseType = type.getBaseType();
        if (baseType instanceof Type_1.UnclearReferenceType) {
            type.setBaseType(replace(baseType));
        }
    }
    else if (type instanceof Type_1.FunctionType) {
        const returnType = type.getMethodSignature().getType();
        if (returnType instanceof Type_1.UnclearReferenceType) {
            type.getMethodSignature().getMethodSubSignature().setReturnType(replace(returnType));
        }
    }
    return type;
}
exports.buildGenericType = buildGenericType;
function buildReturnType(node, sourceFile, method) {
    if (node) {
        return tsNode2Type(node, sourceFile, method);
    }
    else {
        return Type_1.UnknownType.getInstance();
    }
}
exports.buildReturnType = buildReturnType;
function tsNode2Type(typeNode, sourceFile, arkInstance) {
    if (ohos_typescript_1.default.isTypeReferenceNode(typeNode)) {
        const genericTypes = [];
        if (typeNode.typeArguments) {
            for (const typeArgument of typeNode.typeArguments) {
                genericTypes.push(tsNode2Type(typeArgument, sourceFile, arkInstance));
            }
        }
        let referenceNodeName = typeNode.typeName;
        if (ohos_typescript_1.default.isQualifiedName(referenceNodeName)) {
            let parameterTypeStr = handleQualifiedName(referenceNodeName);
            return new Type_1.UnclearReferenceType(parameterTypeStr, genericTypes);
        }
        else {
            let parameterTypeStr = referenceNodeName.text;
            if (parameterTypeStr === Builtin_1.Builtin.OBJECT) {
                return Builtin_1.Builtin.OBJECT_CLASS_TYPE;
            }
            return new Type_1.UnclearReferenceType(parameterTypeStr, genericTypes);
        }
    }
    else if (ohos_typescript_1.default.isUnionTypeNode(typeNode) || ohos_typescript_1.default.isIntersectionTypeNode(typeNode)) {
        let multipleTypePara = [];
        typeNode.types.forEach(tmpType => {
            multipleTypePara.push(tsNode2Type(tmpType, sourceFile, arkInstance));
        });
        if (ohos_typescript_1.default.isUnionTypeNode(typeNode)) {
            return new Type_1.UnionType(multipleTypePara);
        }
        else {
            return new Type_1.IntersectionType(multipleTypePara);
        }
    }
    else if (ohos_typescript_1.default.isLiteralTypeNode(typeNode)) {
        return ArkValueTransformer_1.ArkValueTransformer.resolveLiteralTypeNode(typeNode, sourceFile);
    }
    else if (ohos_typescript_1.default.isTypeLiteralNode(typeNode)) {
        let cls = new ArkClass_1.ArkClass();
        let declaringClass;
        if (arkInstance instanceof ArkMethod_1.ArkMethod) {
            declaringClass = arkInstance.getDeclaringArkClass();
        }
        else if (arkInstance instanceof ArkField_1.ArkField) {
            declaringClass = arkInstance.getDeclaringArkClass();
        }
        else {
            declaringClass = arkInstance;
        }
        if (declaringClass.getDeclaringArkNamespace()) {
            cls.setDeclaringArkNamespace(declaringClass.getDeclaringArkNamespace());
            cls.setDeclaringArkFile(declaringClass.getDeclaringArkFile());
        }
        else {
            cls.setDeclaringArkFile(declaringClass.getDeclaringArkFile());
        }
        (0, ArkClassBuilder_1.buildNormalArkClassFromArkMethod)(typeNode, cls, sourceFile);
        return new Type_1.ClassType(cls.getSignature());
    }
    else if (ohos_typescript_1.default.isFunctionTypeNode(typeNode)) {
        let mtd = new ArkMethod_1.ArkMethod();
        let cls;
        if (arkInstance instanceof ArkMethod_1.ArkMethod) {
            cls = arkInstance.getDeclaringArkClass();
        }
        else if (arkInstance instanceof ArkClass_1.ArkClass) {
            cls = arkInstance;
        }
        else {
            cls = arkInstance.getDeclaringArkClass();
        }
        (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(typeNode, cls, mtd, sourceFile);
        return new Type_1.FunctionType(mtd.getSignature());
    }
    else if (ohos_typescript_1.default.isTypeParameterDeclaration(typeNode)) {
        const name = typeNode.name.text;
        let defaultType;
        if (typeNode.default) {
            defaultType = tsNode2Type(typeNode.default, sourceFile, arkInstance);
        }
        let constraint;
        if (typeNode.constraint) {
            constraint = tsNode2Type(typeNode.constraint, sourceFile, arkInstance);
        }
        return new Type_1.GenericType(name, defaultType, constraint);
    }
    else if (ohos_typescript_1.default.isTupleTypeNode(typeNode)) {
        const types = [];
        typeNode.elements.forEach(element => {
            types.push(tsNode2Type(element, sourceFile, arkInstance));
        });
        return new Type_1.TupleType(types);
    }
    else if (ohos_typescript_1.default.isArrayTypeNode(typeNode)) {
        return new Type_1.ArrayType(tsNode2Type(typeNode.elementType, sourceFile, arkInstance), 1);
    }
    else if (ohos_typescript_1.default.isParenthesizedTypeNode(typeNode)) {
        return tsNode2Type(typeNode.type, sourceFile, arkInstance);
    }
    else if (ohos_typescript_1.default.isTypeOperatorNode(typeNode)) {
        return buildTypeFromTypeOperator(typeNode, sourceFile, arkInstance);
    }
    else if (ohos_typescript_1.default.isTypeQueryNode(typeNode)) {
        return buildTypeFromTypeQuery(typeNode, sourceFile, arkInstance);
    }
    else if (typeNode.kind === ohos_typescript_1.default.SyntaxKind.ObjectKeyword) {
        // TODO: type object which is different from Object is needed to support, such as let a: object = {}
        return new Type_1.UnclearReferenceType('object');
    }
    else {
        return buildTypeFromPreStr(ohos_typescript_1.default.SyntaxKind[typeNode.kind]);
    }
}
exports.tsNode2Type = tsNode2Type;
function buildTypeFromPreStr(preStr) {
    let postStr = '';
    switch (preStr) {
        case 'BooleanKeyword':
            postStr = TSConst_1.BOOLEAN_KEYWORD;
            break;
        case 'FalseKeyword':
            postStr = TSConst_1.BOOLEAN_KEYWORD;
            break;
        case 'TrueKeyword':
            postStr = TSConst_1.BOOLEAN_KEYWORD;
            break;
        case 'NumberKeyword':
            postStr = TSConst_1.NUMBER_KEYWORD;
            break;
        case 'NumericLiteral':
            postStr = TSConst_1.NUMBER_KEYWORD;
            break;
        case 'FirstLiteralToken':
            postStr = TSConst_1.NUMBER_KEYWORD;
            break;
        case 'StringKeyword':
            postStr = TSConst_1.STRING_KEYWORD;
            break;
        case 'StringLiteral':
            postStr = TSConst_1.STRING_KEYWORD;
            break;
        case 'UndefinedKeyword':
            postStr = TSConst_1.UNDEFINED_KEYWORD;
            break;
        case 'NullKeyword':
            postStr = TSConst_1.NULL_KEYWORD;
            break;
        case 'AnyKeyword':
            postStr = TSConst_1.ANY_KEYWORD;
            break;
        case 'VoidKeyword':
            postStr = TSConst_1.VOID_KEYWORD;
            break;
        case 'NeverKeyword':
            postStr = TSConst_1.NEVER_KEYWORD;
            break;
        case 'BigIntKeyword':
            postStr = TSConst_1.BIGINT_KEYWORD;
            break;
        default:
            postStr = preStr;
    }
    return TypeInference_1.TypeInference.buildTypeFromStr(postStr);
}
exports.buildTypeFromPreStr = buildTypeFromPreStr;
function buildTypeFromTypeOperator(typeOperatorNode, sourceFile, arkInstance) {
    const typeNode = typeOperatorNode.type;
    let type = tsNode2Type(typeNode, sourceFile, arkInstance);
    switch (typeOperatorNode.operator) {
        case ohos_typescript_1.default.SyntaxKind.ReadonlyKeyword: {
            if (type instanceof Type_1.ArrayType || type instanceof Type_1.TupleType) {
                type.setReadonlyFlag(true);
            }
            return type;
        }
        case ohos_typescript_1.default.SyntaxKind.KeyOfKeyword:
            return new TypeExpr_1.KeyofTypeExpr(type);
        case ohos_typescript_1.default.SyntaxKind.UniqueKeyword:
            return Type_1.UnknownType.getInstance();
        default:
            return Type_1.UnknownType.getInstance();
    }
}
function buildTypeFromTypeQuery(typeQueryNode, sourceFile, arkInstance) {
    var _a, _b, _c, _d, _e, _f;
    const exprNameNode = typeQueryNode.exprName;
    let opValue;
    if (ohos_typescript_1.default.isQualifiedName(exprNameNode)) {
        if (exprNameNode.left.getText(sourceFile) === TSConst_1.THIS_NAME) {
            const fieldName = exprNameNode.right.getText(sourceFile);
            if (arkInstance instanceof ArkMethod_1.ArkMethod) {
                const fieldSignature = (_b = (_a = arkInstance.getDeclaringArkClass().getFieldWithName(fieldName)) === null || _a === void 0 ? void 0 : _a.getSignature()) !== null && _b !== void 0 ? _b : ArkSignatureBuilder_1.ArkSignatureBuilder.buildFieldSignatureFromFieldName(fieldName);
                const baseLocal = (_d = (_c = arkInstance.getBody()) === null || _c === void 0 ? void 0 : _c.getLocals().get(TSConst_1.THIS_NAME)) !== null && _d !== void 0 ? _d : new Local_1.Local(TSConst_1.THIS_NAME, new Type_1.ClassType(arkInstance.getDeclaringArkClass().getSignature(), arkInstance.getDeclaringArkClass().getGenericsTypes()));
                opValue = new Ref_1.ArkInstanceFieldRef(baseLocal, fieldSignature);
            }
            else if (arkInstance instanceof ArkClass_1.ArkClass) {
                const fieldSignature = (_f = (_e = arkInstance.getFieldWithName(fieldName)) === null || _e === void 0 ? void 0 : _e.getSignature()) !== null && _f !== void 0 ? _f : ArkSignatureBuilder_1.ArkSignatureBuilder.buildFieldSignatureFromFieldName(fieldName);
                const baseLocal = new Local_1.Local(TSConst_1.THIS_NAME, new Type_1.ClassType(arkInstance.getSignature(), arkInstance.getGenericsTypes()));
                opValue = new Ref_1.ArkInstanceFieldRef(baseLocal, fieldSignature);
            }
            else {
                const fieldSignature = arkInstance.getSignature();
                const baseLocal = new Local_1.Local(TSConst_1.THIS_NAME, new Type_1.ClassType(arkInstance.getDeclaringArkClass().getSignature(), arkInstance.getDeclaringArkClass().getGenericsTypes()));
                opValue = new Ref_1.ArkInstanceFieldRef(baseLocal, fieldSignature);
            }
        }
        else {
            const exprName = exprNameNode.getText(sourceFile);
            opValue = new Local_1.Local(exprName, Type_1.UnknownType.getInstance());
        }
    }
    else {
        const exprName = exprNameNode.escapedText.toString();
        opValue = new Local_1.Local(exprName, Type_1.UnknownType.getInstance());
    }
    let expr = new TypeExpr_1.TypeQueryExpr(opValue);
    if (typeQueryNode.typeArguments) {
        for (const typeArgument of typeQueryNode.typeArguments) {
            expr.addGenericType(tsNode2Type(typeArgument, sourceFile, arkInstance));
        }
    }
    return expr;
}
