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


const TAG = 'ClassTest';
class Animal {
    protected _name: string | undefined;
    public constructor(theName: string){
        this._name = theName;
    }
    public move(distanceInMeters: number = 0){
        logger.info(`${this._name} moved ${distanceInMeters}m.`);
    }

    get name(): string | undefined{
        return this._name;
    }

    set name(newName: string | undefined){
        this._name = newName;
    }

    public print(a: Animal[]): number | null{
        return 0;
    }

    public testArrayReturn(): string[]{
        return [];
    }
}

class Snake extends Animal {
    constructor(name: string){
        super(name);
    }
    move(distanceInMeters = 5){
        logger.info('Slithering...');
        super.move(distanceInMeters);
    }
}

class Horse extends Animal {
    constructor(name: string){
        super(name);
    }
    move(distanceInMeters = 45){
        logger.info('Galloping...');
        super.move(distanceInMeters);
    }
}

export interface StringValidator {
    isAcceptable(s?: string): boolean;
}
export const numberRegexp = /^[0-9]+$/;

export default class ZipCodeValidator implements StringValidator {
    isAcceptable(s?: string){
        return s!.length === 5 && numberRegexp.test(s!);
    }
}
export { ZipCodeValidator, ZipCodeValidator as mainValidator };

export class ParseIntBasedZipCodeValidator {
    isAcceptable(s: string){
        return s.length === 5 && parseInt(s).toString() === s;
    }
}

class ObjectLiteralTest {
    public test: Object = {x: 'n', child: [
        {
            x: 'c',
            child: []
        }
    ]}
}

let formData = {
    'isPlay': false,
    1: 1
}