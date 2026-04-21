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

class A {
    static a: string[] = ['a', 'b', 'c'];
    static b: number[] = [0, 1, 2];
}

function foo() : string {
    let index = A.b.indexOf(1);
    return A.a[index];
}

let globalIndex = 2;
function goo(): void {
    let item = A.a[globalIndex];
}

let arr = [1, 2, 3];
class Assign2ArrayItem {
    foo(): void {
        const a = 1;
        arr[a] = 2;
        let b = 3;
        arr[b++] = 4;
        let c = 5;
        arr[c + 1] = 6;
    }
}

class IndexWithConstant {
    foo(): void {
        let item = arr[1.0];
        arr[2.0] = 3;
        arr[1.3];
        arr[2.2] = 2;
    }
}