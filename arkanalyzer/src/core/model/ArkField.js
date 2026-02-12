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
exports.ArkField = exports.FieldCategory = void 0;
const Position_1 = require("../base/Position");
const ArkClass_1 = require("./ArkClass");
const ArkBaseModel_1 = require("./ArkBaseModel");
var FieldCategory;
(function (FieldCategory) {
    FieldCategory[FieldCategory["PROPERTY_DECLARATION"] = 0] = "PROPERTY_DECLARATION";
    FieldCategory[FieldCategory["PROPERTY_ASSIGNMENT"] = 1] = "PROPERTY_ASSIGNMENT";
    FieldCategory[FieldCategory["SHORT_HAND_PROPERTY_ASSIGNMENT"] = 2] = "SHORT_HAND_PROPERTY_ASSIGNMENT";
    FieldCategory[FieldCategory["SPREAD_ASSIGNMENT"] = 3] = "SPREAD_ASSIGNMENT";
    FieldCategory[FieldCategory["PROPERTY_SIGNATURE"] = 4] = "PROPERTY_SIGNATURE";
    FieldCategory[FieldCategory["ENUM_MEMBER"] = 5] = "ENUM_MEMBER";
    FieldCategory[FieldCategory["INDEX_SIGNATURE"] = 6] = "INDEX_SIGNATURE";
    FieldCategory[FieldCategory["GET_ACCESSOR"] = 7] = "GET_ACCESSOR";
    FieldCategory[FieldCategory["PARAMETER_PROPERTY"] = 8] = "PARAMETER_PROPERTY";
})(FieldCategory || (exports.FieldCategory = FieldCategory = {}));
/**
 * @category core/model
 */
class ArkField extends ArkBaseModel_1.ArkBaseModel {
    constructor() {
        super();
        this.code = '';
        this.questionToken = false;
        this.exclamationToken = false;
        this.initializer = [];
    }
    /**
     * Returns the program language of the file where this field's class defined.
     */
    getLanguage() {
        return this.getDeclaringArkClass().getLanguage();
    }
    getDeclaringArkClass() {
        return this.declaringClass;
    }
    setDeclaringArkClass(declaringClass) {
        this.declaringClass = declaringClass;
    }
    /**
     * Returns the codes of field as a **string.**
     * @returns the codes of field.
     */
    getCode() {
        return this.code;
    }
    setCode(code) {
        this.code = code;
    }
    getCategory() {
        return this.category;
    }
    setCategory(category) {
        this.category = category;
    }
    getName() {
        return this.fieldSignature.getFieldName();
    }
    getType() {
        return this.fieldSignature.getType();
    }
    getSignature() {
        return this.fieldSignature;
    }
    setSignature(fieldSig) {
        this.fieldSignature = fieldSig;
    }
    /**
     * Returns an array of statements used for initialization.
     * @returns An array of statements used for initialization.
     */
    getInitializer() {
        return this.initializer;
    }
    setInitializer(initializer) {
        this.initializer = initializer;
    }
    setQuestionToken(questionToken) {
        this.questionToken = questionToken;
    }
    setExclamationToken(exclamationToken) {
        this.exclamationToken = exclamationToken;
    }
    getQuestionToken() {
        return this.questionToken;
    }
    getExclamationToken() {
        return this.exclamationToken;
    }
    setOriginPosition(position) {
        this.originPosition = position;
    }
    /**
     * Returns the original position of the field at source code.
     * @returns The original position of the field at source code.
     */
    getOriginPosition() {
        return this.originPosition ?? Position_1.LineColPosition.DEFAULT;
    }
    validate() {
        return this.validateFields(['category', 'declaringClass', 'fieldSignature']);
    }
    // For class field, it is default public if there is not any access modify
    isPublic() {
        if (!this.containsModifier(ArkBaseModel_1.ModifierType.PUBLIC) &&
            !this.containsModifier(ArkBaseModel_1.ModifierType.PRIVATE) &&
            !this.containsModifier(ArkBaseModel_1.ModifierType.PROTECTED) &&
            (this.getDeclaringArkClass().getCategory() === ArkClass_1.ClassCategory.CLASS ||
                this.getDeclaringArkClass().getCategory() === ArkClass_1.ClassCategory.INTERFACE ||
                this.getDeclaringArkClass().getCategory() === ArkClass_1.ClassCategory.OBJECT)) {
            return true;
        }
        return this.containsModifier(ArkBaseModel_1.ModifierType.PUBLIC);
    }
}
exports.ArkField = ArkField;
//# sourceMappingURL=ArkField.js.map