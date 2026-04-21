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
exports.buildGetAccessor2ArkField = exports.buildIndexSignature2ArkField = exports.buildProperty2ArkField = void 0;
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const ArkField_1 = require("../ArkField");
const logger_1 = __importStar(require("../../../utils/logger"));
const builderUtils_1 = require("./builderUtils");
const ArkSignature_1 = require("../ArkSignature");
const Type_1 = require("../../base/Type");
const Position_1 = require("../../base/Position");
const ArkBaseModel_1 = require("../ArkBaseModel");
const IRUtils_1 = require("../../common/IRUtils");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ArkFieldBuilder');
function buildProperty2ArkField(member, sourceFile, cls) {
    let field = new ArkField_1.ArkField();
    field.setCategory(mapSyntaxKindToFieldOriginType(member.kind));
    field.setCode(member.getText(sourceFile));
    field.setDeclaringArkClass(cls);
    field.setOriginPosition(Position_1.LineColPosition.buildFromNode(member, sourceFile));
    let fieldName = member.getText(sourceFile);
    if (member.name && ohos_typescript_1.default.isComputedPropertyName(member.name)) {
        if (ohos_typescript_1.default.isIdentifier(member.name.expression)) {
            fieldName = member.name.expression.text;
        }
        else if (ohos_typescript_1.default.isPropertyAccessExpression(member.name.expression)) {
            fieldName = (0, builderUtils_1.handlePropertyAccessExpression)(member.name.expression);
        }
        else {
            logger.warn(`Other property expression type found: ${member.name.expression.getText()}!`);
        }
    }
    else if (member.name && (ohos_typescript_1.default.isIdentifier(member.name) || ohos_typescript_1.default.isLiteralExpression(member.name))) {
        fieldName = member.name.text;
    }
    else if (member.name && ohos_typescript_1.default.isPrivateIdentifier(member.name)) {
        let propertyName = member.name.text;
        fieldName = propertyName.substring(1);
        field.addModifier(ArkBaseModel_1.ModifierType.PRIVATE);
    }
    else {
        logger.warn(`Other type of property name found: ${member.getText()}!`);
    }
    let fieldType = Type_1.UnknownType.getInstance();
    if (ohos_typescript_1.default.isPropertyDeclaration(member) || ohos_typescript_1.default.isPropertySignature(member)) {
        if (member.modifiers) {
            field.addModifier((0, builderUtils_1.buildModifiers)(member));
        }
        field.addModifier(0);
        field.setDecorators((0, builderUtils_1.buildDecorators)(member, sourceFile));
        field.setQuestionToken(member.questionToken !== undefined);
        if (member.type) {
            fieldType = (0, builderUtils_1.buildGenericType)((0, builderUtils_1.tsNode2Type)(member.type, sourceFile, cls), field);
        }
    }
    if (ohos_typescript_1.default.isEnumMember(member)) {
        field.addModifier(ArkBaseModel_1.ModifierType.STATIC);
        fieldType = new Type_1.ClassType(cls.getSignature());
    }
    field.setSignature(new ArkSignature_1.FieldSignature(fieldName, cls.getSignature(), fieldType, field.isStatic()));
    if (ohos_typescript_1.default.isPropertyDeclaration(member) && member.exclamationToken) {
        field.setExclamationToken(true);
    }
    IRUtils_1.IRUtils.setComments(field, member, sourceFile, cls.getDeclaringArkFile().getScene().getOptions());
    cls.addField(field);
    return field;
}
exports.buildProperty2ArkField = buildProperty2ArkField;
function buildIndexSignature2ArkField(member, sourceFile, cls) {
    const field = new ArkField_1.ArkField();
    field.setCode(member.getText(sourceFile));
    field.setCategory(mapSyntaxKindToFieldOriginType(member.kind));
    field.setDeclaringArkClass(cls);
    field.setOriginPosition(Position_1.LineColPosition.buildFromNode(member, sourceFile));
    if (member.modifiers) {
        let modifier = (0, builderUtils_1.buildModifiers)(member);
        field.addModifier(modifier);
    }
    const fieldName = '[' + member.parameters[0].getText(sourceFile) + ']';
    const fieldType = (0, builderUtils_1.buildGenericType)((0, builderUtils_1.tsNode2Type)(member.type, sourceFile, field), field);
    const fieldSignature = new ArkSignature_1.FieldSignature(fieldName, cls.getSignature(), fieldType, true);
    field.setSignature(fieldSignature);
    IRUtils_1.IRUtils.setComments(field, member, sourceFile, cls.getDeclaringArkFile().getScene().getOptions());
    cls.addField(field);
}
exports.buildIndexSignature2ArkField = buildIndexSignature2ArkField;
function buildGetAccessor2ArkField(member, mthd, sourceFile) {
    let cls = mthd.getDeclaringArkClass();
    let field = new ArkField_1.ArkField();
    field.setDeclaringArkClass(cls);
    field.setCode(member.getText(sourceFile));
    field.setCategory(mapSyntaxKindToFieldOriginType(member.kind));
    field.setOriginPosition(Position_1.LineColPosition.buildFromNode(member, sourceFile));
    let fieldName = member.getText(sourceFile);
    if (ohos_typescript_1.default.isIdentifier(member.name) || ohos_typescript_1.default.isLiteralExpression(member.name)) {
        fieldName = member.name.text;
    }
    else if (ohos_typescript_1.default.isComputedPropertyName(member.name)) {
        if (ohos_typescript_1.default.isIdentifier(member.name.expression)) {
            let propertyName = member.name.expression.text;
            fieldName = propertyName;
        }
        else if (ohos_typescript_1.default.isPropertyAccessExpression(member.name.expression)) {
            fieldName = (0, builderUtils_1.handlePropertyAccessExpression)(member.name.expression);
        }
        else if (ohos_typescript_1.default.isLiteralExpression(member.name.expression)) {
            fieldName = member.name.expression.text;
        }
        else {
            logger.warn('Other type of computed property name found!');
        }
    }
    else {
        logger.warn('Please contact developers to support new type of GetAccessor name!');
    }
    const fieldType = mthd.getReturnType();
    const fieldSignature = new ArkSignature_1.FieldSignature(fieldName, cls.getSignature(), fieldType, false);
    field.setSignature(fieldSignature);
    cls.addField(field);
}
exports.buildGetAccessor2ArkField = buildGetAccessor2ArkField;
function mapSyntaxKindToFieldOriginType(syntaxKind) {
    let fieldOriginType = null;
    switch (syntaxKind) {
        case ohos_typescript_1.default.SyntaxKind.PropertyDeclaration:
            fieldOriginType = ArkField_1.FieldCategory.PROPERTY_DECLARATION;
            break;
        case ohos_typescript_1.default.SyntaxKind.PropertyAssignment:
            fieldOriginType = ArkField_1.FieldCategory.PROPERTY_ASSIGNMENT;
            break;
        case ohos_typescript_1.default.SyntaxKind.ShorthandPropertyAssignment:
            fieldOriginType = ArkField_1.FieldCategory.SHORT_HAND_PROPERTY_ASSIGNMENT;
            break;
        case ohos_typescript_1.default.SyntaxKind.SpreadAssignment:
            fieldOriginType = ArkField_1.FieldCategory.SPREAD_ASSIGNMENT;
            break;
        case ohos_typescript_1.default.SyntaxKind.PropertySignature:
            fieldOriginType = ArkField_1.FieldCategory.PROPERTY_SIGNATURE;
            break;
        case ohos_typescript_1.default.SyntaxKind.EnumMember:
            fieldOriginType = ArkField_1.FieldCategory.ENUM_MEMBER;
            break;
        case ohos_typescript_1.default.SyntaxKind.IndexSignature:
            fieldOriginType = ArkField_1.FieldCategory.INDEX_SIGNATURE;
            break;
        case ohos_typescript_1.default.SyntaxKind.GetAccessor:
            fieldOriginType = ArkField_1.FieldCategory.GET_ACCESSOR;
            break;
        default:
    }
    return fieldOriginType;
}
