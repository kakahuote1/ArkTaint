"use strict";
/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDefaultArkClassFromArkFile = buildDefaultArkClassFromArkFile;
exports.buildDefaultArkClassFromArkNamespace = buildDefaultArkClassFromArkNamespace;
exports.buildNormalArkClassFromArkMethod = buildNormalArkClassFromArkMethod;
exports.buildNormalArkClassFromArkFile = buildNormalArkClassFromArkFile;
exports.buildNormalArkClassFromArkNamespace = buildNormalArkClassFromArkNamespace;
exports.buildNormalArkClass = buildNormalArkClass;
const ArkField_1 = require("../ArkField");
const ArkMethod_1 = require("../ArkMethod");
const logger_1 = __importStar(require("../../../utils/logger"));
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const ArkClass_1 = require("../ArkClass");
const ArkMethodBuilder_1 = require("./ArkMethodBuilder");
const builderUtils_1 = require("./builderUtils");
const ArkFieldBuilder_1 = require("./ArkFieldBuilder");
const ArkIRTransformer_1 = require("../../common/ArkIRTransformer");
const Stmt_1 = require("../../base/Stmt");
const Ref_1 = require("../../base/Ref");
const Const_1 = require("../../common/Const");
const IRUtils_1 = require("../../common/IRUtils");
const ArkSignature_1 = require("../ArkSignature");
const ArkSignatureBuilder_1 = require("./ArkSignatureBuilder");
const Position_1 = require("../../base/Position");
const Type_1 = require("../../base/Type");
const BodyBuilder_1 = require("./BodyBuilder");
const Expr_1 = require("../../base/Expr");
const ArkBaseModel_1 = require("../ArkBaseModel");
const Constant_1 = require("../../base/Constant");
const ValueUtil_1 = require("../../common/ValueUtil");
const Local_1 = require("../../base/Local");
const ArkMetadata_1 = require("../ArkMetadata");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ArkClassBuilder');
function buildDefaultArkClassFromArkFile(arkFile, defaultClass, astRoot) {
    defaultClass.setDeclaringArkFile(arkFile);
    defaultClass.setCategory(ArkClass_1.ClassCategory.CLASS);
    buildDefaultArkClass(defaultClass, astRoot);
}
function buildDefaultArkClassFromArkNamespace(arkNamespace, defaultClass, nsNode, sourceFile) {
    defaultClass.setDeclaringArkNamespace(arkNamespace);
    defaultClass.setDeclaringArkFile(arkNamespace.getDeclaringArkFile());
    buildDefaultArkClass(defaultClass, sourceFile, nsNode);
}
function buildNormalArkClassFromArkMethod(clsNode, cls, sourceFile, declaringMethod) {
    const namespace = cls.getDeclaringArkNamespace();
    if (namespace) {
        buildNormalArkClassFromArkNamespace(clsNode, namespace, cls, sourceFile, declaringMethod);
    }
    else {
        buildNormalArkClassFromArkFile(clsNode, cls.getDeclaringArkFile(), cls, sourceFile, declaringMethod);
    }
}
function buildNormalArkClassFromArkFile(clsNode, arkFile, cls, sourceFile, declaringMethod) {
    cls.setDeclaringArkFile(arkFile);
    cls.setCode(clsNode.getText(sourceFile));
    const { line, character } = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, clsNode.getStart(sourceFile));
    cls.setLine(line + 1);
    cls.setColumn(character + 1);
    buildNormalArkClass(clsNode, cls, sourceFile, declaringMethod);
    arkFile.addArkClass(cls);
}
function buildNormalArkClassFromArkNamespace(clsNode, arkNamespace, cls, sourceFile, declaringMethod) {
    cls.setDeclaringArkNamespace(arkNamespace);
    cls.setDeclaringArkFile(arkNamespace.getDeclaringArkFile());
    cls.setCode(clsNode.getText(sourceFile));
    const { line, character } = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, clsNode.getStart(sourceFile));
    cls.setLine(line + 1);
    cls.setColumn(character + 1);
    buildNormalArkClass(clsNode, cls, sourceFile, declaringMethod);
    arkNamespace.addArkClass(cls);
}
function buildDefaultArkClass(cls, sourceFile, node) {
    const defaultArkClassSignature = new ArkSignature_1.ClassSignature(Const_1.DEFAULT_ARK_CLASS_NAME, cls.getDeclaringArkFile().getFileSignature(), cls.getDeclaringArkNamespace()?.getSignature() || null);
    cls.setSignature(defaultArkClassSignature);
    genDefaultArkMethod(cls, sourceFile, node);
}
function genDefaultArkMethod(cls, sourceFile, node) {
    let defaultMethod = new ArkMethod_1.ArkMethod();
    (0, ArkMethodBuilder_1.buildDefaultArkMethodFromArkClass)(cls, defaultMethod, sourceFile, node);
    cls.setDefaultArkMethod(defaultMethod);
}
function buildNormalArkClass(clsNode, cls, sourceFile, declaringMethod) {
    switch (clsNode.kind) {
        case ohos_typescript_1.default.SyntaxKind.StructDeclaration:
            buildStruct2ArkClass(clsNode, cls, sourceFile, declaringMethod);
            break;
        case ohos_typescript_1.default.SyntaxKind.ClassDeclaration:
            buildClass2ArkClass(clsNode, cls, sourceFile, declaringMethod);
            break;
        case ohos_typescript_1.default.SyntaxKind.ClassExpression:
            buildClass2ArkClass(clsNode, cls, sourceFile, declaringMethod);
            break;
        case ohos_typescript_1.default.SyntaxKind.InterfaceDeclaration:
            buildInterface2ArkClass(clsNode, cls, sourceFile, declaringMethod);
            break;
        case ohos_typescript_1.default.SyntaxKind.EnumDeclaration:
            buildEnum2ArkClass(clsNode, cls, sourceFile, declaringMethod);
            break;
        case ohos_typescript_1.default.SyntaxKind.TypeLiteral:
            buildTypeLiteralNode2ArkClass(clsNode, cls, sourceFile, declaringMethod);
            break;
        case ohos_typescript_1.default.SyntaxKind.ObjectLiteralExpression:
            buildObjectLiteralExpression2ArkClass(clsNode, cls, sourceFile, declaringMethod);
            break;
        default:
    }
    IRUtils_1.IRUtils.setComments(cls, clsNode, sourceFile, cls.getDeclaringArkFile().getScene().getOptions());
}
function init4InstanceInitMethod(cls) {
    const instanceInit = new ArkMethod_1.ArkMethod();
    instanceInit.setDeclaringArkClass(cls);
    instanceInit.setIsGeneratedFlag(true);
    const methodSubSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(Const_1.INSTANCE_INIT_METHOD_NAME);
    methodSubSignature.setReturnType(Type_1.VoidType.getInstance());
    const methodSignature = new ArkSignature_1.MethodSignature(instanceInit.getDeclaringArkClass().getSignature(), methodSubSignature);
    instanceInit.setImplementationSignature(methodSignature);
    instanceInit.setLineCol(0);
    (0, ArkMethodBuilder_1.checkAndUpdateMethod)(instanceInit, cls);
    cls.addMethod(instanceInit);
    cls.setInstanceInitMethod(instanceInit);
}
function init4StaticInitMethod(cls) {
    const staticInit = new ArkMethod_1.ArkMethod();
    staticInit.setDeclaringArkClass(cls);
    staticInit.setIsGeneratedFlag(true);
    staticInit.setModifiers(ArkBaseModel_1.ModifierType.STATIC);
    const methodSubSignature = ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(Const_1.STATIC_INIT_METHOD_NAME);
    methodSubSignature.setReturnType(Type_1.VoidType.getInstance());
    const methodSignature = new ArkSignature_1.MethodSignature(staticInit.getDeclaringArkClass().getSignature(), methodSubSignature);
    staticInit.setImplementationSignature(methodSignature);
    staticInit.setLineCol(0);
    (0, ArkMethodBuilder_1.checkAndUpdateMethod)(staticInit, cls);
    cls.addMethod(staticInit);
    cls.setStaticInitMethod(staticInit);
}
function buildStruct2ArkClass(clsNode, cls, sourceFile, declaringMethod) {
    const className = genClassName(clsNode.name ? clsNode.name.text : '', cls, declaringMethod);
    const classSignature = new ArkSignature_1.ClassSignature(className, cls.getDeclaringArkFile().getFileSignature(), cls.getDeclaringArkNamespace()?.getSignature() || null);
    cls.setSignature(classSignature);
    if (clsNode.typeParameters) {
        (0, builderUtils_1.buildTypeParameters)(clsNode.typeParameters, sourceFile, cls).forEach(typeParameter => {
            cls.addGenericType(typeParameter);
        });
    }
    initHeritage((0, builderUtils_1.buildHeritageClauses)(clsNode.heritageClauses), cls);
    cls.setModifiers((0, builderUtils_1.buildModifiers)(clsNode));
    cls.setDecorators((0, builderUtils_1.buildDecorators)(clsNode, sourceFile));
    cls.setCategory(ArkClass_1.ClassCategory.STRUCT);
    init4InstanceInitMethod(cls);
    init4StaticInitMethod(cls);
    buildArkClassMembers(clsNode, cls, sourceFile);
}
function buildClass2ArkClass(clsNode, cls, sourceFile, declaringMethod) {
    const className = genClassName(clsNode.name ? clsNode.name.text : '', cls, declaringMethod);
    const classSignature = new ArkSignature_1.ClassSignature(className, cls.getDeclaringArkFile().getFileSignature(), cls.getDeclaringArkNamespace()?.getSignature() || null);
    cls.setSignature(classSignature);
    if (clsNode.typeParameters) {
        (0, builderUtils_1.buildTypeParameters)(clsNode.typeParameters, sourceFile, cls).forEach(typeParameter => {
            cls.addGenericType(typeParameter);
        });
    }
    initHeritage((0, builderUtils_1.buildHeritageClauses)(clsNode.heritageClauses), cls);
    cls.setModifiers((0, builderUtils_1.buildModifiers)(clsNode));
    cls.setDecorators((0, builderUtils_1.buildDecorators)(clsNode, sourceFile));
    cls.setCategory(ArkClass_1.ClassCategory.CLASS);
    init4InstanceInitMethod(cls);
    init4StaticInitMethod(cls);
    buildArkClassMembers(clsNode, cls, sourceFile);
}
function initHeritage(heritageClauses, cls) {
    let superName = '';
    for (let [key, value] of heritageClauses) {
        if (value === ohos_typescript_1.default.SyntaxKind[ohos_typescript_1.default.SyntaxKind.ExtendsKeyword]) {
            superName = key;
            break;
        }
    }
    cls.addHeritageClassName(superName);
    for (let key of heritageClauses.keys()) {
        cls.addHeritageClassName(key);
    }
}
function buildInterface2ArkClass(clsNode, cls, sourceFile, declaringMethod) {
    const className = genClassName(clsNode.name ? clsNode.name.text : '', cls, declaringMethod);
    const classSignature = new ArkSignature_1.ClassSignature(className, cls.getDeclaringArkFile().getFileSignature(), cls.getDeclaringArkNamespace()?.getSignature() || null);
    cls.setSignature(classSignature);
    if (clsNode.typeParameters) {
        (0, builderUtils_1.buildTypeParameters)(clsNode.typeParameters, sourceFile, cls).forEach(typeParameter => {
            cls.addGenericType(typeParameter);
        });
    }
    initHeritage((0, builderUtils_1.buildHeritageClauses)(clsNode.heritageClauses), cls);
    cls.setModifiers((0, builderUtils_1.buildModifiers)(clsNode));
    cls.setDecorators((0, builderUtils_1.buildDecorators)(clsNode, sourceFile));
    cls.setCategory(ArkClass_1.ClassCategory.INTERFACE);
    buildArkClassMembers(clsNode, cls, sourceFile);
}
function buildEnum2ArkClass(clsNode, cls, sourceFile, declaringMethod) {
    const className = genClassName(clsNode.name ? clsNode.name.text : '', cls, declaringMethod);
    const classSignature = new ArkSignature_1.ClassSignature(className, cls.getDeclaringArkFile().getFileSignature(), cls.getDeclaringArkNamespace()?.getSignature() || null);
    cls.setSignature(classSignature);
    cls.setModifiers((0, builderUtils_1.buildModifiers)(clsNode));
    cls.setDecorators((0, builderUtils_1.buildDecorators)(clsNode, sourceFile));
    cls.setCategory(ArkClass_1.ClassCategory.ENUM);
    init4StaticInitMethod(cls);
    buildArkClassMembers(clsNode, cls, sourceFile);
}
function buildTypeLiteralNode2ArkClass(clsNode, cls, sourceFile, declaringMethod) {
    const className = genClassName('', cls, declaringMethod);
    const classSignature = new ArkSignature_1.ClassSignature(className, cls.getDeclaringArkFile().getFileSignature(), cls.getDeclaringArkNamespace()?.getSignature() || null);
    cls.setSignature(classSignature);
    cls.setCategory(ArkClass_1.ClassCategory.TYPE_LITERAL);
    if (ohos_typescript_1.default.isTypeAliasDeclaration(clsNode.parent) && clsNode.parent.typeParameters) {
        (0, builderUtils_1.buildTypeParameters)(clsNode.parent.typeParameters, sourceFile, cls).forEach(typeParameter => {
            cls.addGenericType(typeParameter);
        });
    }
    buildArkClassMembers(clsNode, cls, sourceFile);
}
function buildObjectLiteralExpression2ArkClass(clsNode, cls, sourceFile, declaringMethod) {
    const className = genClassName('', cls, declaringMethod);
    const classSignature = new ArkSignature_1.ClassSignature(className, cls.getDeclaringArkFile().getFileSignature(), cls.getDeclaringArkNamespace()?.getSignature() || null);
    cls.setSignature(classSignature);
    cls.setCategory(ArkClass_1.ClassCategory.OBJECT);
    let arkMethods = [];
    init4InstanceInitMethod(cls);
    const instanceIRTransformer = new ArkIRTransformer_1.ArkIRTransformer(sourceFile, cls.getInstanceInitMethod());
    const instanceFieldInitializerStmts = [];
    clsNode.properties.forEach(property => {
        if (ohos_typescript_1.default.isPropertyAssignment(property) || ohos_typescript_1.default.isShorthandPropertyAssignment(property) || ohos_typescript_1.default.isSpreadAssignment(property)) {
            const arkField = (0, ArkFieldBuilder_1.buildProperty2ArkField)(property, sourceFile, cls);
            if (ohos_typescript_1.default.isPropertyAssignment(property)) {
                getInitStmts(instanceIRTransformer, arkField, property.initializer);
                arkField.getInitializer().forEach(stmt => instanceFieldInitializerStmts.push(stmt));
            }
        }
        else {
            let arkMethod = new ArkMethod_1.ArkMethod();
            arkMethod.setDeclaringArkClass(cls);
            (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(property, cls, arkMethod, sourceFile);
        }
    });
    (0, ArkMethodBuilder_1.buildInitMethod)(cls.getInstanceInitMethod(), instanceFieldInitializerStmts, instanceIRTransformer.getThisLocal());
    arkMethods.forEach(mtd => {
        (0, ArkMethodBuilder_1.checkAndUpdateMethod)(mtd, cls);
        cls.addMethod(mtd);
    });
}
function genClassName(declaringName, cls, declaringMethod) {
    if (!declaringName) {
        const declaringArkNamespace = cls.getDeclaringArkNamespace();
        const num = declaringArkNamespace ? declaringArkNamespace.getAnonymousClassNumber() : cls.getDeclaringArkFile().getAnonymousClassNumber();
        declaringName = Const_1.ANONYMOUS_CLASS_PREFIX + num;
    }
    const suffix = declaringMethod ? `${Const_1.ANONYMOUS_CLASS_DELIMITER}${declaringMethod.getDeclaringArkClass().getName()}${Const_1.NESTED_CLASS_METHOD_DELIMITER}${declaringMethod.getName()}` : '';
    return declaringName + suffix;
}
function buildArkClassMembers(clsNode, cls, sourceFile) {
    if (ohos_typescript_1.default.isObjectLiteralExpression(clsNode)) {
        return;
    }
    buildMethodsForClass(clsNode, cls, sourceFile);
    const staticBlockMethodSignatures = buildStaticBlocksForClass(clsNode, cls, sourceFile);
    let instanceIRTransformer;
    let staticIRTransformer;
    if (ohos_typescript_1.default.isClassDeclaration(clsNode) || ohos_typescript_1.default.isClassExpression(clsNode) || ohos_typescript_1.default.isStructDeclaration(clsNode)) {
        instanceIRTransformer = new ArkIRTransformer_1.ArkIRTransformer(sourceFile, cls.getInstanceInitMethod());
        staticIRTransformer = new ArkIRTransformer_1.ArkIRTransformer(sourceFile, cls.getStaticInitMethod());
    }
    if (ohos_typescript_1.default.isEnumDeclaration(clsNode)) {
        staticIRTransformer = new ArkIRTransformer_1.ArkIRTransformer(sourceFile, cls.getStaticInitMethod());
    }
    const staticInitStmts = [];
    const instanceInitStmts = [];
    let staticBlockId = 0;
    const enumFieldInfo = { lastFieldName: '', curValue: 0, isCurValueValid: true };
    clsNode.members.forEach(member => {
        if (isClassMethod(member)) {
            // these node types have been handled at the beginning of this function by calling buildMethodsForClass
            return;
        }
        if (ohos_typescript_1.default.isPropertyDeclaration(member) || ohos_typescript_1.default.isPropertySignature(member)) {
            const arkField = (0, ArkFieldBuilder_1.buildProperty2ArkField)(member, sourceFile, cls);
            if (!ohos_typescript_1.default.isClassDeclaration(clsNode) && !ohos_typescript_1.default.isClassExpression(clsNode) && !ohos_typescript_1.default.isStructDeclaration(clsNode)) {
                return;
            }
            if (arkField.isStatic()) {
                getInitStmts(staticIRTransformer, arkField, member.initializer);
                arkField.getInitializer().forEach(stmt => staticInitStmts.push(stmt));
                return;
            }
            if (!instanceIRTransformer) {
                console.log(clsNode.getText(sourceFile));
            }
            getInitStmts(instanceIRTransformer, arkField, member.initializer);
            arkField.getInitializer().forEach(stmt => instanceInitStmts.push(stmt));
            return;
        }
        if (ohos_typescript_1.default.isEnumMember(member)) {
            const arkField = (0, ArkFieldBuilder_1.buildProperty2ArkField)(member, sourceFile, cls);
            getInitStmts(staticIRTransformer, arkField, member.initializer, enumFieldInfo);
            arkField.getInitializer().forEach(stmt => staticInitStmts.push(stmt));
        }
        else if (ohos_typescript_1.default.isIndexSignatureDeclaration(member)) {
            (0, ArkFieldBuilder_1.buildIndexSignature2ArkField)(member, sourceFile, cls);
        }
        else if (ohos_typescript_1.default.isClassStaticBlockDeclaration(member)) {
            const currStaticBlockMethodSig = staticBlockMethodSignatures[staticBlockId++];
            const staticBlockInvokeExpr = new Expr_1.ArkStaticInvokeExpr(currStaticBlockMethodSig, []);
            staticInitStmts.push(new Stmt_1.ArkInvokeStmt(staticBlockInvokeExpr));
        }
        else if (ohos_typescript_1.default.isSemicolonClassElement(member)) {
            logger.trace('Skip these members.');
        }
        else {
            logger.warn(`Please contact developers to support new member in class: ${cls.getSignature().toString()}, member: ${member.getText()}!`);
        }
    });
    if (ohos_typescript_1.default.isClassDeclaration(clsNode) || ohos_typescript_1.default.isClassExpression(clsNode) || ohos_typescript_1.default.isStructDeclaration(clsNode)) {
        (0, ArkMethodBuilder_1.buildInitMethod)(cls.getInstanceInitMethod(), instanceInitStmts, instanceIRTransformer.getThisLocal());
        (0, ArkMethodBuilder_1.buildInitMethod)(cls.getStaticInitMethod(), staticInitStmts, staticIRTransformer.getThisLocal());
    }
    if (ohos_typescript_1.default.isEnumDeclaration(clsNode)) {
        (0, ArkMethodBuilder_1.buildInitMethod)(cls.getStaticInitMethod(), staticInitStmts, staticIRTransformer.getThisLocal());
    }
}
function isClassMethod(member) {
    return (ohos_typescript_1.default.isMethodDeclaration(member) ||
        ohos_typescript_1.default.isConstructorDeclaration(member) ||
        ohos_typescript_1.default.isMethodSignature(member) ||
        ohos_typescript_1.default.isConstructSignatureDeclaration(member) ||
        ohos_typescript_1.default.isAccessor(member) ||
        ohos_typescript_1.default.isCallSignatureDeclaration(member));
}
function buildMethodsForClass(clsNode, cls, sourceFile) {
    clsNode.members.forEach(member => {
        if (ohos_typescript_1.default.isMethodDeclaration(member) ||
            ohos_typescript_1.default.isConstructorDeclaration(member) ||
            ohos_typescript_1.default.isMethodSignature(member) ||
            ohos_typescript_1.default.isConstructSignatureDeclaration(member) ||
            ohos_typescript_1.default.isAccessor(member) ||
            ohos_typescript_1.default.isCallSignatureDeclaration(member)) {
            let mthd = new ArkMethod_1.ArkMethod();
            (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(member, cls, mthd, sourceFile);
            if (ohos_typescript_1.default.isConstructorDeclaration(member)) {
                buildParameterProperty2ArkField(member.parameters, cls, sourceFile);
            }
        }
    });
}
// params of constructor method may have modifiers such as public or private to directly define class properties with constructor
function buildParameterProperty2ArkField(params, cls, sourceFile) {
    if (params.length === 0) {
        return;
    }
    params.forEach(parameter => {
        let fieldName;
        if (ohos_typescript_1.default.isIdentifier(parameter.name)) {
            fieldName = parameter.name.text;
        }
        else if (ohos_typescript_1.default.isObjectBindingPattern(parameter.name)) {
            // TODO
            logger.warn(`Need to support param property with ObjectBindingPattern node type: ${cls.getSignature().toString()}!`);
            return;
        }
        else if (ohos_typescript_1.default.isArrayBindingPattern(parameter.name)) {
            // TODO
            logger.warn(`Need to support param property with ArrayBindingPattern node type: ${cls.getSignature().toString()}!`);
            return;
        }
        else {
            logger.warn(`Need to support param property with new node type: ${cls.getSignature().toString()}!`);
            return;
        }
        if (parameter.modifiers === undefined || !ohos_typescript_1.default.isIdentifier(parameter.name)) {
            return;
        }
        let field = new ArkField_1.ArkField();
        field.setDeclaringArkClass(cls);
        field.setCode(parameter.getText(sourceFile));
        field.setCategory(ArkField_1.FieldCategory.PARAMETER_PROPERTY);
        field.setOriginPosition(Position_1.LineColPosition.buildFromNode(parameter, sourceFile));
        let fieldType;
        if (parameter.type) {
            fieldType = (0, builderUtils_1.buildGenericType)((0, builderUtils_1.tsNode2Type)(parameter.type, sourceFile, field), field);
        }
        else {
            fieldType = Type_1.UnknownType.getInstance();
        }
        const fieldSignature = new ArkSignature_1.FieldSignature(fieldName, cls.getSignature(), fieldType, false);
        field.setSignature(fieldSignature);
        field.setModifiers((0, builderUtils_1.buildModifiers)(parameter));
        if (parameter.questionToken) {
            field.setQuestionToken(true);
        }
        cls.addField(field);
    });
}
function buildStaticBlocksForClass(clsNode, cls, sourceFile) {
    let staticInitBlockId = 0;
    const staticBlockMethodSignatures = [];
    clsNode.members.forEach(member => {
        if (ohos_typescript_1.default.isClassStaticBlockDeclaration(member)) {
            const staticBlockMethod = new ArkMethod_1.ArkMethod();
            staticBlockMethod.setDeclaringArkClass(cls);
            staticBlockMethod.setIsGeneratedFlag(true);
            staticBlockMethod.setCode(member.getText(sourceFile));
            const methodName = Const_1.STATIC_BLOCK_METHOD_NAME_PREFIX + staticInitBlockId++;
            const methodSubSignature = new ArkSignature_1.MethodSubSignature(methodName, [], Type_1.VoidType.getInstance(), true);
            const methodSignature = new ArkSignature_1.MethodSignature(cls.getSignature(), methodSubSignature);
            staticBlockMethodSignatures.push(methodSignature);
            staticBlockMethod.setImplementationSignature(methodSignature);
            const { line, character } = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, member.getStart(sourceFile));
            staticBlockMethod.setLine(line + 1);
            staticBlockMethod.setColumn(character + 1);
            let bodyBuilder = new BodyBuilder_1.BodyBuilder(staticBlockMethod.getSignature(), member, staticBlockMethod, sourceFile);
            staticBlockMethod.setBodyBuilder(bodyBuilder);
            cls.addMethod(staticBlockMethod);
        }
    });
    return staticBlockMethodSignatures;
}
function getInitStmts(transformer, field, initNode, enumFieldInfo) {
    let initValue;
    let initPositions;
    const stmts = [];
    if (initNode) {
        let initStmts = [];
        ({ value: initValue, valueOriginalPositions: initPositions, stmts: initStmts } = transformer.tsNodeToValueAndStmts(initNode));
        initStmts.forEach(stmt => stmts.push(stmt));
        if (IRUtils_1.IRUtils.moreThanOneAddress(initValue)) {
            ({ value: initValue, valueOriginalPositions: initPositions, stmts: initStmts } = transformer.generateAssignStmtForValue(initValue, initPositions));
            initStmts.forEach(stmt => stmts.push(stmt));
        }
        if (enumFieldInfo !== undefined) {
            if (initValue instanceof Constant_1.NumberConstant) {
                enumFieldInfo.curValue = parseFloat(initValue.getValue()) + 1;
                enumFieldInfo.isCurValueValid = true;
            }
            else {
                enumFieldInfo.lastFieldName = field.getName();
                enumFieldInfo.isCurValueValid = false;
            }
        }
    }
    else if (enumFieldInfo !== undefined) {
        if (enumFieldInfo.isCurValueValid) {
            initValue = ValueUtil_1.ValueUtil.getOrCreateNumberConst(enumFieldInfo.curValue);
            enumFieldInfo.curValue += 1;
        }
        else {
            initValue = new Expr_1.ArkNormalBinopExpr(new Local_1.Local(enumFieldInfo.lastFieldName), ValueUtil_1.ValueUtil.getOrCreateNumberConst(1), Expr_1.NormalBinaryOperator.Addition);
            enumFieldInfo.lastFieldName = field.getName();
        }
        initPositions = [Position_1.FullPosition.DEFAULT];
        field.setMetadata(ArkMetadata_1.ArkMetadataKind.ENUM_INIT_TYPE_USER, new ArkMetadata_1.EnumInitTypeUserMetadata(false));
    }
    else {
        return;
    }
    const fieldRef = new Ref_1.ArkInstanceFieldRef(transformer.getThisLocal(), field.getSignature());
    const fieldRefPositions = [Position_1.FullPosition.DEFAULT, Position_1.FullPosition.DEFAULT];
    const assignStmt = new Stmt_1.ArkAssignStmt(fieldRef, initValue);
    assignStmt.setOperandOriginalPositions([...fieldRefPositions, ...initPositions]);
    stmts.push(assignStmt);
    const fieldSourceCode = field.getCode();
    const fieldOriginPosition = field.getOriginPosition();
    for (const stmt of stmts) {
        stmt.setOriginPositionInfo(fieldOriginPosition);
        stmt.setOriginalText(fieldSourceCode);
    }
    field.setInitializer(stmts);
    if (field.getType() instanceof Type_1.UnknownType) {
        field.getSignature().setType(initValue.getType());
    }
}
//# sourceMappingURL=ArkClassBuilder.js.map