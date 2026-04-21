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
exports.ModuleScene = exports.Scene = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ModelUtils_1 = require("./core/common/ModelUtils");
const TypeInference_1 = require("./core/common/TypeInference");
const VisibleValue_1 = require("./core/common/VisibleValue");
const ArkFile_1 = require("./core/model/ArkFile");
const ArkNamespace_1 = require("./core/model/ArkNamespace");
const ArkSignature_1 = require("./core/model/ArkSignature");
const logger_1 = __importStar(require("./utils/logger"));
const ArkFileBuilder_1 = require("./core/model/builder/ArkFileBuilder");
const json5parser_1 = require("./utils/json5parser");
const getAllFiles_1 = require("./utils/getAllFiles");
const FileUtils_1 = require("./utils/FileUtils");
const ArkExport_1 = require("./core/model/ArkExport");
const ArkMethodBuilder_1 = require("./core/model/builder/ArkMethodBuilder");
const Const_1 = require("./core/common/Const");
const CallGraph_1 = require("./callgraph/model/CallGraph");
const CallGraphBuilder_1 = require("./callgraph/model/builder/CallGraphBuilder");
const TSConst_1 = require("./core/common/TSConst");
const EtsConst_1 = require("./core/common/EtsConst");
const SdkUtils_1 = require("./core/common/SdkUtils");
const PointerAnalysisConfig_1 = require("./callgraph/pointerAnalysis/PointerAnalysisConfig");
const ValueUtil_1 = require("./core/common/ValueUtil");
const Inference_1 = require("./core/inference/Inference");
const IRInference_1 = require("./core/common/IRInference");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'Scene');
var SceneBuildStage;
(function (SceneBuildStage) {
    SceneBuildStage[SceneBuildStage["BUILD_INIT"] = 0] = "BUILD_INIT";
    SceneBuildStage[SceneBuildStage["SDK_INFERRED"] = 1] = "SDK_INFERRED";
    SceneBuildStage[SceneBuildStage["CLASS_DONE"] = 2] = "CLASS_DONE";
    SceneBuildStage[SceneBuildStage["METHOD_DONE"] = 3] = "METHOD_DONE";
    SceneBuildStage[SceneBuildStage["CLASS_COLLECTED"] = 4] = "CLASS_COLLECTED";
    SceneBuildStage[SceneBuildStage["METHOD_COLLECTED"] = 5] = "METHOD_COLLECTED";
    SceneBuildStage[SceneBuildStage["TYPE_INFERRED"] = 6] = "TYPE_INFERRED";
})(SceneBuildStage || (SceneBuildStage = {}));
/**
 * The Scene class includes everything in the analyzed project.
 * We should be able to re-generate the project's code based on this class.
 */
