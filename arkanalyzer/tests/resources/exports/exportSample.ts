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

import { cc } from './test';
import dfs, { something } from './else';
import { Constants } from './api';

export * as z from './test'; //kind 278

export let blah = 'test';

const a = 1;
const b = 'a';
export { a, b };

export function testing() {
    something();
    cc();
}

export { testing as testing2 };

export const c = '';

export interface MyInterface {

}

type s = object;

export type MyType = string;

export declare namespace MyNameSpace {
    export { write };

    export function doa(): Constants;
}

declare function write(): void;

export class d extends dfs {

    public dos() {

    }

}

let l = 2.1;

class ThrowTest {
    static readonly ERR = 'throw err';

    throws() {
        throw new Error(ThrowTest.ERR);
    }
}

export default new ThrowTest();

export namespace ComponentService {

    export type Constructor<T> = {
        new(): T;
        readonly prototype: T;
    }

    export function register<T extends ComponentService.Constructor<MyInterface>>(clazz: T): T {
        return clazz;
    }

    class Box<T = string> {
        private t: T;
        constructor() {}

        set(value: T) {
            this.t = value;
        }

        get(): T {
            return this.t;
        }
    }

    function testGeneric(){
        const myDox = new Box();
        let string = myDox.get();
        const yourDox = new Box<number>();
        let number = yourDox.get();
    }
}

export let arr = [1, 2, 3, 4];