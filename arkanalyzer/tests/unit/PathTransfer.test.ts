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

import { transfer2UnixPath } from '../../src/utils/pathTransfer';
import { describe, expect, it } from 'vitest';

describe("getAllFiles Test", () => {
    it('normal case 1', () => {
        expect(transfer2UnixPath("\\Users\\abc\\.ssh\\")).toEqual("Users/abc/.ssh");
    })
    it('normal case 2', () => {
        expect(transfer2UnixPath("\\")).toEqual(".");
    })
    it('normal case 3', () => {
        expect(transfer2UnixPath("")).toEqual(".");
    })
    it('normal case 4', () => {
        expect(transfer2UnixPath("\\a\\\\b\\c")).toEqual("a/b/c");
    })
    it('normal case 5', () => {
        expect(transfer2UnixPath("a\\\\b\\c")).toEqual("a/b/c");
    })
    it('normal case 6', () => {
        expect(transfer2UnixPath("\\b\\")).toEqual("b");
    })
})