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

import { describe, expect, it } from 'vitest';
import { ArkField } from '../../../../src/core/model/ArkField';
import { Decorator } from '../../../../src/core/base/Decorator';
import { ModifierType } from '../../../../src/core/model/ArkBaseModel';

describe("ArkField Test", () => {
    it('test getDecorators', async () => {
        let field = new ArkField();
        field.addDecorator(new Decorator('State'));
        field.addDecorator(new Decorator('Link'));
        field.addModifier(ModifierType.STATIC);
        field.addModifier(ModifierType.PUBLIC);
        field.removeModifier(ModifierType.PUBLIC);
        field.removeDecorator('Link');
        expect(field.getModifiers()).eq(ModifierType.STATIC);
        expect(field.getDecorators().length).eq(1);
    })
})