class Scene {
    constructor() {
        this.projectName = '';
        this.projectFiles = [];
        this.realProjectDir = '';
        this.moduleScenesMap = new Map();
        this.modulePath2NameMap = new Map();
        this.moduleSdkMap = new Map();
        this.projectSdkMap = new Map();
        // values that are visible in curr scope
        this.visibleValue = new VisibleValue_1.VisibleValue();
        // signature string to model
        this.filesMap = new Map();
        this.namespacesMap = new Map();
        this.classesMap = new Map();
        this.methodsMap = new Map();
        // TODO: type of key should be signature object
        this.sdkArkFilesMap = new Map();
        this.sdkGlobalMap = new Map();
        this.ohPkgContentMap = new Map();
        this.ohPkgFilePath = '';
        this.ohPkgContent = {};
        this.overRides = new Map();
        this.overRideDependencyMap = new Map();
        this.buildStage = SceneBuildStage.BUILD_INIT;
        this.fileLanguages = new Map();
        this.unhandledFilePaths = new Set();
        this.unhandledSdkFilePaths = [];
    }
    /*
     * Set all static field to be null, then all related objects could be freed by GC.
     * This method could be called before drop Scene.
     */
    dispose() {
        PointerAnalysisConfig_1.PointerAnalysisConfig.dispose();
        SdkUtils_1.SdkUtils.dispose();
        ValueUtil_1.ValueUtil.dispose();
        ModelUtils_1.ModelUtils.dispose();
    }
    getOptions() {
        return this.options;
    }
    getOverRides() {
        return this.overRides;
    }
    getOverRideDependencyMap() {
        return this.overRideDependencyMap;
    }
    clear() {
        this.projectFiles = [];
        this.moduleScenesMap.clear();
        this.modulePath2NameMap.clear();
        this.moduleSdkMap.clear();
        this.projectSdkMap.clear();
        this.filesMap.clear();
        this.namespacesMap.clear();
        this.classesMap.clear();
        this.methodsMap.clear();
        this.sdkArkFilesMap.clear();
        this.sdkGlobalMap.clear();
        this.ohPkgContentMap.clear();
        this.ohPkgContent = {};
    }
    getStage() {
        return this.buildStage;
    }
    /**
     * Build scene object according to the {@link SceneConfig}. This API implements 3 functions.
     * First is to build scene object from {@link SceneConfig}, second is to generate {@link ArkFile}s,
     * and the last is to collect project import infomation.
     * @param sceneConfig - a sceneConfig object, which is usally defined by user or Json file.
     * @example
     * 1. Build Scene object from scene config

     ```typescript
     // build config
     const projectDir = ... ...;
     const sceneConfig = new SceneConfig();
     sceneConfig.buildFromProjectDir(projectDir);

     // build scene
     const scene = new Scene();
     scene.buildSceneFromProjectDir(sceneConfig);
     ```
     */
    buildSceneFromProjectDir(sceneConfig) {
        this.buildBasicInfo(sceneConfig);
        this.genArkFiles();
    }
    buildSceneFromFiles(sceneConfig) {
        this.buildBasicInfo(sceneConfig);
        this.getFilesOrderByDependency();
    }
    /**
     * Set the basic information of the scene using a config,
     * such as the project's name, real path and files.
     * @param sceneConfig - the config used to set the basic information of scene.
     */
    buildBasicInfo(sceneConfig) {
        this.options = sceneConfig.getOptions();
        this.projectName = sceneConfig.getTargetProjectName();
        this.realProjectDir = fs_1.default.realpathSync(sceneConfig.getTargetProjectDirectory());
        this.projectFiles = sceneConfig.getProjectFiles();
        this.parseBuildProfile();
        this.parseOhPackage();
        let tsConfigFilePath;
        if (this.options.tsconfig) {
            tsConfigFilePath = path_1.default.join(sceneConfig.getTargetProjectDirectory(), this.options.tsconfig);
        }
        else {
            tsConfigFilePath = path_1.default.join(sceneConfig.getTargetProjectDirectory(), TSConst_1.TSCONFIG_JSON);
        }
        if (fs_1.default.existsSync(tsConfigFilePath)) {
            const tsConfigObj = (0, json5parser_1.fetchDependenciesFromFile)(tsConfigFilePath);
            this.findTsConfigInfoDeeply(tsConfigObj, tsConfigFilePath);
        }
        else {
            logger.warn('This project has no tsconfig.json!');
        }
        this.buildOhPkgContentMap();
        (0, ModelUtils_1.initModulePathMap)(this.ohPkgContentMap);
        // handle sdks
        if (this.options.enableBuiltIn && !sceneConfig.getSdksObj().find(sdk => sdk.name === SdkUtils_1.SdkUtils.BUILT_IN_NAME)) {
            sceneConfig.getSdksObj().unshift(SdkUtils_1.SdkUtils.getBuiltInSdk());
        }
        sceneConfig.getSdksObj()?.forEach(sdk => {
            if (!sdk.moduleName) {
                this.buildSdk(sdk.name, sdk.path);
                this.projectSdkMap.set(sdk.name, sdk);
            }
            else {
                let moduleSdks = this.moduleSdkMap.get(sdk.moduleName);
                if (moduleSdks) {
                    moduleSdks.push(sdk);
                }
                else {
                    this.moduleSdkMap.set(sdk.moduleName, [sdk]);
                }
            }
        });
        if (this.buildStage < SceneBuildStage.SDK_INFERRED) {
            this.sdkArkFilesMap.forEach(file => {
                Inference_1.InferenceManager.getInstance().getInference(file.getLanguage()).doInfer(file);
                SdkUtils_1.SdkUtils.mergeGlobalAPI(file, this.sdkGlobalMap);
            });
            this.sdkArkFilesMap.forEach(file => {
                SdkUtils_1.SdkUtils.postInferredSdk(file, this.sdkGlobalMap);
            });
            this.buildStage = SceneBuildStage.SDK_INFERRED;
        }
        this.fileLanguages = sceneConfig.getFileLanguages();
    }
    parseBuildProfile() {
        const buildProfile = path_1.default.join(this.realProjectDir, EtsConst_1.BUILD_PROFILE_JSON5);
        if (fs_1.default.existsSync(buildProfile)) {
            let configurationsText;
            try {
                configurationsText = fs_1.default.readFileSync(buildProfile, 'utf-8');
            }
            catch (error) {
                logger.error(`Error reading file: ${error}`);
                return;
            }
            const buildProfileJson = (0, json5parser_1.parseJsonText)(configurationsText);
            SdkUtils_1.SdkUtils.setEsVersion(buildProfileJson);
            const modules = buildProfileJson.modules;
            if (modules instanceof Array) {
                modules.forEach(module => {
                    this.modulePath2NameMap.set(path_1.default.resolve(this.realProjectDir, path_1.default.join(module.srcPath)), module.name);
                });
            }
        }
        else {
            logger.warn('There is no build-profile.json5 for this project.');
        }
    }
    parseOhPackage() {
        const OhPkgFilePath = path_1.default.join(this.realProjectDir, EtsConst_1.OH_PACKAGE_JSON5);
        if (fs_1.default.existsSync(OhPkgFilePath)) {
            this.ohPkgFilePath = OhPkgFilePath;
            this.ohPkgContent = (0, json5parser_1.fetchDependenciesFromFile)(this.ohPkgFilePath);
            this.ohPkgContentMap.set(OhPkgFilePath, this.ohPkgContent);
            if (this.ohPkgContent.overrides) {
                let overRides = this.ohPkgContent.overrides;
                for (const [key, value] of Object.entries(overRides)) {
                    this.overRides.set(key, value);
                }
            }
            if (this.ohPkgContent.overrideDependencyMap) {
                let globalOverRideDependencyMap = this.ohPkgContent.overrideDependencyMap;
                for (const [key, value] of Object.entries(globalOverRideDependencyMap)) {
                    let globalDependency = (0, json5parser_1.fetchDependenciesFromFile)(value);
                    this.overRideDependencyMap.set(key, globalDependency);
                }
            }
        }
        else {
            logger.warn('This project has no oh-package.json5!');
        }
    }
    findTsConfigInfoDeeply(tsConfigObj, tsConfigFilePath) {
        if (tsConfigObj.extends) {
            const extTsConfigObj = (0, json5parser_1.fetchDependenciesFromFile)(path_1.default.join(path_1.default.dirname(tsConfigFilePath), tsConfigObj.extends));
            this.findTsConfigInfoDeeply(extTsConfigObj, tsConfigFilePath);
            if (!this.baseUrl && !this.globalModule2PathMapping) {
                this.addTsConfigInfo(extTsConfigObj);
            }
        }
        if (!this.baseUrl && !this.globalModule2PathMapping) {
            this.addTsConfigInfo(tsConfigObj);
        }
    }
    addTsConfigInfo(tsConfigObj) {
        if (tsConfigObj.compilerOptions && tsConfigObj.compilerOptions.paths) {
            const paths = tsConfigObj.compilerOptions.paths;
            if (paths) {
                this.globalModule2PathMapping = paths;
            }
        }
        if (tsConfigObj.compilerOptions && tsConfigObj.compilerOptions.baseUrl) {
            this.baseUrl = tsConfigObj.compilerOptions.baseUrl;
        }
    }
    updateOrAddDefaultConstructors() {
        for (const file of this.getFiles()) {
            for (const cls of ModelUtils_1.ModelUtils.getAllClassesInFile(file)) {
                (0, ArkMethodBuilder_1.buildDefaultConstructor)(cls);
                const constructor = cls.getMethodWithName(TSConst_1.CONSTRUCTOR_NAME);
                if (constructor !== null && !cls.isDefaultArkClass()) {
                    (0, ArkMethodBuilder_1.replaceSuper2Constructor)(constructor);
                    (0, ArkMethodBuilder_1.addInitInConstructor)(constructor);
                }
            }
        }
    }
    buildAllMethodBody() {
        this.buildStage = SceneBuildStage.CLASS_DONE;
        const methods = [];
        for (const file of this.getFiles()) {
            for (const cls of file.getClasses()) {
                for (const method of cls.getMethods(true)) {
                    methods.push(method);
                }
            }
        }
        for (const namespace of this.getNamespacesMap().values()) {
            for (const cls of namespace.getClasses()) {
                for (const method of cls.getMethods(true)) {
                    methods.push(method);
                }
            }
        }
        for (const method of methods) {
            try {
                method.buildBody();
            }
            catch (error) {
                logger.error('Error building body:', method.getSignature(), error);
            }
            finally {
                method.freeBodyBuilder();
            }
        }
        ModelUtils_1.ModelUtils.dispose();
        this.buildStage = SceneBuildStage.METHOD_DONE;
    }
    genArkFiles() {
        this.projectFiles.forEach(file => {
            logger.trace('=== parse file:', file);
            try {
                const arkFile = new ArkFile_1.ArkFile(FileUtils_1.FileUtils.getFileLanguage(file, this.fileLanguages));
                arkFile.setScene(this);
                (0, ArkFileBuilder_1.buildArkFileFromFile)(file, this.realProjectDir, arkFile, this.projectName);
                this.setFile(arkFile);
            }
            catch (error) {
                logger.error('Error parsing file:', file, error);
                this.unhandledFilePaths.add(file);
                return;
            }
        });
        this.buildAllMethodBody();
        this.updateOrAddDefaultConstructors();
    }
    getFilesOrderByDependency() {
        for (const projectFile of this.projectFiles) {
            this.getDependencyFilesDeeply(projectFile);
        }
        this.buildAllMethodBody();
        this.updateOrAddDefaultConstructors();
    }
    getDependencyFilesDeeply(projectFile) {
        if (!this.options.supportFileExts.includes(path_1.default.extname(projectFile))) {
            return;
        }
        const fileSignature = new ArkSignature_1.FileSignature(this.getProjectName(), path_1.default.relative(this.getRealProjectDir(), projectFile));
        if (this.filesMap.has(fileSignature.toMapKey()) || this.isRepeatBuildFile(projectFile) || this.unhandledFilePaths.has(projectFile)) {
            return;
        }
        // Here use unhandledFilePaths to temporarily store current file until add it to fileMaps to avoid recursively import issue.
        this.unhandledFilePaths.add(projectFile);
        try {
            const arkFile = new ArkFile_1.ArkFile(FileUtils_1.FileUtils.getFileLanguage(projectFile, this.fileLanguages));
            arkFile.setScene(this);
            (0, ArkFileBuilder_1.buildArkFileFromFile)(projectFile, this.getRealProjectDir(), arkFile, this.getProjectName());
            for (const [modulePath, moduleName] of this.modulePath2NameMap) {
                if (arkFile.getFilePath().startsWith(modulePath)) {
                    this.addArkFile2ModuleScene(modulePath, moduleName, arkFile);
                    break;
                }
            }
            const importInfos = arkFile.getImportInfos();
            const repeatFroms = [];
            this.findDependencyFiles(importInfos, arkFile, repeatFroms);
            const exportInfos = arkFile.getExportInfos();
            this.findDependencyFiles(exportInfos, arkFile, repeatFroms);
            // add currently file to files map after adding all its dependencies, and remove it from unhandledFilePaths
            this.setFile(arkFile);
            this.unhandledFilePaths.delete(projectFile);
        }
        catch (error) {
            logger.error('Error parsing file:', projectFile, error);
            return;
        }
    }
    isRepeatBuildFile(projectFile) {
        for (const [key, file] of this.filesMap) {
            if (key && file.getFilePath().toLowerCase() === projectFile.toLowerCase()) {
                return true;
            }
        }
        return false;
    }
    addArkFile2ModuleScene(modulePath, moduleName, arkFile) {
        if (this.moduleScenesMap.has(moduleName)) {
            let curModuleScene = this.moduleScenesMap.get(moduleName);
            if (curModuleScene) {
                curModuleScene.addArkFile(arkFile);
                arkFile.setModuleScene(curModuleScene);
            }
        }
        else {
            let moduleScene = new ModuleScene(this);
            moduleScene.ModuleScenePartiallyBuilder(moduleName, modulePath);
            moduleScene.addArkFile(arkFile);
            this.moduleScenesMap.set(moduleName, moduleScene);
            arkFile.setModuleScene(moduleScene);
        }
    }
    findDependencyFiles(importOrExportInfos, arkFile, repeatFroms) {
        for (const importOrExportInfo of importOrExportInfos) {
            const from = importOrExportInfo.getFrom();
            if (from && !repeatFroms.includes(from)) {
                this.parseFrom(from, arkFile);
                repeatFroms.push(from);
            }
        }
    }
    parseFrom(from, arkFile) {
        if (/^@[a-z|\-]+?\/?/.test(from) || /^[a-z][a-z0-9._-]*[a-z0-9]$/.test(from)) {
            // TODO: if there are more than one modules with the same name e.g. @lib1, here may got the wrong dependency
            // It is better to loop all oh pkg with priority rather than the map key order. But it should be very complicated.
            // Currently it is ok because it's with low probability and order error only affects type accuracy but has no other impact.
            for (const [ohPkgContentPath, ohPkgContent] of this.ohPkgContentMap) {
                this.findDependenciesByOhPkg(ohPkgContentPath, ohPkgContent, from);
            }
        }
        else if (/^([^@]*\/)([^\/]*)$/.test(from) || /^[\.\./|\.\.]+$/.test(from)) {
            this.findRelativeDependenciesByOhPkg(from, arkFile);
        }
        else if (/^[@a-zA-Z0-9]+(\/[a-zA-Z0-9]+)*$/.test(from)) {
            this.findDependenciesByTsConfig(from);
        }
    }
    findDependenciesByTsConfig(from) {
        if (this.globalModule2PathMapping) {
            const paths = this.globalModule2PathMapping;
            Object.keys(paths).forEach(key => this.parseTsConfigParms(paths, key, from));
        }
    }
    parseTsConfigParms(paths, key, from) {
        const module2pathMapping = paths[key];
        if (key.includes(TSConst_1.ALL)) {
            this.processFuzzyMapping(key, from, module2pathMapping);
        }
        else if (from.startsWith(key)) {
            let tail = from.substring(key.length, from.length);
            module2pathMapping.forEach(pathMapping => {
                let originPath = path_1.default.join(this.getRealProjectDir(), pathMapping, tail);
                if (this.baseUrl) {
                    originPath = path_1.default.resolve(this.baseUrl, originPath);
                }
                this.findDependenciesByRule(originPath);
            });
        }
    }
    processFuzzyMapping(key, from, module2pathMapping) {
        key = key.substring(0, key.indexOf(TSConst_1.ALL) - 1);
        if (from.substring(0, key.indexOf(TSConst_1.ALL) - 1) === key) {
            let tail = from.substring(key.indexOf(TSConst_1.ALL) - 1, from.length);
            module2pathMapping.forEach(pathMapping => {
                pathMapping = pathMapping.substring(0, pathMapping.indexOf(TSConst_1.ALL) - 1);
                let originPath = path_1.default.join(this.getRealProjectDir(), pathMapping, tail);
                if (this.baseUrl) {
                    originPath = path_1.default.join(this.baseUrl, originPath);
                }
                this.findDependenciesByRule(originPath);
            });
        }
    }
    findDependenciesByRule(originPath) {
        if (!this.findFilesByPathArray(originPath) &&
            !this.findFilesByExtNameArray(originPath, this.options.supportFileExts)) {
            logger.trace(originPath + 'module mapperInfo is not found!');
        }
    }
    findFilesByPathArray(originPath) {
        if (!fs_1.default.existsSync(originPath)) {
            return false;
        }
        const dirname = path_1.default.dirname(originPath);
        const indexFileName = FileUtils_1.FileUtils.getIndexFileName(dirname);
        if (indexFileName === '') {
            return false;
        }
        const curPath = path_1.default.join(dirname, indexFileName);
        if (!this.isRepeatBuildFile(curPath)) {
            this.addFileNode2DependencyGrap(curPath);
            return true;
        }
        return false;
    }
    findFilesByExtNameArray(originPath, pathArray) {
        for (const pathInfo of pathArray) {
            const curPath = originPath + pathInfo;
            if (fs_1.default.existsSync(curPath) && !this.isRepeatBuildFile(curPath)) {
                this.addFileNode2DependencyGrap(curPath);
                return true;
            }
        }
        return false;
    }
    findRelativeDependenciesByOhPkg(from, arkFile) {
        //relative path ../from  ./from
        //order
        //1. ../from/oh-package.json5 -> [[name]] -> overRides/overRideDependencyMap? ->
        //[[main]] -> file path ->dependencies(priority)+devDependencies? dynamicDependencies(not support) ->
        //key overRides/overRideDependencyMap?
        //2. ../from/index.ets(ts)
        //3. ../from/index.d.ets(ts)
        //4. ../from.ets(ts)
        //5. ../from.d.ets(ts)
        //2.3.4.5 random order
        let originPath = this.getOriginPath(from, arkFile);
        if (fs_1.default.existsSync(path_1.default.join(originPath, EtsConst_1.OH_PACKAGE_JSON5))) {
            for (const [ohPkgContentPath, ohPkgContent] of this.ohPkgContentMap) {
                this.findDependenciesByOhPkg(ohPkgContentPath, ohPkgContent, from);
            }
        }
        this.findDependenciesByRule(originPath);
    }
    findDependenciesByOhPkg(ohPkgContentPath, ohPkgContentInfo, from) {
        //module name @ohos/from
        const ohPkgContent = ohPkgContentInfo;
        //module main name is must be
        if (ohPkgContent && ohPkgContent.name && from.startsWith(ohPkgContent.name.toString())) {
            let originPath = ohPkgContentPath.toString().replace(EtsConst_1.OH_PACKAGE_JSON5, '');
            if (ohPkgContent.main) {
                originPath = path_1.default.join(ohPkgContentPath.toString().replace(EtsConst_1.OH_PACKAGE_JSON5, ''), ohPkgContent.main.toString());
                if (ohPkgContent.dependencies) {
                    this.getDependenciesMapping(ohPkgContent.dependencies, ohPkgContentPath, from);
                }
                else if (ohPkgContent.devDependencies) {
                    this.getDependenciesMapping(ohPkgContent.devDependencies, ohPkgContentPath, from);
                }
                else if (ohPkgContent.dynamicDependencies) {
                    // dynamicDependencies not support
                }
                this.addFileNode2DependencyGrap(originPath);
            }
            if (!this.findFilesByPathArray(originPath)) {
                logger.trace(originPath + 'module mapperInfo is not found!');
            }
        }
    }
    getDependenciesMapping(dependencies, ohPkgContentPath, from) {
        for (let [moduleName, modulePath] of Object.entries(dependencies)) {
            logger.debug('dependencies:' + moduleName);
            if (modulePath.startsWith('file:')) {
                modulePath = modulePath.replace(/^file:/, '');
            }
            const innerOhpackagePath = path_1.default.join(ohPkgContentPath.replace(EtsConst_1.OH_PACKAGE_JSON5, ''), modulePath.toString(), EtsConst_1.OH_PACKAGE_JSON5);
            if (!this.ohPkgContentMap.has(innerOhpackagePath)) {
                const innerModuleOhPkgContent = (0, json5parser_1.fetchDependenciesFromFile)(innerOhpackagePath);
                this.findDependenciesByOhPkg(innerOhpackagePath, innerModuleOhPkgContent, from);
            }
        }
    }
    getOriginPath(from, arkFile) {
        const parentPath = /^\.{1,2}\//.test(from) ? path_1.default.dirname(arkFile.getFilePath()) : arkFile.getProjectDir();
        return path_1.default.resolve(parentPath, from);
    }
    addFileNode2DependencyGrap(filePath) {
        this.getDependencyFilesDeeply(filePath);
    }
    buildSdk(sdkName, sdkPath) {
        let allFiles;
        if (sdkName === SdkUtils_1.SdkUtils.BUILT_IN_NAME) {
            allFiles = SdkUtils_1.SdkUtils.fetchBuiltInFiles(sdkPath);
            if (allFiles.length > 0) {
                this.getOptions().sdkGlobalFolders?.push(sdkPath);
            }
        }
        else {
            allFiles = (0, getAllFiles_1.getAllFiles)(sdkPath, this.options.supportFileExts, this.options.ignoreFileNames);
        }
        allFiles.forEach(file => {
            logger.trace('=== parse sdk file:', file);
            try {
                const arkFile = new ArkFile_1.ArkFile(FileUtils_1.FileUtils.getFileLanguage(file, this.fileLanguages));
                arkFile.setScene(this);
                (0, ArkFileBuilder_1.buildArkFileFromFile)(file, path_1.default.normalize(sdkPath), arkFile, sdkName);
                ModelUtils_1.ModelUtils.getAllClassesInFile(arkFile).forEach(cls => {
                    cls.getDefaultArkMethod()?.buildBody();
                    cls.getDefaultArkMethod()?.freeBodyBuilder();
                });
                const fileSig = arkFile.getFileSignature().toMapKey();
                this.sdkArkFilesMap.set(fileSig, arkFile);
                SdkUtils_1.SdkUtils.buildSdkImportMap(arkFile);
                SdkUtils_1.SdkUtils.loadGlobalAPI(arkFile, this.sdkGlobalMap);
            }
            catch (error) {
                logger.error('Error parsing file:', file, error);
                this.unhandledSdkFilePaths.push(file);
                return;
            }
        });
    }
    /**
     * Build the scene for harmony project. It resolves the file path of the project first, and then fetches
     * dependencies from this file. Next, build a `ModuleScene` for this project to generate {@link ArkFile}. Finally,
     * it build bodies of all methods, generate extended classes, and add DefaultConstructors.
     */
    buildScene4HarmonyProject() {
        this.modulePath2NameMap.forEach((value, key) => {
            let moduleScene = new ModuleScene(this);
            moduleScene.ModuleSceneBuilder(value, key, this.options.supportFileExts);
            this.moduleScenesMap.set(value, moduleScene);
        });
        this.buildAllMethodBody();
        this.updateOrAddDefaultConstructors();
    }
    buildOhPkgContentMap() {
        this.modulePath2NameMap.forEach((value, key) => {
            const moduleOhPkgFilePath = path_1.default.resolve(key, EtsConst_1.OH_PACKAGE_JSON5);
            if (fs_1.default.existsSync(moduleOhPkgFilePath)) {
                const moduleOhPkgContent = (0, json5parser_1.fetchDependenciesFromFile)(moduleOhPkgFilePath);
                this.ohPkgContentMap.set(moduleOhPkgFilePath, moduleOhPkgContent);
            }
        });
    }
    buildModuleScene(moduleName, modulePath, supportFileExts) {
        if (this.moduleScenesMap.get(moduleName)) {
            return;
        }
        // get oh-package.json5
        const moduleOhPkgFilePath = path_1.default.resolve(this.realProjectDir, path_1.default.join(modulePath, EtsConst_1.OH_PACKAGE_JSON5));
        if (fs_1.default.existsSync(moduleOhPkgFilePath)) {
            const moduleOhPkgContent = (0, json5parser_1.fetchDependenciesFromFile)(moduleOhPkgFilePath);
            this.ohPkgContentMap.set(moduleOhPkgFilePath, moduleOhPkgContent);
        }
        else {
            logger.warn('Module: ', moduleName, 'has no oh-package.json5.');
        }
        // parse moduleOhPkgContent, get dependencies and build dependent module
        const moduleOhPkgContent = this.ohPkgContentMap.get(moduleOhPkgFilePath);
        if (moduleOhPkgContent) {
            if (moduleOhPkgContent.dependencies instanceof Object) {
                this.processModuleOhPkgContent(moduleOhPkgContent.dependencies, moduleOhPkgFilePath, supportFileExts);
            }
        }
        let moduleScene = new ModuleScene(this);
        moduleScene.ModuleSceneBuilder(moduleName, modulePath, supportFileExts);
        this.moduleScenesMap.set(moduleName, moduleScene);
        this.buildAllMethodBody();
    }
    processModuleOhPkgContent(dependencies, moduleOhPkgFilePath, supportFileExts) {
        Object.entries(dependencies).forEach(([k, v]) => {
            const pattern = new RegExp('^(\\.\\.\\/\|\\.\\/)');
            if (typeof v === 'string') {
                let dependencyModulePath = '';
                if (pattern.test(v)) {
                    dependencyModulePath = path_1.default.join(moduleOhPkgFilePath, v);
                }
                else if (v.startsWith('file:')) {
                    const dependencyFilePath = path_1.default.join(moduleOhPkgFilePath, v.replace(/^file:/, ''));
                    const dependencyOhPkgPath = (0, FileUtils_1.getFileRecursively)(path_1.default.dirname(dependencyFilePath), EtsConst_1.OH_PACKAGE_JSON5);
                    dependencyModulePath = path_1.default.dirname(dependencyOhPkgPath);
                }
                const dependencyModuleName = this.modulePath2NameMap.get(dependencyModulePath);
                if (dependencyModuleName) {
                    this.buildModuleScene(dependencyModuleName, dependencyModulePath, supportFileExts);
                }
            }
        });
    }
    /**
     * Get the absolute path of current project.
     * @returns The real project's directiory.
     * @example
     * 1. get real project directory, such as:
     ```typescript
     let projectDir = projectScene.getRealProjectDir();
     ```
     */
    getRealProjectDir() {
        return this.realProjectDir;
    }
    /**
     * Returns the **string** name of the project.
     * @returns The name of the project.
     */
    getProjectName() {
        return this.projectName;
    }
    getProjectFiles() {
        return this.projectFiles;
    }
    getSdkGlobal(globalName) {
        return this.sdkGlobalMap.get(globalName) || null;
    }
    /**
     * Returns the file based on its signature.
     * If no file can be found according to the input signature, **null** will be returned.
     * A typical {@link ArkFile} contains: file's name (i.e., its relative path), project's name,
     * project's dir, file's signature etc.
     * @param fileSignature - the signature of file.
     * @returns a file defined by ArkAnalyzer. **null** will be returned if no file could be found.
     * @example
     * 1. get ArkFile based on file signature.

     ```typescript
     if (...) {
     const fromSignature = new FileSignature();
     fromSignature.setProjectName(im.getDeclaringArkFile().getProjectName());
     fromSignature.setFileName(fileName);
     return scene.getFile(fromSignature);
     }
     ```
     */
    getFile(fileSignature) {
        if (this.projectName === fileSignature.getProjectName()) {
            return this.filesMap.get(fileSignature.toMapKey()) || null;
        }
        else {
            return this.sdkArkFilesMap.get(fileSignature.toMapKey()) || null;
        }
    }
    /*
     * Returns the absolute file paths that cannot be handled currently.
     */
    getUnhandledFilePaths() {
        return Array.from(this.unhandledFilePaths);
    }
    /*
     * Returns the absolute sdk file paths that cannot be handled currently.
     */
    getUnhandledSdkFilePaths() {
        return this.unhandledSdkFilePaths;
    }
    setFile(file) {
        this.filesMap.set(file.getFileSignature().toMapKey(), file);
    }
    hasSdkFile(fileSignature) {
        return this.sdkArkFilesMap.has(fileSignature.toMapKey());
    }
    /**
     * Get files of a {@link Scene}. Generally, a project includes several ets/ts files that define the different
     * class. We need to generate {@link ArkFile} objects from these ets/ts files.
     * @returns The array of {@link ArkFile} from `scene.filesMap.values()`.
     * @example
     * 1. In inferSimpleTypes() to check arkClass and arkMethod.
     * ```typescript
     * public inferSimpleTypes(): void {
     *   for (let arkFile of this.getFiles()) {
     *       for (let arkClass of arkFile.getClasses()) {
     *           for (let arkMethod of arkClass.getMethods()) {
     *           // ... ...;
     *           }
     *       }
     *   }
     * }
     * ```
     * 2. To iterate each method
     * ```typescript
     * for (const file of this.getFiles()) {
     *     for (const cls of file.getClasses()) {
     *         for (const method of cls.getMethods()) {
     *             // ... ...
     *         }
     *     }
     * }
     *```
     */
    getFiles() {
        return Array.from(this.filesMap.values());
    }
    getFileLanguages() {
        return this.fileLanguages;
    }
    getSdkArkFiles() {
        return Array.from(this.sdkArkFilesMap.values());
    }
    getModuleSdkMap() {
        return this.moduleSdkMap;
    }
    getProjectSdkMap() {
        return this.projectSdkMap;
    }
    getNamespace(namespaceSignature) {
        const isProject = this.projectName === namespaceSignature.getDeclaringFileSignature().getProjectName();
        let namespace;
        if (isProject) {
            namespace = this.namespacesMap.get(namespaceSignature.toMapKey());
        }
        if (namespace) {
            return namespace;
        }
        namespace = this.getNamespaceBySignature(namespaceSignature);
        if (isProject && namespace) {
            this.namespacesMap.set(namespaceSignature.toMapKey(), namespace);
        }
        return namespace || null;
    }
    getNamespaceBySignature(signature) {
        const parentSignature = signature.getDeclaringNamespaceSignature();
        if (parentSignature) {
            const parentNamespace = this.getNamespaceBySignature(parentSignature);
            return parentNamespace?.getNamespace(signature) || null;
        }
        else {
            const arkFile = this.getFile(signature.getDeclaringFileSignature());
            return arkFile?.getNamespace(signature) || null;
        }
    }
    getNamespacesMap() {
        if (this.buildStage === SceneBuildStage.CLASS_DONE) {
            for (const file of this.getFiles()) {
                ModelUtils_1.ModelUtils.getAllNamespacesInFile(file).forEach(namespace => {
                    this.namespacesMap.set(namespace.getNamespaceSignature().toMapKey(), namespace);
                });
            }
        }
        return this.namespacesMap;
    }
    getNamespaces() {
        return Array.from(this.getNamespacesMap().values());
    }
    /**
     * Returns the class according to the input class signature.
     * @param classSignature - signature of the class to be obtained.
     * @returns A class.
     */
    getClass(classSignature) {
        const isProject = this.projectName === classSignature.getDeclaringFileSignature().getProjectName();
        let arkClass;
        if (isProject) {
            arkClass = this.classesMap.get(classSignature.toMapKey());
        }
        if (arkClass) {
            return arkClass;
        }
        const namespaceSignature = classSignature.getDeclaringNamespaceSignature();
        if (namespaceSignature) {
            arkClass = this.getNamespaceBySignature(namespaceSignature)?.getClass(classSignature) || null;
        }
        else {
            const arkFile = this.getFile(classSignature.getDeclaringFileSignature());
            arkClass = arkFile?.getClass(classSignature);
        }
        if (isProject && arkClass) {
            this.classesMap.set(classSignature.toMapKey(), arkClass);
        }
        return arkClass || null;
    }
    getClassesMap(refresh) {
        if (refresh || this.buildStage === SceneBuildStage.METHOD_DONE) {
            this.classesMap.clear();
            for (const file of this.getFiles()) {
                for (const cls of file.getClasses()) {
                    this.classesMap.set(cls.getSignature().toMapKey(), cls);
                }
            }
            for (const namespace of this.getNamespacesMap().values()) {
                for (const cls of namespace.getClasses()) {
                    this.classesMap.set(cls.getSignature().toMapKey(), cls);
                }
            }
            if (this.buildStage < SceneBuildStage.CLASS_COLLECTED) {
                this.buildStage = SceneBuildStage.CLASS_COLLECTED;
            }
        }
        return this.classesMap;
    }
    getClasses() {
        return Array.from(this.getClassesMap().values());
    }
    getMethod(methodSignature, refresh) {
        const isProject = this.projectName === methodSignature.getDeclaringClassSignature().getDeclaringFileSignature().getProjectName();
        let arkMethod;
        if (isProject) {
            arkMethod = this.methodsMap.get(methodSignature.toMapKey());
        }
        if (arkMethod) {
            return arkMethod;
        }
        arkMethod = this.getClass(methodSignature.getDeclaringClassSignature())?.getMethod(methodSignature);
        if (isProject && arkMethod) {
            this.methodsMap.set(methodSignature.toMapKey(), arkMethod);
        }
        return arkMethod || null;
    }
    getMethodsMap(refresh) {
        if (refresh || (this.buildStage >= SceneBuildStage.METHOD_DONE && this.buildStage < SceneBuildStage.METHOD_COLLECTED)) {
            this.methodsMap.clear();
            for (const cls of this.getClassesMap(refresh).values()) {
                for (const method of cls.getMethods(true)) {
                    this.methodsMap.set(method.getSignature().toMapKey(), method);
                }
            }
            if (this.buildStage < SceneBuildStage.METHOD_COLLECTED) {
                this.buildStage = SceneBuildStage.METHOD_COLLECTED;
            }
        }
        return this.methodsMap;
    }
    /**
     * Returns the method associated with the method signature.
     * If no method is associated with this signature, **null** will be returned.
     * An {@link ArkMethod} includes:
     * - Name: the **string** name of method.
     * - Code: the **string** code of the method.
     * - Line: a **number** indicating the line location, initialized as -1.
     * - Column: a **number** indicating the column location, initialized as -1.
     * - Parameters & Types of parameters: the parameters of method and their types.
     * - View tree: the view tree of the method.
     * - ...
     *
     * @param methodSignature - the signature of method.
     * @returns The method associated with the method signature.
     * @example
     * 1. get method from getMethod.

     ```typescript
     const methodSignatures = this.CHA.resolveCall(xxx, yyy);
     for (const methodSignature of methodSignatures) {
     const method = this.scene.getMethod(methodSignature);
     ... ...
     }
     ```
     */
    getMethods() {
        return Array.from(this.getMethodsMap().values());
    }
    addToMethodsMap(method) {
        this.methodsMap.set(method.getSignature().toMapKey(), method);
    }
    removeMethod(method) {
        return this.methodsMap.delete(method.getSignature().toMapKey());
    }
    removeClass(arkClass) {
        return this.classesMap.delete(arkClass.getSignature().toMapKey());
    }
    removeNamespace(namespace) {
        return this.namespacesMap.delete(namespace.getSignature().toMapKey());
    }
    removeFile(file) {
        return this.filesMap.delete(file.getFileSignature().toMapKey());
    }
    hasMainMethod() {
        return false;
    }
    //Get the set of entry points that are used to build the call graph.
    getEntryPoints() {
        return [];
    }
    /** get values that is visible in curr scope */
    getVisibleValue() {
        return this.visibleValue;
    }
    getOhPkgContent() {
        return this.ohPkgContent;
    }
    getOhPkgContentMap() {
        return this.ohPkgContentMap;
    }
    getOhPkgFilePath() {
        return this.ohPkgFilePath;
    }
    makeCallGraphCHA(entryPoints) {
        let callGraph = new CallGraph_1.CallGraph(this);
        let callGraphBuilder = new CallGraphBuilder_1.CallGraphBuilder(callGraph, this);
        callGraphBuilder.buildClassHierarchyCallGraph(entryPoints);
        return callGraph;
    }
    makeCallGraphRTA(entryPoints) {
        let callGraph = new CallGraph_1.CallGraph(this);
        let callGraphBuilder = new CallGraphBuilder_1.CallGraphBuilder(callGraph, this);
        callGraphBuilder.buildRapidTypeCallGraph(entryPoints);
        return callGraph;
    }
    /**
     * Infer type for each non-default method. It infers the type of each field/local/reference.
     * For example, the statement `let b = 5;`, the type of local `b` is `NumberType`; and for the statement `let s =
     * 'hello';`, the type of local `s` is `StringType`. The detailed types are defined in the Type.ts file.
     * @example
     * 1. Infer the type of each class field and method field.
     ```typescript
     const scene = new Scene();
     scene.buildSceneFromProjectDir(sceneConfig);
     scene.inferTypes();
     ```
     */
    inferTypes() {
        this.filesMap.forEach(file => {
            Inference_1.InferenceManager.getInstance().getInference(file.getLanguage()).doInfer(file);
        });
        if (this.buildStage < SceneBuildStage.TYPE_INFERRED) {
            this.getMethodsMap(true);
            this.buildStage = SceneBuildStage.TYPE_INFERRED;
        }
        SdkUtils_1.SdkUtils.dispose();
    }
    /**
     * @deprecated This method is deprecated and will be removed in the next major release.
     * Please use the new type inference system instead.
     *
     * Scheduled for removal: one month from deprecation date.
     */
    inferTypesOld() {
        this.filesMap.forEach(file => {
            try {
                IRInference_1.IRInference.inferFile(file);
            }
            catch (error) {
                logger.error('Error inferring types of project file:', file.getFileSignature(), error);
            }
        });
        if (this.buildStage < SceneBuildStage.TYPE_INFERRED) {
            this.getMethodsMap(true);
            this.buildStage = SceneBuildStage.TYPE_INFERRED;
        }
        SdkUtils_1.SdkUtils.dispose();
    }
    /**
     * Iterate all assignment statements in methods,
     * and set the type of left operand based on the type of right operand
     * if the left operand is a local variable as well as an unknown.
     * @Deprecated
     * @example
     * 1. Infer simple type when scene building.

     ```typescript
     let scene = new Scene();
     scene.buildSceneFromProjectDir(config);
     scene.inferSimpleTypes();
     ```
     */
    inferSimpleTypes() {
        for (let arkFile of this.getFiles()) {
            for (let arkClass of arkFile.getClasses()) {
                for (let arkMethod of arkClass.getMethods()) {
                    TypeInference_1.TypeInference.inferSimpleTypeInMethod(arkMethod);
                }
            }
        }
    }
    addNSClasses(namespaceStack, finalNamespaces, classMap, parentMap) {
        while (namespaceStack.length > 0) {
            const ns = namespaceStack.shift();
            const nsClass = [];
            for (const arkClass of ns.getClasses()) {
                nsClass.push(arkClass);
            }
            classMap.set(ns.getNamespaceSignature(), nsClass);
            if (ns.getNamespaces().length === 0) {
                finalNamespaces.push(ns);
            }
            else {
                for (const nsns of ns.getNamespaces()) {
                    namespaceStack.push(nsns);
                    parentMap.set(nsns, ns);
                }
            }
        }
    }
    addNSExportedClasses(finalNamespaces, classMap, parentMap) {
        while (finalNamespaces.length > 0) {
            const finalNS = finalNamespaces.shift();
            const exportClass = [];
            for (const arkClass of finalNS.getClasses()) {
                if (arkClass.isExported()) {
                    exportClass.push(arkClass);
                }
            }
            const parent = parentMap.get(finalNS);
            if (parent instanceof ArkNamespace_1.ArkNamespace) {
                classMap.get(parent.getNamespaceSignature())?.push(...exportClass);
            }
            else if (parent instanceof ArkFile_1.ArkFile) {
                classMap.get(parent.getFileSignature())?.push(...exportClass);
            }
            let p = finalNS;
            while (!(parentMap.get(p) instanceof ArkFile_1.ArkFile) && p.isExported()) {
                const grandParent = parentMap.get(parentMap.get(p));
                if (grandParent instanceof ArkNamespace_1.ArkNamespace) {
                    classMap.get(grandParent.getNamespaceSignature())?.push(...exportClass);
                    p = parentMap.get(p);
                }
                else if (grandParent instanceof ArkFile_1.ArkFile) {
                    classMap.get(grandParent.getFileSignature())?.push(...exportClass);
                    break;
                }
            }
            if (parent instanceof ArkNamespace_1.ArkNamespace && !finalNamespaces.includes(parent)) {
                finalNamespaces.push(parent);
            }
        }
    }
    addFileImportedClasses(file, classMap) {
        const importClasses = [];
        const importNameSpaces = [];
        for (const importInfo of file.getImportInfos()) {
            const importClass = ModelUtils_1.ModelUtils.getClassInImportInfoWithName(importInfo.getImportClauseName(), file);
            if (importClass && !importClasses.includes(importClass)) {
                importClasses.push(importClass);
                continue;
            }
            const importNameSpace = ModelUtils_1.ModelUtils.getNamespaceInImportInfoWithName(importInfo.getImportClauseName(), file);
            if (importNameSpace && !importNameSpaces.includes(importNameSpace)) {
                try {
                    // 遗留问题：只统计了项目文件的namespace，没统计sdk文件内部的引入
                    const importNameSpaceClasses = classMap.get(importNameSpace.getNamespaceSignature());
                    importClasses.push(...importNameSpaceClasses.filter(c => !importClasses.includes(c) && c.getName() !== Const_1.DEFAULT_ARK_CLASS_NAME));
                }
                catch {
                }
            }
        }
        const fileClasses = classMap.get(file.getFileSignature());
        fileClasses.push(...importClasses.filter(c => !fileClasses.includes(c)));
        // 子节点加上父节点的class
        const namespaceStack = [...file.getNamespaces()];
        for (const ns of namespaceStack) {
            const nsClasses = classMap.get(ns.getNamespaceSignature());
            nsClasses.push(...fileClasses.filter(c => !nsClasses.includes(c) && c.getName() !== Const_1.DEFAULT_ARK_CLASS_NAME));
        }
        while (namespaceStack.length > 0) {
            const ns = namespaceStack.shift();
            const nsClasses = classMap.get(ns.getNamespaceSignature());
            for (const nsns of ns.getNamespaces()) {
                const nsnsClasses = classMap.get(nsns.getNamespaceSignature());
                nsnsClasses.push(...nsClasses.filter(c => !nsnsClasses.includes(c) && c.getName() !== Const_1.DEFAULT_ARK_CLASS_NAME));
                namespaceStack.push(nsns);
            }
        }
    }
    getClassMap() {
        const classMap = new Map();
        for (const file of this.getFiles()) {
            const fileClass = [];
            const namespaceStack = [];
            const parentMap = new Map();
            const finalNamespaces = [];
            for (const arkClass of file.getClasses()) {
                fileClass.push(arkClass);
            }
            for (const ns of file.getNamespaces()) {
                namespaceStack.push(ns);
                parentMap.set(ns, file);
            }
            classMap.set(file.getFileSignature(), fileClass);
            // 第一轮遍历，加上每个namespace自己的class
            this.addNSClasses(namespaceStack, finalNamespaces, classMap, parentMap);
            // 第二轮遍历，父节点加上子节点的export的class
            this.addNSExportedClasses(finalNamespaces, classMap, parentMap);
        }
        for (const file of this.getFiles()) {
            // 文件加上import的class，包括ns的
            this.addFileImportedClasses(file, classMap);
        }
        return classMap;
    }
    addNSLocals(namespaceStack, finalNamespaces, parentMap, globalVariableMap) {
        while (namespaceStack.length > 0) {
            const ns = namespaceStack.shift();
            const nsGlobalLocals = [];
            ns
                .getDefaultClass()
                .getDefaultArkMethod()
                .getBody()
                ?.getLocals()
                .forEach(local => {
                if (local.getDeclaringStmt() && local.getName() !== 'this' && local.getName()[0] !== '$') {
                    nsGlobalLocals.push(local);
                }
            });
            globalVariableMap.set(ns.getNamespaceSignature(), nsGlobalLocals);
            if (ns.getNamespaces().length === 0) {
                finalNamespaces.push(ns);
            }
            else {
                for (const nsns of ns.getNamespaces()) {
                    namespaceStack.push(nsns);
                    parentMap.set(nsns, ns);
                }
            }
        }
    }
    addNSExportedLocals(finalNamespaces, globalVariableMap, parentMap) {
        while (finalNamespaces.length > 0) {
            const finalNS = finalNamespaces.shift();
            const exportLocal = [];
            for (const exportInfo of finalNS.getExportInfos()) {
                if (exportInfo.getExportClauseType() === ArkExport_1.ExportType.LOCAL && exportInfo.getArkExport()) {
                    exportLocal.push(exportInfo.getArkExport());
                }
            }
            const parent = parentMap.get(finalNS);
            if (parent instanceof ArkNamespace_1.ArkNamespace) {
                globalVariableMap.get(parent.getNamespaceSignature())?.push(...exportLocal);
            }
            else if (parent instanceof ArkFile_1.ArkFile) {
                globalVariableMap.get(parent.getFileSignature())?.push(...exportLocal);
            }
            let p = finalNS;
            while (!(parentMap.get(p) instanceof ArkFile_1.ArkFile) && p.isExported()) {
                const grandParent = parentMap.get(parentMap.get(p));
                if (grandParent instanceof ArkNamespace_1.ArkNamespace) {
                    globalVariableMap.get(grandParent.getNamespaceSignature())?.push(...exportLocal);
                    p = parentMap.get(p);
                }
                else if (grandParent instanceof ArkFile_1.ArkFile) {
                    globalVariableMap.get(grandParent.getFileSignature())?.push(...exportLocal);
                    break;
                }
            }
            if (parent instanceof ArkNamespace_1.ArkNamespace && !finalNamespaces.includes(parent)) {
                finalNamespaces.push(parent);
            }
        }
    }
    addFileImportLocals(file, globalVariableMap) {
        const importLocals = [];
        const importNameSpaces = [];
        for (const importInfo of file.getImportInfos()) {
            const importLocal = ModelUtils_1.ModelUtils.getLocalInImportInfoWithName(importInfo.getImportClauseName(), file);
            if (importLocal && !importLocals.includes(importLocal)) {
                importLocals.push(importLocal);
            }
            const importNameSpace = ModelUtils_1.ModelUtils.getNamespaceInImportInfoWithName(importInfo.getImportClauseName(), file);
            if (importNameSpace && !importNameSpaces.includes(importNameSpace)) {
                try {
                    // 遗留问题：只统计了项目文件，没统计sdk文件内部的引入
                    const importNameSpaceClasses = globalVariableMap.get(importNameSpace.getNamespaceSignature());
                    importLocals.push(...importNameSpaceClasses.filter(c => !importLocals.includes(c) && c.getName() !== Const_1.DEFAULT_ARK_CLASS_NAME));
                }
                catch {
                }
            }
        }
        const fileLocals = globalVariableMap.get(file.getFileSignature());
        fileLocals.push(...importLocals.filter(c => !fileLocals.includes(c)));
        // 子节点加上父节点的local
        const namespaceStack = [...file.getNamespaces()];
        for (const ns of namespaceStack) {
            const nsLocals = globalVariableMap.get(ns.getNamespaceSignature());
            const nsLocalNameSet = new Set(nsLocals.map(item => item.getName()));
            for (const local of fileLocals) {
                if (!nsLocalNameSet.has(local.getName())) {
                    nsLocals.push(local);
                }
            }
        }
        while (namespaceStack.length > 0) {
            const ns = namespaceStack.shift();
            const nsLocals = globalVariableMap.get(ns.getNamespaceSignature());
            for (const nsns of ns.getNamespaces()) {
                this.handleNestedNSLocals(nsns, nsLocals, globalVariableMap);
                namespaceStack.push(nsns);
            }
        }
    }
    handleNestedNSLocals(nsns, nsLocals, globalVariableMap) {
        const nsnsLocals = globalVariableMap.get(nsns.getNamespaceSignature());
        const nsnsLocalNameSet = new Set(nsnsLocals.map(item => item.getName()));
        for (const local of nsLocals) {
            if (!nsnsLocalNameSet.has(local.getName())) {
                nsnsLocals.push(local);
            }
        }
    }
    getGlobalVariableMap() {
        const globalVariableMap = new Map();
        for (const file of this.getFiles()) {
            const namespaceStack = [];
            const parentMap = new Map();
            const finalNamespaces = [];
            const globalLocals = [];
            file
                .getDefaultClass()
                ?.getDefaultArkMethod()
                .getBody()
                ?.getLocals()
                .forEach(local => {
                if (local.getDeclaringStmt() && local.getName() !== 'this' && local.getName()[0] !== '$') {
                    globalLocals.push(local);
                }
            });
            globalVariableMap.set(file.getFileSignature(), globalLocals);
            for (const ns of file.getNamespaces()) {
                namespaceStack.push(ns);
                parentMap.set(ns, file);
            }
            // 第一轮遍历，加上每个namespace自己的local
            this.addNSLocals(namespaceStack, finalNamespaces, parentMap, globalVariableMap);
            // 第二轮遍历，父节点加上子节点的export的local
            this.addNSExportedLocals(finalNamespaces, globalVariableMap, parentMap);
        }
        for (const file of this.getFiles()) {
            // 文件加上import的local，包括ns的
            this.addFileImportLocals(file, globalVariableMap);
        }
        return globalVariableMap;
    }
    getStaticInitMethods() {
        const staticInitMethods = [];
        for (const method of Array.from(this.getMethodsMap(true).values())) {
            if (method.getName() === Const_1.STATIC_INIT_METHOD_NAME) {
                staticInitMethods.push(method);
            }
        }
        return staticInitMethods;
    }
    buildClassDone() {
        return this.buildStage >= SceneBuildStage.CLASS_DONE;
    }
    getModuleScene(moduleName) {
        return this.moduleScenesMap.get(moduleName);
    }
    getModuleSceneMap() {
        return this.moduleScenesMap;
    }
    getGlobalModule2PathMapping() {
        return this.globalModule2PathMapping;
    }
    getbaseUrl() {
        return this.baseUrl;
    }
}
exports.Scene = Scene;
class ModuleScene {
    constructor(projectScene) {
        this.moduleName = '';
        this.modulePath = '';
        this.moduleFileMap = new Map();
        this.moduleOhPkgFilePath = '';
        this.ohPkgContent = {};
        this.projectScene = projectScene;
    }
    ModuleSceneBuilder(moduleName, modulePath, supportFileExts, recursively = false) {
        this.moduleName = moduleName;
        this.modulePath = modulePath;
        this.getModuleOhPkgFilePath();
        if (this.moduleOhPkgFilePath) {
            this.ohPkgContent = (0, json5parser_1.fetchDependenciesFromFile)(this.moduleOhPkgFilePath);
        }
        else {
            logger.warn('This module has no oh-package.json5!');
        }
        this.genArkFiles(supportFileExts);
    }
    ModuleScenePartiallyBuilder(moduleName, modulePath) {
        this.moduleName = moduleName;
        this.modulePath = modulePath;
        if (this.moduleOhPkgFilePath) {
            this.ohPkgContent = (0, json5parser_1.fetchDependenciesFromFile)(this.moduleOhPkgFilePath);
        }
        else {
            logger.warn('This module has no oh-package.json5!');
        }
    }
    /**
     * get oh-package.json5
     */
    getModuleOhPkgFilePath() {
        const moduleOhPkgFilePath = path_1.default.resolve(this.projectScene.getRealProjectDir(), path_1.default.join(this.modulePath, EtsConst_1.OH_PACKAGE_JSON5));
        if (fs_1.default.existsSync(moduleOhPkgFilePath)) {
            this.moduleOhPkgFilePath = moduleOhPkgFilePath;
        }
    }
    /**
     * get nodule name
     * @returns return module name
     */
    getModuleName() {
        return this.moduleName;
    }
    getModulePath() {
        return this.modulePath;
    }
    getOhPkgFilePath() {
        return this.moduleOhPkgFilePath;
    }
    getOhPkgContent() {
        return this.ohPkgContent;
    }
    getModuleFilesMap() {
        return this.moduleFileMap;
    }
    addArkFile(arkFile) {
        this.moduleFileMap.set(arkFile.getFileSignature().toMapKey(), arkFile);
    }
    genArkFiles(supportFileExts) {
        (0, getAllFiles_1.getAllFiles)(this.modulePath, supportFileExts, this.projectScene.getOptions().ignoreFileNames).forEach(file => {
            logger.trace('=== parse file:', file);
            try {
                const arkFile = new ArkFile_1.ArkFile(FileUtils_1.FileUtils.getFileLanguage(file, this.projectScene.getFileLanguages()));
                arkFile.setScene(this.projectScene);
                arkFile.setModuleScene(this);
                (0, ArkFileBuilder_1.buildArkFileFromFile)(file, this.projectScene.getRealProjectDir(), arkFile, this.projectScene.getProjectName());
                this.projectScene.setFile(arkFile);
            }
            catch (error) {
                logger.error('Error parsing file:', file, error);
                this.projectScene.getUnhandledFilePaths().push(file);
                return;
            }
        });
    }
}
exports.ModuleScene = ModuleScene;
//# sourceMappingURL=Scene.js.map