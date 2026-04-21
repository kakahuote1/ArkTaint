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
exports.buildExportInfo = buildExportInfo;
exports.buildExportAssignment = buildExportAssignment;
exports.buildExportDeclaration = buildExportDeclaration;
exports.buildDefaultExportInfo = buildDefaultExportInfo;
exports.buildExportVariableStatement = buildExportVariableStatement;
exports.buildExportTypeAliasDeclaration = buildExportTypeAliasDeclaration;
exports.isExported = isExported;
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const Position_1 = require("../../base/Position");
const ArkExport_1 = require("../ArkExport");
const builderUtils_1 = require("./builderUtils");
const TSConst_1 = require("../../common/TSConst");
const ArkBaseModel_1 = require("../ArkBaseModel");
const IRUtils_1 = require("../../common/IRUtils");
const ArkClass_1 = require("../ArkClass");
const ArkClassBuilder_1 = require("./ArkClassBuilder");
let tempIndex = 0;
function getTempAll() {
    return `${TSConst_1.TEMP_EXPORT_ALL_PREFIX}${tempIndex++}`;
}
function buildExportInfo(arkInstance, arkFile, line) {
    let exportClauseName;
    if (arkInstance instanceof ArkBaseModel_1.ArkBaseModel && arkInstance.isDefault()) {
        exportClauseName = TSConst_1.DEFAULT;
    }
    else {
        exportClauseName = arkInstance.getName();
    }
    return new ArkExport_1.ExportInfo.Builder()
        .exportClauseName(exportClauseName)
        .exportClauseType(arkInstance.getExportType())
        .modifiers(arkInstance.getModifiers())
        .arkExport(arkInstance)
        .originTsPosition(line)
        .declaringArkFile(arkFile)
        .build();
}
function buildDefaultExportInfo(im, file, arkExport) {
    return new ArkExport_1.ExportInfo.Builder()
        .exportClauseType(arkExport?.getExportType() ?? ArkExport_1.ExportType.CLASS)
        .exportClauseName(im.getOriginName())
        .declaringArkFile(file)
        .arkExport(arkExport ?? file.getDefaultClass())
        .build();
}
function buildExportDeclaration(node, sourceFile, arkFile) {
    const originTsPosition = Position_1.LineColPosition.buildFromNode(node, sourceFile);
    const tsSourceCode = node.getText(sourceFile);
    let exportFrom = '';
    if (node.moduleSpecifier && ohos_typescript_1.default.isStringLiteral(node.moduleSpecifier)) {
        exportFrom = node.moduleSpecifier.text;
    }
    let modifiers = 0;
    if (node.isTypeOnly) {
        modifiers |= ArkBaseModel_1.ModifierType.TYPE;
    }
    let exportInfos = [];
    // just like: export {xxx as x} from './yy'
    if (node.exportClause && ohos_typescript_1.default.isNamedExports(node.exportClause) && node.exportClause.elements) {
        node.exportClause.elements.forEach(element => {
            let modifier = modifiers;
            if (element.isTypeOnly) {
                modifier |= ArkBaseModel_1.ModifierType.TYPE;
            }
            let builder = new ArkExport_1.ExportInfo.Builder()
                .exportClauseType(ArkExport_1.ExportType.UNKNOWN).exportClauseName(element.name.text)
                .tsSourceCode(tsSourceCode).exportFrom(exportFrom).originTsPosition(originTsPosition)
                .declaringArkFile(arkFile)
                .setLeadingComments(IRUtils_1.IRUtils.getCommentsMetadata(node, sourceFile, arkFile.getScene().getOptions(), true))
                .setTrailingComments(IRUtils_1.IRUtils.getCommentsMetadata(node, sourceFile, arkFile.getScene().getOptions(), false))
                .modifiers(modifier);
            if (element.propertyName && ohos_typescript_1.default.isIdentifier(element.propertyName)) {
                builder.nameBeforeAs(element.propertyName.text);
            }
            exportInfos.push(builder.build());
        });
        return exportInfos;
    }
    let builder1 = new ArkExport_1.ExportInfo.Builder()
        .exportClauseType(ArkExport_1.ExportType.UNKNOWN).nameBeforeAs(TSConst_1.ALL)
        .modifiers(modifiers).tsSourceCode(tsSourceCode)
        .exportFrom(exportFrom).declaringArkFile(arkFile)
        .setLeadingComments(IRUtils_1.IRUtils.getCommentsMetadata(node, sourceFile, arkFile.getScene().getOptions(), true))
        .setTrailingComments(IRUtils_1.IRUtils.getCommentsMetadata(node, sourceFile, arkFile.getScene().getOptions(), false))
        .originTsPosition(originTsPosition);
    if (node.exportClause && ohos_typescript_1.default.isNamespaceExport(node.exportClause) && ohos_typescript_1.default.isIdentifier(node.exportClause.name)) {
        // just like: export * as xx from './yy'
        exportInfos.push(builder1.exportClauseName(node.exportClause.name.text).build());
    }
    else if (!node.exportClause && node.moduleSpecifier) {
        // just like: export * from './yy'
        const tempAll = getTempAll();
        exportInfos.push(builder1.nameBeforeAs(tempAll).exportClauseName(tempAll).build());
    }
    return exportInfos;
}
function buildExportAssignment(node, sourceFile, arkFile) {
    let exportInfos = [];
    if (!node.expression) {
        return exportInfos;
    }
    const originTsPosition = Position_1.LineColPosition.buildFromNode(node, sourceFile);
    const tsSourceCode = node.getText(sourceFile);
    let modifiers = (0, builderUtils_1.buildModifiers)(node);
    if (isKeyword(node.getChildren(sourceFile), ohos_typescript_1.default.SyntaxKind.DefaultKeyword) || node.isExportEquals) {
        modifiers |= ArkBaseModel_1.ModifierType.DEFAULT;
    }
    let exportInfo = new ArkExport_1.ExportInfo.Builder()
        .exportClauseType(ArkExport_1.ExportType.UNKNOWN)
        .modifiers(modifiers)
        .tsSourceCode(tsSourceCode)
        .originTsPosition(originTsPosition)
        .declaringArkFile(arkFile)
        .exportClauseName(TSConst_1.DEFAULT)
        .setLeadingComments(IRUtils_1.IRUtils.getCommentsMetadata(node, sourceFile, arkFile.getScene().getOptions(), true))
        .setTrailingComments(IRUtils_1.IRUtils.getCommentsMetadata(node, sourceFile, arkFile.getScene().getOptions(), false));
    if (ohos_typescript_1.default.isNewExpression(node.expression) && ohos_typescript_1.default.isClassExpression(node.expression.expression)) {
        let cls = new ArkClass_1.ArkClass();
        (0, ArkClassBuilder_1.buildNormalArkClassFromArkFile)(node.expression.expression, arkFile, cls, sourceFile);
    }
    if (ohos_typescript_1.default.isIdentifier(node.expression)) {
        // just like: export default xx
        exportInfo.nameBeforeAs(node.expression.text);
    }
    else if (ohos_typescript_1.default.isAsExpression(node.expression)) {
        // just like: export default xx as YY
        exportInfo.nameBeforeAs(node.expression.expression.getText(sourceFile));
    }
    exportInfos.push(exportInfo.build());
    return exportInfos;
}
/**
 * export const c = '', b = 1;
 * @param node
 * @param sourceFile
 * @param arkFile
 */
