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

namespace call_param {
    function main() {
        let a: A = new A();
        a.param();
        let b: B = a.id(new B());
    }
    
    class A {
        param(): void {
            let b1: B = new B();
            let b2: B = new B();
            this.foo(b1, b2);
            this.bar(b2, b1);
        }
    
        foo(p1: B, p2: B): void {
        }
    
        bar(p1: B, p2: B): void {
        }
    
        id(b: B): B {
            return b;
        }
    }
    
    class B {
    }
}