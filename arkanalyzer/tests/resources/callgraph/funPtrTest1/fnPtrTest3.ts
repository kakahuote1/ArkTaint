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

namespace FnPtrTest3 {
    interface Trait {
        f(): void;
        g(): void;
    }

    class MyStruct implements Trait{
        private s: string;
        constructor(i: string) {
            this.s = i;
        }

        static foo() { }
        bar() {
            console.log(`in bar(), this.s is ${this.s}`)
         }
        gen<T>(t: T): T {
            console.log(`in gen(${t}) `)
            return t;
        }

        f() {}
        g() {}
    }

    function times2(value: number): number {
        return 2 * value;
    }

    function id<T>(t: T): T {
        return t;
    }

    export function main() {
        let fp1: (value: number) => number = times2;
        fp1(2);

        let fp2: (t: number) => number = id;
        fp2(2);

        let fp3: () => void = MyStruct.foo;
        fp3();

        let m = new MyStruct('');
        let fp4: (this: MyStruct) => void = MyStruct.prototype.bar;
        fp4.call(m);

        let fp4_2: () => void = MyStruct.prototype.bar;
        fp4_2.call(m);

        let fp5: (t: number) => number = MyStruct.prototype.gen;
        fp5.call(m, 2);

        let fp6: () => void = m.f;
        fp6.call(m);

        let fp6_2: () => void = m.f;
        fp6.call(m);

        let fp7: (t: number) => number = (t: number) => m.gen(t)
        let a = fp7(3)
    }
}
