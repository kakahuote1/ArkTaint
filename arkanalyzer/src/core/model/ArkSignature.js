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
exports.AliasTypeSignature = exports.LocalSignature = exports.MethodSignature = exports.MethodSubSignature = exports.FieldSignature = exports.AliasClassSignature = exports.ClassSignature = exports.NamespaceSignature = exports.FileSignature = void 0;
exports.fieldSignatureCompare = fieldSignatureCompare;
exports.methodSignatureCompare = methodSignatureCompare;
exports.methodSubSignatureCompare = methodSubSignatureCompare;
exports.classSignatureCompare = classSignatureCompare;
exports.fileSignatureCompare = fileSignatureCompare;
exports.genSignature4ImportClause = genSignature4ImportClause;
const path_1 = __importDefault(require("path"));
const pathTransfer_1 = require("../../utils/pathTransfer");
const Type_1 = require("../base/Type");
const Const_1 = require("../common/Const");
const crypto_utils_1 = require("../../utils/crypto_utils");
/**
 * @category core/model
 */
class FileSignature {
    constructor(projectName, fileName) {
        this.projectName = projectName;
        this.fileName = (0, pathTransfer_1.transfer2UnixPath)(fileName);
        this.hashcode = crypto_utils_1.CryptoUtils.hashcode(this.toString());
    }
    getProjectName() {
        return this.projectName;
    }
    getFileName() {
        return this.fileName;
    }
    toString() {
        return `@${this.projectName}/${this.fileName}: `;
    }
    toMapKey() {
        return `${this.hashcode}${path_1.default.basename(this.fileName)}`;
    }
}
exports.FileSignature = FileSignature;
FileSignature.DEFAULT = new FileSignature(Const_1.UNKNOWN_PROJECT_NAME, Const_1.UNKNOWN_FILE_NAME);
class NamespaceSignature {
    constructor(namespaceName, declaringFileSignature, declaringNamespaceSignature = null) {
        this.namespaceName = namespaceName;
        this.declaringFileSignature = declaringFileSignature;
        this.declaringNamespaceSignature = declaringNamespaceSignature;
    }
    getNamespaceName() {
        return this.namespaceName;
    }
    getDeclaringFileSignature() {
        return this.declaringFileSignature;
    }
    getDeclaringNamespaceSignature() {
        return this.declaringNamespaceSignature;
    }
    toString() {
        if (this.declaringNamespaceSignature) {
            return this.declaringNamespaceSignature.toString() + '.' + this.namespaceName;
        }
        else {
            return this.declaringFileSignature.toString() + this.namespaceName;
        }
    }
    toMapKey() {
        if (this.declaringNamespaceSignature) {
            return this.declaringNamespaceSignature.toMapKey() + '.' + this.namespaceName;
        }
        else {
            return this.declaringFileSignature.toMapKey() + this.namespaceName;
        }
    }
}
exports.NamespaceSignature = NamespaceSignature;
NamespaceSignature.DEFAULT = new NamespaceSignature(Const_1.UNKNOWN_NAMESPACE_NAME, FileSignature.DEFAULT, null);
class ClassSignature {
    constructor(className, declaringFileSignature, declaringNamespaceSignature = null) {
        this.className = className;
        this.declaringFileSignature = declaringFileSignature;
        this.declaringNamespaceSignature = declaringNamespaceSignature;
    }
    /**
     * Returns the declaring file signature.
     * @returns The declaring file signature.
     */
    getDeclaringFileSignature() {
        return this.declaringFileSignature;
    }
    /**
     * Get the declaring namespace's signature.
     * @returns the declaring namespace's signature.
     */
    getDeclaringNamespaceSignature() {
        return this.declaringNamespaceSignature;
    }
    /**
     * Get the **string** name of class from the the class signature. The default value is `""`.
     * @returns The name of this class.
     */
    getClassName() {
        return this.className;
    }
    /**
     *
     * @returns The name of the declare class.
     */
    getDeclaringClassName() {
        if (this.className.startsWith(Const_1.ANONYMOUS_CLASS_PREFIX)) {
            let temp = this.className;
            do {
                temp = temp.substring(temp.indexOf(Const_1.NAME_DELIMITER) + 1, temp.lastIndexOf(Const_1.NESTED_CLASS_METHOD_DELIMITER));
            } while (temp.startsWith(Const_1.ANONYMOUS_CLASS_PREFIX));
            return temp;
        }
        return this.className;
    }
    setClassName(className) {
        this.className = className;
    }
    getType() {
        return new Type_1.ClassType(this);
    }
    toString() {
        if (this.declaringNamespaceSignature) {
            return this.declaringNamespaceSignature.toString() + '.' + this.className;
        }
        else {
            return this.declaringFileSignature.toString() + this.className;
        }
    }
    toMapKey() {
        if (this.declaringNamespaceSignature) {
            return this.declaringNamespaceSignature.toMapKey() + '.' + this.className;
        }
        else {
            return this.declaringFileSignature.toMapKey() + this.className;
        }
    }
}
exports.ClassSignature = ClassSignature;
ClassSignature.DEFAULT = new ClassSignature(Const_1.UNKNOWN_CLASS_NAME, FileSignature.DEFAULT, null);
/**
 * `AliasClassSignature` is used to extend `ClassSignature`, preserving the actual name used during invocation.
 */
