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

namespace AnoTest {

    class Fru { }

    class Foo {
        fmap: Set<Fru> = new Set();

        fooFun() {
            this.fmap.forEach(elem => {
                gfun(elem);
            })
        }

        handleNum(nu: number) {
            return nu + 1;
        }
    }

    function gfun(fru: Fru) {
        return fru;
    }

    function getArr(a: number[]) {
        return a;
    }

    function main() {
        let foo = new Foo();
        foo.fooFun();

        getArr([1,2]).forEach(n => {
            foo.handleNum(n);
            let f2 = new Foo();
            f2.handleNum(n);
        })
    }
}
