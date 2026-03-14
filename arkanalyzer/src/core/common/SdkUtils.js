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
exports.SdkUtils = void 0;
const ArkExport_1 = require("../model/ArkExport");
const EtsConst_1 = require("./EtsConst");
const TSConst_1 = require("./TSConst");
const Const_1 = require("./Const");
const ArkClass_1 = require("../model/ArkClass");
const ArkSignature_1 = require("../model/ArkSignature");
const Local_1 = require("../base/Local");
const path_1 = __importDefault(require("path"));
const Type_1 = require("../base/Type");
const ArkNamespace_1 = require("../model/ArkNamespace");
const logger_1 = __importStar(require("../../utils/logger"));
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const fs_1 = __importDefault(require("fs"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'SdkUtils');
class SdkUtils {
    static setEsVersion(buildProfile) {
        const accessChain = 'buildOption.arkOptions.tscConfig.targetESVersion';
        const version = accessChain.split('.').reduce((acc, key) => acc?.[key], buildProfile);
        if (version && this.esVersionMap.has(version)) {
            this.esVersion = version;
        }
    }
    static getBuiltInSdk() {
        let builtInPath;
        try {
            // If arkanalyzer is used as dependency by other project, the base directory should be the module path.
            const moduleRoot = path_1.default.dirname(path_1.default.dirname(require.resolve('arkanalyzer')));
            builtInPath = path_1.default.join(moduleRoot, this.BUILT_IN_PATH);
            logger.debug(`arkanalyzer is used as dependency, so using builtin sdk file in ${builtInPath}.`);
        }
        catch {
            builtInPath = path_1.default.resolve(this.BUILT_IN_PATH);
            logger.debug(`use builtin sdk file in ${builtInPath}.`);
        }
        return {
            moduleName: '',
            name: this.BUILT_IN_NAME,
            path: builtInPath
        };
    }
    static fetchBuiltInFiles(builtInPath) {
        const filePath = path_1.default.resolve(builtInPath, this.esVersionMap.get(this.esVersion) ?? '');
        if (!fs_1.default.existsSync(filePath)) {
            logger.error(`built in directory ${filePath} is not exist, please check!`);
            return [];
        }
        const result = new Set();
        this.dfsFiles(filePath, result);
        return Array.from(result);
    }
    static dfsFiles(filePath, files) {
        const sourceFile = ohos_typescript_1.default.createSourceFile(filePath, fs_1.default.readFileSync(filePath, 'utf8'), ohos_typescript_1.default.ScriptTarget.Latest);
        const references = sourceFile.libReferenceDirectives;
        references.forEach(ref => {
            this.dfsFiles(path_1.default.join(path_1.default.dirname(filePath), `lib.${ref.fileName}.d.ts`), files);
        });
        files.add(filePath);
    }
    /*
     * Set static field to be null, then all related objects could be freed by GC.
     * Class SdkUtils is only internally used by ArkAnalyzer type inference, the dispose method should be called at the end of type inference.
     */
    static dispose() {
        this.sdkImportMap.clear();
    }
    static buildSdkImportMap(file) {
        const fileName = path_1.default.basename(file.getName());
        if (fileName.startsWith('@')) {
            this.sdkImportMap.set(fileName.replace(/\.d\.e?ts$/, ''), file);
        }
    }
    static getImportSdkFile(from) {
        return this.sdkImportMap.get(from);
    }
    static isGlobalPath(file) {
        return !!file.getScene().getOptions().sdkGlobalFolders?.find(x => {
            if (path_1.default.isAbsolute(x)) {
                return file.getFilePath().startsWith(x);
            }
            else {
                return file.getFilePath().includes(path_1.default.sep + x + path_1.default.sep);
            }
        });
    }
    static loadGlobalAPI(file, globalMap) {
        if (!this.isGlobalPath(file)) {
            return;
        }
        file.getClasses().forEach(cls => {
            if (!cls.isAnonymousClass() && !cls.isDefaultArkClass()) {
                this.loadAPI(cls, globalMap);
            }
            if (cls.isDefaultArkClass()) {
                cls.getMethods()
                    .filter(mtd => !mtd.isDefaultArkMethod() && !mtd.isAnonymousMethod())
                    .forEach(mtd => this.loadAPI(mtd, globalMap));
            }
        });
        file.getDefaultClass().getDefaultArkMethod()
            ?.getBody()
            ?.getAliasTypeMap()
            ?.forEach(a => this.loadAPI(a[0], globalMap, true));
        file.getNamespaces().forEach(ns => this.loadAPI(ns, globalMap));
    }
    static mergeGlobalAPI(file, globalMap) {
        if (!this.isGlobalPath(file)) {
            return;
        }
        file.getClasses().forEach(cls => {
            if (!cls.isAnonymousClass() && !cls.isDefaultArkClass()) {
                this.loadClass(globalMap, cls);
            }
        });
        file.getNamespaces().forEach(ns => {
            const oldNs = globalMap.get(ns.getName());
            if (oldNs instanceof ArkNamespace_1.ArkNamespace && oldNs !== ns) {
                SdkUtils.copyNamespace(ns, oldNs);
            }
        });
    }
    static copyNamespace(ns, oldNs) {
        ns.getClasses().forEach(cls => {
            const oldCls = oldNs.getClassWithName(cls.getName());
            if (oldCls) {
                this.copyMembers(cls, oldCls);
            }
            else {
                oldNs.addArkClass(cls);
            }
        });
    }
    static loadAPI(api, globalMap, override = false) {
        const old = globalMap.get(api.getName());
        if (!old) {
            globalMap.set(api.getName(), api);
        }
        else if (override) {
            logger.trace(`${old.getSignature()} is override`);
            globalMap.set(api.getName(), api);
        }
        else {
            logger.trace(`duplicated api: ${api.getSignature()}`);
        }
    }
    static postInferredSdk(file, globalMap) {
        if (!this.isGlobalPath(file)) {
            return;
        }
        const defaultArkMethod = file.getDefaultClass().getDefaultArkMethod();
        defaultArkMethod
            ?.getBody()
            ?.getLocals()
            .forEach(local => {
            const name = local.getName();
            if (name !== TSConst_1.THIS_NAME && !name.startsWith(Const_1.TEMP_LOCAL_PREFIX)) {
                this.loadGlobalLocal(local, defaultArkMethod, globalMap);
            }
        });
    }
    static loadClass(globalMap, cls) {
        const old = globalMap.get(cls.getName());
        if (cls === old) {
            return;
        }
        else if (old instanceof ArkClass_1.ArkClass && old.getDeclaringArkFile().getProjectName() === cls.getDeclaringArkFile().getProjectName()) {
            if (old.getCategory() === ArkClass_1.ClassCategory.CLASS || old.getCategory() === ArkClass_1.ClassCategory.INTERFACE) {
                this.copyMembers(cls, old);
            }
            else {
                this.copyMembers(old, cls);
                globalMap.delete(cls.getName());
                this.loadAPI(cls, globalMap, true);
            }
        }
        else {
            this.loadAPI(cls, globalMap, true);
        }
    }
    static loadGlobalLocal(local, defaultArkMethod, globalMap) {
        const name = local.getName();
        local.setSignature(new ArkSignature_1.LocalSignature(name, defaultArkMethod.getSignature()));
        const scene = defaultArkMethod.getDeclaringArkFile().getScene();
        if (scene.getOptions().isScanAbc) {
            const instance = globalMap.get(name + 'Interface');
            const attr = globalMap.get(name + EtsConst_1.COMPONENT_ATTRIBUTE);
            if (attr instanceof ArkClass_1.ArkClass && instance instanceof ArkClass_1.ArkClass) {
                this.copyMembers(instance, attr);
                globalMap.set(name, attr);
                return;
            }
        }
        const old = globalMap.get(name);
        if (old instanceof ArkClass_1.ArkClass && local.getType() instanceof Type_1.ClassType) {
            const localConstructor = globalMap.get(local.getType().getClassSignature().getClassName());
            if (localConstructor instanceof ArkClass_1.ArkClass) {
                this.copyMembers(localConstructor, old);
            }
            else {
                this.loadAPI(local, globalMap, true);
            }
        }
        else {
            this.loadAPI(local, globalMap, true);
        }
    }
    static copyMembers(from, to) {
        from.getMethods().forEach(method => {
            const dist = method.isStatic() ? to.getStaticMethodWithName(method.getName()) : to.getMethodWithName(method.getName());
            const distSignatures = dist?.getDeclareSignatures();
            if (distSignatures) {
                method.getDeclareSignatures()?.forEach(x => distSignatures.push(x));
            }
            else if (method.getName() === Const_1.DEFAULT_ARK_METHOD_NAME && dist) {
                method.getBody()?.getLocals().forEach(local => dist.getBody()?.getLocals().set(local.getName(), local));
                method.getBody()?.getAliasTypeMap()?.forEach(type => dist.getBody()?.getAliasTypeMap()?.set(type[0].getName(), type));
            }
            else {
                to.addMethod(method);
            }
        });
        from.getFields().forEach(field => {
            const dist = field.isStatic() ? to.getStaticFieldWithName(field.getName()) : to.getFieldWithName(field.getName());
            if (!dist) {
                to.addField(field);
            }
        });
    }
    static computeGlobalThis(leftOp, arkMethod) {
        const globalThis = arkMethod.getDeclaringArkFile().getScene().getSdkGlobal(TSConst_1.GLOBAL_THIS_NAME);
        if (globalThis instanceof ArkNamespace_1.ArkNamespace) {
            const exportInfo = new ArkExport_1.ExportInfo.Builder()
                .exportClauseName(leftOp.getFieldName())
                .arkExport(new Local_1.Local(leftOp.getFieldName(), leftOp.getType()))
                .build();
            globalThis.addExportInfo(exportInfo);
        }
    }
}
exports.SdkUtils = SdkUtils;
SdkUtils.esVersion = 'ES2017';
SdkUtils.esVersionMap = new Map([
    ['ES2017', 'lib.es2020.d.ts'],
    ['ES2021', 'lib.es2021.d.ts']
]);
SdkUtils.sdkImportMap = new Map();
SdkUtils.BUILT_IN_NAME = 'built-in';
SdkUtils.BUILT_IN_PATH = 'node_modules/ohos-typescript/lib';
//# sourceMappingURL=SdkUtils.js.map