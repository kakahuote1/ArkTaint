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
exports.RefEqual = exports.LocalEqual = exports.getRecallMethodInParam = exports.INTERNAL_SINK_METHOD = exports.INTERNAL_PARAMETER_SOURCE = void 0;
const Type_1 = require("../base/Type");
const Ref_1 = require("../base/Ref");
exports.INTERNAL_PARAMETER_SOURCE = ['@ohos.app.ability.Want.d.ts: Want'];
exports.INTERNAL_SINK_METHOD = [
    'console.<@%unk/%unk: .log()>',
    'console.<@%unk/%unk: .error()>',
    'console.<@%unk/%unk: .info()>',
    'console.<@%unk/%unk: .warn()>',
    'console.<@%unk/%unk: .assert()>',
];
function getRecallMethodInParam(stmt) {
    var _a;
    for (const param of stmt.getInvokeExpr().getArgs()) {
        if (param.getType() instanceof Type_1.FunctionType) {
            const methodSignature = param.getType().getMethodSignature();
            const method = (_a = stmt.getCfg()) === null || _a === void 0 ? void 0 : _a.getDeclaringMethod().getDeclaringArkClass().getMethod(methodSignature);
            if (method) {
                return method;
            }
        }
    }
    return null;
}
exports.getRecallMethodInParam = getRecallMethodInParam;
function LocalEqual(local1, local2) {
    var _a, _b, _c, _d;
    if (local1.getName() === 'this' && local2.getName() === 'this') {
        return true;
    }
    const method1 = (_b = (_a = local1.getDeclaringStmt()) === null || _a === void 0 ? void 0 : _a.getCfg()) === null || _b === void 0 ? void 0 : _b.getDeclaringMethod();
    const method2 = (_d = (_c = local2.getDeclaringStmt()) === null || _c === void 0 ? void 0 : _c.getCfg()) === null || _d === void 0 ? void 0 : _d.getDeclaringMethod();
    const nameEqual = local1.getName() === local2.getName();
    return method1 === method2 && nameEqual;
}
exports.LocalEqual = LocalEqual;
function RefEqual(ref1, ref2) {
    if (ref1 instanceof Ref_1.ArkStaticFieldRef && ref2 instanceof Ref_1.ArkStaticFieldRef) {
        return ref1.getFieldSignature().toString() === ref2.getFieldSignature().toString();
    }
    else if (ref1 instanceof Ref_1.ArkInstanceFieldRef && ref2 instanceof Ref_1.ArkInstanceFieldRef) {
        return LocalEqual(ref1.getBase(), ref2.getBase()) && ref1.getFieldSignature().toString() === ref2.getFieldSignature().toString();
    }
    return false;
}
exports.RefEqual = RefEqual;