function buildExportVariableStatement(node, sourceFile, arkFile, namespace) {
    let exportInfos = [];
    const originTsPosition = Position_1.LineColPosition.buildFromNode(node, sourceFile);
    const modifiers = node.modifiers ? (0, builderUtils_1.buildModifiers)(node) : 0;
    const tsSourceCode = node.getText(sourceFile);
    node.declarationList.declarations.forEach(dec => {
        const exportInfoBuilder = new ArkExport_1.ExportInfo.Builder()
            .exportClauseName(dec.name.getText(sourceFile))
            .exportClauseType(ArkExport_1.ExportType.LOCAL)
            .modifiers(modifiers)
            .tsSourceCode(tsSourceCode)
            .originTsPosition(originTsPosition)
            .declaringArkFile(arkFile);
        if (namespace) {
            exportInfoBuilder.declaringArkNamespace(namespace);
        }
        exportInfos.push(exportInfoBuilder.build());
    });
    return exportInfos;
}
/**
 * export type MyType = string;
 * @param node
 * @param sourceFile
 * @param arkFile
 */
function buildExportTypeAliasDeclaration(node, sourceFile, arkFile) {
    let exportInfos = [];
    const originTsPosition = Position_1.LineColPosition.buildFromNode(node, sourceFile);
    let modifiers = node.modifiers ? (0, builderUtils_1.buildModifiers)(node) : 0;
    modifiers |= ArkBaseModel_1.ModifierType.TYPE;
    const tsSourceCode = node.getText(sourceFile);
    const exportInfo = new ArkExport_1.ExportInfo.Builder()
        .exportClauseName(node.name.text)
        .exportClauseType(ArkExport_1.ExportType.TYPE)
        .tsSourceCode(tsSourceCode)
        .modifiers(modifiers)
        .originTsPosition(originTsPosition)
        .declaringArkFile(arkFile)
        .build();
    exportInfos.push(exportInfo);
    return exportInfos;
}
function isExported(modifierArray) {
    if (!modifierArray) {
        return false;
    }
    for (let child of modifierArray) {
        if (child.kind === ohos_typescript_1.default.SyntaxKind.ExportKeyword) {
            return true;
        }
    }
    return false;
}
function isKeyword(modifierArray, keyword) {
    if (!modifierArray) {
        return false;
    }
    for (let child of modifierArray) {
        if (child.kind === keyword) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=ArkExportBuilder.js.map