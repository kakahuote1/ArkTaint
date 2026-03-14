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

import { SparseBitVector } from '../../src/utils/SparseBitVector';

const numOperations = 100000; // Number of operations to perform
const maxBitIndex = numOperations; // Maximum bit index to test

function getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
        const memory = process.memoryUsage();
        return memory.heapUsed / 1024 / 1024; // Convert bytes to MB
    } else {
        throw new Error('Memory usage measurement is only supported in Node.js.');
    }
}

function testNormal(): boolean {
    let sbv = new SparseBitVector();
    let setNums = new Set();
    for (let i = 0; i < numOperations / 2; i++) {
        const num = getRandomInt(0, maxBitIndex);
        setNums.add(num);
        sbv.set(num);
    }

    for (let i = 0; i < numOperations; i++) {
        let exp = setNums.has(i);
        let real = sbv.test(i);
        if (exp !== real) {
            console.log('ERROR on test');
            return false;
        }
    }

    let sbv2 = new SparseBitVector();
    let com = new Set();
    for (let i = 0; i < numOperations; i++) {
        const num = getRandomInt(0, numOperations);
        com.add(num);
        sbv2.set(num);
    }

    let i = 0;
    for (let e of sbv2) {
        if (!com.has(e)) {
            console.log('ERROR on iterator');
            return false;
        }
        i++;
    }

    if (com.size !== i) {
        console.log('ERROR on total');
        return false;
    }

    if (com.size !== sbv2.count()) {
        console.log('ERROR on count');
        return false;
    }

    console.log('Test End ' + i);
    return true;
}

function testEQ(): boolean {
    let sbv1 = new SparseBitVector();
    let sbv2 = new SparseBitVector();
    let nums = new Array();
    for (let i = 0; i < numOperations; i++) {
        const num = getRandomInt(0, numOperations);
        nums.push(num);
    }

    nums.forEach(n => sbv1.set(n));
    nums.reverse().forEach(n => sbv2.set(n));

    if (!sbv1.equals(sbv2)) {
        console.log('ERROR on euquals');
        return false;
    }

    sbv2.reset(nums[0]);
    if (sbv1.equals(sbv2)) {
        console.log('ERROR on euquals');
        return false;
    }

    return true;
}

function testUn(): boolean {
    let sbv1 = new SparseBitVector();
    let sbv2 = new SparseBitVector();
    let nums1 = [1, 2, 4, 128];
    let nums2 = [1, 3, 6, 7, 129, 270];
    nums1.forEach(n => sbv1.set(n));
    nums2.forEach(n => sbv2.set(n));

    sbv1.unionWith(sbv2);
    if (sbv1.toString() !== '1,2,3,4,6,7,128,129,270') {
        console.log('ERROR on Union');
        return false;
    }

    return true;
}

function testIt(): boolean {
    let sbv1 = new SparseBitVector();
    let sbv2 = new SparseBitVector();
    let nums1 = [1, 2, 4, 7, 32, 128, 1000, 3000];
    let nums2 = [1, 3, 6, 7, 128, 129, 270, 1000];
    nums1.forEach(n => sbv1.set(n));
    nums2.forEach(n => sbv2.set(n));

    sbv1.intersectWith(sbv2);
    if (sbv1.toString() !== '1,7,128,1000') {
        console.log('ERROR on Union');
        return false;
    }

    return true;
}


// Test the performance of SparseBitVector
function testSparseBitVectorRandomPerformance(): void {
    console.log('\nSBV random test ...');
    const initialMemory = getMemoryUsage();

    const vector = new SparseBitVector(128);

    // Test setting bits
    console.time('setBits');
    for (let i = 0; i < numOperations; i++) {
        const bitIndex = getRandomInt(0, maxBitIndex);
        vector.set(bitIndex);
    }
    console.timeEnd('setBits');

    // Test testing bits
    console.time('testBits');
    for (let i = 0; i < numOperations; i++) {
        const bitIndex = getRandomInt(0, maxBitIndex);
        vector.test(bitIndex);
    }
    console.timeEnd('testBits');

    // Test iterating over set bits
    console.time('iterateBits');
    for (const bitIndex of vector) {
        // Simulate some operation on the set bit
        bitIndex;
    }

    console.timeEnd('iterateBits');
    // Test resetting bits
    console.time('resetBits');
    for (let i = 0; i < numOperations; i++) {
        const bitIndex = getRandomInt(0, maxBitIndex);
        vector.reset(bitIndex);
    }
    console.timeEnd('resetBits');

    console.time('countBits');
    const count = vector.count();
    console.timeEnd('countBits');
    console.log(`Number of set bits: ${count}`);

    const memoryAfterSettingBits = getMemoryUsage();
    console.log(`Memory increase: ${(memoryAfterSettingBits - initialMemory).toFixed(2)} MB`);

}

