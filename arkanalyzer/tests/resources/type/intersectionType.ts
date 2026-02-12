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

type IntersectionType = string & number & void;
type ComplicatedType = string | ((number & any) & (string | void));

interface IA {
    a: number;
}

interface IB {
    a: string;
}

type IC = IA & IB; // 这里IA的a属性类型与IB的a属性类型冲突，IC的a属性类型实际为never

type A = {
    name: string;
    age: number;
};

type B = {
    name: string;
    gender: 'male' | 'female';
};

type C = A & B;

type Person = {
    name: string;
    age: number;
};

type Employee = Person & {
    employeeId: number;
};

abstract class CanEat {
    abstract eat(): string;
}

class CanSleep {
    sleep(): string {
        return 'Sleep...';
    }
}

type CanEatAndSleep = CanEat & CanSleep;

let student: A & B = {
    name: 'abc',
    age: 12,
    gender: 'male'
};

function animal(property: CanEat & CanSleep): A & B {
    property.eat();
    property.sleep();
    return {
        name: 'abc',
        age: 12,
        gender: 'male'
    };
}

class Inter {
    private fieldA: string & number;
    fieldB: A & B;
    static fieldC: Employee & (number | boolean);
}