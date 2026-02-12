/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
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

function main() {
    const b = 2;
    const c = { c1: 3, c2: 4 };

    const obj = {
        a: 1,
        b,
        ...c,
        method() {
            console.log('method');
        },
        _value: 0,
        get accessor() {
            return 'getter';
        },
        set accessor(value) {
            console.log('setter', value);
        }
    };

    console.log(obj);
    obj.method();
    console.log(obj.accessor);
    obj.accessor = 'new value';
    console.log(obj.accessor);
}

main();
