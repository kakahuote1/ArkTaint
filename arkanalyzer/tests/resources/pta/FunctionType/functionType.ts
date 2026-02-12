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

namespace functionType {
    class Param {
        public name: string;
        public value: string;

        constructor(name: string, value: string) {
            this.name = name;
            this.value = value;
        }
    }

    class Test {
        public test(arg1: Param, arg2: Param): void {
            console.log('test', arg1, arg2);
        }

        public static testStatic(arg1: Param, arg2: Param): void {
            console.log('testStatic', arg1, arg2);
        }
    }

    function test(arg1: Param, arg2: Param): void {
        console.log('test', arg1, arg2);
    }

    function anonFunc(this: { name: string }, arg1: Param, arg2: Param): void {
        console.log(this.name, arg1, arg2);
    };
      
    const obj = { name: 'Alice' };

    function ptrInvoke1Call(heapObj1: Param, heapObj2: Param): void {
        let f1 = (arg1: Param, arg2: Param): void => {
            console.log('f1', arg1, arg2);
        };
        f1.call(null, heapObj1, heapObj2);
    }

    function ptrInvoke1Apply(heapObj1: Param, heapObj2: Param): void {
        let f1 = (arg1: Param, arg2: Param): void => {
            console.log('f1', arg1, arg2);
        };
        f1.apply(null, [heapObj1, heapObj2]);
    }

    function ptrInvoke1Bind(heapObj1: Param, heapObj2: Param): void {
        let f1 = (arg1: Param, arg2: Param): void => {
            console.log('f1', arg1, arg2);
        };
        const f1_new = f1.bind(null, heapObj1, heapObj2);
        f1_new();
    }

    function ptrInvoke2Call(heapObj1: Param, heapObj2: Param): void {
        let test_instance_1 = new Test();
        let f2 = test_instance_1.test;
        f2.call(test_instance_1, heapObj1, heapObj2);
    }

    function ptrInvoke2Apply(heapObj1: Param, heapObj2: Param): void {
        let test_instance_2 = new Test();
        let f2 = test_instance_2.test;
        f2.apply(test_instance_2, [heapObj1, heapObj2]);
    }

    function ptrInvoke2Bind(heapObj1: Param, heapObj2: Param): void {
        let test_instance = new Test();
        let f2 = test_instance.test;
        const f2_new = f2.bind(test_instance, heapObj1, heapObj2);
        f2_new();
    }

    function ptrInvoke2BindReturn(heapObj1: Param, heapObj2: Param): () => void {
        let test_instance = new Test();
        let f2 = test_instance.test;
        const f2_new = f2.bind(test_instance, heapObj1, heapObj2);
        return f2_new;
    }

    function ptrInvoke3Call(heapObj1: Param, heapObj2: Param): void {
        let f2 = Test.testStatic;
        f2.call(Test, heapObj1, heapObj2);
    }

    function ptrInvoke3Apply(heapObj1: Param, heapObj2: Param): void {
        let f2 = Test.testStatic;
        f2.apply(null, [heapObj1, heapObj2]);
    }

    function ptrInvoke3Bind(heapObj1: Param, heapObj2: Param): void {
        let test_instance = new Test();
        let f2 = Test.testStatic;
        const f2_new = f2.bind(test_instance, heapObj1, heapObj2);
        f2_new();
    }

    function ptrInvoke4Call(heapObj1: Param, heapObj2: Param): void {
        let f3 = test;
        f3.call(null, heapObj1, heapObj2);
    }

    function ptrInvoke4Apply(heapObj1: Param, heapObj2: Param): void {
        let f3 = test;
        f3.apply(null, [heapObj1, heapObj2]);
    }

    function ptrInvoke4Bind(heapObj1: Param, heapObj2: Param): void {
        let f3 = test;
        const f3_new = f3.bind(null, heapObj1, heapObj2);
        f3_new();
    }

    function ptrInvoke5Call(heapObj1: Param, heapObj2: Param): void {
        anonFunc.call(obj, heapObj1, heapObj2); // Alice
    }

    function ptrInvoke5Apply(heapObj1: Param, heapObj2: Param): void {
        anonFunc.apply(obj, [heapObj1, heapObj2]); // Alice
    }

    function ptrInvoke5Bind(heapObj1: Param, heapObj2: Param): void {
        const boundFunc = anonFunc.bind(obj, heapObj1, heapObj2);
        boundFunc(); // Alice
    }

    export function main(): void {
        let heapObj1 = new Param('name1', 'value1');
        let heapObj2 = new Param('name2', 'value2');

        ptrInvoke1Call(heapObj1, heapObj2);
        ptrInvoke1Apply(heapObj1, heapObj2);
        ptrInvoke1Bind(heapObj1, heapObj2);

        ptrInvoke2Call(heapObj1, heapObj2);
        ptrInvoke2Apply(heapObj1, heapObj2);
        ptrInvoke2Bind(heapObj1, heapObj2);
        let b = ptrInvoke2BindReturn(heapObj1, heapObj2);
        b();

        ptrInvoke3Call(heapObj1, heapObj2);
        ptrInvoke3Apply(heapObj1, heapObj2);
        ptrInvoke3Bind(heapObj1, heapObj2);

        ptrInvoke4Call(heapObj1, heapObj2);
        ptrInvoke4Apply(heapObj1, heapObj2);
        ptrInvoke4Bind(heapObj1, heapObj2);

        ptrInvoke5Call(heapObj1, heapObj2);
        ptrInvoke5Apply(heapObj1, heapObj2);
        ptrInvoke5Bind(heapObj1, heapObj2);
    }
}