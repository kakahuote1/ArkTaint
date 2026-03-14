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
exports.ModelUtils = void 0;
exports.getArkFile = getArkFile;
exports.findExportInfo = findExportInfo;
exports.findArkExport = findArkExport;
exports.findArkExportInFile = findArkExportInFile;
exports.findExportInfoInfile = findExportInfoInfile;
exports.initModulePathMap = initModulePathMap;
const Local_1 = require("../base/Local");
const ArkClass_1 = require("../model/ArkClass");
const ArkFile_1 = require("../model/ArkFile");
const ArkMethod_1 = require("../model/ArkMethod");
const ArkNamespace_1 = require("../model/ArkNamespace");
const ArkSignature_1 = require("../model/ArkSignature");
const ArkExport_1 = require("../model/ArkExport");
const ArkField_1 = require("../model/ArkField");
const logger_1 = __importStar(require("../../utils/logger"));
const FileUtils_1 = require("../../utils/FileUtils");
const path_1 = __importDefault(require("path"));
const TSConst_1 = require("./TSConst");
const ArkExportBuilder_1 = require("../model/builder/ArkExportBuilder");
const Type_1 = require("../base/Type");
const Const_1 = require("./Const");
const ValueUtil_1 = require("./ValueUtil");
const Stmt_1 = require("../base/Stmt");
const Ref_1 = require("../base/Ref");
const SdkUtils_1 = require("./SdkUtils");
const TypeInference_1 = require("./TypeInference");
const Constant_1 = require("../base/Constant");
const Builtin_1 = require("./Builtin");
const EtsConst_1 = require("./EtsConst");
class ModelUtils {
    /*
     * Set static field to be null, then all related objects could be freed by GC.
     * Static field implicitArkUIBuilderMethods is only used during method body building, the dispose method should be called after build all body.
     */
    static dispose() {
        this.implicitArkUIBuilderMethods.clear();
    }
    static getMethodSignatureFromArkClass(arkClass, methodName) {
        for (const arkMethod of arkClass.getMethods()) {
            if (arkMethod.getName() === methodName) {
                return arkMethod.getSignature();
            }
        }
        return null;
    }
    static getClassWithNameInNamespaceRecursively(className, ns) {
        if (className === '') {
            return null;
        }
        let res = null;
        res = ns.getClassWithName(className);
        if (res == null) {
            let declaringNs = ns.getDeclaringArkNamespace();
            if (declaringNs != null) {
                res = this.getClassWithNameInNamespaceRecursively(className, declaringNs);
            }
            else {
                res = this.getClassInFileWithName(className, ns.getDeclaringArkFile());
            }
        }
        return res;
    }
    static getClassWithNameFromClass(className, startFrom) {
        if (!className.includes('.')) {
            let res = null;
            const arkNamespace = startFrom.getDeclaringArkNamespace();
            if (arkNamespace) {
                res = this.getClassWithNameInNamespaceRecursively(className, arkNamespace);
            }
            else {
                res = this.getClassInFileWithName(className, startFrom.getDeclaringArkFile());
            }
            return res;
        }
        else {
            const names = className.split('.');
            let nameSpace = this.getNamespaceWithNameFromClass(names[0], startFrom);
            for (let i = 1; i < names.length - 1; i++) {
                if (nameSpace) {
                    nameSpace = nameSpace.getNamespaceWithName(names[i]);
                }
            }
            if (nameSpace) {
                return nameSpace.getClassWithName(names[names.length - 1]);
            }
        }
        return null;
    }
    /**
     *  search class within the file that contain the given method
     */
    static getClassWithName(className, thisClass) {
        if (thisClass.getName() === className) {
            return thisClass;
        }
        let classSearched = thisClass.getDeclaringArkNamespace()?.getClassWithName(className);
        if (!classSearched) {
            classSearched = thisClass.getDeclaringArkFile().getClassWithName(className);
        }
        return classSearched;
    }
    /** search class within the given file */
    static getClassInFileWithName(className, arkFile) {
        let classSearched = arkFile.getClassWithName(className);
        if (classSearched != null) {
            return classSearched;
        }
        return null;
    }
    static getClassInImportInfoWithName(className, arkFile) {
        let arkExport = this.getArkExportInImportInfoWithName(className, arkFile);
        if (arkExport instanceof ArkClass_1.ArkClass) {
            return arkExport;
        }
        return null;
    }
    /** search type within the given file import infos */
    static getArkExportInImportInfoWithName(name, arkFile) {
        return arkFile.getImportInfoBy(name)?.getLazyExportInfo()?.getArkExport() ?? null;
    }
    /** search method within the file that contain the given method */
    static getMethodWithName(methodName, startFrom) {
        if (!methodName.includes('.')) {
            if (startFrom.getName() === methodName) {
                return startFrom;
            }
            const thisClass = startFrom.getDeclaringArkClass();
            let methodSearched = thisClass.getMethodWithName(methodName);
            if (!methodSearched) {
                methodSearched = thisClass.getStaticMethodWithName(methodName);
            }
            return methodSearched;
        }
        else {
            const names = methodName.split('.');
            let nameSpace = this.getNamespaceWithName(names[0], startFrom.getDeclaringArkClass());
            for (let i = 1; i < names.length - 1; i++) {
                if (nameSpace) {
                    nameSpace = nameSpace.getNamespaceWithName(names[i]);
                }
            }
            if (nameSpace) {
                return nameSpace.getDefaultClass().getMethodWithName(names[names.length - 1]);
            }
        }
        return null;
    }
    static getNamespaceWithNameFromClass(namespaceName, startFrom) {
        const thisNamespace = startFrom.getDeclaringArkNamespace();
        let namespaceSearched = null;
        if (thisNamespace) {
            namespaceSearched = thisNamespace.getNamespaceWithName(namespaceName);
            if (namespaceSearched) {
                return namespaceSearched;
            }
        }
        const thisFile = startFrom.getDeclaringArkFile();
        namespaceSearched = this.getNamespaceInFileWithName(namespaceName, thisFile);
        return namespaceSearched;
    }
    static getNamespaceWithName(namespaceName, thisClass) {
        let thisNamespace = thisClass.getDeclaringArkNamespace();
        let namespaceSearched = null;
        while (!namespaceSearched && thisNamespace) {
            namespaceSearched = thisNamespace.getNamespaceWithName(namespaceName);
            thisNamespace = thisNamespace.getDeclaringArkNamespace();
        }
        if (!namespaceSearched) {
            namespaceSearched = thisClass.getDeclaringArkFile().getNamespaceWithName(namespaceName);
        }
        return namespaceSearched;
    }
    static getNamespaceInFileWithName(namespaceName, arkFile) {
        let namespaceSearched = arkFile.getNamespaceWithName(namespaceName);
        if (namespaceSearched) {
            return namespaceSearched;
        }
        return null;
    }
    static findSymbolInFileWithName(symbolName, arkClass, onlyType = false) {
        // look up symbol from inner to outer
        let currNamespace = arkClass.getDeclaringArkNamespace();
        let result;
        while (currNamespace) {
            result = currNamespace.getClassWithName(symbolName) ??
                currNamespace.getDefaultClass()?.getDefaultArkMethod()?.getBody()?.getAliasTypeByName(symbolName) ??
                currNamespace.getDefaultClass()?.getDefaultArkMethod()?.getBody()?.getLocals()?.get(symbolName);
            if (!result && !onlyType) {
                result = (currNamespace.getName() === symbolName ? currNamespace : null) ??
                    currNamespace.getNamespaceWithName(symbolName) ??
                    currNamespace.getDefaultClass().getMethodWithName(symbolName);
            }
            if (result) {
                return result;
            }
            currNamespace = currNamespace.getDeclaringArkNamespace();
        }
        const file = arkClass.getDeclaringArkFile();
        result =
            file.getClassWithName(symbolName) ??
                file.getDefaultClass().getDefaultArkMethod()?.getBody()?.getAliasTypeByName(symbolName) ??
                file.getDefaultClass()?.getDefaultArkMethod()?.getBody()?.getLocals().get(symbolName);
        if (!result && !onlyType) {
            result = file.getNamespaceWithName(symbolName) ??
                file.getDefaultClass().getMethodWithName(symbolName);
        }
        return result || null;
    }
    static getNamespaceInImportInfoWithName(namespaceName, arkFile) {
        let arkExport = this.getArkExportInImportInfoWithName(namespaceName, arkFile);
        if (arkExport instanceof ArkNamespace_1.ArkNamespace) {
            return arkExport;
        }
        return null;
    }
    static getStaticMethodWithName(methodName, thisClass) {
        const thisNamespace = thisClass.getDeclaringArkNamespace();
        if (thisNamespace) {
            const defaultClass = thisNamespace.getClassWithName(Const_1.DEFAULT_ARK_CLASS_NAME);
            if (defaultClass) {
                const method = defaultClass.getMethodWithName(methodName);
                if (method) {
                    return method;
                }
            }
        }
        return this.getStaticMethodInFileWithName(methodName, thisClass.getDeclaringArkFile());
    }
    static isLanguageOverloadSupport(language) {
        if (language === ArkFile_1.Language.CXX) {
            return true;
        }
        else {
            return false;
        }
    }
    static getStaticMethodInFileWithName(methodName, arkFile) {
        const defaultClass = arkFile.getClasses().find(cls => cls.getName() === Const_1.DEFAULT_ARK_CLASS_NAME) || null;
        if (defaultClass) {
            let method = defaultClass.getMethodWithName(methodName);
            if (method) {
                return method;
            }
        }
        return null;
    }
    static getStaticMethodInImportInfoWithName(methodName, arkFile) {
        let arkExport = this.getArkExportInImportInfoWithName(methodName, arkFile);
        if (arkExport instanceof ArkMethod_1.ArkMethod) {
            return arkExport;
        }
        return null;
    }
    static getLocalInImportInfoWithName(localName, arkFile) {
        let arkExport = this.getArkExportInImportInfoWithName(localName, arkFile);
        if (arkExport instanceof Local_1.Local) {
            return arkExport;
        }
        return null;
    }
    /* get nested namespaces in a file */
    static getAllNamespacesInFile(arkFile) {
        const arkNamespaces = arkFile.getNamespaces();
        for (const arkNamespace of arkFile.getNamespaces()) {
            this.getAllNamespacesInNamespace(arkNamespace, arkNamespaces);
        }
        return arkNamespaces;
    }
    /* get nested namespaces in a namespace */
    static getAllNamespacesInNamespace(arkNamespace, allNamespaces) {
        allNamespaces.push(...arkNamespace.getNamespaces());
        for (const nestedNamespace of arkNamespace.getNamespaces()) {
            this.getAllNamespacesInNamespace(nestedNamespace, allNamespaces);
        }
    }
    static getAllClassesInFile(arkFile) {
        const allClasses = arkFile.getClasses();
        this.getAllNamespacesInFile(arkFile).forEach(namespace => {
            allClasses.push(...namespace.getClasses());
        });
        return allClasses;
    }
    static getAllMethodsInFile(arkFile) {
        const allMethods = [];
        this.getAllClassesInFile(arkFile).forEach(cls => {
            allMethods.push(...cls.getMethods());
        });
        return allMethods;
    }
    static isArkUIBuilderMethod(arkMethod) {
        let isArkUIBuilderMethod = arkMethod.hasBuilderDecorator() || this.implicitArkUIBuilderMethods.has(arkMethod);
        if (!isArkUIBuilderMethod && arkMethod.getName() === 'build' && arkMethod.getDeclaringArkClass().hasComponentDecorator() && !arkMethod.isStatic()) {
            const fileName = arkMethod.getDeclaringArkClass().getDeclaringArkFile().getName();
            if (fileName.endsWith('.ets')) {
                isArkUIBuilderMethod = true;
            }
        }
        return isArkUIBuilderMethod;
    }
    static getArkClassInBuild(scene, classType) {
        const classSignature = classType.getClassSignature();
        const file = scene.getFile(classSignature.getDeclaringFileSignature());
        const namespaceSignature = classSignature.getDeclaringNamespaceSignature();
        if (namespaceSignature) {
            return file?.getNamespace(namespaceSignature)?.getClass(classSignature) || null;
        }
        return file?.getClassWithName(classSignature.getClassName()) || null;
    }
    static getDefaultClass(arkClass) {
        return arkClass.getDeclaringArkNamespace()?.getDefaultClass() ?? arkClass.getDeclaringArkFile().getDefaultClass();
    }
    static getClass(method, signature) {
        let cls = method.getDeclaringArkFile().getScene().getClass(signature);
        if (cls) {
            return cls;
        }
        let importInfo = method.getDeclaringArkFile().getImportInfoBy(signature.getClassName());
        let exportInfo = importInfo ? findExportInfo(importInfo) : null;
        let arkExport = exportInfo?.getArkExport();
        if (arkExport instanceof ArkClass_1.ArkClass) {
            return arkExport;
        }
        cls = method.getDeclaringArkClass().getDeclaringArkNamespace()?.getClassWithName(signature.getClassName());
        if (cls) {
            return cls;
        }
        for (const ns of method.getDeclaringArkFile().getAllNamespacesUnderThisFile()) {
            cls = ns.getClassWithName(signature.getClassName());
            if (cls) {
                return cls;
            }
        }
        return method.getDeclaringArkFile().getClassWithName(signature.getClassName());
    }
    static findPropertyInNamespace(name, namespace) {
        return (namespace.getDefaultClass()?.getDefaultArkMethod()?.getBody()?.getLocals()?.get(name) ??
            namespace.getDefaultClass()?.getMethodWithName(name) ??
            findArkExport(namespace.getExportInfoBy(name)) ??
            namespace.getClassWithName(name) ??
            namespace.getNamespaceWithName(name) ??
            namespace.getDefaultClass()?.getDefaultArkMethod()?.getBody()?.getAliasTypeByName(name));
    }
    static findPropertyInClass(name, arkClass) {
        let property = arkClass.getMethodWithName(name) ??
            arkClass.getFieldWithName(name) ??
            arkClass.getStaticMethodWithName(name) ??
            arkClass.getStaticFieldWithName(name) ??
            arkClass.getMethodWithName(Const_1.GETTER_PREFIX + name) ??
            arkClass.getStaticMethodWithName(Const_1.GETTER_PREFIX + name);
        if (property) {
            return property;
        }
        if (arkClass.isDefaultArkClass()) {
            return findArkExport(arkClass.getDeclaringArkFile().getExportInfoBy(name));
        }
        for (const heritage of arkClass.getAllHeritageClasses()) {
            property = this.findPropertyInClass(name, heritage);
            if (property) {
                return property;
            }
        }
        const objectClass = arkClass.getDeclaringArkFile().getScene().getSdkGlobal(Builtin_1.Builtin.OBJECT);
        if (objectClass instanceof ArkClass_1.ArkClass && arkClass !== objectClass) {
            return this.findPropertyInClass(name, objectClass);
        }
        return null;
    }
    static findDeclaredLocal(local, arkMethod, times = 0) {
        const name = local.getName();
        if (name === TSConst_1.THIS_NAME || name.startsWith(Const_1.TEMP_LOCAL_PREFIX)) {
            return null;
        }
        const parameter = arkMethod.getParameters().find(p => p.getName() === name);
        if (parameter) {
            return new Local_1.Local(parameter.getName(), parameter.getType());
        }
        if (times > 0) {
            const declaredLocal = arkMethod.getBody()?.getLocals().get(name);
            if (declaredLocal &&
                declaredLocal.getDeclaringStmt() instanceof Stmt_1.ArkAssignStmt &&
                !(declaredLocal.getDeclaringStmt().getRightOp() instanceof Ref_1.ClosureFieldRef)) {
                return declaredLocal;
            }
        }
        let parentName = arkMethod.getName();
        if (parentName === Const_1.DEFAULT_ARK_METHOD_NAME) {
            return null;
        }
        let invokeMethod = arkMethod.getOuterMethod();
        if (!invokeMethod) {
            const className = arkMethod.getDeclaringArkClass().getName();
            const outerStart = className.indexOf(Const_1.NAME_DELIMITER);
            const outerEnd = className.lastIndexOf(Const_1.NESTED_CLASS_METHOD_DELIMITER);
            if (outerStart > -1 && outerEnd > -1) {
                invokeMethod = arkMethod
                    .getDeclaringArkFile()
                    .getClassWithName(className.substring(outerStart + 1, outerEnd))
                    ?.getMethodWithName(className.substring(outerEnd + 1));
            }
            else {
                const symbol = this.findSymbolInFileWithName(name, arkMethod.getDeclaringArkClass(), true);
                return symbol instanceof Local_1.Local ? symbol : null;
            }
        }
        if (invokeMethod) {
            return this.findDeclaredLocal(local, invokeMethod, ++times);
        }
        return null;
    }
    static findArkModel(baseName, arkClass) {
        let arkModel = arkClass.getMethodWithName(baseName) ??
            arkClass.getStaticMethodWithName(baseName) ??
            arkClass.getFieldWithName(baseName) ??
            arkClass.getStaticFieldWithName(baseName);
        if (arkModel) {
            return arkModel;
        }
        arkModel =
            ModelUtils.getDefaultClass(arkClass)?.getDefaultArkMethod()?.getBody()?.getLocals()?.get(baseName) ??
                ModelUtils.getClassWithName(baseName, arkClass) ??
                ModelUtils.getNamespaceWithName(baseName, arkClass) ??
                ModelUtils.getDefaultClass(arkClass)?.getMethodWithName(baseName) ??
                ModelUtils.getDefaultClass(arkClass)?.getDefaultArkMethod()?.getBody()?.getAliasTypeByName(baseName) ??
                ModelUtils.getArkExportInImportInfoWithName(baseName, arkClass.getDeclaringArkFile());
        if (!arkModel && !arkClass.getDeclaringArkFile().getImportInfoBy(baseName)) {
            arkModel = arkClass.getDeclaringArkFile().getScene().getSdkGlobal(baseName);
        }
        return arkModel;
    }
    static findGlobalRef(refName, method) {
        return (this.findDeclaredLocal(new Local_1.Local(refName), method, 1) ??
            this.getArkExportInImportInfoWithName(refName, method.getDeclaringArkFile()) ??
            method.getDeclaringArkFile().getScene().getSdkGlobal(refName));
    }
    static findArkModelByRefName(refName, arkClass) {
        const singleNames = refName.split('.');
        let model = null;
        for (let i = 0; i < singleNames.length; i++) {
            if (model instanceof Local_1.Local || model instanceof ArkField_1.ArkField) {
                const type = model.getType();
                if (type instanceof Type_1.ClassType) {
                    model = arkClass.getDeclaringArkFile().getScene().getClass(type.getClassSignature());
                }
                else if (type instanceof Type_1.AnnotationNamespaceType) {
                    model = arkClass.getDeclaringArkFile().getScene().getNamespace(type.getNamespaceSignature());
                }
            }
            const name = singleNames[i].replace(/<(\w+)>/, ValueUtil_1.EMPTY_STRING);
            if (i === 0) {
                model = this.findArkModel(name, arkClass);
            }
            else if (model instanceof ArkClass_1.ArkClass) {
                model = this.findPropertyInClass(name, model);
            }
            else if (model instanceof ArkNamespace_1.ArkNamespace) {
                model = this.findPropertyInNamespace(name, model);
            }
            if (!model) {
                return null;
            }
        }
        return model;
    }
    static findArkModelBySignature(signature, scene) {
        if (signature instanceof ArkSignature_1.ClassSignature) {
            return scene.getClass(signature);
        }
        else if (signature instanceof ArkSignature_1.NamespaceSignature) {
            return scene.getNamespace(signature);
        }
        else if (signature instanceof ArkSignature_1.MethodSignature) {
            return scene.getMethod(signature);
        }
        else if (signature instanceof ArkSignature_1.FieldSignature) {
            const declare = this.findArkModelBySignature(signature.getDeclaringSignature(), scene);
            if (declare instanceof ArkClass_1.ArkClass) {
                return this.findPropertyInClass(signature.getFieldName(), declare);
            }
            else if (declare instanceof ArkNamespace_1.ArkNamespace) {
                return this.findPropertyInNamespace(signature.getFieldName(), declare) || null;
            }
            return null;
        }
        else if (signature instanceof ArkSignature_1.LocalSignature) {
            const declare = scene.getMethod(signature.getDeclaringMethodSignature());
            return declare?.getBody()?.getLocals().get(signature.getName()) ?? declare?.getBody()?.getAliasTypeByName(signature.getName()) ?? null;
        }
        else if (signature instanceof ArkSignature_1.AliasTypeSignature) {
            const declare = scene.getMethod(signature.getDeclaringMethodSignature());
            return declare?.getBody()?.getAliasTypeByName(signature.getName()) ?? null;
        }
        return null;
    }
    static parseArkBaseModel2Type(arkBaseModel) {
        if (arkBaseModel instanceof ArkClass_1.ArkClass) {
            return new Type_1.ClassType(arkBaseModel.getSignature(), arkBaseModel.getGenericsTypes());
        }
        else if (arkBaseModel instanceof ArkNamespace_1.ArkNamespace) {
            return Type_1.AnnotationNamespaceType.getInstance(arkBaseModel.getSignature());
        }
        else if (arkBaseModel instanceof ArkMethod_1.ArkMethod) {
            return new Type_1.FunctionType(arkBaseModel.getSignature());
        }
        else if (arkBaseModel instanceof ArkField_1.ArkField) {
            if (arkBaseModel.getType() instanceof Type_1.UnknownType || arkBaseModel.getType() instanceof Type_1.UnclearReferenceType) {
                return null;
            }
            return arkBaseModel.getType();
        }
        return null;
    }
    static isMatched(parameters, args, scene, isArrowFunc = false) {
        for (let i = 0; i < parameters.length; i++) {
            if (!args[i]) {
                return isArrowFunc ? true : parameters[i].isOptional();
            }
            const paramType = parameters[i].getType();
            const isMatched = ModelUtils.matchParam(paramType, args[i], scene);
            if (!isMatched) {
                return false;
            }
            else if (paramType instanceof Type_1.EnumValueType || paramType instanceof Type_1.LiteralType) {
                return true;
            }
        }
        return true;
    }
    static matchParam(paramType, argument, scene) {
        const arg = ModelUtils.parseArg(argument, paramType);
        let argType = arg.getType();
        if (paramType instanceof Type_1.AliasType && !(argType instanceof Type_1.AliasType)) {
            paramType = TypeInference_1.TypeInference.replaceAliasType(paramType);
        }
        else if (!(paramType instanceof Type_1.AliasType) && argType instanceof Type_1.AliasType) {
            argType = TypeInference_1.TypeInference.replaceAliasType(argType);
        }
        if (paramType instanceof Type_1.UnionType) {
            return !!paramType.getTypes().find(p => this.matchParam(p, arg, scene));
        }
        else if (argType instanceof Type_1.FunctionType && paramType instanceof Type_1.FunctionType) {
            if (argType.getMethodSignature().getParamLength() > paramType.getMethodSignature().getParamLength()) {
                return false;
            }
            const parameters = paramType.getMethodSignature().getMethodSubSignature().getParameters();
            const args = argType.getMethodSignature().getMethodSubSignature().getParameters().filter(p => !p.getName().startsWith(Const_1.LEXICAL_ENV_NAME_PREFIX));
            return ModelUtils.isMatched(parameters, args, scene, true);
        }
        return ModelUtils.matchType(paramType, argType, arg, scene);
    }
    static matchType(paramType, argType, arg, scene) {
        if (paramType instanceof Type_1.LiteralType) {
            const argStr = arg instanceof Constant_1.Constant ? arg.getValue() : argType.getTypeString();
            return argStr.replace(/[\"|\']/g, '') ===
                paramType.getTypeString().replace(/[\"|\']/g, '');
        }
        else if (paramType instanceof Type_1.ClassType && argType instanceof Type_1.EnumValueType) {
            return paramType.getClassSignature() === argType.getFieldSignature().getDeclaringSignature();
        }
        else if (paramType instanceof Type_1.EnumValueType) {
            if (argType instanceof Type_1.EnumValueType) {
                return paramType.getFieldSignature() === argType.getFieldSignature();
            }
            else if (argType.constructor === paramType.getConstant()?.getType().constructor && arg instanceof Constant_1.Constant) {
                return paramType.getConstant()?.getValue() === arg.getValue();
            }
        }
        else if (paramType instanceof Type_1.ClassType && paramType.getClassSignature().getClassName().startsWith(Const_1.ANONYMOUS_CLASS_PREFIX)) {
            if (argType instanceof Type_1.ClassType) {
                const className = argType.getClassSignature().getClassName();
                return className === Builtin_1.Builtin.OBJECT || className.startsWith(Const_1.ANONYMOUS_CLASS_PREFIX);
            }
            return false;
        }
        else if (paramType instanceof Type_1.ClassType && argType instanceof Type_1.ClassType) {
            return ModelUtils.classTypeMatch(paramType, argType, scene);
        }
        else if (paramType instanceof Type_1.ClassType && paramType.getClassSignature().getClassName().includes(EtsConst_1.CALL_BACK)) {
            return argType instanceof Type_1.FunctionType;
        }
        return argType.constructor === paramType.constructor;
    }
    static classTypeMatch(paramType, argType, scene) {
        const paramClass = scene.getClass(paramType.getClassSignature());
        const argClass = scene.getClass(argType.getClassSignature());
        if (!paramClass || !argClass) {
            return false;
        }
        if (paramClass === argClass) {
            return true;
        }
        const mustFields = paramClass.getFields().filter(f => !f.isStatic() && !f.getQuestionToken());
        const noMatchedField = mustFields.find(f => !argClass.getFieldWithName(f.getName()));
        if (noMatchedField) {
            return false;
        }
        const mustMethods = paramClass.getMethods().filter(f => !f.isStatic() && !f.getQuestionToken());
        const noMatchedMethod = mustMethods.find(f => !argClass.getMethodWithName(f.getName()));
        if (noMatchedMethod) {
            return false;
        }
        if (mustFields.length === 0 && mustMethods.length === 0) {
            const excessField = argClass.getFields().find(f => !paramClass.getFieldWithName(f.getName()));
            if (excessField) {
                return false;
            }
            const excessMethod = argClass.getMethods().find(f => !paramClass.getMethodWithName(f.getName()));
            if (excessMethod) {
                return false;
            }
        }
        return true;
    }
    static parseArg(arg, paramType) {
        if ((paramType instanceof Type_1.EnumValueType || paramType instanceof Type_1.LiteralType) && arg instanceof Local_1.Local) {
            const stmt = arg.getDeclaringStmt();
            const argType = arg.getType();
            if (argType instanceof Type_1.EnumValueType && argType.getConstant()) {
                arg = argType.getConstant();
            }
            else if (stmt instanceof Stmt_1.ArkAssignStmt && stmt.getRightOp() instanceof Constant_1.Constant) {
                arg = stmt.getRightOp();
            }
        }
        return arg;
    }
}
exports.ModelUtils = ModelUtils;
ModelUtils.implicitArkUIBuilderMethods = new Set();
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ModelUtils');
let moduleMap;
/**
 * find arkFile by from info
 * export xx from '../xx'
 * import xx from '@ohos/xx'
 * import xx from '@ohos.xx'
 * @param im importInfo or exportInfo
 */
function getArkFile(im) {
    const from = im.getFrom();
    if (!from) {
        return null;
    }
    if (/^([^@]*\/)([^\/]*)$/.test(from)) {
        //relative path
        const parentPath = /^\.{1,2}\//.test(from) ? path_1.default.dirname(im.getDeclaringArkFile().getFilePath()) : im.getDeclaringArkFile().getProjectDir();
        const originPath = path_1.default.resolve(parentPath, from);
        return getArkFileFromScene(im, originPath);
    }
    else if (moduleMap?.get(from) || /^@[a-z|\-]+?\//.test(from)) {
        //module path
        const arkFile = getArkFileFromOtherModule(im);
        if (arkFile) {
            return arkFile;
        }
    }
    //sdk path
    const file = SdkUtils_1.SdkUtils.getImportSdkFile(from);
    if (file) {
        return file;
    }
    const scene = im.getDeclaringArkFile().getScene();
    for (const sdk of scene.getProjectSdkMap().values()) {
        const arkFile = getArkFileFormMap(sdk.name, processSdkPath(sdk, from), scene);
        if (arkFile) {
            return arkFile;
        }
    }
    return null;
}
/**
 * find from info's export
 * @param fromInfo importInfo or exportInfo
 * @param visited
 */
function findExportInfo(fromInfo, visited = new Set([fromInfo.getDeclaringArkFile()])) {
    let file = getArkFile(fromInfo);
    if (!file) {
        logger.warn(`${fromInfo.getOriginName()} ${fromInfo.getFrom()} file not found: ${fromInfo.getDeclaringArkFile()?.getFileSignature()?.toString()}`);
        return null;
    }
    if (fromInfo.getOriginName() === TSConst_1.ALL) {
        const exportInfo = (0, ArkExportBuilder_1.buildDefaultExportInfo)(fromInfo, file);
        file.addExportInfo(exportInfo, TSConst_1.ALL);
        return exportInfo;
    }
    let exportInfo = findExportInfoInfile(fromInfo, file, visited) || null;
    if (exportInfo === null) {
        return null;
    }
    const arkExport = findArkExport(exportInfo);
    exportInfo.setArkExport(arkExport);
    if (arkExport) {
        exportInfo.setExportClauseType(arkExport.getExportType());
    }
    return exportInfo;
}
function findArkExport(exportInfo) {
    if (!exportInfo) {
        return null;
    }
    let arkExport = exportInfo.getArkExport();
    if (arkExport || arkExport === null) {
        return arkExport;
    }
    if (!exportInfo.getFrom()) {
        const name = exportInfo.getOriginName();
        const defaultClass = exportInfo.getDeclaringArkNamespace()?.getDefaultClass() ?? exportInfo.getDeclaringArkFile().getDefaultClass();
        if (exportInfo.getExportClauseType() === ArkExport_1.ExportType.LOCAL) {
            arkExport = defaultClass.getDefaultArkMethod()?.getBody()?.getExportLocalByName(name);
        }
        else if (exportInfo.getExportClauseType() === ArkExport_1.ExportType.TYPE) {
            arkExport = defaultClass.getDefaultArkMethod()?.getBody()?.getAliasTypeByName(name);
        }
        else {
            arkExport = findArkExportInFile(name, exportInfo.getDeclaringArkFile());
        }
    }
    else if (exportInfo.getExportClauseType() === ArkExport_1.ExportType.UNKNOWN) {
        const result = findExportInfo(exportInfo);
        if (result) {
            arkExport = result.getArkExport() || null;
        }
    }
    if (arkExport) {
        exportInfo.setArkExport(arkExport);
    }
    else {
        const file = exportInfo.getDeclaringArkFile().getFileSignature().toString();
        logger.warn(`${exportInfo.getExportClauseName()} get arkExport fail from ${exportInfo.getFrom()} at ${file}`);
    }
    return arkExport || null;
}
function findArkExportInFile(name, declaringArkFile) {
    let arkExport = declaringArkFile.getNamespaceWithName(name) ??
        declaringArkFile.getDefaultClass().getDefaultArkMethod()?.getBody()?.getAliasTypeByName(name) ??
        declaringArkFile.getClassWithName(name) ??
        declaringArkFile.getDefaultClass().getMethodWithName(name) ??
        declaringArkFile.getDefaultClass().getDefaultArkMethod()?.getBody()?.getExportLocalByName(name);
    if (!arkExport) {
        const importInfo = declaringArkFile.getImportInfoBy(name);
        if (importInfo) {
            const result = findExportInfo(importInfo);
            if (result) {
                arkExport = result.getArkExport();
            }
        }
    }
    return arkExport || null;
}
function processSdkPath(sdk, formPath) {
    let originPath = path_1.default.join(sdk.path, formPath);
    if (FileUtils_1.FileUtils.isDirectory(originPath)) {
        formPath = path_1.default.join(formPath, FileUtils_1.FileUtils.getIndexFileName(originPath));
    }
    return `${formPath}`;
}
function getArkFileFromScene(im, originPath) {
    if (FileUtils_1.FileUtils.isDirectory(originPath)) {
        originPath = path_1.default.join(originPath, FileUtils_1.FileUtils.getIndexFileName(originPath));
    }
    const fileName = path_1.default.relative(im.getDeclaringArkFile().getProjectDir(), originPath);
    const scene = im.getDeclaringArkFile().getScene();
    if (/\.e?ts$/.test(originPath)) {
        const fromSignature = new ArkSignature_1.FileSignature(im.getDeclaringArkFile().getProjectName(), fileName);
        return scene.getFile(fromSignature);
    }
    const projectName = im.getDeclaringArkFile().getProjectName();
    return getArkFileFormMap(projectName, fileName, scene);
}
function getArkFileFormMap(projectName, filePath, scene) {
    if (/\.e?ts$/.test(filePath)) {
        return scene.getFile(new ArkSignature_1.FileSignature(projectName, filePath));
    }
    const fileSuffixArray = scene.getOptions().supportFileExts;
    if (!fileSuffixArray) {
        return null;
    }
    for (const suffix of fileSuffixArray) {
        const arkFile = scene.getFile(new ArkSignature_1.FileSignature(projectName, filePath + suffix));
        if (arkFile) {
            return arkFile;
        }
    }
    return null;
}
function findExportInfoInfile(fromInfo, file, visited = new Set([fromInfo.getDeclaringArkFile()])) {
    //check cycle
    if (!visited.has(file)) {
        visited.add(file);
        // expand export *
        file.getExportInfos().filter(f => f.getExportClauseName().startsWith(TSConst_1.TEMP_EXPORT_ALL_PREFIX))
            .forEach(e => {
            findExportInfo(e, visited);
            file.removeExportInfo(e);
        });
    }
    if (fromInfo.getOriginName().startsWith(TSConst_1.TEMP_EXPORT_ALL_PREFIX) && fromInfo instanceof ArkExport_1.ExportInfo) {
        const declaringArkFile = fromInfo.getDeclaringArkFile();
        file.getExportInfos().filter(f => !f.isDefault() && !f.getExportClauseName().startsWith(TSConst_1.TEMP_EXPORT_ALL_PREFIX))
            .forEach(exportInfo => declaringArkFile.addExportInfo(exportInfo));
        declaringArkFile.removeExportInfo(fromInfo);
        return undefined;
    }
    const exportName = fromInfo.isDefault() ? TSConst_1.DEFAULT : fromInfo.getOriginName();
    let exportInfo = file.getExportInfoBy(exportName);
    if (exportInfo) {
        return exportInfo;
    }
    if (exportName === TSConst_1.DEFAULT) {
        exportInfo = file.getExportInfos().find(p => p.isDefault());
        if (exportInfo) {
            file.addExportInfo(exportInfo, TSConst_1.DEFAULT);
            return exportInfo;
        }
    }
    if (fromInfo.getOriginName() === TSConst_1.ALL) {
        exportInfo = (0, ArkExportBuilder_1.buildDefaultExportInfo)(fromInfo, file);
        file.addExportInfo(exportInfo, TSConst_1.ALL);
    }
    else if (/\.d\.e?ts$/.test(file.getName())) {
        let declare = exportName === TSConst_1.DEFAULT ? undefined : findArkExportInFile(fromInfo.getOriginName(), file) || undefined;
        exportInfo = (0, ArkExportBuilder_1.buildDefaultExportInfo)(fromInfo, file, declare);
    }
    return exportInfo;
}
function initModulePathMap(ohPkgContentMap) {
    if (moduleMap) {
        moduleMap.clear();
    }
    moduleMap = FileUtils_1.FileUtils.generateModuleMap(ohPkgContentMap);
}
function getArkFileFromOtherModule(fromInfo) {
    if (!moduleMap || moduleMap.size === 0) {
        return undefined;
    }
    const from = fromInfo.getFrom();
    let index;
    let file;
    let modulePath;
    //find file by given from like '@ohos/module/src/xxx' '@ohos/module/index'
    if ((index = from.indexOf('src')) > 0 || (index = from.indexOf('Index')) > 0 || (index = from.indexOf('index')) > 0) {
        modulePath = moduleMap.get(from.substring(0, index).replace(/\/*$/, ''));
        file = findFileInModule(fromInfo, modulePath, from.substring(index));
    }
    if (file) {
        return file;
    }
    modulePath = modulePath ?? moduleMap.get(from);
    if (!modulePath) {
        return file;
    }
    //find file in module json main path
    if (modulePath.main) {
        file = getArkFileFromScene(fromInfo, modulePath.main);
    }
    //find file in module path Index.ts
    if (!file && FileUtils_1.FileUtils.isDirectory(modulePath.path)) {
        file = findFileInModule(fromInfo, modulePath, FileUtils_1.FileUtils.getIndexFileName(modulePath.path));
    }
    //find file in module path/src/main/ets/TsIndex.ts
    if (!file) {
        file = findFileInModule(fromInfo, modulePath, '/src/main/ets/TsIndex.ts');
    }
    return file;
}
function findFileInModule(fromInfo, modulePath, contentPath) {
    if (!modulePath) {
        return undefined;
    }
    const originPath = path_1.default.join(modulePath.path, contentPath);
    let file;
    if (originPath !== modulePath.main) {
        file = getArkFileFromScene(fromInfo, originPath);
    }
    if (file && findExportInfoInfile(fromInfo, file)) {
        return file;
    }
    return undefined;
}
//# sourceMappingURL=ModelUtils.js.map