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

namespace static_call {
    class StaticCall {
        static foo(n: number, o: Object): Object {
            if (n > 0) {
                return StaticCall.bar(n, o);
            }
            return o;
        }
    
        static bar(n: number, o: Object): Object {
            return StaticCall.foo(n - 1, o); // 注意，这里使用 n - 1 而不是 n-- 来避免可能的递归调用中的副作用
        }
    }
    
    function main(): void {
        const o = StaticCall.foo(100, new Object());
    }
}



