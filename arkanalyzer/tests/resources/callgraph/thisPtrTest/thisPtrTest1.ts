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

class Dummy {}

class Sharp {
    d: Dummy;

    constructor(input: Dummy) {
        this.d = input;
    }

    setD(input: Dummy) {
        this.d = input;
    }

    getD(): Dummy {
        return this.d;
    }
}

function main() {
    let d1 = new Dummy();
    let d2 = new Dummy();

    let s1 = new Sharp(d1);
    s1.setD(d2);
    let s2 = s1

    let d3 = s1.getD();
//    let d4 = s2.getD();
}
