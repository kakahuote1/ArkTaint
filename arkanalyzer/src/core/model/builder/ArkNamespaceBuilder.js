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
exports.buildArkNamespace = buildArkNamespace;
exports.mergeNameSpaces = mergeNameSpaces;
const Position_1 = require("../../base/Position");
const ArkClassBuilder_1 = require("./ArkClassBuilder");
const ArkFile_1 = require("../ArkFile");
const ArkMethodBuilder_1 = require("./ArkMethodBuilder");
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const ArkNamespace_1 = require("../ArkNamespace");
const builderUtils_1 = require("./builderUtils");
const logger_1 = __importStar(require("../../../utils/logger"));
const ArkExportBuilder_1 = require("./ArkExportBuilder");
const ArkClass_1 = require("../ArkClass");
const ArkMethod_1 = require("../ArkMethod");
const ArkSignature_1 = require("../ArkSignature");
const IRUtils_1 = require("../../common/IRUtils");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ArkNamespaceBuilder');
function buildArkNamespace(node, declaringInstance, ns, sourceFile) {
    // modifiers
    if (node.modifiers) {
        ns.setModifiers((0, builderUtils_1.buildModifiers)(node));
        ns.setDecorators((0, builderUtils_1.buildDecorators)(node, sourceFile));
    }
    if (declaringInstance instanceof ArkFile_1.ArkFile) {
        ns.setDeclaringArkFile(declaringInstance);
    }
    else {
        ns.setDeclaringArkNamespace(declaringInstance);
        ns.setDeclaringArkFile(declaringInstance.getDeclaringArkFile());
    }
    ns.setDeclaringInstance(declaringInstance);
    const namespaceName = node.name.text;
    const namespaceSignature = new ArkSignature_1.NamespaceSignature(namespaceName, ns.getDeclaringArkFile().getFileSignature(), ns.getDeclaringArkNamespace()?.getSignature() || null);
    ns.setSignature(namespaceSignature);
    // TODO: whether needed?
    ns.setCode(node.getText(sourceFile));
    // set line and column
    const { line, character } = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
    ns.setLine(line + 1);
    ns.setColumn(character + 1);
    genDefaultArkClass(ns, node, sourceFile);
    // build ns member
    if (node.body) {
        if (ohos_typescript_1.default.isModuleBlock(node.body)) {
            buildNamespaceMembers(node.body, ns, sourceFile);
        }
        // NamespaceDeclaration extends ModuleDeclaration
        //TODO: Check
        else if (ohos_typescript_1.default.isModuleDeclaration(node.body)) {
            logger.trace('This ModuleBody is an NamespaceDeclaration.');
            let childNs = new ArkNamespace_1.ArkNamespace();
            buildArkNamespace(node.body, ns, childNs, sourceFile);
            ns.addNamespace(childNs);
        }
        else if (ohos_typescript_1.default.isIdentifier(node.body)) {
            logger.warn('ModuleBody is Identifier');
        }
        else {
            logger.warn('JSDocNamespaceDeclaration found.');
        }
    }
    else {
        logger.warn('JSDocNamespaceDeclaration found.');
    }
    IRUtils_1.IRUtils.setComments(ns, node, sourceFile, ns.getDeclaringArkFile().getScene().getOptions());
}
// TODO: check and update
function buildNamespaceMembers(node, namespace, sourceFile) {
    const statements = node.statements;
    const nestedNamespaces = [];
    statements.forEach(child => {
        if (ohos_typescript_1.default.isModuleDeclaration(child)) {
            let childNs = new ArkNamespace_1.ArkNamespace();
            childNs.setDeclaringArkNamespace(namespace);
            childNs.setDeclaringArkFile(namespace.getDeclaringArkFile());
            buildArkNamespace(child, namespace, childNs, sourceFile);
            nestedNamespaces.push(childNs);
        }
        else if (ohos_typescript_1.default.isClassDeclaration(child) || ohos_typescript_1.default.isInterfaceDeclaration(child) || ohos_typescript_1.default.isEnumDeclaration(child) || ohos_typescript_1.default.isStructDeclaration(child)) {
            let cls = new ArkClass_1.ArkClass();
            (0, ArkClassBuilder_1.buildNormalArkClassFromArkNamespace)(child, namespace, cls, sourceFile);
            if (cls.isExported()) {
                namespace.addExportInfo((0, ArkExportBuilder_1.buildExportInfo)(cls, namespace.getDeclaringArkFile(), Position_1.LineColPosition.buildFromNode(child, sourceFile)));
            }
        }
        // TODO: Check
        else if (ohos_typescript_1.default.isMethodDeclaration(child)) {
            logger.trace('This is a MethodDeclaration in ArkNamespace.');
            let mthd = new ArkMethod_1.ArkMethod();
            (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(child, namespace.getDefaultClass(), mthd, sourceFile);
            if (mthd.isExported()) {
                namespace.addExportInfo((0, ArkExportBuilder_1.buildExportInfo)(mthd, namespace.getDeclaringArkFile(), Position_1.LineColPosition.buildFromNode(child, sourceFile)));
            }
        }
        else if (ohos_typescript_1.default.isFunctionDeclaration(child)) {
            let mthd = new ArkMethod_1.ArkMethod();
            (0, ArkMethodBuilder_1.buildArkMethodFromArkClass)(child, namespace.getDefaultClass(), mthd, sourceFile);
            if (mthd.isExported()) {
                namespace.addExportInfo((0, ArkExportBuilder_1.buildExportInfo)(mthd, namespace.getDeclaringArkFile(), Position_1.LineColPosition.buildFromNode(child, sourceFile)));
            }
        }
        else if (ohos_typescript_1.default.isExportDeclaration(child)) {
            (0, ArkExportBuilder_1.buildExportDeclaration)(child, sourceFile, namespace.getDeclaringArkFile()).forEach(item => namespace.addExportInfo(item));
        }
        else if (ohos_typescript_1.default.isExportAssignment(child)) {
            (0, ArkExportBuilder_1.buildExportAssignment)(child, sourceFile, namespace.getDeclaringArkFile()).forEach(item => namespace.addExportInfo(item));
        }
        else if (ohos_typescript_1.default.isVariableStatement(child) && (0, ArkExportBuilder_1.isExported)(child.modifiers)) {
            (0, ArkExportBuilder_1.buildExportVariableStatement)(child, sourceFile, namespace.getDeclaringArkFile(), namespace).forEach(item => namespace.addExportInfo(item));
        }
        else {
            logger.trace('Child joined default method of arkFile: ', ohos_typescript_1.default.SyntaxKind[child.kind]);
            // join default method
        }
    });
    const nestedMergedNameSpaces = mergeNameSpaces(nestedNamespaces);
    nestedMergedNameSpaces.forEach(nestedNameSpace => {
        namespace.addNamespace(nestedNameSpace);
        if (nestedNameSpace.isExport()) {
            const linCol = new Position_1.LineColPosition(nestedNameSpace.getLine(), nestedNameSpace.getColumn());
            namespace.addExportInfo((0, ArkExportBuilder_1.buildExportInfo)(nestedNameSpace, namespace.getDeclaringArkFile(), linCol));
        }
    });
}
function genDefaultArkClass(ns, node, sourceFile) {
    let defaultClass = new ArkClass_1.ArkClass();
    (0, ArkClassBuilder_1.buildDefaultArkClassFromArkNamespace)(ns, defaultClass, node, sourceFile);
    ns.setDefaultClass(defaultClass);
    ns.addArkClass(defaultClass);
}
function mergeNameSpaces(arkNamespaces) {
    const namespaceMap = new Map();
    for (let i = 0; i < arkNamespaces.length; i++) {
        const currNamespace = arkNamespaces[i];
        const currName = currNamespace.getName();
        if (namespaceMap.has(currName)) {
            const prevNamespace = namespaceMap.get(currName);
            const nestedPrevNamespaces = prevNamespace.getNamespaces();
            const nestedCurrNamespaces = currNamespace.getNamespaces();
            const nestedMergedNameSpaces = mergeNameSpaces([...nestedPrevNamespaces, ...nestedCurrNamespaces]);
            nestedMergedNameSpaces.forEach(nestedNameSpace => {
                prevNamespace.addNamespace(nestedNameSpace);
            });
            const classes = currNamespace.getClasses();
            classes.forEach(cls => {
                prevNamespace.addArkClass(cls);
            });
            const preSourceCodes = prevNamespace.getCodes();
            const currSourceCodes = currNamespace.getCodes();
            prevNamespace.setCodes([...preSourceCodes, ...currSourceCodes]);
            const prevLineColPairs = prevNamespace.getLineColPairs();
            const currLineColPairs = currNamespace.getLineColPairs();
            prevNamespace.setLineCols([...prevLineColPairs, ...currLineColPairs]);
        }
        else {
            namespaceMap.set(currName, currNamespace);
        }
    }
    return [...namespaceMap.values()];
}
//# sourceMappingURL=ArkNamespaceBuilder.js.map