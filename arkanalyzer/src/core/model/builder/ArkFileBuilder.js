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
exports.notStmtOrExprKind = void 0;
exports.buildArkFileFromFile = buildArkFileFromFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const ArkFile_1 = require("../ArkFile");
const ArkNamespace_1 = require("../ArkNamespace");
const logger_1 = __importStar(require("../../../utils/logger"));
const ArkClassBuilder_1 = require("./ArkClassBuilder");
const ArkMethodBuilder_1 = require("./ArkMethodBuilder");
const ArkImportBuilder_1 = require("./ArkImportBuilder");
const ArkExportBuilder_1 = require("./ArkExportBuilder");
const ArkNamespaceBuilder_1 = require("./ArkNamespaceBuilder");
const ArkClass_1 = require("../ArkClass");
const ArkMethod_1 = require("../ArkMethod");
const Position_1 = require("../../base/Position");
const EtsConst_1 = require("../../common/EtsConst");
const ArkSignature_1 = require("../ArkSignature");
const Const_1 = require("../../common/Const");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ArkFileBuilder');
exports.notStmtOrExprKind = [
    'ModuleDeclaration',
    'ClassDeclaration',
    'InterfaceDeclaration',
    'EnumDeclaration',
    'ExportDeclaration',
    'ExportAssignment',
    'MethodDeclaration',
    'Constructor',
    'FunctionDeclaration',
    'GetAccessor',
    'SetAccessor',
    'ArrowFunction',
    'FunctionExpression',
    'MethodSignature',
    'ConstructSignature',
    'CallSignature',
];
/**
 * Entry of building ArkFile instance
 *
 * @param arkFile
 * @returns
 */
function buildArkFileFromFile(absoluteFilePath, projectDir, arkFile, projectName) {
    arkFile.setFilePath(absoluteFilePath);
    arkFile.setProjectDir(projectDir);
    const fileSignature = new ArkSignature_1.FileSignature(projectName, path_1.default.relative(projectDir, absoluteFilePath));
    arkFile.setFileSignature(fileSignature);
    try {
        arkFile.setCode(fs_1.default.readFileSync(arkFile.getFilePath(), 'utf8'));
    }
    catch (error) {
        logger.error('Failed to read file: ${error}');
        return;
    }
    const sourceFile = ohos_typescript_1.default.createSourceFile(arkFile.getName(), arkFile.getCode(), ohos_typescript_1.default.ScriptTarget.Latest, true, undefined, EtsConst_1.ETS_COMPILER_OPTIONS);
    // save ast source file, if enabled ast and file is from the project (not from sdk)
    if (arkFile.getScene().getOptions().enableAST && arkFile.getScene().getProjectName() === arkFile.getProjectName()) {
        arkFile.setAST(sourceFile);
    }
    genDefaultArkClass(arkFile, sourceFile);
    buildArkFile(arkFile, sourceFile);
}
/**
 * Building ArkFile instance
 *
 * @param arkFile
 * @param astRoot
 * @returns
 */
