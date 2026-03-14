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

class C {
    public d: number;
    constructor(d: number) {
        this.d = d;
    }
}
class B {
    public c: C;
    constructor(c: C) {
        this.c = c;
    }
}
export class A {
    public b: B;
    constructor(b: B) {
        this.b = b;
    }
}
function tac(){
    const c = new C(10);
    const b = new B(c);
    const a = new A(b);
    const x = 1, y = 2, z = 3;
    console.log((a.b.c.d + x) % y - z);
}

namespace t{
    export namespace t1{
        export class t1c {
            static n=1;
        }
        namespace t11{
            export class t11c {
                static n=1;
            }
        }
    }
    
    namespace t2{
        export class t2c{
            static n=1;
        }
        export namespace t21{
            export class t21c {
                static n=1;
            }
        }
    }
    
}