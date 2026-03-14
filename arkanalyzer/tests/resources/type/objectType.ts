/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
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

class ClassA {
    fieldA: Object = {a: 1};

    hasA(): string {
        return this.fieldA.toLocaleString();
    }

    keys(): void {
        Object.keys(this.fieldA);
    }
}

function foo(obj: Object): Object {
    Object.keys(obj);
    obj.toLocaleString();
    return obj;
}

const emptyObj = new Object();
let a = foo(emptyObj);

type newObject = Object;
const newEmptyObj: newObject = Object.create(Object.prototype);
let b = foo(newEmptyObj);
