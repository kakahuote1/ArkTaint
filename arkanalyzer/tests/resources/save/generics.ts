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

function identity<T>(arg: T): T {
    return arg;
}
let myIdentity: <T>(arg: T) => T = identity;

// TODO: <string> lost
let output = identity<string>('myString');

class GenericNumber<T> {
    zeroValue: T;
    add: (x: T, y: T) => T;
    private methods: Set<string>;
    private calls: Map<string, string[]>;
}

interface Lengthwise {
    length: number;
}

function loggingIdentity<T extends Lengthwise>(arg: T): T {
    logger.info(arg.length);  // Now we know it has a .length property, so no more error
    return arg;
}

declare interface BreakPointTypeOption<T> {
    sm?: T;
    md?: T;
    lg?: T;
}

export class BreakpointType<T> {
    options: BreakPointTypeOption<T>;

    constructor(option: BreakPointTypeOption<T>) {
        this.options = option;
    }

    getValue(currentPoint: string): T {
        if (currentPoint === 'sm') {
            return this.options.sm as T;
        } else if (currentPoint === 'md') {
            return this.options.md as T;
        } else {
            return this.options.lg as T;
        }
    }
}
