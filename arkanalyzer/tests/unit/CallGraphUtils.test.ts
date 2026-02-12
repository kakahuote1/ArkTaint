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

import { extractLastBracketContent, isItemRegistered, splitStringWithRegex } from '../../src/utils/callGraphUtils';
import { assert, describe, expect, it } from 'vitest';

describe("isItemRegistered Test", () => {
    let arr = [1, 2, 3];
    let isSame = (a: any, b: any): boolean => {
        return a === b;
    }
    it('true case', () => {
        assert.isTrue(isItemRegistered(2, arr, isSame));
    })
    it('false case', () => {
        assert.isFalse(isItemRegistered(0, arr, isSame));
    })
})

describe("splitStringWithRegex Test", () => {
    it('matched case', () => {
        let result = splitStringWithRegex("type.script.test()");
        expect(result.length).toBe(3);
        assert.equal(result[0], "type");
        assert.equal(result[1], "script");
        assert.equal(result[2], "test");
    })
    it('not matched case', () => {
        assert.isEmpty(splitStringWithRegex("testing"));
    })
})

describe("extractLastBracketContent Test", () => {
    it('matched case 1', () => {
        assert.equal(extractLastBracketContent("< string ()>"), "string");
    })
    it('white space matched case', () => {
        assert.isEmpty(extractLastBracketContent("<  ()>"));
    })
    it('not matched case 1', () => {
        assert.isEmpty(extractLastBracketContent("<<>string ()>"));
    })
    it('not matched case 2', () => {
        assert.isEmpty(extractLastBracketContent("testing"));
    })
    it('not matched case 3', () => {
        assert.isEmpty(extractLastBracketContent("<()>"));
    })
})