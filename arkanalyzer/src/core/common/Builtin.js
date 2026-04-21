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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Builtin = void 0;
const ArkSignature_1 = require("../model/ArkSignature");
const Type_1 = require("../base/Type");
const ArkClass_1 = require("../model/ArkClass");
class Builtin {
    static buildBuiltInClasses() {
        const builtInClasses = new Set();
        builtInClasses.add(this.OBJECT);
        builtInClasses.add(this.ARRAY);
        builtInClasses.add(this.SET);
        builtInClasses.add(this.MAP);
        builtInClasses.add(this.REGEXP);
        return builtInClasses;
    }
    static buildBuiltInClassesFileSignature() {
        return new ArkSignature_1.FileSignature(this.DUMMY_PROJECT_NAME, this.DUMMY_FILE_NAME);
    }
    static buildBuiltInClassSignature(className) {
        return new ArkSignature_1.ClassSignature(className, this.BUILT_IN_CLASSES_FILE_SIGNATURE);
    }
    static buildBuiltInClassSignatureMap() {
        const builtInClassSignatureMap = new Map();
        builtInClassSignatureMap.set(this.OBJECT, this.OBJECT_CLASS_SIGNATURE);
        builtInClassSignatureMap.set(this.ARRAY, this.ARRAY_CLASS_SIGNATURE);
        builtInClassSignatureMap.set(this.SET, this.SET_CLASS_SIGNATURE);
        builtInClassSignatureMap.set(this.MAP, this.MAP_CLASS_SIGNATURE);
        builtInClassSignatureMap.set(this.REGEXP, this.REGEXP_CLASS_SIGNATURE);
        return builtInClassSignatureMap;
    }
    static isBuiltinClass(className) {
        return this.BUILT_IN_CLASSES.has(className);
    }
    static buildArrayMethodSignature(methodName, scene) {
        let methodSignature = this.getBuiltInMethodSignature(_a.ARRAY, methodName, scene);
        if (!methodSignature) {
            methodSignature = new ArkSignature_1.MethodSignature(_a.ARRAY_CLASS_SIGNATURE, new ArkSignature_1.MethodSubSignature(methodName, [], Type_1.UnknownType.getInstance(), false));
        }
        return methodSignature;
    }
    static getBuiltInMethodSignature(className, methodName, scene) {
        const globalClass = scene.getSdkGlobal(className);
        if (globalClass instanceof ArkClass_1.ArkClass) {
            return globalClass.getMethodWithName(methodName)?.getSignature();
        }
        return undefined;
    }
}
exports.Builtin = Builtin;
_a = Builtin;
// built-in classes
// TODO: Automatically obtain from the standard library
Builtin.OBJECT = 'Object';
Builtin.ARRAY = 'Array';
Builtin.SET = 'Set';
Builtin.MAP = 'Map';
Builtin.REGEXP = 'RegExp';
Builtin.BIGINT = 'BigInt';
Builtin.FUNCTION = 'Function';
Builtin.BUILT_IN_CLASSES = _a.buildBuiltInClasses();
// signature for built-in class
Builtin.DUMMY_PROJECT_NAME = 'ES2015';
Builtin.DUMMY_FILE_NAME = 'BuiltinClass';
Builtin.BUILT_IN_CLASSES_FILE_SIGNATURE = _a.buildBuiltInClassesFileSignature();
Builtin.OBJECT_CLASS_SIGNATURE = _a.buildBuiltInClassSignature(_a.OBJECT);
Builtin.OBJECT_CLASS_TYPE = new Type_1.ClassType(_a.OBJECT_CLASS_SIGNATURE);
Builtin.ARRAY_CLASS_SIGNATURE = _a.buildBuiltInClassSignature(_a.ARRAY);
Builtin.SET_CLASS_SIGNATURE = _a.buildBuiltInClassSignature(_a.SET);
Builtin.MAP_CLASS_SIGNATURE = _a.buildBuiltInClassSignature(_a.MAP);
Builtin.REGEXP_CLASS_SIGNATURE = _a.buildBuiltInClassSignature(_a.REGEXP);
Builtin.REGEXP_CLASS_TYPE = new Type_1.ClassType(_a.REGEXP_CLASS_SIGNATURE);
Builtin.BUILT_IN_CLASS_SIGNATURE_MAP = _a.buildBuiltInClassSignatureMap();
// constants for iterator
Builtin.ITERATOR_FUNCTION = 'Symbol.iterator';
Builtin.ITERATOR = 'IterableIterator';
Builtin.ITERATOR_NEXT = 'next';
Builtin.ITERATOR_RESULT = 'IteratorResult';
Builtin.ITERATOR_RESULT_DONE = 'done';
Builtin.ITERATOR_RESULT_VALUE = 'value';
Builtin.ITERATOR_CLASS_SIGNATURE = _a.buildBuiltInClassSignature(_a.ITERATOR);
Builtin.ITERATOR_RESULT_CLASS_SIGNATURE = _a.buildBuiltInClassSignature(_a.ITERATOR_RESULT);
Builtin.ITERATOR_CLASS_TYPE = new Type_1.ClassType(_a.ITERATOR_CLASS_SIGNATURE, [new Type_1.GenericType('T')]);
Builtin.ITERATOR_RESULT_CLASS_TYPE = new Type_1.ClassType(_a.ITERATOR_RESULT_CLASS_SIGNATURE, [new Type_1.GenericType('T')]);
// constants for string
Builtin.TO_STRING = 'toString';
Builtin.TO_STRING_METHOD_SIGNATURE = new ArkSignature_1.MethodSignature(ArkSignature_1.ClassSignature.DEFAULT, new ArkSignature_1.MethodSubSignature(_a.TO_STRING, [], Type_1.StringType.getInstance(), false));
// constants for array
Builtin.SLICE = 'slice';
Builtin.CONCAT = 'concat';
//# sourceMappingURL=Builtin.js.map