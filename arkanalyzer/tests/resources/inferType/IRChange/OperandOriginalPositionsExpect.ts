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

export const OperandOriginalPositions_Expect_IR = {
    stmts: [
        {
            text: 'this = this: @IRChange/OperandOriginalPositionsTest.ts: Sample',
            operandOriginalPositions: [
                null, null,
            ],
        },
        {
            text: '%0 = new @IRChange/OperandOriginalPositionsTest.ts: Util',
            operandOriginalPositions: [
                [46, 22, 46, 32], [46, 22, 46, 32],
            ],
        },
        {
            text: '%0 = instanceinvoke %0.<@IRChange/OperandOriginalPositionsTest.ts: Util.constructor()>()',
            operandOriginalPositions: [
                [46, 22, 46, 32], [46, 22, 46, 32], [46, 22, 46, 32]
            ],
        },
        {
            text: 'util = %0',
            operandOriginalPositions: [
                [46, 15, 46, 19], [46, 22, 46, 32],
            ],
        },
        {
            text: 'instanceinvoke util.<@IRChange/OperandOriginalPositionsTest.ts: Util.instanceFunc1()>()',
            operandOriginalPositions: [
                [47, 9, 47, 29], [47, 9, 47, 13],
            ],
        },
        {
            text: 'instanceinvoke util.<@IRChange/OperandOriginalPositionsTest.ts: Util.instanceFunc2(number)>(1)',
            operandOriginalPositions: [
                [48, 9, 48, 30], [48, 9, 48, 13], [48, 28, 48, 29],
            ],
        },
        {
            text: 'i = instanceinvoke util.<@IRChange/OperandOriginalPositionsTest.ts: Util.instanceFunc2(number)>(1)',
            operandOriginalPositions: [
                [49, 13, 49, 14], [49, 17, 49, 38], [49, 17, 49, 21], [49, 36, 49, 37],
            ],
        },
        {
            text: '%1 = instanceinvoke util.<@IRChange/OperandOriginalPositionsTest.ts: Util.instanceFunc3(number)>(1)',
            operandOriginalPositions: [
                [50, 19, 50, 40], [50, 19, 50, 40], [50, 19, 50, 23], [50, 38, 50, 39],
            ],
        },
        {
            text: 'i = await %1',
            operandOriginalPositions: [
                [50, 9, 50, 10], [50, 13, 50, 40], [50, 19, 50, 40],
            ],
        },
        {
            text: 'util.<@IRChange/OperandOriginalPositionsTest.ts: Util.instanceField1> = 2',
            operandOriginalPositions: [
                [51, 9, 51, 28], [51, 9, 51, 13], [51, 31, 51, 32],
            ],
        },
        {
            text: 'staticinvoke <@IRChange/OperandOriginalPositionsTest.ts: Util.[static]staticFunc1()>()',
            operandOriginalPositions: [
                [53, 9, 53, 27],
            ],
        },
        {
            text: 'staticinvoke <@IRChange/OperandOriginalPositionsTest.ts: Util.[static]staticFunc2(number)>(2)',
            operandOriginalPositions: [
                [54, 9, 54, 28], [54, 26, 54, 27],
            ],
        },
        {
            text: 'i = staticinvoke <@IRChange/OperandOriginalPositionsTest.ts: Util.[static]staticFunc2(number)>(2)',
            operandOriginalPositions: [
                [55, 9, 55, 10], [55, 13, 55, 32], [55, 30, 55, 31],
            ],
        },
        {
            text: '%2 = staticinvoke <@IRChange/OperandOriginalPositionsTest.ts: Util.[static]staticFunc3(number)>(2)',
            operandOriginalPositions: [
                [56, 19, 56, 38], [56, 19, 56, 38], [56, 36, 56, 37],
            ],
        },
        {
            text: 'i = await %2',
            operandOriginalPositions: [
                [56, 9, 56, 10], [56, 13, 56, 38], [56, 19, 56, 38],
            ],
        },
        {
            text: '@IRChange/OperandOriginalPositionsTest.ts: Util.[static]staticField1 = 1',
            operandOriginalPositions: [
                [57, 9, 57, 26], [57, 29, 57, 30],
            ],
        },
        {
            text: '%3 = @IRChange/OperandOriginalPositionsTest.ts: Util.[static]staticField2',
            operandOriginalPositions: [
                [58, 9, 58, 26], [58, 9, 58, 26],
            ],
        },
        {
            text: '%3[0] = 1',
            operandOriginalPositions: [
                [58, 9, 58, 29], [58, 9, 58, 26], [58, 27, 58, 28], [58, 32, 58, 33],
            ],
        },
        {
            text: 'return',
            operandOriginalPositions: [],
        },
    ],
};