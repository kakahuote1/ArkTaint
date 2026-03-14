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

import { fetchDependenciesFromFile } from '../../src/utils/json5parser';
import { assert, describe, expect, it } from 'vitest';
import path from 'path';

describe("fetchDependenciesFromFile Test", () => {
    it('true case', () => {
        let filePath = path.join(__dirname, '../../package.json');
        let map = fetchDependenciesFromFile(filePath);
        assert.isDefined(map.dependencies);
    })

    it('file does not exist case', () => {
        let filePath = path.join(__dirname, '../../notExist.json');
        let map = fetchDependenciesFromFile(filePath);
        assert.isNotNull(map);
    })

    it('f case', () => {
        let filePath = path.join(__dirname, '../resources/sample/sceneBoard.json5');
        let map = fetchDependenciesFromFile(filePath);
        expect(Object.entries(map.dependencies as Object).length).greaterThan(3);
        assert.isDefined((map.dependencies as Object).hasOwnProperty('@hw-hmos/abxconvertor'));
    })
})