function buildArkFile(arkFile, astRoot) {
    const statements = astRoot.statements;
    const namespaces = [];
    statements.forEach(child => {
        if (ohos_typescript_1.default.isModuleDeclaration(child)) {
            let ns = new ArkNamespace_1.ArkNamespace();
            ns.setDeclaringArkFile(arkFile);
            (0, ArkNamespaceBuilder_1.buildArkNamespace)(child, arkFile, ns, astRoot);
            namespaces.push(ns);
            if (ns.isExported()) {
                arkFile.addExportInfo((0, ArkExportBuilder_1.buildExportInfo)(ns, arkFile, Position_1.LineColPosition.buildFromNode(child, astRoot)));
            }
        }
        else if (ohos_typescript_1.default.isClassDeclaration(child) || ohos_typescript_1.default.isInterfaceDeclaration(child) || ohos_typescript_1.default.isEnumDeclaration(child) || ohos_typescript_1.default.isStructDeclaration(child)) {
            let cls = new ArkClass_1.ArkClass();
            (0, ArkClassBuilder_1.buildNormalArkClassFromArkFile)(child, arkFile, cls, astRoot);
            if (cls.isExported()) {
                arkFile.addExportInfo((0, ArkExportBuilder_1.buildExportInfo)(cls, arkFile, Position_1.LineColPosition.buildFromNode(child, astRoot)));
            }
        }
        // TODO: Check
        else if (ohos_typescript_1.default.isMethodDeclaration(child)) {
            logger.trace('This is a MethodDeclaration in ArkFile.');
            let mthd = new ArkMethod_1.ArkMethod();
            (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(child, arkFile.getDefaultClass(), mthd, astRoot);
            if (mthd.isExported()) {
                arkFile.addExportInfo((0, ArkExportBuilder_1.buildExportInfo)(mthd, arkFile, Position_1.LineColPosition.buildFromNode(child, astRoot)));
            }
        }
        else if (ohos_typescript_1.default.isFunctionDeclaration(child)) {
            let mthd = new ArkMethod_1.ArkMethod();
            (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(child, arkFile.getDefaultClass(), mthd, astRoot);
            if (mthd.isExported()) {
                arkFile.addExportInfo((0, ArkExportBuilder_1.buildExportInfo)(mthd, arkFile, Position_1.LineColPosition.buildFromNode(child, astRoot)));
            }
        }
        else if (ohos_typescript_1.default.isImportEqualsDeclaration(child) || ohos_typescript_1.default.isImportDeclaration(child)) {
            let importInfos = (0, ArkImportBuilder_1.buildImportInfo)(child, astRoot, arkFile);
            importInfos?.forEach(element => {
                element.setDeclaringArkFile(arkFile);
                arkFile.addImportInfo(element);
            });
        }
        else if (ohos_typescript_1.default.isExportDeclaration(child)) {
            (0, ArkExportBuilder_1.buildExportDeclaration)(child, astRoot, arkFile).forEach(item => arkFile.addExportInfo(item));
        }
        else if (ohos_typescript_1.default.isExportAssignment(child)) {
            (0, ArkExportBuilder_1.buildExportAssignment)(child, astRoot, arkFile).forEach(item => arkFile.addExportInfo(item));
        }
        else if (ohos_typescript_1.default.isVariableStatement(child) && (0, ArkExportBuilder_1.isExported)(child.modifiers)) {
            (0, ArkExportBuilder_1.buildExportVariableStatement)(child, astRoot, arkFile).forEach(item => arkFile.addExportInfo(item));
        }
        else if (ohos_typescript_1.default.isTypeAliasDeclaration(child) && (0, ArkExportBuilder_1.isExported)(child.modifiers)) {
            (0, ArkExportBuilder_1.buildExportTypeAliasDeclaration)(child, astRoot, arkFile).forEach(item => arkFile.addExportInfo(item));
        }
        else if (ohos_typescript_1.default.isExpressionStatement(child) && ohos_typescript_1.default.isStringLiteral(child.expression)) {
            child.expression.text.trim() === Const_1.ARKTS_STATIC_MARK && arkFile.setLanguage(ArkFile_1.Language.ARKTS1_2);
        }
        else {
            logger.trace('Child joined default method of arkFile: ', ohos_typescript_1.default.SyntaxKind[child.kind]);
        }
    });
    const mergedNameSpaces = (0, ArkNamespaceBuilder_1.mergeNameSpaces)(namespaces);
    mergedNameSpaces.forEach(mergedNameSpace => {
        arkFile.addNamespace(mergedNameSpace);
        if (mergedNameSpace.isExport()) {
            const linCol = new Position_1.LineColPosition(mergedNameSpace.getLine(), mergedNameSpace.getColumn());
            arkFile.addExportInfo((0, ArkExportBuilder_1.buildExportInfo)(mergedNameSpace, arkFile, linCol));
        }
    });
}
function genDefaultArkClass(arkFile, astRoot) {
    let defaultClass = new ArkClass_1.ArkClass();
    (0, ArkClassBuilder_1.buildDefaultArkClassFromArkFile)(arkFile, defaultClass, astRoot);
    arkFile.setDefaultClass(defaultClass);
    arkFile.addArkClass(defaultClass);
}
//# sourceMappingURL=ArkFileBuilder.js.map