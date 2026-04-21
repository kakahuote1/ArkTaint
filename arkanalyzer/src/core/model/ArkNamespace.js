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
exports.ArkNamespace = void 0;
const ArkExport_1 = require("./ArkExport");
const ArkSignature_1 = require("./ArkSignature");
const TSConst_1 = require("../common/TSConst");
const Position_1 = require("../base/Position");
const ArkBaseModel_1 = require("./ArkBaseModel");
const Const_1 = require("../common/Const");
const SdkUtils_1 = require("../common/SdkUtils");
/**
 * @category core/model
 */
class ArkNamespace extends ArkBaseModel_1.ArkBaseModel {
    constructor() {
        super();
        this.sourceCodes = [''];
        this.lineCols = [];
        this.declaringArkNamespace = null;
        this.exportInfos = new Map();
        // name to model
        this.namespaces = new Map(); // don't contain nested namespace
        this.classes = new Map();
        this.anonymousClassNumber = 0;
    }
    /**
     * Returns the program language of the file where this namespace defined.
     */
    getLanguage() {
        return this.getDeclaringArkFile().getLanguage();
    }
    addNamespace(namespace) {
        const existing = this.namespaces.get(namespace.getName());
        if (existing) {
            // Merge content of namespaces with the same name
            namespace.getClasses().forEach(cls => existing.addArkClass(cls));
            namespace.getNamespaces().forEach(ns => existing.addNamespace(ns));
            return;
        }
        this.namespaces.set(namespace.getName(), namespace);
    }
    getNamespace(namespaceSignature) {
        const namespaceName = namespaceSignature.getNamespaceName();
        return this.getNamespaceWithName(namespaceName);
    }
    getNamespaceWithName(namespaceName) {
        return this.namespaces.get(namespaceName) || null;
    }
    getNamespaces() {
        return Array.from(this.namespaces.values());
    }
    setSignature(namespaceSignature) {
        this.namespaceSignature = namespaceSignature;
    }
    getSignature() {
        return this.namespaceSignature;
    }
    getNamespaceSignature() {
        return this.namespaceSignature;
    }
    getName() {
        return this.namespaceSignature.getNamespaceName();
    }
    getCode() {
        return this.sourceCodes[0];
    }
    setCode(sourceCode) {
        this.sourceCodes[0] = sourceCode;
    }
    /*
     * Get multiple sourceCodes when the arkNamespace is merged from multiple namespace with the same name
     */
    getCodes() {
        return this.sourceCodes;
    }
    /*
     * Set multiple sourceCodes when the arkNamespace is merged from multiple namespace with the same name
     */
    setCodes(sourceCodes) {
        this.sourceCodes = [];
        this.sourceCodes.push(...sourceCodes);
    }
    addCode(sourceCode) {
        this.sourceCodes.push(sourceCode);
    }
    getLine() {
        return (0, Position_1.getLineNo)(this.lineCols[0]);
    }
    setLine(line) {
        this.lineCols[0] = (0, Position_1.setLine)(this.lineCols[0], line);
    }
    getColumn() {
        return (0, Position_1.getColNo)(this.lineCols[0]);
    }
    setColumn(column) {
        this.lineCols[0] = (0, Position_1.setCol)(this.lineCols[0], column);
    }
    getLineColPairs() {
        const lineColPairs = [];
        this.lineCols.forEach(lineCol => {
            lineColPairs.push([(0, Position_1.getLineNo)(lineCol), (0, Position_1.getColNo)(lineCol)]);
        });
        return lineColPairs;
    }
    setLineCols(lineColPairs) {
        this.lineCols = [];
        lineColPairs.forEach(lineColPair => {
            this.lineCols.push((0, Position_1.setLineCol)(lineColPair[0], lineColPair[1]));
        });
    }
    getDeclaringInstance() {
        return this.declaringInstance;
    }
    setDeclaringInstance(declaringInstance) {
        this.declaringInstance = declaringInstance;
    }
    getDeclaringArkFile() {
        return this.declaringArkFile;
    }
    setDeclaringArkFile(declaringArkFile) {
        this.declaringArkFile = declaringArkFile;
    }
    getDeclaringArkNamespace() {
        return this.declaringArkNamespace;
    }
    setDeclaringArkNamespace(declaringArkNamespace) {
        this.declaringArkNamespace = declaringArkNamespace;
    }
    getClass(classSignature) {
        const className = classSignature instanceof ArkSignature_1.AliasClassSignature ? classSignature.getOriginName() : classSignature.getClassName();
        return this.getClassWithName(className);
    }
    getClassWithName(Class) {
        return this.classes.get(Class) || null;
    }
    getClasses() {
        return Array.from(new Set(this.classes.values()));
    }
    addArkClass(arkClass, originName) {
        const name = originName ?? arkClass.getName();
        const cls = this.classes.get(name);
        if (!cls) {
            this.classes.set(name, arkClass);
        }
        else {
            SdkUtils_1.SdkUtils.copyMembers(arkClass, cls);
        }
        if (!originName && !arkClass.isAnonymousClass()) {
            const index = name.indexOf(Const_1.NAME_DELIMITER);
            if (index > 0) {
                const originName = name.substring(0, index);
                this.addArkClass(arkClass, originName);
            }
        }
    }
    getExportInfos() {
        const exportInfos = [];
        this.exportInfos.forEach((value, key) => {
            if (key !== TSConst_1.ALL || value.getFrom()) {
                exportInfos.push(value);
            }
        });
        return exportInfos;
    }
    getExportInfoBy(name) {
        return this.exportInfos.get(name);
    }
    addExportInfo(exportInfo) {
        this.exportInfos.set(exportInfo.getExportClauseName(), exportInfo);
    }
    getDefaultClass() {
        return this.defaultClass;
    }
    setDefaultClass(defaultClass) {
        this.defaultClass = defaultClass;
    }
    getAllMethodsUnderThisNamespace() {
        let methods = [];
        this.classes.forEach(cls => {
            methods.push(...cls.getMethods());
        });
        this.namespaces.forEach(ns => {
            methods.push(...ns.getAllMethodsUnderThisNamespace());
        });
        return methods;
    }
    getAllClassesUnderThisNamespace() {
        let classes = [];
        classes.push(...this.classes.values());
        this.namespaces.forEach(ns => {
            classes.push(...ns.getAllClassesUnderThisNamespace());
        });
        return classes;
    }
    getAllNamespacesUnderThisNamespace() {
        let namespaces = [];
        namespaces.push(...this.namespaces.values());
        this.namespaces.forEach(ns => {
            namespaces.push(...ns.getAllNamespacesUnderThisNamespace());
        });
        return namespaces;
    }
    getAnonymousClassNumber() {
        return this.anonymousClassNumber++;
    }
    getExportType() {
        return ArkExport_1.ExportType.NAME_SPACE;
    }
    removeArkClass(arkClass) {
        let rtn = this.classes.delete(arkClass.getName());
        rtn &&= this.getDeclaringArkFile().getScene().removeClass(arkClass);
        return rtn;
    }
    removeNamespace(namespace) {
        let rtn = this.namespaces.delete(namespace.getName());
        rtn &&= this.getDeclaringArkFile().getScene().removeNamespace(namespace);
        return rtn;
    }
    validate() {
        return this.validateFields(['declaringArkFile', 'declaringInstance', 'namespaceSignature', 'defaultClass']);
    }
}
exports.ArkNamespace = ArkNamespace;
//# sourceMappingURL=ArkNamespace.js.map