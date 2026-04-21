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

import { configure, getLogger } from 'log4js';

configure({
    appenders: {
        console: {
            type: 'console',
            layout: {
                type: 'pattern',
                pattern: '[%d] [%p] [%z] [ArkAnalyzer] - %m',
            },
        },
    },
    categories: {
        default: {
            appenders: ['console'],
            level: 'info',
            enableCallStack: false,
        },
    },
});
const logger = getLogger();

function forLoopTest() {
    let myPerson = new Person(10);
    for (let i = 0; i < 10; i++) {
        let newAge = myPerson.age + i;
        logger.info(newAge);
    }
}

function controlTest() {
    const sampleData: number[] = [1, 2, 3, 4, 5];

    for (let i = 0; i < sampleData.length; i++) {
        // 使用 if 判断
        if (sampleData[i] % 2 === 0) {
            logger.info(`${sampleData[i]} 是偶数`);
        } else {
            logger.info(`${sampleData[i]} 是奇数`);
        }
        // 使用 while 循环
        let count = 0;
        while (count < sampleData[i]) {
            logger.info(`当前计数: ${count}`);
            count++;
        }

        // 使用 for 循环和 continue
        for (let j = 0; j < 5; j++) {
            if (j === 2) {
                continue; // 跳过本次循环的剩余代码，进入下一次循环
            }
            logger.info(`当前内层循环计数: ${j}`);
        }

        // 使用 break 终止循环
        for (let k = 0; k < 3; k++) {
            logger.info(`外层循环计数: ${k}`);
            logger.info('Department name: ' + k);
            if (k === 1) {
                break; // 终止整个循环
            }
        }
    }
}

class Person {
    x: number = 0;

    constructor(public age: number) {}
    growOld = () => {
        this.age++;
    };

    public getAge() {
        return this.age;
    }

    static wooooof() {
        logger.info('not a person sound');
    }
}

export function classMethodTest() {
    let notPerson = new Person(10);
    let x = new Map();
    let z = new Error();
    let y = controlTest();
    let a = notPerson.age;
    notPerson.growOld();
    Person.wooooof();
}

interface Alarm {
    alert(): void;
}

interface Alarm2 {
    alert2(): void;
}

class Door {}

export function foo(x: number): number {
    var y: number = 0;
    for (let k = 0; k < x; k++) {
        y = y + k;
    }
    return y;
}

class Adder {
    constructor(public a: number) {}
    // This function is now safe to pass around
    add = (b: string): string => {
        return this.a + b;
    };
}

class ExtendedAdder extends Adder {
    // Create a copy of parent before creating our own
    private superAdd = this.add;
    // Now create our override
    add = (b: string): string => {
        return this.superAdd(b);
    };
}

export function listParameters(u: number, v: number, w: string): { x: number; y: number; z: string } {
    return { x: u, y: v, z: w };
}

export class SecurityDoor extends Door implements Alarm, Alarm2 {
    x: number = 0;
    y: string = '';
    z: Person = new Person(10);
    alert(): void {
        logger.info('SecurityDoor alert');
    }
    alert2(): void {
        logger.info('SecurityDoor alert2');
    }
    public Members = class {};
    public fooo() {
        logger.info('This is fooo!');
    }
    constructor(x: number, y: string) {
        super();
        this.x = x;
        this.y = y;
        logger.info('This is a constrctor!');
    }
}

const someClass = class<Type> {
    content: Type;
    constructor(value: Type) {
        this.content = value;
    }
};
const m = new someClass('Hello, world');

abstract class Animal {
    public name;
    public constructor(name: string) {
        this.name = name;
    }
    public abstract sayHi(): void;
}

function deleteTest() {
    let x: { a?: number; b: number[] } = { a: 42, b: [5, 100] };
    let bbb: number[] = x.b;
    delete x.a;
    delete bbb[0];
    logger.info(x);
    delete x;
}

async function* yieldTest() {
    yield 1;
    yield 2;
    yield 3;
}

const iterator = await yieldTest();

export default 123;
export let x: number = 1;
export const soo = 123;
export interface StringValidator {
    isAcceptable(s?: string): boolean;
    color?: string;
    width?: number;
}
export { ExtendedAdder as ExtAdder, ExtendedAdder };

forLoopTest();
controlTest();
deleteTest();

function dealColor(rRGB: number, gRGB: number, bRGB: number) {
    let max = Math.max(Math.max(rRGB, gRGB), bRGB);
    let min = Math.min(Math.min(rRGB, gRGB), bRGB);
    let bHSB = max / 255;
    let hHSB = 0;
    if (max === rRGB && gRGB >= bRGB) {
        hHSB = (60 * (gRGB - bRGB)) / (max - min) + 0;
    }
    if (max === rRGB && gRGB < bRGB) {
        hHSB = (60 * (gRGB - bRGB)) / (max - min) + 360;
    }
    if (max === gRGB) {
        hHSB = (60 * (bRGB - rRGB)) / (max - min) + 120;
    }
    if (max === bRGB) {
        hHSB = (60 * (rRGB - gRGB)) / (max - min) + 240;
    }

    if (bHSB >= 0.4) {
        bHSB = 0.3;
    } else if (bHSB >= 0.2) {
        bHSB -= 0.1;
    } else {
        bHSB = bHSB + 0.2;
    }
}

function specialString(text: string) {
    const lrcLineRegex: RegExp = new RegExp('\\[\\d{2,}:\\d{2}((\\.|:)\\d{2,})\\]', 'g');
    const lrcTimeRegex1: RegExp = new RegExp('\\[\\d{2,}', 'i');
    const lrcTimeRegex2: RegExp = new RegExp('\\d{2}\\.\\d{2,}', 'i');
    let lyric: string[] = text.split('\n');
}

function dotDotDotTokenTest(...args: string[]): void {

}