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

class Tclass {
    value: number;
    t: Tclass;
    func() {
        sink(this.t);
    }
}

function source(): Tclass{
    return new Tclass();
}
function sink(t: Tclass){}

function T1() {
    let t = new Tclass();
    t.t = source();
    t.func();
}

function source2(): Tclass{
    return new Tclass();
}
function sink2(t: Tclass){}

function tiantIt(inn: Tclass, out: Tclass) {
    let x = out;
    x.t = inn;
    sink(x.t);
}


function T2() {
    let t1 = new Tclass(), t2 = new Tclass();
    tiantIt(source(), t1);
    sink(t1.t);
}