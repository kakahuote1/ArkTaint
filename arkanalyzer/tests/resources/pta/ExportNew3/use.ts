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

import { config } from './config';
import { Vector } from './vector';

function main(): void {
    /**
     * will check `config`, and find it is imported from `config.ts`
     * add config.ts/%dflt to funcPag build worklist for first time, and will add the edge from
     * config(config.ts/%dflt) -> config(use.ts/%dflt)
     */
    config.edit();
    let vector = new Vector();
    vector.editConfig();
}