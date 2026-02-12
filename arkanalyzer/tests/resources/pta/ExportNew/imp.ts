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

import et from './exp'
import et2 from './exp2'
import { Du } from './exp'

class ImportTest {
    obj: Du = et.obj;
    obj2: Du = et2.obj;
}

function main(): void {
    test1();
    test2();
    test3();
}

function test1(): void {
    let lo = et;
    let lo2 = et2;
    lo.foo();
    lo2.foo();
}

function test2(): void {
    let lo2 = new ImportTest()
    let x = lo2.obj;
    let y = lo2.obj2;
}

function test3(): void {
    et.foo();
    et2.foo();
}