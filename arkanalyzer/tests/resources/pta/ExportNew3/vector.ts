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

export class Vector {
    public editConfig(): void {
        /**
         * will check `config`, and find it is imported from `config.ts`
         * config.ts/%dflt has been added to funcPag build worklist, and will NOT rebuild the funcPag
         * even though the external copy edge is added, but will not add the pts value into this node
         * because the upstream node is stable, and will not be triggered.
         */
        config.edit();
    }
}