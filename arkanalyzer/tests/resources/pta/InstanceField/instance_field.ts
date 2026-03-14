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

namespace instance_field {
    class A {
        b: B;
    
        longAP(): void {
            const a = new A();
            a.b = new B();
            a.b.c = new C();
            a.b.c.d = new D();
            const x: D = a.b.c.d;
        }
    
        cycle(): void {
            const a = new A();
            const b = new B();
            b.a = a;
            a.b = b;
            const x: A = b.a.b.a;
        }
    
        callField(): void {
            const a = new A();
            const b = new B();
            a.b = b;
            const c: C = a.b.foo();
        }
    }
    
    class B {
        a: A;
        c: C;
    
        foo(): C {
            const x = new C();
            return x;
        }
    }
    
    class C {
        d: D;
    }
    
    class D {
    }
    
    // Mimicking the Java 'main' method
    function main(): void {
        const a = new A();
        a.longAP();
        a.cycle();
        a.callField();
    }
}