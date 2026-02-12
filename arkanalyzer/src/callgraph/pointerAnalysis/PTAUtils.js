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
exports.MAP_FIELD_SIGNATURE = exports.SET_FIELD_SIGNATURE = exports.ARRAY_FIELD_SIGNATURE = exports.BuiltApiType = void 0;
exports.IsCollectionClass = IsCollectionClass;
exports.getBuiltInApiType = getBuiltInApiType;
const Type_1 = require("../../core/base/Type");
const ArkSignature_1 = require("../../core/model/ArkSignature");
function IsCollectionClass(classSignature) {
    if (classSignature.toString().endsWith('lib.es2015.collection.d.ts: Set') || classSignature.toString().endsWith('lib.es2015.collection.d.ts: Map')) {
        return true;
    }
    return false;
}
var BuiltApiType;
(function (BuiltApiType) {
    BuiltApiType[BuiltApiType["SetConstructor"] = 0] = "SetConstructor";
    BuiltApiType[BuiltApiType["MapConstructor"] = 1] = "MapConstructor";
    BuiltApiType[BuiltApiType["ArrayConstructor"] = 2] = "ArrayConstructor";
    BuiltApiType[BuiltApiType["SetAdd"] = 3] = "SetAdd";
    BuiltApiType[BuiltApiType["MapSet"] = 4] = "MapSet";
    BuiltApiType[BuiltApiType["MapGet"] = 5] = "MapGet";
    BuiltApiType[BuiltApiType["ArrayPush"] = 6] = "ArrayPush";
    BuiltApiType[BuiltApiType["Foreach"] = 7] = "Foreach";
    BuiltApiType[BuiltApiType["FunctionCall"] = 8] = "FunctionCall";
    BuiltApiType[BuiltApiType["FunctionApply"] = 9] = "FunctionApply";
    BuiltApiType[BuiltApiType["FunctionBind"] = 10] = "FunctionBind";
    BuiltApiType[BuiltApiType["NotBuiltIn"] = 11] = "NotBuiltIn";
})(BuiltApiType || (exports.BuiltApiType = BuiltApiType = {}));
exports.ARRAY_FIELD_SIGNATURE = new ArkSignature_1.FieldSignature('field', new ArkSignature_1.ClassSignature('Array', new ArkSignature_1.FileSignature('container', 'lib.es5.d.ts')), new Type_1.UnclearReferenceType(''));
exports.SET_FIELD_SIGNATURE = new ArkSignature_1.FieldSignature('field', new ArkSignature_1.ClassSignature('Set', new ArkSignature_1.FileSignature('container', 'lib.es2015.collection.d.ts')), new Type_1.UnclearReferenceType(''));
exports.MAP_FIELD_SIGNATURE = new ArkSignature_1.FieldSignature('field', new ArkSignature_1.ClassSignature('Map', new ArkSignature_1.FileSignature('container', 'lib.es2015.collection.d.ts')), new Type_1.UnclearReferenceType(''));
/**
 * register container built-in API patterns, these APIs will not be recognized as SDK APIs
 */
const BUILTIN_API_PATTERNS = new Map([
    // constructor
    ['lib.es2015.collection.d.ts: SetConstructor.construct-signature()', BuiltApiType.SetConstructor],
    ['lib.es2015.collection.d.ts: MapConstructor.construct-signature()', BuiltApiType.MapConstructor],
    ['lib.es5.d.ts: ArrayConstructor.construct-signature()', BuiltApiType.ArrayConstructor],
    // set
    ['lib.es2015.collection.d.ts: Set.add(T)', BuiltApiType.SetAdd],
    ['lib.es2015.collection.d.ts: Set.forEach(', BuiltApiType.Foreach],
    // map
    ['lib.es2015.collection.d.ts: Map.set(K, V)', BuiltApiType.MapSet],
    ['lib.es2015.collection.d.ts: Map.get(K)', BuiltApiType.MapGet],
    ['lib.es2015.collection.d.ts: Map.forEach(', BuiltApiType.Foreach],
    // array
    ['lib.es5.d.ts: Array.push(T[])', BuiltApiType.ArrayPush],
    ['lib.es5.d.ts: Array.forEach(', BuiltApiType.Foreach],
]);
const FUNCTION_METHOD_REGEX = /lib\.es5\.d\.ts: Function\.(call|apply|bind)\(/;
const FUNCTION_METHOD_MAP = {
    'call': BuiltApiType.FunctionCall,
    'apply': BuiltApiType.FunctionApply,
    'bind': BuiltApiType.FunctionBind
};
function getBuiltInApiType(method) {
    let methodSigStr = method.toString();
    for (const [pattern, apiType] of BUILTIN_API_PATTERNS.entries()) {
        const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedPattern);
        if (regex.test(methodSigStr)) {
            return apiType;
        }
    }
    const match = methodSigStr.match(FUNCTION_METHOD_REGEX);
    if (match && match.length > 1) {
        const functionName = match[1];
        if (functionName in FUNCTION_METHOD_MAP) {
            return FUNCTION_METHOD_MAP[functionName];
        }
    }
    return BuiltApiType.NotBuiltIn;
}
//# sourceMappingURL=PTAUtils.js.map