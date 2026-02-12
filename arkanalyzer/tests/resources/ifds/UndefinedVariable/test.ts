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

import { im } from './test2';

export class property{
    pp=1;
}
class t{
    static s:property;
    p:property;
    constructor(){
    }
    static sm(){
        console.log(this.s.pp);
        console.log(t.s.pp);
    }
    method(){
        console.log(t.s);
    }
    print(){
        console.log(this.p.pp);
    }
}

function u1(): void {
    let t1 = getUndefined();
    printUndefined(t1);
}

function u2(): void {
    let t1 = new t();
    t1.print();
}

function u3(): void {
    let t1 = new t();
    print(t1);
}

function u4(): void {
    [0, 1].forEach(() => {
        let t1 = new t();
        t1.print();
    });
}

function getUndefined(): undefined {
    return undefined;
}

function printUndefined(tp: t | undefined): void {
    if (tp) {
        tp.print();
    }
}

function print(tp:t): void {
    console.log(tp.p.pp);
}