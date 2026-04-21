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

import { getFileRecursively } from '../../src/utils/FileUtils';
import { describe, expect, it } from 'vitest';

describe('FileUtils Test', () => {
    it('normal case 1', () => {
        let p = getFileRecursively('./tests/resources/viewtree/project/entry', 'oh-package.json5');
        console.log('path: ', p)
        expect(p.endsWith('oh-package.json5')).toBe(true);
    })
    it('normal case 2', () => {
        let p = getFileRecursively('./tests/resources/viewtree/project/entry/src', 'oh-package.json5');
        console.log('path: ', p)
        expect(p.endsWith('oh-package.json5')).toBe(true);
    })
    it('abnormal case 1', () => {
        let p = getFileRecursively('./tests/resources/viewtree/project', 'oh-package.json5');
        console.log('path: ', p)
        expect(p.endsWith('oh-package.json5')).toBe(false);
    })
})