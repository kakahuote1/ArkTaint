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

// Common Syntax
interface Updatable {
    [key: string]: number;
}

interface Serializable {
    toString(): string;
}

class Account {
    id: string;

    constructor(id: string) {
        this.id = id;
    }
}

class User extends Account implements Updatable, Serializable {
    displayName?: boolean;
    name!: string;
    #attributes: Map<any, any>;
    roles = ['user'];
    selectIndex: number = 0;
    role: string = this.roles[this.selectIndex];
    readonly createdAt = new Date();

    constructor(id: string, name: string) {
        super(id);
        this.name = name;
    }

    setName(name: string) {
        this.name = name;
    }

    verifyName = (name: string) => {

    }

 
    sync(cb: ((result: string) => void)): void {

    }

    get accountID() {
        return this.id;
    }

    set accountID(value: string) {
        this.id = value;
    }

    private makeRequest() {

    }

    protected handleRequest() {

    }

    static #userCount = 0;
    static registerUser(user: User) {

    }

    static {
        this.#userCount = -1;
    }
}

class GenericsTestCase2<Type> {
    content: Type;

    constructor(value: Type) {
        this.content = value;
    }
}

const testcase2 = new GenericsTestCase2('test');

class ParameterPropertiesTestCase3 {
    constructor(public x: number, public y: number) {

    }
}

const testcase3 = new ParameterPropertiesTestCase3(20, 40);
console.log(testcase3.x, testcase3.y);

abstract class Animal {
    abstract getName(): string;

    printName() {
        console.log('hello,' + this.getName());
    }
}

class Dog extends Animal {
    getName(): string {
        return 'Dog';
    }
}