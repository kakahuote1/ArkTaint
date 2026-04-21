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
exports.ArkSignatureBuilder = void 0;
const ArkSignature_1 = require("../ArkSignature");
const Type_1 = require("../../base/Type");
class ArkSignatureBuilder {
    static buildMethodSignatureFromClassNameAndMethodName(className, methodName, staticFlag = false) {
        const classSignature = this.buildClassSignatureFromClassName(className);
        const methodSubSignature = this.buildMethodSubSignatureFromMethodName(methodName, staticFlag);
        return new ArkSignature_1.MethodSignature(classSignature, methodSubSignature);
    }
    static buildMethodSignatureFromMethodName(methodName, staticFlag = false) {
        const methodSubSignature = this.buildMethodSubSignatureFromMethodName(methodName, staticFlag);
        return new ArkSignature_1.MethodSignature(ArkSignature_1.ClassSignature.DEFAULT, methodSubSignature);
    }
    static buildMethodSubSignatureFromMethodName(methodName, staticFlag = false) {
        return new ArkSignature_1.MethodSubSignature(methodName, [], Type_1.UnknownType.getInstance(), staticFlag);
    }
    static buildClassSignatureFromClassName(className) {
        return new ArkSignature_1.ClassSignature(className, ArkSignature_1.FileSignature.DEFAULT);
    }
    static buildFieldSignatureFromFieldName(fieldName, staticFlag = false) {
        return new ArkSignature_1.FieldSignature(fieldName, ArkSignature_1.ClassSignature.DEFAULT, Type_1.UnknownType.getInstance(), staticFlag);
    }
}
exports.ArkSignatureBuilder = ArkSignatureBuilder;