class AliasClassSignature extends ClassSignature {
    constructor(aliasName, signature) {
        super(signature.getClassName(), signature.getDeclaringFileSignature(), signature.getDeclaringNamespaceSignature());
        this.aliasName = aliasName;
    }
    /**
     * Returns the name used in the code.
     */
    getClassName() {
        return this.aliasName;
    }
    /**
     * Return the original name of declared class
     */
    getOriginName() {
        return super.getClassName();
    }
}
exports.AliasClassSignature = AliasClassSignature;
class FieldSignature {
    constructor(fieldName, declaringSignature, type, staticFlag = false) {
        this.fieldName = fieldName;
        this.declaringSignature = declaringSignature;
        this.type = type;
        this.staticFlag = staticFlag;
    }
    getDeclaringSignature() {
        return this.declaringSignature;
    }
    getBaseName() {
        return this.declaringSignature instanceof ClassSignature ? this.declaringSignature.getClassName() : this.declaringSignature.getNamespaceName();
    }
    getFieldName() {
        return this.fieldName;
    }
    getType() {
        return this.type;
    }
    isStatic() {
        return this.staticFlag;
    }
    // temp for being compatible with existing type inference
    setType(type) {
        this.type = type;
    }
    // temp for being compatible with existing type inference
    setStaticFlag(flag) {
        this.staticFlag = flag;
    }
    toString() {
        let tmpSig = this.fieldName;
        if (this.isStatic()) {
            tmpSig = '[static]' + tmpSig;
        }
        return this.getDeclaringSignature().toString() + '.' + tmpSig;
    }
}
exports.FieldSignature = FieldSignature;
class MethodSubSignature {
    constructor(methodName, parameters, returnType, staticFlag = false) {
        this.methodName = methodName;
        this.parameters = parameters;
        this.returnType = returnType;
        this.staticFlag = staticFlag;
    }
    getMethodName() {
        return this.methodName;
    }
    getParameters() {
        return this.parameters;
    }
    getParameterTypes() {
        const parameterTypes = [];
        this.parameters.forEach(parameter => {
            parameterTypes.push(parameter.getType());
        });
        return parameterTypes;
    }
    getReturnType() {
        return this.returnType;
    }
    setReturnType(returnType) {
        this.returnType = returnType;
    }
    isStatic() {
        return this.staticFlag;
    }
    toString(ptrName) {
        let paraStr = '';
        this.getParameterTypes().forEach(parameterType => {
            paraStr += parameterType.toString() + ', ';
        });
        paraStr = paraStr.replace(/, $/, '');
        let tmpSig = `${ptrName ?? this.getMethodName()}(${paraStr})`;
        if (this.isStatic()) {
            tmpSig = '[static]' + tmpSig;
        }
        return tmpSig;
    }
}
exports.MethodSubSignature = MethodSubSignature;
/**
 * @category core/model
 */
