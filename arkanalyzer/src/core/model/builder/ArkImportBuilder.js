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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildImportInfo = buildImportInfo;
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const Position_1 = require("../../base/Position");
const ArkImport_1 = require("../ArkImport");
const IRUtils_1 = require("../../common/IRUtils");
const ArkBaseModel_1 = require("../ArkBaseModel");
function buildImportInfo(node, sourceFile, arkFile) {
    if (ohos_typescript_1.default.isImportDeclaration(node)) {
        return buildImportDeclarationNode(node, sourceFile, arkFile);
    }
    else if (ohos_typescript_1.default.isImportEqualsDeclaration(node)) {
        return buildImportEqualsDeclarationNode(node, sourceFile, arkFile);
    }
    return [];
}
function buildImportDeclarationNode(node, sourceFile, arkFile) {
    const originTsPosition = Position_1.LineColPosition.buildFromNode(node, sourceFile);
    const tsSourceCode = node.getText(sourceFile);
    let importInfos = [];
    let importFrom = '';
    if (ohos_typescript_1.default.isStringLiteral(node.moduleSpecifier)) {
        importFrom = node.moduleSpecifier.text;
    }
    let modifiers = 0;
    // just like: import '../xxx'
    if (!node.importClause) {
        let importClauseName = '';
        let importType = '';
        let importInfo = new ArkImport_1.ImportInfo();
        importInfo.build(importClauseName, importType, importFrom, originTsPosition, modifiers);
        importInfo.setTsSourceCode(tsSourceCode);
        IRUtils_1.IRUtils.setComments(importInfo, node, sourceFile, arkFile.getScene().getOptions());
        importInfos.push(importInfo);
        return importInfos;
    }
    if (node.importClause.isTypeOnly) {
        modifiers |= ArkBaseModel_1.ModifierType.TYPE;
    }
    if (node.importClause.isLazy) {
        modifiers |= ArkBaseModel_1.ModifierType.LAZY;
    }
    //just like: import zs from 'xxx'
    if (node.importClause.name && ohos_typescript_1.default.isIdentifier(node.importClause.name)) {
        let importClauseName = node.importClause.name.text;
        const pos = Position_1.LineColPosition.buildFromNode(node.importClause.name, sourceFile);
        let importType = 'Identifier';
        let importInfo = new ArkImport_1.ImportInfo();
        importInfo.build(importClauseName, importType, importFrom, pos, modifiers);
        importInfo.setTsSourceCode(tsSourceCode);
        IRUtils_1.IRUtils.setComments(importInfo, node, sourceFile, arkFile.getScene().getOptions());
        importInfos.push(importInfo);
    }
    if (node.importClause.namedBindings === undefined) {
        return importInfos;
    }
    // just like: import {xxx} from './yyy'
    if (ohos_typescript_1.default.isNamedImports(node.importClause.namedBindings)) {
        const elements = node.importClause.namedBindings.elements;
        if (elements === undefined) {
            return importInfos;
        }
        let importType = 'NamedImports';
        elements.forEach(element => {
            if (element.name === undefined || !ohos_typescript_1.default.isIdentifier(element.name)) {
                return;
            }
            let modifier = modifiers;
            if (element.isTypeOnly) {
                modifier |= ArkBaseModel_1.ModifierType.TYPE;
            }
            let importClauseName = element.name.text;
            const pos = Position_1.LineColPosition.buildFromNode(element, sourceFile);
            let importInfo = new ArkImport_1.ImportInfo();
            if (element.propertyName && ohos_typescript_1.default.isIdentifier(element.propertyName)) {
                importInfo.build(importClauseName, importType, importFrom, pos, modifier, element.propertyName.text);
            }
            else {
                importInfo.build(importClauseName, importType, importFrom, pos, modifier);
            }
            importInfo.setTsSourceCode(tsSourceCode);
            IRUtils_1.IRUtils.setComments(importInfo, node, sourceFile, arkFile.getScene().getOptions());
            importInfos.push(importInfo);
        });
    }
    // just like: import * as ts from 'ohos-typescript'
    if (ohos_typescript_1.default.isNamespaceImport(node.importClause.namedBindings)) {
        let importType = 'NamespaceImport';
        if (node.importClause.namedBindings.name && ohos_typescript_1.default.isIdentifier(node.importClause.namedBindings.name)) {
            let importClauseName = node.importClause.namedBindings.name.text;
            let importInfo = new ArkImport_1.ImportInfo();
            let nameBeforeAs = '*';
            const pos = Position_1.LineColPosition.buildFromNode(node.importClause.namedBindings.name, sourceFile);
            importInfo.build(importClauseName, importType, importFrom, pos, modifiers, nameBeforeAs);
            importInfo.setTsSourceCode(tsSourceCode);
            IRUtils_1.IRUtils.setComments(importInfo, node, sourceFile, arkFile.getScene().getOptions());
            importInfos.push(importInfo);
        }
    }
    return importInfos;
}
function buildImportEqualsDeclarationNode(node, sourceFile, arkFile) {
    const originTsPosition = Position_1.LineColPosition.buildFromNode(node, sourceFile);
    const tsSourceCode = node.getText(sourceFile);
    let importInfos = [];
    let importType = 'EqualsImport';
    let modifiers = 0;
    if (node.isTypeOnly) {
        modifiers |= ArkBaseModel_1.ModifierType.TYPE;
    }
    if (node.moduleReference &&
        ohos_typescript_1.default.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ohos_typescript_1.default.isStringLiteral(node.moduleReference.expression)) {
        let importFrom = node.moduleReference.expression.text;
        let importClauseName = node.name.text;
        let importInfo = new ArkImport_1.ImportInfo();
        importInfo.build(importClauseName, importType, importFrom, originTsPosition, modifiers);
        importInfo.setTsSourceCode(tsSourceCode);
        IRUtils_1.IRUtils.setComments(importInfo, node, sourceFile, arkFile.getScene().getOptions());
        importInfos.push(importInfo);
    }
    return importInfos;
}
//# sourceMappingURL=ArkImportBuilder.js.map