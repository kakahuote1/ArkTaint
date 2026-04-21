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

class StaticFieldA {
    static s_f1() {
    };

    f2() {
    };

    static s_v1: number = 1;
    v2: number = 2;
}

class StaticUserB {
    f1() {
        console.log(StaticFieldA.s_v1);
        StaticFieldA.s_f1();
        const a: StaticFieldA = new StaticFieldA();
        console.log(a.v2);
        a.f2();
    }

    a: StaticFieldA;
}

class C {
    b: StaticUserB;

    cf(): void {
        new StaticFieldA().f2();
        new StaticUserB().f1();
        this.b.f1();
        this.b.a.f2();

    }

}

export {}

class Test {
    public a = this.pass();

    public pass() {
        return new C();
    }

    constructor() {
        console.log('123');
    }
}

const d = new Test();
let b = d.pass();

declare namespace outer {
    namespace inner {
        class TestClass {
            static request(): void;
        }
    }
}

function testDoubleNamespace(): void {
    outer.inner.TestClass.request();
}

type responseType = 'string' | 'object';

function responseType(type: responseType): void {
    if (d instanceof Test) {
        console.log('yes');
    }
}