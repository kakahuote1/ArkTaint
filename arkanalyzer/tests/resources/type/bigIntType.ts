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

class BigIntClass {
    private fieldA: bigint = 1n;
    fieldB: number & bigint;
    static fieldC: bigint | number;

    transfer2String(num: number | bigint): string | bigint {
        if (typeof num === 'bigint') {
            let a = 10n;
            const b: bigint = 100n;
            const c = this.fieldA + 100n;
            return (a + b - c) * a / b + num;
        } else {
            return num.toString();
        }
    }

    testBitOperator(a: bigint, b: bigint): bigint {
        const c = a ^ b & a | b << 1n >> 2n;
        const aa = 123;
        const bb = 456;
        const cc = aa ^ bb & aa | bb << aa >> bb >>> aa;
        return c;
    }
}

type IntersectionType = string & bigint & void;
