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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArkClass = exports.ClassCategory = void 0;
const Type_1 = require("../base/Type");
const ArkMethod_1 = require("./ArkMethod");
const ArkExport_1 = require("./ArkExport");
const TypeInference_1 = require("../common/TypeInference");
const Const_1 = require("../common/Const");
const Position_1 = require("../base/Position");
const ArkBaseModel_1 = require("./ArkBaseModel");
const ModelUtils_1 = require("../common/ModelUtils");
const logger_1 = __importStar(require("../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ArkClass');
var ClassCategory;
(function (ClassCategory) {
    ClassCategory[ClassCategory["CLASS"] = 0] = "CLASS";
    ClassCategory[ClassCategory["STRUCT"] = 1] = "STRUCT";
    ClassCategory[ClassCategory["INTERFACE"] = 2] = "INTERFACE";
    ClassCategory[ClassCategory["ENUM"] = 3] = "ENUM";
    ClassCategory[ClassCategory["TYPE_LITERAL"] = 4] = "TYPE_LITERAL";
    ClassCategory[ClassCategory["OBJECT"] = 5] = "OBJECT";
})(ClassCategory || (exports.ClassCategory = ClassCategory = {}));
/**
 * @category core/model
 */
class ArkClass extends ArkBaseModel_1.ArkBaseModel {
    constructor() {
        super();
        this.lineCol = 0;
        /**
         * The keys of the `heritageClasses` map represent the names of superclass and interfaces.
         * The superclass name is placed first; if it does not exist, an empty string `''` will occupy this position.
         * The values of the `heritageClasses` map will be replaced with `ArkClass` or `null` during type inference.
         */
        this.heritageClasses = new Map();
        this.defaultMethod = null;
        // name to model
        this.methods = new Map();
        this.fields = new Map();
        this.extendedClasses = new Map();
        this.staticMethods = new Map();
        this.staticFields = new Map();
        this.instanceInitMethod = new ArkMethod_1.ArkMethod();
        this.staticInitMethod = new ArkMethod_1.ArkMethod();
        this.anonymousMethodNumber = 0;
        this.indexSignatureNumber = 0;
    }
    /**
     * Returns the program language of the file where this class defined.
     */
    getLanguage() {
        return this.getDeclaringArkFile().getLanguage();
    }
    /**
     * Returns the **string**name of this class.
     * @returns The name of this class.
     */
    getName() {
        return this.classSignature.getClassName();
    }
    /**
     * Returns the codes of class as a **string.**
     * @returns the codes of class.
     */
    getCode() {
        return this.code;
    }
    setCode(code) {
        this.code = code;
    }
    /**
     * Returns the line position of this class.
     * @returns The line position of this class.
     */
    getLine() {
        return (0, Position_1.getLineNo)(this.lineCol);
    }
    setLine(line) {
        this.lineCol = (0, Position_1.setLine)(this.lineCol, line);
    }
    /**
     * Returns the column position of this class.
     * @returns The column position of this class.
     */
    getColumn() {
        return (0, Position_1.getColNo)(this.lineCol);
    }
    setColumn(column) {
        this.lineCol = (0, Position_1.setCol)(this.lineCol, column);
    }
    getCategory() {
        return this.category ?? ClassCategory.CLASS;
    }
    setCategory(category) {
        this.category = category;
    }
    /**
     * Returns the declaring file.
     * @returns A file defined by ArkAnalyzer.
     * @example
     * 1. Get the {@link ArkFile} which the ArkClass is in.

     ```typescript
     const arkFile = arkClass.getDeclaringArkFile();
     ```
     */
    getDeclaringArkFile() {
        return this.declaringArkFile;
    }
    setDeclaringArkFile(declaringArkFile) {
        this.declaringArkFile = declaringArkFile;
    }
    /**
     * Returns the declaring namespace of this class, which may also be an **undefined**.
     * @returns The declaring namespace (may be **undefined**) of this class.
     */
    getDeclaringArkNamespace() {
        return this.declaringArkNamespace;
    }
    setDeclaringArkNamespace(declaringArkNamespace) {
        this.declaringArkNamespace = declaringArkNamespace;
    }
    isDefaultArkClass() {
        return this.getName() === Const_1.DEFAULT_ARK_CLASS_NAME;
    }
    isAnonymousClass() {
        return this.getName().startsWith(Const_1.ANONYMOUS_CLASS_PREFIX);
    }
    /**
     * Returns the signature of current class (i.e., {@link ClassSignature}).
     * The {@link ClassSignature} can uniquely identify a class, according to which we can find the class from the scene.
     * @returns The class signature.
     */
    getSignature() {
        return this.classSignature;
    }
    setSignature(classSig) {
        this.classSignature = classSig;
    }
    getSuperClassName() {
        return this.heritageClasses.keys().next().value || '';
    }
    addHeritageClassName(className) {
        this.heritageClasses.set(className, undefined);
    }
    /**
     * Returns the superclass of this class.
     * @returns The superclass of this class.
     */
    getSuperClass() {
        const heritageClass = this.getHeritageClass(this.getSuperClassName());
        if (heritageClass && heritageClass.getCategory() !== ClassCategory.INTERFACE) {
            return heritageClass;
        }
        return null;
    }
    getHeritageClass(heritageClassName) {
        if (!heritageClassName) {
            return null;
        }
        let superClass = this.heritageClasses.get(heritageClassName);
        if (superClass === undefined) {
            let type = TypeInference_1.TypeInference.inferUnclearRefName(heritageClassName, this) ??
                TypeInference_1.TypeInference.inferUnclearRefName(heritageClassName, this.getDeclaringArkFile().getDefaultClass());
            if (type) {
                type = TypeInference_1.TypeInference.replaceAliasType(type);
            }
            if (type instanceof Type_1.ClassType && (superClass = this.declaringArkFile.getScene().getClass(type.getClassSignature()))) {
                superClass.addExtendedClass(this);
                const realGenericTypes = type.getRealGenericTypes();
                if (realGenericTypes) {
                    this.realTypes = realGenericTypes;
                }
            }
            this.heritageClasses.set(heritageClassName, superClass || null);
        }
        return superClass || null;
    }
    getAllHeritageClasses() {
        const result = [];
        this.heritageClasses.forEach((v, k) => {
            const heritage = v ?? this.getHeritageClass(k);
            if (heritage) {
                result.push(heritage);
            }
        });
        return result;
    }
    getExtendedClasses() {
        return this.extendedClasses;
    }
    addExtendedClass(extendedClass) {
        this.extendedClasses.set(extendedClass.getName(), extendedClass);
    }
    getImplementedInterfaceNames() {
        if (this.category === ClassCategory.INTERFACE) {
            return [];
        }
        return Array.from(this.heritageClasses.keys()).slice(1);
    }
    hasImplementedInterface(interfaceName) {
        return this.heritageClasses.has(interfaceName) && this.getSuperClassName() !== interfaceName;
    }
    getImplementedInterface(interfaceName) {
        const heritageClass = this.getHeritageClass(interfaceName);
        if (heritageClass && heritageClass.getCategory() === ClassCategory.INTERFACE) {
            return heritageClass;
        }
        return null;
    }
    /**
     * Get the field according to its field signature.
     * If no field cound be found, **null**will be returned.
     * @param fieldSignature - the field's signature.
     * @returns A field. If there is no field in this class, the return will be a **null**.
     */
    getField(fieldSignature) {
        const fieldName = fieldSignature.getFieldName();
        let fieldSearched = this.getFieldWithName(fieldName);
        if (!fieldSearched) {
            fieldSearched = this.getStaticFieldWithName(fieldName);
        }
        return fieldSearched;
    }
    getFieldWithName(fieldName) {
        return this.fields.get(fieldName) || null;
    }
    getStaticFieldWithName(fieldName) {
        return this.staticFields.get(fieldName) || null;
    }
    /**
     * Returns an **array** of fields in the class.
     * @returns an **array** of fields in the class.
     */
    getFields() {
        const allFields = Array.from(this.staticFields.values());
        allFields.push(...this.fields.values());
        return allFields;
    }
    addField(field) {
        if (field.isStatic()) {
            this.staticFields.set(field.getName(), field);
        }
        else {
            this.fields.set(field.getName(), field);
        }
    }
    addFields(fields) {
        fields.forEach(field => {
            this.addField(field);
        });
    }
    getRealTypes() {
        return this.realTypes ? Array.from(this.realTypes) : undefined;
    }
    getGenericsTypes() {
        return this.genericsTypes ? Array.from(this.genericsTypes) : undefined;
    }
    addGenericType(gType) {
        if (!this.genericsTypes) {
            this.genericsTypes = [];
        }
        this.genericsTypes.push(gType);
    }
    /**
     * Returns all methods defined in the specific class in the form of an array.
     * @param generated - indicating whether this API returns the methods that are dynamically
     * generated at runtime. If it is not specified as true or false, the return will not include the generated method.
     * @returns An array of all methods in this class.
     * @example
     * 1. Get methods defined in class `BookService`.

     ```typescript
     let classes: ArkClass[] = scene.getClasses();
     let serviceClass : ArkClass = classes[1];
     let methods: ArkMethod[] = serviceClass.getMethods();
     let methodNames: string[] = methods.map(mthd => mthd.name);
     console.log(methodNames);
     ```
     */
    getMethods(generated) {
        const flattenReducer = (acc, val) => acc.concat(val);
        const allMethods = Array.from(this.methods.values()).reduce(flattenReducer, []).filter(f => (!generated && !f.isGenerated()) || generated);
        allMethods.push(...[...this.staticMethods.values()].reduce(flattenReducer, []));
        return [...new Set(allMethods)];
    }
    getMethod(methodSignature) {
        const methodName = methodSignature.getMethodSubSignature().getMethodName();
        const methodSearched = this.getMethodWithName(methodName) ?? this.getStaticMethodWithName(methodName);
        if (methodSearched === null) {
            return null;
        }
        const implSignature = methodSearched.getImplementationSignature();
        if (implSignature !== null && implSignature.isMatch(methodSignature)) {
            return methodSearched;
        }
        const declareSignatures = methodSearched.getDeclareSignatures();
        if (declareSignatures !== null) {
            for (let i = 0; i < declareSignatures.length; i++) {
                if (declareSignatures[i].isMatch(methodSignature)) {
                    return methodSearched;
                }
            }
        }
        return null;
    }
    getMethodWithName(methodName) {
        const sameNameMethods = this.methods.get(methodName);
        if (!sameNameMethods) {
            return null;
        }
        if (sameNameMethods.length > 1) {
            logger.warn("There are multiple non-static methods with the same name, and the interface 'getMethodWithName' only returns one of them. " +
                "If you want to obtain all non-static methods with the same name, please use the interface 'getMethodsWithName'.");
        }
        return sameNameMethods[0];
    }
    getStaticMethodWithName(methodName) {
        const sameNameStaticMethods = this.staticMethods.get(methodName);
        if (!sameNameStaticMethods) {
            return null;
        }
        if (sameNameStaticMethods.length > 1) {
            logger.warn("There are multiple static methods with the same name, and the interface 'getStaticMethodWithName' only returns one of them. " +
                "If you want to obtain all static methods with the same name, please use the interface 'getStaticMethodsWithName'.");
        }
        return sameNameStaticMethods[0];
    }
    /**
     * add a method in class.
     * when a nested method with declare name, add both the declare origin name and signature name
     * %${declare name}$${outer method name} in class.
     */
    addMethod(method, originName) {
        const name = originName ?? method.getName();
        this.updateMethodMap(method, name);
        if (!originName && !method.isAnonymousMethod() && name.startsWith(Const_1.NAME_PREFIX)) {
            const index = name.indexOf(Const_1.NAME_DELIMITER);
            if (index > 1) {
                const originName = name.substring(1, index);
                this.addMethod(method, originName);
            }
        }
    }
    /**
     * Update the new method to the corresponding Map.
     *
     * @param newMethod - the new method
     * @param methodName - name of new method
     */
    updateMethodMap(newMethod, methodName) {
        const methodMap = newMethod.isStatic() ? this.staticMethods : this.methods;
        const methodsWithSameName = methodMap.get(methodName);
        if (!methodsWithSameName || !ModelUtils_1.ModelUtils.isLanguageOverloadSupport(this.getLanguage())) {
            methodMap.set(methodName, [newMethod]);
            return;
        }
        const newMethodSignature = newMethod.getSignature();
        const matchIndex = methodsWithSameName.findIndex(
        // CXXTodo: After the subsequent abstraction of BodyBuilder, this conditions need to be refactored.
        preMtd => preMtd.getSignature().isMatch(newMethodSignature));
        if (matchIndex === -1) {
            methodsWithSameName.push(newMethod);
        }
        else {
            methodsWithSameName[matchIndex] = newMethod;
        }
    }
    /**
     * Get all non-static methods with the same name.
     *
     * @param methodName - name of method
     * @returns an **array** of methods in the class.
     */
    getMethodsWithName(methodName) {
        return this.methods.get(methodName) ?? [];
    }
    /**
     * Get all static methods with the same name.
     *
     * @param methodName - name of method
     * @returns an **array** of methods in the class.
     */
    getStaticMethodsWithName(methodName) {
        return this.staticMethods.get(methodName) ?? [];
    }
    /**
     * Get all non-static and static methods with the same name.
     *
     * @param methodName - name of method
     * @returns an **array** of methods in the class.
     */
    getAllMethodsWithName(methodName) {
        const allMethods = [...this.getMethodsWithName(methodName), ...this.getStaticMethodsWithName(methodName)];
        return [...new Set(allMethods)];
    }
    setDefaultArkMethod(defaultMethod) {
        this.defaultMethod = defaultMethod;
        this.addMethod(defaultMethod);
    }
    getDefaultArkMethod() {
        return this.defaultMethod;
    }
    setViewTree(viewTree) {
        this.viewTree = viewTree;
    }
    /**
     * Returns the view tree of the ArkClass.
     * @returns The view tree of the ArkClass.
     * @example
     * 1. get viewTree of ArkClass.

     ```typescript
     for (let arkFiles of scene.getFiles()) {
     for (let arkClasss of arkFiles.getClasses()) {
     if (arkClasss.hasViewTree()) {
     arkClasss.getViewTree();
     }
     }
     }
     ```
     */
    getViewTree() {
        return this.viewTree;
    }
    /**
     * Check whether the view tree is defined.
     * If it is defined, the return value is true, otherwise it is false.
     * @returns True if the view tree is defined; false otherwise.
     * @example
     * 1. Judge viewTree of ArkClass.

     ```typescript
     for (let arkFiles of scene.getFiles()) {
     for (let arkClasss of arkFiles.getClasses()) {
     if (arkClasss.hasViewTree()) {
     arkClasss.getViewTree();
     }
     }
     }
     ```
     */
    hasViewTree() {
        return this.viewTree !== undefined;
    }
    getStaticFields(classMap) {
        return Array.from(this.staticFields.values());
    }
    getGlobalVariable(globalMap) {
        if (this.declaringArkNamespace) {
            return globalMap.get(this.declaringArkNamespace.getNamespaceSignature());
        }
        return globalMap.get(this.declaringArkFile.getFileSignature());
    }
    getAnonymousMethodNumber() {
        return this.anonymousMethodNumber++;
    }
    getIndexSignatureNumber() {
        return this.indexSignatureNumber++;
    }
    getExportType() {
        return ArkExport_1.ExportType.CLASS;
    }
    getInstanceInitMethod() {
        return this.instanceInitMethod;
    }
    getStaticInitMethod() {
        return this.staticInitMethod;
    }
    setInstanceInitMethod(arkMethod) {
        this.instanceInitMethod = arkMethod;
    }
    setStaticInitMethod(arkMethod) {
        this.staticInitMethod = arkMethod;
    }
    removeField(field) {
        if (field.isStatic()) {
            return this.staticFields.delete(field.getName());
        }
        return this.fields.delete(field.getName());
    }
    removeMethod(method) {
        let rtn = false;
        if (method.isStatic()) {
            rtn = this.staticMethods.delete(method.getName());
        }
        else {
            rtn = this.methods.delete(method.getName());
        }
        rtn &&= this.getDeclaringArkFile().getScene().removeMethod(method);
        return rtn;
    }
    validate() {
        return this.validateFields(['declaringArkFile', 'category', 'classSignature']);
    }
}
exports.ArkClass = ArkClass;
//# sourceMappingURL=ArkClass.js.map