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

import * as t from './exportSample';
import hilog from '@ohos.hilog';
import file from '@ohos.base';
import path from 'path';
import { arr } from './exportSample';

export function cc() {
    t.testing();
    t.z.cc();
    let dd = new t.d();
    dd.dos();
    hilog.info('print log');
    t.MyNameSpace.write();
    let ab = t.default;
    return ab;
}

class test {
    public type() {
        let a: t.MyType = 'type';
        type ss = t.MyType;
        let be = file.BusinessError;
    }
}

let sTest = new test();
export default sTest as test;

arr[3] = 2;