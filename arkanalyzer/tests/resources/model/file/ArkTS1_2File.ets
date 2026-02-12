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

import { A1 } from './ArkTS1_1File';

'use static'

@Component
struct SubComponent {
    build() {
        Column() {
            Text('This is ArkTS 1.2')
        }
    }
}

export namespace A2 {}

export class C2 {
    private field2: string;

    public function2(): void {}
}