class MethodSignature {
    constructor(declaringClassSignature, methodSubSignature) {
        this.declaringClassSignature = declaringClassSignature;
        this.methodSubSignature = methodSubSignature;
    }
    /**
     * Return the declaring class signature.
     * A {@link ClassSignature} includes:
     * - File Signature: including the **string** names of the project and file, respectively.
     * The default value of project's name is "%unk" and the default value of file's name is "%unk".
     * - Namespace Signature | **null**:  it may be a namespace signature or **null**.
     * A namespace signature can indicate its **string** name of namespace and its file signature.
     * - Class Name: the **string** name of this class.
     * @returns The declaring class signature.
     * @example
     * 1. get class signature from ArkMethod.

     ```typescript
     let methodSignature = expr.getMethodSignature();
     let name = methodSignature.getDeclaringClassSignature().getClassName();
     ```
     *
     */
    getDeclaringClassSignature() {
        return this.declaringClassSignature;
    }
    /**
     * Returns the sub-signature of this method signature.
     * The sub-signature is part of the method signature, which is used to
     * identify the name of the method, its parameters and the return value type.
     * @returns The sub-signature of this method signature.
     */
    getMethodSubSignature() {
        return this.methodSubSignature;
    }
    getType() {
        return this.methodSubSignature.getReturnType();
    }
    toString(ptrName) {
        return this.declaringClassSignature.toString() + '.' +
            this.methodSubSignature.toString(ptrName);
    }
    toMapKey() {
        return this.declaringClassSignature.toMapKey() + '.' + this.methodSubSignature.toString();
    }
    isMatch(signature) {
        return this.toString() === signature.toString() && this.getType().toString() === signature.getType().toString();
    }
    getParamLength() {
        return this.methodSubSignature.getParameters().filter(p => !p.getName().startsWith(Const_1.LEXICAL_ENV_NAME_PREFIX)).length;
    }
}
exports.MethodSignature = MethodSignature;
class LocalSignature {
    constructor(name, declaringMethodSignature) {
        this.name = name;
        this.declaringMethodSignature = declaringMethodSignature;
    }
    getName() {
        return this.name;
    }
    getDeclaringMethodSignature() {
        return this.declaringMethodSignature;
    }
    toString() {
        return this.declaringMethodSignature.toString() + '#' + this.name;
    }
}
exports.LocalSignature = LocalSignature;
class AliasTypeSignature {
    constructor(name, declaringMethodSignature) {
        this.name = name;
        this.declaringMethodSignature = declaringMethodSignature;
    }
    getName() {
        return this.name;
    }
    getDeclaringMethodSignature() {
        return this.declaringMethodSignature;
    }
    toString() {
        return this.declaringMethodSignature.toString() + '#' + this.name;
    }
}
exports.AliasTypeSignature = AliasTypeSignature;
//TODO, reconstruct
function fieldSignatureCompare(leftSig, rightSig) {
    if (leftSig.getDeclaringSignature().toString() === rightSig.getDeclaringSignature().toString() && leftSig.getFieldName() === rightSig.getFieldName()) {
        return true;
    }
    return false;
}
function methodSignatureCompare(leftSig, rightSig) {
    if (classSignatureCompare(leftSig.getDeclaringClassSignature(), rightSig.getDeclaringClassSignature()) &&
        methodSubSignatureCompare(leftSig.getMethodSubSignature(), rightSig.getMethodSubSignature())) {
        return true;
    }
    return false;
}
function methodSubSignatureCompare(leftSig, rightSig) {
    if (leftSig.getMethodName() === rightSig.getMethodName() &&
        arrayCompare(leftSig.getParameterTypes(), rightSig.getParameterTypes()) &&
        leftSig.getReturnType() === rightSig.getReturnType() &&
        leftSig.isStatic() === rightSig.isStatic()) {
        return true;
    }
    return false;
}
function classSignatureCompare(leftSig, rightSig) {
    if (fileSignatureCompare(leftSig.getDeclaringFileSignature(), rightSig.getDeclaringFileSignature()) && leftSig.getClassName() === rightSig.getClassName()) {
        return true;
    }
    return false;
}
function fileSignatureCompare(leftSig, rightSig) {
    if (leftSig.getFileName() === rightSig.getFileName() && leftSig.getProjectName() === rightSig.getProjectName()) {
        return true;
    }
    return false;
}
function arrayCompare(leftArray, rightArray) {
    if (leftArray.length !== rightArray.length) {
        return false;
    }
    for (let i = 0; i < leftArray.length; i++) {
        if (leftArray[i] !== rightArray[i]) {
            return false;
        }
    }
    return true;
}
function genSignature4ImportClause(arkFileName, importClauseName) {
    return `<${arkFileName}>.<${importClauseName}>`;
}
//# sourceMappingURL=ArkSignature.js.map