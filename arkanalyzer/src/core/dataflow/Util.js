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
exports.INTERNAL_SINK_METHOD = exports.INTERNAL_PARAMETER_SOURCE = void 0;
exports.getRecallMethodInParam = getRecallMethodInParam;
exports.LocalEqual = LocalEqual;
exports.RefEqual = RefEqual;
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
    for (const param of stmt.getInvokeExpr().getArgs()) {
        if (param.getType() instanceof Type_1.FunctionType) {
            const methodSignature = param.getType().getMethodSignature();
            const method = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass().getMethod(methodSignature);
            if (method) {
                return method;
            }
        }
    }
    return null;
}
function LocalEqual(local1, local2) {
    if (local1.getName() === 'this' && local2.getName() === 'this') {
        return true;
    }
    const method1 = local1.getDeclaringStmt()?.getCfg()?.getDeclaringMethod();
    const method2 = local2.getDeclaringStmt()?.getCfg()?.getDeclaringMethod();
    const nameEqual = local1.getName() === local2.getName();
    return method1 === method2 && nameEqual;
}
function RefEqual(ref1, ref2) {
    if (ref1 instanceof Ref_1.ArkStaticFieldRef && ref2 instanceof Ref_1.ArkStaticFieldRef) {
        return ref1.getFieldSignature().toString() === ref2.getFieldSignature().toString();
    }
    else if (ref1 instanceof Ref_1.ArkInstanceFieldRef && ref2 instanceof Ref_1.ArkInstanceFieldRef) {
        return LocalEqual(ref1.getBase(), ref2.getBase()) && ref1.getFieldSignature().toString() === ref2.getFieldSignature().toString();
    }
    return false;
}
//# sourceMappingURL=Util.js.map