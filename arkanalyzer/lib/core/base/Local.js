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
exports.Local = void 0;
const Type_1 = require("./Type");
const TypeInference_1 = require("../common/TypeInference");
const ArkExport_1 = require("../model/ArkExport");
const ArkSignature_1 = require("../model/ArkSignature");
const ArkSignatureBuilder_1 = require("../model/builder/ArkSignatureBuilder");
const Const_1 = require("../common/Const");
const ArkBaseModel_1 = require("../model/ArkBaseModel");
const ModelUtils_1 = require("../common/ModelUtils");
const TSConst_1 = require("../common/TSConst");
/**
 * @category core/base
 */
class Local {
    constructor(name, type = Type_1.UnknownType.getInstance()) {
        this.name = name;
        this.type = type;
        this.originalValue = null;
        this.declaringStmt = null;
        this.usedStmts = [];
    }
    inferType(arkMethod) {
        var _a, _b;
        if (this.name === TSConst_1.THIS_NAME && this.type instanceof Type_1.UnknownType) {
            const declaringArkClass = arkMethod.getDeclaringArkClass();
            this.type = new Type_1.ClassType(declaringArkClass.getSignature(), declaringArkClass.getRealTypes());
        }
        else if (!this.name.startsWith(Const_1.NAME_PREFIX) && TypeInference_1.TypeInference.isUnclearType(this.type)) {
            const type = (_a = TypeInference_1.TypeInference.inferBaseType(this.name, arkMethod.getDeclaringArkClass())) !== null && _a !== void 0 ? _a : (_b = ModelUtils_1.ModelUtils.findDeclaredLocal(this, arkMethod)) === null || _b === void 0 ? void 0 : _b.getType();
            if (type) {
                this.type = type;
            }
        }
        if (this.type instanceof Type_1.FunctionType) {
            this.type.getMethodSignature().getMethodSubSignature().getParameters()
                .forEach(p => TypeInference_1.TypeInference.inferParameterType(p, arkMethod));
            TypeInference_1.TypeInference.inferSignatureReturnType(this.type.getMethodSignature(), arkMethod);
        }
        return this;
    }
    /**
     * Returns the name of local value.
     * @returns The name of local value.
     * @example
     * 1. get the name of local value.

     ```typescript
     arkClass.getDefaultArkMethod()?.getBody().getLocals().forEach(local => {
     const arkField = new ArkField();
     arkField.setFieldType(ArkField.DEFAULT_ARK_Field);
     arkField.setDeclaringClass(defaultClass);
     arkField.setType(local.getType());
     arkField.setName(local.getName());
     arkField.genSignature();
     defaultClass.addField(arkField);
     });
     ```
     */
    getName() {
        return this.name;
    }
    setName(name) {
        this.name = name;
    }
    /**
     * Returns the type of this local.
     * @returns The type of this local.
     */
    getType() {
        return this.type;
    }
    setType(newType) {
        this.type = newType;
    }
    getOriginalValue() {
        return this.originalValue;
    }
    setOriginalValue(originalValue) {
        this.originalValue = originalValue;
    }
    /**
     * Returns the declaring statement, which may also be a **null**.
     * For example, if the code snippet in a function is `let dd = cc + 5;` where `cc` is a **number**
     * and `dd` is not defined before, then the declaring statemet of local `dd`:
     * - its **string** text is "dd = cc + 5".
     * - the **strings** of right operand and left operand are "cc + 5" and "dd", respectively.
     * - three values are used in this statement: `cc + 5` (i.e., a normal binary operation expression), `cc` (a local), and `5` (a constant), respectively.
     * @returns The declaring statement (maybe a **null**) of the local.
     * @example
     * 1. get the statement that defines the local for the first time.

     ```typescript
     let stmt = local.getDeclaringStmt();
     if (stmt !== null) {
     ...
     }
     ```
     */
    getDeclaringStmt() {
        return this.declaringStmt;
    }
    setDeclaringStmt(declaringStmt) {
        this.declaringStmt = declaringStmt;
    }
    /**
     * Returns an **array** of values which are contained in this local.
     * @returns An **array** of values used by this local.
     */
    getUses() {
        return [];
    }
    addUsedStmt(usedStmt) {
        this.usedStmts.push(usedStmt);
    }
    /**
     * Returns an array of statements used by the local, i.e., the statements in which the local participate.
     * For example, if the code snippet is `let dd = cc + 5;` where `cc` is a local and `cc` only appears once,
     * then the length of **array** returned is 1 and `Stmts[0]` will be same as the example described
     * in the `Local.getDeclaringStmt()`.
     * @returns An array of statements used by the local.
     */
    getUsedStmts() {
        return this.usedStmts;
    }
    /**
     * Get a string of local name in Local
     * @returns The string of local name.
     * @example
     * 1. get a name string.

     ```typescript
     for (const value of stmt.getUses()) {
     const name = value.toString();
     ...
     }
     ```
     */
    toString() {
        return this.getName();
    }
    getExportType() {
        return ArkExport_1.ExportType.LOCAL;
    }
    getModifiers() {
        return 0;
    }
    containsModifier(modifierType) {
        if (modifierType === ArkBaseModel_1.ModifierType.CONST) {
            return this.getConstFlag();
        }
        return false;
    }
    getSignature() {
        var _a;
        return ((_a = this.signature) !== null && _a !== void 0 ? _a : new ArkSignature_1.LocalSignature(this.name, new ArkSignature_1.MethodSignature(ArkSignature_1.ClassSignature.DEFAULT, ArkSignatureBuilder_1.ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(Const_1.UNKNOWN_METHOD_NAME))));
    }
    setSignature(signature) {
        this.signature = signature;
    }
    getConstFlag() {
        if (!this.constFlag) {
            return false;
        }
        return this.constFlag;
    }
    setConstFlag(newConstFlag) {
        this.constFlag = newConstFlag;
    }
}
exports.Local = Local;
