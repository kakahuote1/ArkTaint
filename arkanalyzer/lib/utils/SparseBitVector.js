"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparseBitVector = void 0;
const BITWORD_SIZE = 16; // bits of a Word
const DEFAULT_SIZE = 64;
class SparseBitVectorElement {
    constructor(elementSize = DEFAULT_SIZE) {
        this.ELEMENT_SIZE = elementSize;
        this.BITWORDS_NUM = Math.ceil(this.ELEMENT_SIZE / BITWORD_SIZE);
        this.bits = new Uint16Array(this.BITWORDS_NUM);
    }
    word(idx) {
        return this.bits[idx];
    }
    clone() {
        return new Uint16Array(this.bits);
    }
    get elementSize() {
        return this.ELEMENT_SIZE;
    }
    get bitWordNum() {
        return this.BITWORDS_NUM;
    }
    // Check if the element is empty (all bits are zero)
    isEmpty() {
        return this.isZero();
    }
    // Set a bit at the given index
    set(bitIdx) {
        const wordIndex = Math.floor(bitIdx / BITWORD_SIZE);
        const bitOffset = bitIdx % BITWORD_SIZE;
        this.bits[wordIndex] |= 1 << bitOffset;
    }
    setWord(word) {
        this.bits = word;
    }
    // Reset a bit at the given index
    reset(bitIdx) {
        const wordIndex = Math.floor(bitIdx / BITWORD_SIZE);
        const bitOffset = bitIdx % BITWORD_SIZE;
        this.bits[wordIndex] &= ~(1 << bitOffset);
    }
    // Test if a bit is set
    test(bitIdx) {
        const wordIndex = Math.floor(bitIdx / BITWORD_SIZE);
        const bitOffset = bitIdx % BITWORD_SIZE;
        return (this.bits[wordIndex] & (1 << bitOffset)) !== 0;
    }
    // Set if not existing, else return
    test_and_set(bitIdx) {
        let old = this.test(bitIdx);
        if (!old) {
            this.set(bitIdx);
            return true;
        }
        return false;
    }
    // Count the number of set bits in this element
    count() {
        let numBits = 0;
        this.bits.forEach(word => {
            numBits += this.countBits(word);
        });
        return numBits;
    }
    // Find the index of the first set bit in this element
    findFirst() {
        for (let i = 0; i < this.bits.length; i++) {
            if (this.bits[i] !== 0) {
                return i * BITWORD_SIZE + this.countTrailingZeros(this.bits[i]);
            }
        }
        return -1; // No bits are set
    }
    // Find the next set bit after the given index
    findNext(bitIdx) {
        bitIdx++;
        let wordIndex = Math.floor(bitIdx / BITWORD_SIZE);
        let bitOffset = bitIdx % BITWORD_SIZE;
        // Check the current word
        // Mask off previous bits
        let word = this.bits[wordIndex] & (~0 << bitOffset);
        if (word !== 0) {
            return wordIndex * BITWORD_SIZE + this.countTrailingZeros(word);
        }
        // Check subsequent words
        for (let i = wordIndex + 1; i < this.bits.length; i++) {
            if (this.bits[i] !== 0) {
                return i * BITWORD_SIZE + this.countTrailingZeros(this.bits[i]);
            }
        }
        return -1; // No more bits are set
    }
    // Comparison
    equals(rhs) {
        for (let i = 0; i < this.BITWORDS_NUM; i++) {
            if (this.bits[i] !== rhs.word(i)) {
                return false;
            }
        }
        return true;
    }
    // Union this element with another element and return true if this one changed
    unionWith(other) {
        let changed = false;
        for (let i = 0; i < this.bits.length; i++) {
            const oldWord = changed ? 0 : this.bits[i];
            this.bits[i] |= other.bits[i];
            if (!changed && oldWord !== this.bits[i]) {
                changed = true;
            }
        }
        return changed;
    }
    // Intersect this element with another element and return true if this one changed.
    intersectWith(other) {
        let changed = false;
        for (let i = 0; i < this.bits.length; i++) {
            const oldWord = changed ? 0 : this.bits[i];
            this.bits[i] &= other.bits[i];
            if (!changed && oldWord !== this.bits[i]) {
                changed = true;
            }
        }
        return changed;
    }
    // Subtract another SparseBitVectorElement from this one.
    subtractWith(rhs) {
        let changed = false;
        // Perform subtraction: this = this & ~rhs
        for (let i = 0; i < this.bits.length; i++) {
            const oldWord = this.bits[i];
            this.bits[i] &= ~rhs.bits[i];
            // If any bit was changed, mark as changed
            if (this.bits[i] !== oldWord) {
                changed = true;
            }
        }
        return changed;
    }
    // Count the number of set bits in a word
    countBitsV2(word) {
        let count = 0;
        while (word !== 0) {
            word &= word - 1;
            count++;
        }
        return count;
    }
    // Count the number of set bits in a word
    countBits(word) {
        // assume the value is treated as a unsigned integer
        let v = word;
        // Step 1: Pairwise addition of bits
        v = v - ((v >> 1) & 0x55555555);
        // Step 2: Group bits into 4-bit chunks and add
        v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
        // Step 3: Group bits into 8-bit chunks and add
        v = (v + (v >> 4)) & 0xf0f0f0f;
        // Step 4: Multiply by a magic number to sum all 8-bit chunks into the highest byte
        v = (v * 0x1010101) >> 24;
        return v;
    }
    isZero() {
        for (let i = 0; i < this.BITWORDS_NUM; i++) {
            if (this.bits[i] !== 0) {
                return false;
            }
        }
        return true;
    }
    // Count trailing zeros in a word
    countTrailingZeros(word) {
        if (word === 0) {
            return BITWORD_SIZE;
        }
        if ((word & 1) !== 0) {
            return 0;
        }
        let zeroBits = 0;
        let shift = BITWORD_SIZE / 2; // Start with half the bit width
        let mask = (1 << shift) - 1; // Mask for the lower half
        while (shift > 0) {
            if ((word & mask) === 0) {
                word >>= shift;
                zeroBits |= Number(shift);
            }
            shift >>= 1;
            mask >>= shift;
        }
        return zeroBits;
    }
}
class SparseBitVector {
    constructor(elementsSize = DEFAULT_SIZE) {
        // Unordered storage of elements.
        // key is actually the element index (normally it is in element)
        this.elements = new Map();
        this.ELEMENT_SIZE = elementsSize;
    }
    get elementSize() {
        return this.ELEMENT_SIZE;
    }
    get elems() {
        return this.elements;
    }
    // Set a bit at the given index
    set(bitIdx) {
        const elementIndex = Math.floor(bitIdx / this.ELEMENT_SIZE);
        let element = this.elements.get(elementIndex);
        if (!element) {
            element = new SparseBitVectorElement(this.ELEMENT_SIZE);
            this.elements.set(elementIndex, element);
        }
        element.set(bitIdx % this.ELEMENT_SIZE);
    }
    // Test if a bit is set
    test(bitIdx) {
        const elementIndex = Math.floor(bitIdx / this.ELEMENT_SIZE);
        const element = this.elements.get(elementIndex);
        return element ? element.test(bitIdx % this.ELEMENT_SIZE) : false;
    }
    // Set a bit if not existing. Else return
    testAndSet(bitIdx) {
        let old = this.test(bitIdx);
        if (!old) {
            this.set(bitIdx);
            return true;
        }
        return false;
    }
    // Reset a bit at the given index
    reset(bitIdx) {
        const elementIndex = Math.floor(bitIdx / this.ELEMENT_SIZE);
        let element = this.elements.get(elementIndex);
        if (element) {
            element.reset(bitIdx % this.ELEMENT_SIZE);
            if (element.isEmpty()) {
                this.elements.delete(elementIndex);
            }
        }
    }
    // Clear all elements
    clear() {
        this.elements.clear();
    }
    // Clone, return a deep copied object
    clone() {
        const newVector = new SparseBitVector(this.elementSize);
        for (const [idx, element] of this.elements) {
            const newElement = new SparseBitVectorElement(this.elementSize);
            newElement.setWord(element.clone());
            newVector.elems.set(idx, newElement);
        }
        return newVector;
    }
    // Find the first set bit in the vector
    findFirst() {
        if (this.elements.size === 0) {
            return -1;
        }
        const firstElement = this.elements.entries().next().value;
        if (firstElement) {
            const firstBit = firstElement[1].findFirst();
            return firstElement[0] * this.ELEMENT_SIZE + firstBit;
        }
        else {
            return -1;
        }
    }
    // Count the number of set bits in the vector
    count() {
        let count = 0;
        this.elements.forEach((elem, _) => {
            count += elem.count();
        });
        return count;
    }
    // Check if the vector is empty
    isEmpty() {
        return this.elements.size === 0;
    }
    [Symbol.iterator]() {
        let iter = this.elements.entries();
        let next = iter.next();
        const elementSize = this.ELEMENT_SIZE;
        let element = next.value;
        if (!element) {
            return {
                next() {
                    return { value: undefined, done: true };
                },
                [Symbol.iterator]() {
                    return this; // Make the iterator itself iterable
                },
            };
        }
        let bitIndex = element[1].findFirst();
        return {
            next() {
                if (element) {
                    let v = element[0] * elementSize + bitIndex;
                    bitIndex = element[1].findNext(bitIndex);
                    if (bitIndex === -1) {
                        next = iter.next();
                        element = next.value;
                        if (element) {
                            bitIndex = element[1].findFirst();
                        }
                    }
                    return { value: v, done: false };
                }
                return { value: undefined, done: true };
            },
            [Symbol.iterator]() {
                return this; // Make the iterator itself iterable
            },
        };
    }
    /**
     * Check if this SparseBitVector is equal to another SparseBitVector.
     */
    equals(rhs) {
        if (this.ELEMENT_SIZE !== rhs.ELEMENT_SIZE || this.elems.size !== rhs.elems.size) {
            return false;
        }
        let rhsElems = rhs.elems;
        for (let p of this.elements) {
            let rhsElem = rhsElems.get(p[0]);
            if (!rhsElem) {
                return false;
            }
            if (!rhsElem.equals(p[1])) {
                return false;
            }
        }
        return true;
    }
    /**
     * Perform a union operation with another SparseBitVector.
     * Returns True if this vector was changed, false otherwise.
     */
    unionWith(rhs) {
        if (this.equals(rhs) || rhs.elems.size === 0) {
            return false;
        }
        let changed = false;
        let newElems = new Map();
        for (let p of rhs.elems) {
            let elem = this.elements.get(p[0]);
            if (elem) {
                changed = elem.unionWith(p[1]) || changed;
            }
            else {
                newElems.set(p[0], p[1]);
            }
        }
        if (newElems.size > 0) {
            newElems.forEach((v, k) => this.elements.set(k, v));
            changed = true;
        }
        return changed;
    }
    /**
     * Perform an intersection operation with another SparseBitVector.
     * Returns True if this vector was changed, false otherwise.
     */
    intersectWith(rhs) {
        if (this.equals(rhs) || rhs.elems.size === 0) {
            return false;
        }
        let changed = false;
        // If either vector is empty, the result is empty
        if (this.elements.size === 0 || rhs.elems.size === 0) {
            if (this.elements.size > 0) {
                this.elements = new Map();
                changed = true;
            }
            return changed;
        }
        let needDeleteIdx = new Set();
        for (let p of this.elems) {
            let elem = rhs.elems.get(p[0]);
            if (elem) {
                changed = p[1].intersectWith(elem) || changed;
                if (changed && p[1].isZero()) {
                    needDeleteIdx.add(p[0]);
                }
            }
            else {
                needDeleteIdx.add(p[0]);
            }
        }
        if (needDeleteIdx.size > 0) {
            needDeleteIdx.forEach(idx => this.elements.delete(idx));
            changed = true;
        }
        return changed;
    }
    /**
     * Subtract another SparseBitVector from this one.
     * This operation modifies the current SparseBitVector in place.
     * Return True if the current SparseBitVector was modified, false otherwise.
     */
    subtractWith(rhs) {
        if (this.elementSize !== rhs.elementSize || this.isEmpty() || rhs.isEmpty()) {
            return false;
        }
        let needDeleteIdx = new Set();
        let changed = false;
        for (const [elementIndex, element] of this.elements) {
            const rhsElement = rhs.elements.get(elementIndex);
            if (rhsElement) {
                changed = element.subtractWith(rhsElement) || changed;
                if (element.isEmpty()) {
                    needDeleteIdx.add(elementIndex);
                }
            }
        }
        if (needDeleteIdx.size > 0) {
            needDeleteIdx.forEach(idx => this.elements.delete(idx));
            changed = true;
        }
        return changed;
    }
    toString() {
        let ar = [...this];
        return ar.toString();
    }
}
exports.SparseBitVector = SparseBitVector;
