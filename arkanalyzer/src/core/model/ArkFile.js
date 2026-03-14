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
exports.ArkFile = exports.Language = exports.notStmtOrExprKind = void 0;
const ArkNamespace_1 = require("./ArkNamespace");
const ArkSignature_1 = require("./ArkSignature");
const TSConst_1 = require("../common/TSConst");
const Const_1 = require("../common/Const");
const SdkUtils_1 = require("../common/SdkUtils");
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
var Language;
(function (Language) {
    Language[Language["TYPESCRIPT"] = 0] = "TYPESCRIPT";
    Language[Language["ARKTS1_1"] = 1] = "ARKTS1_1";
    Language[Language["ARKTS1_2"] = 2] = "ARKTS1_2";
    Language[Language["JAVASCRIPT"] = 3] = "JAVASCRIPT";
    Language[Language["CXX"] = 4] = "CXX";
    Language[Language["ABC"] = 5] = "ABC";
    Language[Language["UNKNOWN"] = -1] = "UNKNOWN";
})(Language || (exports.Language = Language = {}));
/**
 * @category core/model
 */
class ArkFile {
    constructor(language) {
        this.absoluteFilePath = '';
        this.projectDir = '';
        this.code = '';
        // name to model
        this.namespaces = new Map(); // don't contain nested namespaces
        this.classes = new Map(); // don't contain class in namespace
        this.importInfoMap = new Map();
        this.exportInfoMap = new Map();
        this.fileSignature = ArkSignature_1.FileSignature.DEFAULT;
        this.ohPackageJson5Path = [];
        this.anonymousClassNumber = 0;
        this.ast = null;
        this.language = language;
    }
    /**
     * Returns the program language of the file.
     */
    getLanguage() {
        return this.language;
    }
    setLanguage(language) {
        this.language = language;
    }
    /**
     * Returns the **string** name of the file, which also acts as the file's relative path.
     * @returns The file's name (also means its relative path).
     */
    getName() {
        return this.fileSignature.getFileName();
    }
    setScene(scene) {
        this.scene = scene;
    }
    /**
     * Returns the scene (i.e., {@link Scene}) built for the project. The {@link Scene} is the core class of ArkAnalyzer,
     * through which users can access all the information of the analyzed code (project),
     * including file list, class list, method list, property list, etc.
     * @returns The scene of the file.
     */
    getScene() {
        return this.scene;
    }
    getModuleScene() {
        return this.moduleScene;
    }
    setModuleScene(moduleScene) {
        this.moduleScene = moduleScene;
    }
    setProjectDir(projectDir) {
        this.projectDir = projectDir;
    }
    getProjectDir() {
        return this.projectDir;
    }
    /**
     * Get a file path.
     * @returns The absolute file path.
     * @example
     * 1. Read source code based on file path.

     ```typescript
     let str = fs.readFileSync(arkFile.getFilePath(), 'utf8');
     ```
     */
    getFilePath() {
        return this.absoluteFilePath;
    }
    setFilePath(absoluteFilePath) {
        this.absoluteFilePath = absoluteFilePath;
    }
    setCode(code) {
        this.code = code;
    }
    /**
     * Returns the codes of file as a **string.**
     * @returns the codes of file.
     */
    getCode() {
        return this.code;
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
                if (!this.classes.has(originName)) {
                    this.addArkClass(arkClass, originName);
                }
            }
        }
    }
    getDefaultClass() {
        return this.defaultClass;
    }
    setDefaultClass(defaultClass) {
        this.defaultClass = defaultClass;
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
    /**
     * Returns the class based on its class signature. If the class could not be found, **null** will be returned.
     * @param classSignature - the class signature.
     * @returns A class. If there is no class, the return will be a **null**.
     */
    getClass(classSignature) {
        const className = classSignature instanceof ArkSignature_1.AliasClassSignature ? classSignature.getOriginName() : classSignature.getClassName();
        return this.getClassWithName(className);
    }
    getClassWithName(className) {
        // First, search for the top-level class
        let cls = this.classes.get(className);
        if (cls) {
            return cls;
        }
        // Recursively search for classes within namespaces
        for (const ns of this.namespaces.values()) {
            cls = this.findClassInNamespace(ns, className);
            if (cls) {
                return cls;
            }
        }
        return null;
    }
    findClassInNamespace(namespace, className) {
        const cls = namespace.getClassWithName(className);
        if (cls) {
            return cls;
        }
        for (const ns of namespace.getNamespaces()) {
            const found = this.findClassInNamespace(ns, className);
            if (found) {
                return found;
            }
        }
        return null;
    }
    getClasses() {
        return Array.from(new Set(this.classes.values()));
    }
    addNamespace(namespace) {
        this.namespaces.set(namespace.getName(), namespace);
    }
    /**
     * Returns an **array** of import information.
     * The import information includes: clause's name, type, modifiers, location where it is imported from, etc.
     * @returns An **array** of import information.
     */
    getImportInfos() {
        return Array.from(this.importInfoMap.values());
    }
    getImportInfoBy(name) {
        return this.importInfoMap.get(name);
    }
    addImportInfo(importInfo) {
        this.importInfoMap.set(importInfo.getImportClauseName(), importInfo);
    }
    removeImportInfo(importInfo) {
        return this.importInfoMap.delete(importInfo.getImportClauseName());
    }
    removeNamespace(namespace) {
        let rtn = this.namespaces.delete(namespace.getName());
        rtn &&= this.getScene().removeNamespace(namespace);
        return rtn;
    }
    removeArkClass(arkClass) {
        let rtn = this.classes.delete(arkClass.getName());
        rtn &&= this.getScene().removeClass(arkClass);
        return rtn;
    }
    getExportInfos() {
        const exportInfos = [];
        this.exportInfoMap.forEach((value, key) => {
            if (key !== TSConst_1.ALL || value.getFrom()) {
                exportInfos.push(value);
            }
        });
        return exportInfos;
    }
    /**
     * Find out the {@link ExportInfo} of this {@link ArkFile} by the given export name.
     * It returns an {@link ExportInfo} or 'undefined' if it failed to find.
     * @param name
     * @returns
     * @example
     ```typescript
     // abc.ts ArkFile
     export class A {
     ...
     }

     export namespace B {
     export namespace C {
     export class D {}
     }
     }

     // xyz.ts call getExportInfoBy
     let arkFile = scene.getFile(fileSignature);

     // a is the export class A defined in abc.ts
     let a = arkFile.getExportInfoBy('A');

     // b is the export class D within namespace C defined in abc.ts
     let b = arkFile.getExportInfoBy('B.C.D');
     ```
     */
    getExportInfoBy(name) {
        const separator = '.';
        const names = name.split(separator);
        if (names.length === 1) {
            return this.exportInfoMap.get(names[0]);
        }
        let index = 0;
        let currExportInfo = this.exportInfoMap.get(names[index]);
        if (currExportInfo === undefined) {
            return undefined;
        }
        for (let i = 1; i < names.length; i++) {
            const arkExport = currExportInfo.getArkExport();
            if (arkExport && arkExport instanceof ArkNamespace_1.ArkNamespace) {
                currExportInfo = arkExport.getExportInfoBy(names[i]);
                if (currExportInfo === undefined) {
                    return undefined;
                }
            }
        }
        return currExportInfo;
    }
    addExportInfo(exportInfo, key) {
        this.exportInfoMap.set(key ?? exportInfo.getExportClauseName(), exportInfo);
    }
    removeExportInfo(exportInfo, key) {
        if (key) {
            this.exportInfoMap.delete(key);
            return;
        }
        this.exportInfoMap.delete(exportInfo.getExportClauseName());
    }
    getProjectName() {
        return this.fileSignature.getProjectName();
    }
    getModuleName() {
        return this.moduleScene?.getModuleName();
    }
    setOhPackageJson5Path(ohPackageJson5Path) {
        this.ohPackageJson5Path = ohPackageJson5Path;
    }
    getOhPackageJson5Path() {
        return this.ohPackageJson5Path;
    }
    /**
     * Returns the file signature of this file. A file signature consists of project's name and file's name.
     * @returns The file signature of this file.
     */
    getFileSignature() {
        return this.fileSignature;
    }
    setFileSignature(fileSignature) {
        this.fileSignature = fileSignature;
    }
    getAllNamespacesUnderThisFile() {
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
    getAST() {
        return this.ast;
    }
    setAST(value) {
        this.ast = value;
    }
}
exports.ArkFile = ArkFile;
//# sourceMappingURL=ArkFile.js.map