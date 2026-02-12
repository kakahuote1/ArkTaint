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

namespace call_field {
    function main() {
        let a: A = new A();
        a.setget();
        a.modifyParam();
    }
    
    class A {
        setget(): void {
            let b: B = new B();
            b.set(new C());
            let c: C = b.get();
        }

        modifyParam(): void {
            let b1: B = new B();
            let b2: B = new B();
            b1.setC(b2);
            let c: C = b2.c;
        }
    }
    
    class B {
        c: C;
    
        set(c: C): void {
            this.c = c;
        }
    
        get(): C {
            return this.c;
        }
    
        setC(b: B): void {
            b.c = new C();
        }
    }
    
    class C {
    }
}