function testCompareRandomPerformance(): void {
    console.log('\nCompare......');
    const initialMemory = getMemoryUsage();
    const vector = new Array();

    // Test setting bits
    console.time('setBits');
    for (let i = 0; i < numOperations; i++) {
        const bitIndex = getRandomInt(0, maxBitIndex);
        vector.push(bitIndex);
    }
    console.timeEnd('setBits');

    // Test testing bits
    console.time('testBits');
    for (let i = 0; i < numOperations; i++) {
        const bitIndex = getRandomInt(0, maxBitIndex);
        vector.includes(bitIndex);
    }
    console.timeEnd('testBits');

    // Test iterating over set bits
    console.time('iterateBits');
    for (const bitIndex of vector) {
        // Simulate some operation on the set bit
        bitIndex;
    }
    console.timeEnd('iterateBits');

    // Test counting set bits
    console.time('count size');
    const count = vector.length;
    console.timeEnd('count size');
    console.log(`Number of set size: ${count}`);
    const memoryAfterSettingBits = getMemoryUsage();
    console.log(`Memory increase: ${(memoryAfterSettingBits - initialMemory).toFixed(2)} MB`);
}

// Test the performance of SparseBitVector
function testSparseBitVectorNotRandomPerformance(): void {
    console.log('\nSBV not random test ...');
    const initialMemory = getMemoryUsage();

    const vector = new SparseBitVector(128);

    // Test setting bits
    console.time('setBits');
    for (let i = 0; i < numOperations; i++) {
        vector.set(i);
    }
    console.timeEnd('setBits');

    // Test testing bits
    console.time('testBits');
    for (let i = 0; i < numOperations; i++) {
        vector.test(i);
    }
    console.timeEnd('testBits');

    // Test iterating over set bits
    console.time('iterateBits');
    for (const bitIndex of vector) {
        // Simulate some operation on the set bit
        bitIndex;
    }
    console.timeEnd('iterateBits');

    // Test resetting bits
    console.time('resetBits');
    for (let i = 0; i < numOperations; i++) {
        vector.reset(i);
    }
    console.timeEnd('resetBits');

    const memoryAfterSettingBits = getMemoryUsage();
    console.log(`Memory increase: ${(memoryAfterSettingBits - initialMemory).toFixed(2)} MB`);

    console.time('countBits');
    const count = vector.count();
    console.timeEnd('countBits');
    console.log(`Number of set bits: ${count}`);
}

function testCompareNotRandomPerformance(): void {
    console.log('\nCompare Not Random......');
    const initialMemory = getMemoryUsage();
    const vector = new Array();

    // Test setting bits
    console.time('setBits');
    for (let i = 0; i < numOperations; i++) {
        vector.push(i);
    }
    console.timeEnd('setBits');

    // Test testing bits
    console.time('testBits');
    for (let i = 0; i < numOperations; i++) {
        vector.includes(i);
    }
    console.timeEnd('testBits');

    // Test iterating over set bits
    console.time('iterateBits');
    for (const bitIndex of vector) {
        // Simulate some operation on the set bit
        bitIndex;
    }
    console.timeEnd('iterateBits');

    // Test counting set bits
    console.time('count size');
    const count = vector.length;
    console.timeEnd('count size');
    console.log(`Number of set size: ${count}`);
    const memoryAfterSettingBits = getMemoryUsage();
    console.log(`Memory increase: ${(memoryAfterSettingBits - initialMemory).toFixed(2)} MB`);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function test(): boolean {
    let ret = true;
    ret = testNormal() && ret;
    ret = testEQ() && ret;
    ret = testUn() && ret;
    ret = testIt() && ret;
    return ret;
}

// Run the performance test
if (1) {
    sleep(1500);
    testSparseBitVectorRandomPerformance();
    sleep(10000);
    testCompareRandomPerformance();
    console.log('======');
    sleep(10000);
    testSparseBitVectorNotRandomPerformance();
    sleep(10000);
    testCompareNotRandomPerformance();
}

test();
console.log('test finish.');